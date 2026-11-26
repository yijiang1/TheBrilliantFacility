// ════════════════════════════════════════════════════════════════
//  ROBOTS — the automation path (M2.5)
//
//  Robots take over the sample loop one step at a time, bought from the
//  Robots tab of the cycle-end shop. Numbers live in RULES.robots (data.js).
//
//    Prep Bot       parks at a lab; prep runs with nobody there
//    Console Bot    parks in a control room; starts, runs and collects scans
//    Hutch Bot      parks in a hutch; takes prepped samples, does the setup,
//                   loads the beamline and realigns motor slips
//    Courier Bot    walks prepped samples from the labs to Hutch Bots
//    Reception Bot  walks raw samples from users to the labs
//    Facility OS    accepts proposals and brings in users
//
//  Owning every robot plus the Facility OS makes the next cycle a victory
//  lap: the facility runs itself and the player just watches.
//
//  State lives in upgrades.robots:
//    { prep:{prep,prep2}, console:[4], hutch:[4], courier:n, reception:n, osStages:n, os }
//
//  This file adds methods to GameScene and loads after game.js.
// ════════════════════════════════════════════════════════════════

function emptyRobots() {
  return { prep: { prep: false, prep2: false }, console: [false, false, false, false],
           hutch: [false, false, false, false], courier: 0, reception: 0, osStages: 0, os: false };
}

// The first cycle a Facility OS install stage (0-based) can work toward: stage i is sold in the shop
// after cycle (fromCycle - stages + i), the last one in the shop after cycle fromCycle-1.
function osStageCycle(i) {
  const c = RULES.robots.facilityOS;
  return c.fromCycle - (c.stages - 1) + i;
}

// How many of the robots the Facility OS needs are owned, and how many are needed.
function robotProgress(robots) {
  const r = robots || emptyRobots();
  const R = RULES.robots;
  const owned = (r.prep.prep ? 1 : 0) + (r.prep.prep2 ? 1 : 0)
    + r.console.filter(Boolean).length + r.hutch.filter(Boolean).length
    + Math.min(r.courier, R.courierBot.max) + Math.min(r.reception, R.receptionBot.max);
  const needed = R.prepBot.max + R.consoleBot.max + R.hutchBot.max + R.courierBot.max + R.receptionBot.max;
  return { owned, needed, complete: owned >= needed };
}

const ROBOT_STYLE = {
  prepBot:      { badge: 'PRP', color: 0x5a7a9a },
  consoleBot:   { badge: 'CON', color: 0x3a8a7a },
  hutchBot:     { badge: 'HUT', color: 0x9a5a3a },
  courierBot:   { badge: 'CUR', color: 0x6a4a9a },
  receptionBot: { badge: 'REC', color: 0x9a7a2a },
};

Object.assign(GameScene.prototype, {

  // ── Setup ──────────────────────────────────────────────────
  buildRobots() {
    const R = this.upgrades.robots = Object.assign(emptyRobots(), this.upgrades.robots || {});
    this.robots = [];
    this.hutchRack  = [[], [], [], []];      // samples handed to each Hutch Bot
    this.hutchSetup = [null, null, null, null];
    this.victoryLap = !!R.os && robotProgress(R).complete;

    const add = (kind, key) => this.robots.push(this._makeRobot(kind, key));
    for (const pk of this.prepKeys) if (R.prep[pk]) add('prepBot', pk);
    R.console.forEach((on, i) => { if (on) add('consoleBot', i); });
    R.hutch.forEach((on, i) => { if (on) add('hutchBot', i); });
    for (let i = 0; i < R.courier; i++) add('courierBot', i);
    for (let i = 0; i < R.reception; i++) add('receptionBot', i);

    if (R.os) {
      this.osLabel = this.add.text(this.CX, this.CY + 22, '🤖 FACILITY OS ONLINE',
        { font: 'bold 11px Arial', color: '#2a7a6a', letterSpacing: 1 }).setOrigin(0.5).setDepth(6);
    }
    if (this.victoryLap) {
      this.add.rectangle(GW / 2, this.HUD_H + 14, GW, 24, 0x0a3a2a, 0.9).setOrigin(0.5).setDepth(30);
      this.add.text(GW / 2, this.HUD_H + 14, '🏆 FULLY AUTOMATED — victory lap: the robots run everything, sit back and watch',
        { font: 'bold 12px Arial', color: '#9effd8' }).setOrigin(0.5).setDepth(31);
    }
    this._osTimer = 0;
  },

  _makeRobot(kind, key) {
    const st = ROBOT_STYLE[kind];
    const walker = kind === 'courierBot' || kind === 'receptionBot';
    const home = walker ? this._robotHome(key + (kind === 'receptionBot' ? 2 : 0)) : this._robotPost(kind, key);
    const grp = this.add.container(home.x, home.y).setDepth(9);
    grp.add([
      this.add.ellipse(0, 11, 24, 7, 0x000000, 0.18),
      this.add.rectangle(0, 0, 20, 18, st.color).setStrokeStyle(1, 0x223344),
      this.add.rectangle(0, -3, 14, 5, 0xaee8ff),
      this.add.line(0, 0, 0, -9, 0, -14, 0x223344).setLineWidth(1),
      this.add.circle(0, -14, 2, 0xff5544),
      this.add.text(0, 5, st.badge, { font: 'bold 7px Arial', color: '#ffffff' }).setOrigin(0.5),
    ]);
    const label = this.add.text(0, -24, '', { font: '9px Arial', color: '#556677' }).setOrigin(0.5);
    grp.add(label);
    return { kind, key, walker, x: home.x, y: home.y, grp, label, held: [], task: null,
             fault: false, rebootMs: 0, faultMs: 0, thinkMs: 0 };
  },

  // Where a station robot parks: just inside its room.
  _robotPost(kind, key) {
    if (kind === 'prepBot') {
      const st = this.stDefs[key];
      return { x: st.x + 74, y: st.y };
    }
    const bl = this.beamlines[key];
    const st = this.stDefs[kind === 'consoleBot' ? bl.measKey : bl.lockKey];
    const out = Math.hypot(st.boxCX - this.CX, st.boxCY - this.CY) || 1;
    return { x: st.boxCX + (st.boxCX - this.CX) / out * 14, y: st.boxCY + (st.boxCY - this.CY) / out * 14 };
  },

  _robotHome(i) {
    const a = Math.PI * (0.1 + 0.5 * i);
    const r = (this.RING_RAD + this.PREP_RAD) / 2;
    return { x: this.CX + Math.cos(a) * r, y: this.CY + Math.sin(a) * r };
  },

  // Is a robot of this kind at this station and not broken down?
  robotWorking(kind, key) {
    return !!this.robots && this.robots.some(r => r.kind === kind && r.key === key && !r.fault);
  },

  // Samples walkers are carrying go with a departing user, like samples in the player's hands.
  // (Samples already handed to a Hutch Bot count as in flight and keep going.)
  _dropRobotSamples(jobId) {
    let n = 0;
    for (const r of this.robots || []) {
      const before = r.held.length;
      r.held = r.held.filter(h => h.jobId !== jobId);
      n += before - r.held.length;
    }
    return n;
  },

  // Player hands a prepped sample to a Hutch Bot (called from tryInteract).
  handToHutchBot(blIdx) {
    if (!this.robotWorking('hutchBot', blIdx)) return false;
    const tech = this.beamlineTechs[blIdx];
    const idx = this.held.findIndex(h => {
      if (h.stage !== 'prepped') return false;
      const job = this.active.find(a => a.id === h.jobId);
      return job && job.tech === tech;
    });
    if (idx < 0) return false;
    if (this.hutchRack[blIdx].length >= 2) { this.flash(`BL-${blIdx+1} Hutch Bot rack is full — wait a moment`, '#ff8833'); return true; }
    const item = this.held.splice(idx, 1)[0];
    this.hutchRack[blIdx].push(item);
    this.flash(`🤖 Sample handed to the BL-${blIdx+1} Hutch Bot`, '#44aaff');
    this.refreshJobs(); this.refreshNPCs();
    return true;
  },

  // ── Per-frame update ───────────────────────────────────────
  updateRobots(delta) {
    if (!this.robots) return;
    if (this.robots.length || this.upgrades.robots.os) {
      this._updateConsoleBots();
      this._updateHutchBots(delta);
      for (const r of this.robots) {
        if (r.fault) { this._updateFault(r, delta); continue; }
        if (r.walker) this._updateWalker(r, delta);
      }
      if (this.upgrades.robots.os) this._updateFacilityOS(delta);
    }
    this._renderRobots();
  },

  _updateConsoleBots() {
    for (const s of this.measSlots) {
      if (!s.started && !s.toStage && this.robotWorking('consoleBot', s.blIdx)) s.started = true;
    }
    for (let bl = 0; bl < this.beamlines.length; bl++) {
      if (this.robotWorking('consoleBot', bl) && this.measSlots.some(s => s.toStage === 'meas_ready' && s.blIdx === bl)) {
        this._collectMeasResult(bl, 'Console Bot');
      }
    }
  },

  _updateHutchBots(delta) {
    for (let bl = 0; bl < this.beamlines.length; bl++) {
      if (!this.robotWorking('hutchBot', bl)) continue;
      const rack = this.hutchRack[bl];
      let job = this.hutchSetup[bl];
      if (!job && rack.length && this.measSlots.filter(s => s.blIdx === bl).length < this.measCap) {
        const item = rack.shift();
        const j = item && this.active.find(a => a.id === item.jobId);
        if (!j) continue;
        const dur = j.setupDurs?.length ? j.setupDurs.shift() : Phaser.Math.FloatBetween(DUR_EXP_SETUP_MIN, DUR_EXP_SETUP_MAX);
        job = this.hutchSetup[bl] = { item, leftMs: dur * 1000 };
      }
      if (!job) continue;
      job.leftMs -= delta;
      if (job.leftMs > 0) continue;
      this.hutchSetup[bl] = null;
      const j = this.active.find(a => a.id === job.item.jobId);
      if (!j) continue;
      const dur = j.measDurs?.length ? j.measDurs.shift()
        : Phaser.Math.FloatBetween(DUR_MEAS_MIN, DUR_MEAS_MAX) * (this._measSpeedMap[bl] || 1.0);
      this.measSlots.push({ sampleId: job.item.sampleId, jobId: j.id, remaining: dur * 1000, total: dur * 1000, blIdx: bl, started: false });
      this._rollMotorSlip(this.measSlots[this.measSlots.length - 1]);
      this.redrawBeam();
      if (!this.robotWorking('consoleBot', bl)) this.flash(`🤖 BL-${bl+1} loaded by the Hutch Bot — start it in the Control Room`, '#44ccff');
      this.refreshJobs(); this.refreshNPCs();
    }
  },

  // ── Walkers (courier and reception) ────────────────────────
  _updateWalker(r, delta) {
    r.thinkMs -= delta;
    if (r.thinkMs <= 0 || !r.task) {
      r.thinkMs = 300;
      r.task = r.kind === 'courierBot' ? this._courierTask(r) : this._receptionTask(r);
    }
    const t = r.task;
    if (!t) { r.label.setText(''); return; }
    r.label.setText(t.label);
    if (!this._robotStep(r, delta, t.x, t.y)) return;
    // Arrived
    if (t.type === 'pickupPrep') {
      const slots = this.prepSlotsFor[t.pk];
      const i = slots.indexOf(t.slot);
      if (i >= 0 && slots[i].toStage === 'prepped_ready') {
        const s = slots.splice(i, 1)[0];
        r.held.push({ sampleId: s.sampleId, jobId: s.jobId, stage: 'prepped', degradeMs: s.degradeMs, degradeTotal: s.degradeTotal });
        this.refreshJobs();
      }
    } else if (t.type === 'deliverHutch') {
      if (r.held.length && this.robotWorking('hutchBot', t.bl) && this.hutchRack[t.bl].length < 2) {
        this.hutchRack[t.bl].push(r.held.shift());
        this.refreshJobs();
      }
    } else if (t.type === 'collectUser') {
      const j = this.active.find(a => a.id === t.jobId);
      if (j && j.unstarted > 0 && !j.npcGone && j.npcSlot >= 0) {
        r.held.push({ sampleId: ++this.sampleIdCtr, jobId: j.id, stage: 'raw', labType: j.labType || 'dry' });
        j.unstarted--;
        this.refreshJobs(); this.refreshNPCs();
      }
    } else if (t.type === 'depositLab') {
      const slots = this.prepSlotsFor[t.pk];
      if (slots.length < this.prepCap && r.held.length) {
        const item = r.held.shift();
        const j = this.active.find(a => a.id === item.jobId);
        const dur = j?.prepDurs?.length ? j.prepDurs.shift()
          : Phaser.Math.FloatBetween(DUR_PREP_MIN, DUR_PREP_MAX) * (this._prepSpeedMap[t.pk] || 1.0);
        slots.push({ sampleId: item.sampleId, jobId: item.jobId, remaining: dur * 1000, total: dur * 1000 });
        this.refreshJobs(); this.refreshNPCs();
      }
    }
    r.task = null;
  },

  _courierTask(r) {
    if (r.held.length) {
      const j = this.active.find(a => a.id === r.held[0].jobId);
      const bl = j ? this.beamlineTechs.indexOf(j.tech) : -1;
      if (bl < 0) { r.held.shift(); return null; }
      const st = this.stDefs[this.beamlines[bl].lockKey];
      return { type: 'deliverHutch', bl, x: st.boxCX, y: st.boxCY, label: `→ BL-${bl+1}` };
    }
    const claimed = new Set(this.robots.filter(o => o !== r && o.task?.slot).map(o => o.task.slot));
    for (const pk of this.prepKeys) {
      for (const s of this.prepSlotsFor[pk]) {
        if (s.toStage !== 'prepped_ready' || claimed.has(s)) continue;
        const j = this.active.find(a => a.id === s.jobId);
        const bl = j ? this.beamlineTechs.indexOf(j.tech) : -1;
        if (bl < 0 || !this.robotWorking('hutchBot', bl) || this.hutchRack[bl].length >= 2) continue;
        const st = this.stDefs[pk];
        return { type: 'pickupPrep', pk, slot: s, x: st.x, y: st.y, label: '→ lab' };
      }
    }
    return null;
  },

  _receptionTask(r) {
    if (r.held.length) {
      const pk = r.held[0].labType === 'wet' ? 'prep' : 'prep2';
      const st = this.stDefs[pk];
      return { type: 'depositLab', pk, x: st.x, y: st.y, label: this.prepSlotsFor[pk].length < this.prepCap ? '→ lab' : 'waiting' };
    }
    const claimed = new Set(this.robots.filter(o => o !== r && o.task?.jobId !== undefined).map(o => o.task.jobId));
    const waiting = this.active
      .filter(j => j.unstarted > 0 && !j.npcGone && j.npcSlot >= 0 && !claimed.has(j.id))
      .sort((a, b) => (a.leaveMs ?? Infinity) - (b.leaveMs ?? Infinity));
    const j = waiting[0];
    if (!j) return null;
    const pos = this.npcPos[j.npcSlot];
    return { type: 'collectUser', jobId: j.id, x: pos.x, y: pos.y, label: '→ user' };
  },

  // Move a walker toward (tx, ty). Returns true on arrival. Mirrors the bot's routing.
  _robotStep(r, delta, tx, ty) {
    if (Math.hypot(tx - r.x, ty - r.y) < 16) return true;
    const step = RULES.robots.walkSpeed * delta / 1000;
    const rR = Math.hypot(r.x - this.CX, r.y - this.CY);
    const tR = Math.hypot(tx - this.CX, ty - this.CY);
    let ax = tx, ay = ty;
    if (rR > this.PREP_RAD - 15 && tR < this.PREP_RAD - 15) {   // leave a side room radially first
      const f = (this.PREP_RAD - 30) / rR;
      ax = this.CX + (r.x - this.CX) * f;
      ay = this.CY + (r.y - this.CY) * f;
    }
    const proxy = { x: r.x, y: r.y, targetX: ax, targetY: ay };
    if (this._pathCrossesRing(r.x, r.y, ax, ay)) {
      this._orbitRing(proxy, step);
    } else {
      const d = Math.hypot(ax - r.x, ay - r.y) || 1;
      const nx = (ax - r.x) / d * step, ny = (ay - r.y) / d * step;
      let moved = false;
      if (this.isValidPos(proxy.x + nx, proxy.y, 8)) { proxy.x += nx; moved = true; }
      if (this.isValidPos(proxy.x, proxy.y + ny, 8)) { proxy.y += ny; moved = true; }
      if (!moved) {
        if (Math.hypot(proxy.x - this.CX, proxy.y - this.CY) < this.RING_RAD + 80) this._orbitRing(proxy, step);
        else {
          const cx = this.CX - proxy.x, cy = this.CY - proxy.y, cd = Math.hypot(cx, cy) || 1;
          if (this.isValidPos(proxy.x + cx / cd * step, proxy.y, 8)) proxy.x += cx / cd * step;
          if (this.isValidPos(proxy.x, proxy.y + cy / cd * step, 8)) proxy.y += cy / cd * step;
        }
      }
    }
    r.x = proxy.x; r.y = proxy.y;
    return false;
  },

  // ── Facility OS: accepts proposals and brings in users ─────
  _updateFacilityOS(delta) {
    this._osTimer -= delta;
    if (this._osTimer > 0) return;
    this._osTimer = 500;
    const effMax = MAX_ACTIVE + (this.upgrades.extraJobSlots || 0);
    if (this.active.length >= effMax) return;
    const waitingUsers = this.active.filter(j => j.unstarted > 0 && !j.npcGone && j.npcSlot >= 0).length;
    if (waitingUsers >= 2) return;
    let best = -1, bestRep = -Infinity;
    for (let i = 0; i < (this.jobSlots?.length ?? 0); i++) {
      const slot = this.jobSlots[i];
      if (!slot) continue;
      if (slot.linkedQueueIdx >= 0) { best = i; break; }           // committed users first
      const p = slot.linkedPendingIdx >= 0 ? this.pending[slot.linkedPendingIdx] : null;
      if (p && p.rep > bestRep) { bestRep = p.rep; best = i; }
    }
    if (best >= 0) this.acceptProposalBySlot(best);
  },

  // ── Robot faults (from Year 3; not during the victory lap) ─
  scheduleRobotFaults() {
    const cfg = RULES.robots.fault;
    if (this.victoryLap || this.cycle < cfg.fromCycle) return;
    for (const r of this.robots) {
      if (Math.random() >= cfg.chance) continue;
      const whenMs = Phaser.Math.FloatBetween(10, Math.max(11, this.yearTimer - 10)) * 1000;
      this.time.delayedCall(whenMs, () => {
        if (r.fault || this.gamePaused) return;
        r.fault = true; r.rebootMs = 0; r.faultMs = 0;
        window.simEvent?.('robotFault');
        this.flash(`⚠ ${ROBOT_STYLE[r.kind].badge} robot faulted — stand next to it to reboot`, '#cc4400');
      }, [], this);
    }
  },

  _updateFault(r, delta) {
    const cfg = RULES.robots.fault;
    r.faultMs += delta;
    const near = Math.hypot(this.px - r.x, this.py - r.y) < 36
      || (this.coopOther && Math.hypot(this.coopOther.px - r.x, this.coopOther.py - r.y) < 36);
    r.rebootMs = near ? r.rebootMs + delta : 0;
    const postdocFix = this.postdocs.some(pd => pd.level >= 3) && r.faultMs >= cfg.postdocRebootSec * 1000;
    if (r.rebootMs >= cfg.rebootSec * 1000 || postdocFix) {
      r.fault = false;
      window.simEvent?.(postdocFix ? 'robotRebootedByPostdoc' : 'robotRebooted');
      this.flash(`✅ ${ROBOT_STYLE[r.kind].badge} robot rebooted${postdocFix ? ' by your postdoc' : ''}`, '#1a7a3a');
    }
  },

  // Nearest faulted robot (used by the prompt and the bot).
  faultedRobot() {
    return (this.robots || []).find(r => r.fault) || null;
  },

  _renderRobots() {
    for (const r of this.robots) {
      if (!r.walker && !r.fault) {
        const p = this._robotPost(r.kind, r.key);   // stations can move in layout mode
        r.x = p.x; r.y = p.y;
      }
      r.grp.setPosition(r.x, r.y);
      if (r.fault) {
        const blink = Math.floor(this.time.now / 300) % 2 === 0;
        r.label.setText(blink ? '⚠ FAULT' : '').setColor('#cc2200');
      } else if (!r.walker) {
        const busy = r.kind === 'hutchBot' ? (this.hutchSetup[r.key] ? 'setting up' : this.hutchRack[r.key].length ? 'queued' : '')
          : r.kind === 'consoleBot' ? (this.measSlots.some(s => s.blIdx === r.key && s.started && !s.toStage) ? 'scanning' : '')
          : (this.prepSlotsFor[r.key].some(s => !s.toStage) ? 'prepping' : '');
        r.label.setText(busy).setColor('#556677');
      } else {
        r.label.setColor('#556677');
      }
    }
  },
});
