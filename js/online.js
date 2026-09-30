/* Private two-player co-op. The host runs the simulation; the server relays
 * validated input and snapshots. Guests never run world timers or game rules. */
(() => {
  'use strict';
  const PLAYER_FIELDS = ['px', 'py', 'held', 'playerMoveAngle', 'expSetupProg',
    'doingExpSetup', '_durExpSetup', 'activeExpSetupIdx', 'setupSampleId'];
  const WORLD_FIELDS = ['yearTimer', 'ringStab', 'reputation', 'totalSamples', 'yearSamples',
    'pending', 'active', 'commitQueue', 'prepSlotsFor', 'measSlots', 'npcPos',
    'beamDump', 'beamDumpTimer', 'gamePaused', 'remoteFeedback'];
  const select = (object, keys) => Object.fromEntries(keys.map(k => [k, object[k]]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const $ = id => document.getElementById(id);

  class OnlineCoop {
    constructor() {
      this.enabled = false;
      this.started = false;
      this.blocked = false;
      this.epoch = 0;
      this.seq = 0;
      this.keys = new Set();
      this.inputQueue = [];
      this.remoteInput = { x: 0, y: 0, at: 0 };
      this.lastInputSend = 0;
      this.renderUI();
      document.addEventListener('keydown', event => {
        if (!this.isGuest || !this.started || /INPUT|TEXTAREA|BUTTON/.test(event.target.tagName)) return;
        const key = event.code;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Escape'].includes(key)) {
          event.preventDefault();
          this.keys.add(key);
          if (!event.repeat) {
            const action = { Space: 'interact', KeyE: 'pass', Escape: 'pause' }[key];
            if (action) this.sendInput(action);
          }
        }
      });
      document.addEventListener('keyup', event => { this.keys.delete(event.code); });
      window.addEventListener('blur', () => { this.keys.clear(); if (this.isGuest) this.sendInput(); });
      document.addEventListener('visibilitychange', () => {
        this.keys.clear();
        if (!this.enabled) return;
        this.send({ type: 'visibility', visible: !document.hidden });
        this.syncPause();
      });
    }
    get isGuest() { return this.enabled && this.role === 'guest'; }
    renderUI() {
      const panel = document.createElement('section');
      panel.id = 'online-panel';
      panel.setAttribute('aria-label', 'Online co-op');
      panel.innerHTML = `
        <div class="online-card">
          <p class="online-eyebrow">THE BRILLIANT FACILITY</p>
          <h1>Better science.<br><span>Two lab coats.</span></h1>
          <p class="online-description">Run the facility together. Prepare samples, share the workload, and race the beamtime clock.</p>
          <div id="online-entry">
            <button id="online-create" class="primary">Create a private room</button>
            <div class="online-join"><input id="online-code" aria-label="Room code or invite link" placeholder="Room code or invite link" maxlength="300" autocomplete="off"><button id="online-join">Join room</button></div>
            <button id="online-solo" class="quiet">Play solo</button>
          </div>
          <div id="online-lobby" hidden>
            <label class="online-label" for="online-invite">INVITE YOUR TEAMMATE</label>
            <div class="online-join"><input id="online-invite" readonly><button id="online-copy">Copy link</button></div>
            <div id="online-players" class="online-players"></div>
            <div class="online-actions"><button id="online-ready" class="primary">Ready</button><button id="online-start">Start session</button><button id="online-leave" class="quiet">Leave room</button></div>
            <p class="online-footnote">The host chooses proposals and upgrades. Both players control their own scientist. Keep the host’s game open.</p>
          </div>
          <p id="online-message" role="status" aria-live="polite"></p>
          <p class="online-controls">WASD / ARROWS · Move &nbsp; SPACE · Interact &nbsp; E · Pass sample</p>
        </div>`;
      document.body.append(panel);
      const bar = document.createElement('div');
      bar.id = 'online-bar'; bar.hidden = true;
      bar.innerHTML = '<span id="online-status"></span><button id="online-exit">Leave room</button>';
      document.body.append(bar);
      $('online-create').onclick = () => this.connect({ type: 'create' });
      $('online-join').onclick = () => this.join($('online-code').value);
      $('online-code').onkeydown = e => { if (e.key === 'Enter') this.join(e.target.value); };
      $('online-solo').onclick = () => { panel.hidden = true; };
      $('online-ready').onclick = () => this.send({ type: 'ready', ready: !this.room?.players[this.role]?.ready });
      $('online-start').onclick = () => this.send({ type: 'start' });
      $('online-leave').onclick = $('online-exit').onclick = () => this.leave();
      $('online-copy').onclick = async () => {
        try { await navigator.clipboard.writeText($('online-invite').value); this.message('Invite link copied.'); }
        catch { $('online-invite').select(); this.message('Select and copy the invite link above.'); }
      };
    }
    message(text) { $('online-message').textContent = text; }
    join(value) {
      let code = value.trim();
      try { code = new URL(code).searchParams.get('room') || code; } catch {}
      code = code.toUpperCase();
      if (!/^[A-F0-9]{10}$/.test(code)) return this.message('Enter the 10-character room code or the complete invite link.');
      let saved;
      try { saved = JSON.parse(sessionStorage.getItem(`tbf-room-${code}`)); } catch {}
      this.connect({ type: 'join', code, token: saved?.token });
    }
    connect(request, reconnect = false) {
      if (!/^https?:$/.test(location.protocol)) return this.message('Online co-op needs the room server. Run npm start and open http://localhost:3000.');
      if (!reconnect && this.ws && this.ws.readyState < 2) return;
      this.message(reconnect ? 'Reconnecting… the game is paused.' : 'Connecting to the room server…');
      this.intentionalClose = false;
      const ws = this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/coop`);
      let opened = false;
      const timeout = setTimeout(() => { if (ws.readyState < 2) ws.close(); }, 8000);
      ws.onopen = () => { opened = true; this.lastPong = performance.now(); ws.send(JSON.stringify(request)); };
      ws.onmessage = e => {
        let message; try { message = JSON.parse(e.data); } catch { return; }
        if (message.type === 'joined' || message.type === 'error') clearTimeout(timeout);
        this.receive(message);
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        clearTimeout(timeout);
        if (ws !== this.ws || this.intentionalClose) return;
        this.syncPause();
        if (this.enabled && this.token) {
          this.reconnectAt ||= Date.now();
          if (Date.now() - this.reconnectAt < 30_000) {
            this.message('Connection lost. Reconnecting for up to 30 seconds…');
            this.retry = setTimeout(() => this.connect({ type: 'join', code: this.code, token: this.token }, true), 1000);
          } else this.end('Could not reconnect. Create a new room to play again.');
        } else this.message(opened ? 'Disconnected from the room server.' : 'Cannot reach the room server. Open the game through npm start or your deployed server.');
      };
    }
    send(message) {
      if (this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 256 * 1024)
        this.ws.send(JSON.stringify(message));
    }
    receive(m) {
      if (m.type === 'pong') { this.lastPong = performance.now(); this.syncPause(); return; }
      if (m.type === 'error') {
        if (this.enabled) this.end(m.message);
        else { this.message(m.message); this.intentionalClose = true; this.ws.close(); }
        return;
      }
      if (m.type === 'ended') { this.end(m.reason); return; }
      if (m.type === 'joined') {
        // A refreshed host tab has lost its simulation. Do not silently start a new world.
        if (m.role === 'host' && m.started && !this.started) {
          this.send({ type: 'leave' }); this.end('The host game was reloaded. Create a new room to restart.'); return;
        }
        this.enabled = true; this.role = m.role; this.code = m.code; this.token = m.token;
        this.reconnectAt = 0; this.seq = 0;
        sessionStorage.setItem(`tbf-room-${m.code}`, JSON.stringify({ token: m.token }));
        window._bot?.stop();
        GW = 1280; GH = 800; this.game.scale.setGameSize(GW, GH);
        $('online-entry').hidden = true; $('online-lobby').hidden = false;
        const url = new URL(location.href); url.search = ''; url.searchParams.set('room', m.code); url.hash = '';
        $('online-invite').value = url.href;
        history.replaceState(null, '', url);
        this.message(m.role === 'host' ? 'Share the link with your teammate, then both click Ready.' : 'You joined as Player 2. Click Ready when you’re set.');
        this.send({ type: 'visibility', visible: !document.hidden });
        if (m.started) this.begin(false);
        return;
      }
      if (m.type === 'room') {
        this.room = m;
        $('online-players').textContent = ['host', 'guest'].map((role, i) => {
          const p = m.players[role];
          return `P${i + 1}${role === this.role ? ' (you)' : ''}: ${!p ? 'Waiting for teammate' : !p.connected ? 'Reconnecting' : p.ready ? 'Ready' : 'Not ready'}`;
        }).join('   ·   ');
        const ready = !!m.players[this.role]?.ready;
        $('online-ready').textContent = ready ? 'Not ready' : 'Ready';
        $('online-ready').setAttribute('aria-pressed', String(ready));
        $('online-start').hidden = this.role !== 'host';
        $('online-start').disabled = !Object.values(m.players).every(p => p?.connected && p.ready && p.visible);
        this.syncPause(); return;
      }
      if (m.type === 'started') { this.begin(true); return; }
      if (m.type === 'input' && this.role === 'host') {
        if (m.epoch === this.epoch) {
          this.remoteInput = { ...m, at: performance.now() };
          if (m.action && this.inputQueue.length < 30) this.inputQueue.push(m.action);
        }
        return;
      }
      if (m.type === 'snapshot' && this.isGuest) this.receiveSnapshot(m);
    }
    begin(startHost) {
      this.started = true;
      document.activeElement?.blur();
      $('online-panel').hidden = true; $('online-bar').hidden = false;
      document.body.classList.add('online-playing'); this.game.scale.refresh();
      if (startHost && this.role === 'host') {
        this.game.scene.getScenes(true).forEach(s => this.game.scene.stop(s.scene.key));
        this.game.scene.start('ProposalReview', { cycle: 1, cycleInYear: 1, year: 1,
          reputation: 0, ringBase: 98, funding: 200000,
          upgrades: { prepCap: 1, measCap: 1, prepSpeedMap: { prep: 1, prep2: 1 },
            measSpeedMap: [1, 1, 1, 1], extraJobSlots: 0, postdocs: 0, postdocLevels: [], postdocNames: [], ringMaint: false } });
      }
      this.syncPause();
    }
    attach(game) {
      this.game = game;
      this.interval = setInterval(() => {
        if (!this.enabled) return;
        if (performance.now() - (this.lastPing || 0) > 1000) { this.send({ type: 'ping' }); this.lastPing = performance.now(); }
        this.syncPause();
        if (this.started && this.role === 'host') this.publish();
        if (this.started && this.isGuest) this.sendInput();
      }, 50);
      const code = new URLSearchParams(location.search).get('room');
      if (code) { $('online-code').value = code; this.join(code); }
    }
    installScenes(classes) {
      for (const Scene of classes) {
        const init = Scene.prototype.init;
        Scene.prototype.init = function(data) {
          this.onlineData = clone(data || {});
          this.onlineProposals = data?.onlineProposals;
          if (init) init.call(this, data);
        };
        const create = Scene.prototype.create;
        const coop = this;
        Scene.prototype.create = function(...args) {
          // Phaser reuses scene instances, including their disabled input/clock plugins.
          this.input.enabled = !coop.isGuest;
          this.input.keyboard.enabled = !coop.isGuest;
          this.time.paused = false;
          create.apply(this, args);
          if (!coop.enabled || !coop.started) return;
          coop.scene = this;
          if (coop.role === 'host') { coop.epoch++; coop.inputQueue = []; coop.remoteInput = { x: 0, y: 0, at: 0 }; }
          else { this.input.enabled = false; this.input.keyboard.enabled = false; this.time.paused = true; }
          if (this.scene.key === 'Game') coop.createOther(this);
          if (coop.isGuest && this.scene.key !== 'Game') {
            const render = () => coop.applySnapshot(this);
            this.events.on('postupdate', render);
            this.events.once('shutdown', () => this.events.off('postupdate', render));
          }
          coop.syncPause();
        };
      }
    }
    syncPause() {
      if (!this.enabled) return;
      this.blocked = this.ws?.readyState !== WebSocket.OPEN || document.hidden
        || performance.now() - (this.lastPong || 0) > 3500
        || !this.room || !Object.values(this.room.players).every(p => p?.connected && p.visible);
      if (this.blocked) { this.keys.clear(); this.inputQueue = []; this.remoteInput = { x: 0, y: 0, at: 0 }; }
      const scene = this.scene;
      if (scene?.sys?.isActive()) {
        scene.time.paused = this.isGuest || this.blocked || !!scene.gamePaused;
        scene.input.enabled = !this.isGuest && !this.blocked;
      }
      const text = this.blocked ? 'Session paused · waiting for both players to reconnect / return'
        : scene?.gamePaused ? 'Session paused · press Esc to resume'
        : scene?.scene.key === 'Game' ? `P${this.isGuest ? 2 : 1} · WASD / arrows: move · Space: interact · E: pass · Esc: pause`
        : this.isGuest ? 'Your host is choosing proposals / upgrades. You’ll play together when the cycle starts.'
        : 'You’re the host · choose proposals / upgrades for your team';
      $('online-status').textContent = text;
      $('online-bar').classList.toggle('waiting', !!this.blocked || !!scene?.gamePaused);
    }
    publish() {
      const s = this.scene;
      if (!s?.sys?.isActive()) return;
      const data = { ...s.onlineData };
      let state;
      if (s.scene.key === 'Game') {
        state = { ...select(s, WORLD_FIELDS), host: select(s, PLAYER_FIELDS), guest: s.coopOther,
          postdocs: s.postdocs.map(p => select(p, ['x', 'y', 'state', 'assignedAction', 'name', 'level'])) };
      } else {
        if (s.scene.key === 'ProposalReview') { data.onlineProposals = s.proposals; data.beamlineTechs = s.beamlineTechs; }
        // Between-cycle screens are host controlled. Mirror their visible labels and selections.
        state = { view: s.children.list.map(o => select(o, ['text', 'visible', 'alpha', 'fillColor', 'fillAlpha', 'strokeColor', 'strokeAlpha', 'lineWidth'])) };
      }
      this.send({ type: 'snapshot', scene: s.scene.key, epoch: this.epoch, data, state });
    }
    receiveSnapshot(m) {
      if (m.epoch < this.epoch) return;
      if (this.epoch !== m.epoch || this.scene?.scene.key !== m.scene) {
        this.epoch = m.epoch; this.keys.clear();
        this.game.scene.getScenes(true).forEach(s => this.game.scene.stop(s.scene.key));
        this.game.scene.start(m.scene, m.data);
      }
      this.pendingSnapshot = m;
      this.lastSnapshotAt = performance.now();
    }
    applySnapshot(s) {
      const packet = this.pendingSnapshot;
      if (!packet || s.scene.key !== packet.scene) return;
      this.pendingSnapshot = null;
      const state = packet.state;
      if (s.scene.key !== 'Game') {
        state.view?.forEach((v, i) => {
          const o = s.children.list[i]; if (!o) return;
          if (v.text !== undefined && o.setText) o.setText(v.text);
          o.setVisible(v.visible); o.setAlpha(v.alpha);
          if (o.setFillStyle && v.fillColor !== undefined) o.setFillStyle(v.fillColor, v.fillAlpha);
          if (o.setStrokeStyle && v.lineWidth !== undefined) o.setStrokeStyle(v.lineWidth, v.strokeColor, v.strokeAlpha);
        });
        return;
      }
      if (!state.guest || !state.host) return;
      const oldX = s.px, oldY = s.py;
      Object.assign(s, select(state, WORLD_FIELDS), state.guest);
      s.coopOther = state.host;
      // Smooth small corrections while walking; snap larger corrections and scene spawns.
      if (this.hasPosition && !this.blocked && !s.gamePaused && Math.hypot(oldX-s.px, oldY-s.py) < 60) {
        const x = oldX + (s.px-oldX) * 0.4, y = oldY + (s.py-oldY) * 0.4;
        if (s.isValidPos(x, y, 12)) { s.px = x; s.py = y; }
      }
      this.hasPosition = true;
      state.postdocs?.forEach((p, i) => {
        if (!s.postdocs[i]) return;
        Object.assign(s.postdocs[i], p); s.postdocs[i].grp.setPosition(p.x, p.y); s.postdocs[i].label.setText(p.state);
      });
      s.npcPos.forEach((p, i) => s.npcs[i].grp.setPosition(p.x, p.y));
      s.refreshJobs(); s.refreshNPCs(); s.redrawBeam();
      s.timerTxt.setText(s.daysLeft(s.yearTimer)); s.repTxt.setText(`⭐ ${s.reputation} rep`);
      s.sampTxt.setText(`⬡ ${s.totalSamples} samples`);
      s.showDumpOverlay(s.beamDump);
      s.pauseOverlay.setAlpha(s.gamePaused ? .5 : 0);
      s.pauseTxt.setAlpha(s.gamePaused ? 1 : 0);
      s.pauseHint.setAlpha(s.gamePaused ? 1 : 0);
      s.dumpCountdown.setText(`measurements paused — ${(s.beamDumpTimer / 2).toFixed(1)} days remaining`);
      if (state.remoteFeedback && state.remoteFeedback.at !== this.lastFeedback) {
        this.lastFeedback = state.remoteFeedback.at;
        s.statusTxt.setText(state.remoteFeedback.msg).setStyle({ color: state.remoteFeedback.color });
        this.feedbackUntil = performance.now() + 2800;
      }
      for (const j of s.active) {
        const npc = s.npcs[j.npcSlot]; if (!npc || !j.leaveMsTotal) continue;
        const f = 1 - Math.max(0, j.leaveMs) / j.leaveMsTotal;
        npc.leaveBarFill.setDisplaySize(Math.max(1, 28*f), 4).setFillStyle(f > .75 ? 0xff4433 : f > .5 ? 0xffaa33 : 0x44cc88);
      }
      this.syncPause();
    }
    axes() {
      const has = (...codes) => codes.some(k => this.keys.has(k));
      return { x: Number(has('KeyD', 'ArrowRight')) - Number(has('KeyA', 'ArrowLeft')),
        y: Number(has('KeyS', 'ArrowDown')) - Number(has('KeyW', 'ArrowUp')) };
    }
    sendInput(action = null) {
      if (!this.isGuest || !this.started || this.scene?.scene.key !== 'Game' || this.blocked) return;
      this.send({ type: 'input', seq: ++this.seq, epoch: this.epoch, ...this.axes(), action });
    }
    createOther(s) {
      this.hasPosition = false;
      const angle = Math.atan2(s.py - s.CY, s.px - s.CX) + 0.15;
      const radius = Math.hypot(s.px-s.CX, s.py-s.CY);
      let px = s.CX + Math.cos(angle)*radius, py = s.CY + Math.sin(angle)*radius;
      if (!s.isValidPos(px, py, 12)) { px = s.px; py = s.py; }
      s.coopOther = { px, py, held: [], playerMoveAngle: 0, expSetupProg: 0,
        doingExpSetup: false, _durExpSetup: 2, activeExpSetupIdx: -1, setupSampleId: null };
      s.pauseSaveTxt.setText('Leave online room');
      if (this.isGuest) s.add.text(GW - 130, s.HUD_H + 40, 'HOST MANAGES PROPOSALS', {font:'9px Arial',color:'#526b78'}).setOrigin(.5).setDepth(30);
      s.pCon.list[1].setFillStyle(this.isGuest ? 0x18aaa5 : C.hat);
      s.pCon.list[2].setText(this.isGuest ? 'P2 · YOU' : 'P1 · YOU');
      s.otherSprite = s.add.container(px, py).setDepth(10);
      s.otherSprite.add([s.add.circle(0, 0, 13, C.player),
        s.add.circle(0, -9, 7, this.isGuest ? C.hat : 0x18aaa5),
        s.add.text(0, 18, this.isGuest ? 'P1' : 'P2', { font: 'bold 12px Arial', color: '#0a3a8a' }).setOrigin(.5)]);
      s.otherInventory = s.add.text(px, py-28, '', { font: 'bold 12px Arial', color: '#126a66', backgroundColor: '#ffffff' }).setOrigin(.5).setDepth(20);
      s.otherSetupBar = new ProgressBar(s, 0, 0, 60, 8, { bgColor: 0xddeef8, bgAlpha: 1, depth: 22 });
    }
    withOther(s, fn) {
      const host = select(s, PLAYER_FIELDS), other = s.coopOther;
      Object.assign(s, other); s.coopOther = host; s._actingRemote = true;
      try { fn(); }
      finally {
        Object.assign(other, select(s, PLAYER_FIELDS));
        Object.assign(s, host); s.coopOther = other; s._actingRemote = false;
      }
    }
    updateOther(s, delta) {
      if (!this.enabled || this.role !== 'host' || !s.coopOther || this.blocked) return;
      const actions = this.inputQueue.splice(0);
      for (const action of actions) {
        if (action === 'pause') s.togglePause();
        else if (!s.gamePaused) this.withOther(s, () => action === 'pass' ? s.passSample() : s.tryInteract());
      }
      if (s.gamePaused) return;
      const input = performance.now() - this.remoteInput.at < 250 ? this.remoteInput : { x: 0, y: 0 };
      this.withOther(s, () => {
        s.movePlayer(input.x, input.y, delta / 1000);
        s.updateExperimentSetup(delta / 1000);
      });
    }
    updateGuest(s, delta) {
      this.applySnapshot(s);
      if (!this.blocked && !s.gamePaused && performance.now()-this.lastSnapshotAt < 500) {
        const { x, y } = this.axes();
        s.movePlayer(x, y, Math.min(delta, 50) / 1000);
      }
      s.pCon.setPosition(s.px, s.py);
      s.renderPlayer(); s.updateStationBars(s.time.now); s.renderWorld(); this.renderOther(s);
      if (performance.now() > (this.feedbackUntil || 0)) s.statusTxt.setText('');
    }
    renderOther(s) {
      if (!this.enabled || !s.coopOther || !s.otherSprite) return;
      const p = s.coopOther;
      s.otherSprite.setPosition(p.px, p.py);
      const icons = p.held.map(h => h.stage === 'raw' ? ((h.labType || 'dry') === 'wet' ? 'W' : 'D') : h.stage === 'prepped' ? 'P' : '✓');
      s.otherInventory.setPosition(p.px, p.py-30).setText(icons.join(' · '));
      if (p.doingExpSetup && p.activeExpSetupIdx >= 0) {
        const st = s.stDefs[s.beamlines[p.activeExpSetupIdx].lockKey];
        s.otherSetupBar.setPosition(st.boxCX-30, st.boxCY+26).setFraction(p.expSetupProg).setLabel(this.isGuest ? 'P1 SETUP' : 'P2 SETUP', '#126a66').show();
      } else s.otherSetupBar.hide();
    }
    leave() { this.send({ type: 'leave' }); this.end('You left the room.'); }
    end(reason) {
      this.intentionalClose = true; clearTimeout(this.retry); this.ws?.close();
      if (this.code) sessionStorage.removeItem(`tbf-room-${this.code}`);
      document.body.classList.remove('online-playing');
      this.enabled = false; this.started = false; this.blocked = false; this.room = null;
      this.token = null; this.scene = null; this.epoch = 0; this.keys.clear(); this.pendingSnapshot = null;
      this.game?.scene.getScenes(true).forEach(s => this.game.scene.stop(s.scene.key));
      this.game?.scene.start('Tutorial');
      const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url);
      $('online-panel').hidden = false; $('online-bar').hidden = true;
      $('online-entry').hidden = false; $('online-lobby').hidden = true;
      this.message(reason);
    }
  }
  window.coop = new OnlineCoop();
})();
