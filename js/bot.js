// ================================================================
//  FacilityBot — automated player for The Brilliant Facility
//
//  Usage:
//    _bot.start()   — begin bot control (hides keyboard input)
//    _bot.stop()    — return control to player
//    _bot.stats()   — print cycle stats to console
//    _bot.speed(n)  — set speed multiplier (1 = normal, 2 = fast, etc.)
//
//  The bot runs in the Phaser postupdate hook so it fires after the
//  scene's own update() and can safely override px/py each frame.
// ================================================================
(function () {

const ARRIVE_DIST = 18;   // px — "close enough" to a target position
const DECIDE_MS   = 250;  // ms — how often to re-evaluate the current goal

// ── Main Bot Class ─────────────────────────────────────────────
class FacilityBot {
  constructor() {
    this.enabled      = false;
    this._goal        = null;   // { label, x, y, interact } — current navigation target
    this._decideTimer = 0;
    this._dbgGfx      = null;
    this._overlay     = null;
    this._overlayGoal = null;
    this._overlayStat = null;
    this._listener    = null;
    this._scene       = null;
  }

  // ── Public API ─────────────────────────────────────────────
  start() {
    const s = this._scene = this._findScene();
    if (!s) { console.warn('[Bot] GameScene not found — start a game cycle first'); return; }
    if (this.enabled) { console.log('[Bot] Already running'); return; }

    this.enabled = true;

    // Visual helpers
    this._dbgGfx = s.add.graphics().setDepth(50);
    this._buildOverlay(s);

    // Hook into Phaser's postupdate so we run AFTER scene.update() each frame
    this._listener = (_t, delta) => {
      if (!this.enabled) return;
      const sc = this._findScene();
      if (sc) this._tick(sc, delta);
    };
    s.events.on('postupdate', this._listener);

    // Suppress keyboard movement while bot is active
    this._setKeyboard(s, false);

    console.log('[Bot] Started — _bot.stop() to hand back control');
  }

  stop() {
    if (!this.enabled) return;
    this.enabled = false;
    const s = this._findScene();
    if (s) {
      if (this._listener) s.events.off('postupdate', this._listener);
      this._setKeyboard(s, true);
    }
    if (this._dbgGfx)  { this._dbgGfx.destroy();            this._dbgGfx = null; }
    if (this._overlay) { this._overlay.forEach(o => o.destroy()); this._overlay = null; }
    this._overlayGoal = null; this._overlayStat = null;
    this._scene = null;
    console.log('[Bot] Stopped — keyboard restored');
  }

  // Multiply the game's dev tick speed (requires ?dev in URL).
  speed(n) {
    const s = this._findScene();
    if (s) s.devTickMult = n;
  }

  stats() {
    const s = this._findScene();
    if (!s) { console.warn('[Bot] No active GameScene'); return; }
    console.table({
      reputation:          s.reputation,
      cycleRepEarned:      s.cycleRepEarned,
      proposalsDone:       s.cycleProposalsDone,
      totalSamples:        s.totalSamples,
      timeLeft:            s.yearTimer + 's',
      activeJobs:          s.active.length,
      heldSamples:         s.held.length,
      prepSlots:           Object.entries(s.prepSlotsFor)
                             .map(([k, v]) => `${k}:${v.length}`).join(', '),
      measSlots:           s.measSlots.length,
      currentGoal:         this._goal ? this._goal.label : 'idle',
    });
  }

  // ── Core tick (runs each frame in postupdate) ───────────────
  _tick(s, delta) {
    if (s.gamePaused || !s.active) return;

    // Accept any pending proposals immediately (no movement needed)
    this._tryAcceptProposals(s);

    // Re-decide goal on a timer
    this._decideTimer -= delta;
    if (this._decideTimer <= 0) {
      this._decideTimer = DECIDE_MS;
      this._goal = this._decide(s);
    }

    // Navigate toward goal
    if (this._goal) {
      const arrived = this._moveToward(s, delta, this._goal.x, this._goal.y);
      if (arrived && this._goal.interact) {
        s.tryInteract();
        this._goal.interact = false; // fire once per arrival
      }
    }

    // Keep sprite in sync with overridden px/py
    s.pCon.setPosition(s.px, s.py);

    // Refresh UI
    this._updateOverlay(s);
    this._drawDebug(s);
  }

  // ── Goal selection (priority-ordered) ──────────────────────
  _decide(s) {

    // 1. If holding exp_setup_done sample → head to that beamline's control room
    const doneItem = s.held.find(h => h.stage === 'exp_setup_done');
    if (doneItem) {
      const bl = s.beamlines[doneItem.expBlIdx];
      if (bl) {
        const st = s.stDefs[bl.measKey];
        return { label: `deposit→BL-${doneItem.expBlIdx+1} ctrl`, x: st.boxCX, y: st.boxCY, interact: true };
      }
    }

    // 2. Collect any ready measurement results (clears slots for next sample)
    for (const bl of s.beamlines) {
      if (s.measSlots.find(ms => ms.toStage === 'meas_ready' && ms.blIdx === bl.idx)) {
        const st = s.stDefs[bl.measKey];
        return { label: `collect meas BL-${bl.idx+1}`, x: st.boxCX, y: st.boxCY, interact: true };
      }
    }

    // 3. Stay in control room while measurement is actively running
    //    (measurements only tick when player is nearby — this is the core mechanic)
    for (const bl of s.beamlines) {
      if (s.measSlots.find(ms => ms.started && !ms.toStage && ms.blIdx === bl.idx)) {
        const st = s.stDefs[bl.measKey];
        return { label: `wait meas BL-${bl.idx+1}`, x: st.boxCX, y: st.boxCY, interact: false };
      }
    }

    // 4. Start a deposited-but-not-started measurement at control room
    for (const bl of s.beamlines) {
      if (s.measSlots.find(ms => !ms.started && !ms.toStage && ms.blIdx === bl.idx)) {
        const st = s.stDefs[bl.measKey];
        return { label: `start meas BL-${bl.idx+1}`, x: st.boxCX, y: st.boxCY, interact: true };
      }
    }

    // 5. Stay near hutch while exp setup is in progress
    if (s.doingExpSetup && s.activeExpSetupIdx >= 0) {
      const bl = s.beamlines[s.activeExpSetupIdx];
      const st = s.stDefs[bl.lockKey];
      return { label: `exp setup BL-${s.activeExpSetupIdx+1}`, x: st.boxCX, y: st.boxCY, interact: false };
    }

    // 6. Trigger exp setup — holding a prepped sample near the right beamline
    const preppedItem = s.held.find(h => h.stage === 'prepped');
    if (preppedItem) {
      const job = s.active.find(a => a.id === preppedItem.jobId);
      if (job) {
        const blIdx = s.beamlineTechs.indexOf(job.tech);
        if (blIdx >= 0) {
          const bl = s.beamlines[blIdx];
          const st = s.stDefs[bl.lockKey];
          const occupied = s.measSlots.some(ms => ms.blIdx === blIdx);
          if (!occupied) {
            return { label: `hutch BL-${blIdx+1}`, x: st.boxCX, y: st.boxCY, interact: true };
          }
          // Beamline occupied — wait near hutch
          return { label: `wait hutch BL-${blIdx+1}`, x: st.boxCX, y: st.boxCY, interact: false };
        }
      }
    }

    // 7. Pick up any finished prep
    for (const pk of s.prepKeys) {
      if (s.prepSlotsFor[pk].find(ps => ps.toStage === 'prepped_ready') && s.held.length < 3) {
        const st = s.stDefs[pk];
        return { label: `pickup ${s.stDefs[pk].labType} lab`, x: st.x, y: st.y, interact: true };
      }
    }

    // 8. Deposit raw sample at correct prep table
    const rawItem = s.held.find(h => h.stage === 'raw');
    if (rawItem) {
      const pk = rawItem.labType === 'wet' ? 'prep' : 'prep2';
      const st = s.stDefs[pk];
      if (s.prepSlotsFor[pk].length < s.prepCap) {
        return { label: `deposit ${rawItem.labType} lab`, x: st.x, y: st.y, interact: true };
      }
      // Prep table full — stand next to it so processing continues (proximity-gated)
      return { label: `wait ${rawItem.labType} lab`, x: st.x, y: st.y, interact: false };
    }

    // 9. Collect raw sample from NPC — prioritise jobs whose users are leaving soonest
    if (s.held.length < 3) {
      const urgentJob = s.active
        .filter(j => j.unstarted > 0 && !j.npcGone && j.npcSlot >= 0)
        .sort((a, b) => (a.leaveMs ?? Infinity) - (b.leaveMs ?? Infinity))[0];
      if (urgentJob) {
        const pos = s.npcPos[urgentJob.npcSlot];
        return { label: `NPC: ${urgentJob.name}`, x: pos.x, y: pos.y, interact: true };
      }
    }

    // Nothing actionable — stay put
    return null;
  }

  // ── Accept pending/queued proposals (called every tick) ────
  _tryAcceptProposals(s) {
    const effMax = 5 + (s.upgrades?.extraJobSlots || 0);
    if (s.active.length >= effMax) return;
    for (let i = 0; i < (s.jobSlots?.length ?? 0); i++) {
      const slot = s.jobSlots[i];
      if (slot && (slot.linkedPendingIdx >= 0 || slot.linkedQueueIdx >= 0)) {
        s.acceptProposalBySlot(i);
        return; // one at a time to avoid state conflicts
      }
    }
  }

  // ── Movement (mirrors postdoc movement logic) ───────────────
  _moveToward(s, delta, tx, ty) {
    const dx = tx - s.px, dy = ty - s.py;
    const dist = Math.hypot(dx, dy);
    if (dist < ARRIVE_DIST) return true; // arrived

    const step = s.SPD * (delta / 1000);

    // If the bot is inside a beamline room (outside the main corridor) and the
    // target is inside the corridor, the direct path clips through an invalid wall
    // gap.  Move radially inward first to exit the room, then navigate normally.
    const playerR = Math.hypot(s.px - s.CX, s.py - s.CY);
    const targetR = Math.hypot(tx - s.CX, ty - s.CY);
    let actualTx = tx, actualTy = ty;
    if (playerR > s.PREP_RAD - 15 && targetR < s.PREP_RAD - 15) {
      const factor = (s.PREP_RAD - 30) / playerR;
      actualTx = s.CX + (s.px - s.CX) * factor;
      actualTy = s.CY + (s.py - s.CY) * factor;
    }

    const adx = actualTx - s.px, ady = actualTy - s.py;
    const adist = Math.hypot(adx, ady);
    const proxy = { x: s.px, y: s.py, targetX: actualTx, targetY: actualTy };

    if (s._pathCrossesRing(s.px, s.py, actualTx, actualTy)) {
      s._orbitRing(proxy, step);
    } else if (adist > 1) {
      const nx = (adx / adist) * step;
      const ny = (ady / adist) * step;
      let moved = false;
      if (s.isValidPos(proxy.x + nx, proxy.y, 12)) { proxy.x += nx; moved = true; }
      if (s.isValidPos(proxy.x, proxy.y + ny, 12)) { proxy.y += ny; moved = true; }

      if (!moved) {
        const toCenter = Math.hypot(proxy.x - s.CX, proxy.y - s.CY);
        if (toCenter < s.RING_RAD + 80) {
          // Near inner ring — orbit around it
          s._orbitRing(proxy, step);
        } else {
          // Stuck elsewhere (e.g. room corner) — push radially inward toward corridor
          const cx = s.CX - proxy.x, cy = s.CY - proxy.y;
          const cd = Math.hypot(cx, cy);
          if (s.isValidPos(proxy.x + cx/cd * step, proxy.y, 12)) proxy.x += cx/cd * step;
          if (s.isValidPos(proxy.x, proxy.y + cy/cd * step, 12)) proxy.y += cy/cd * step;
        }
      }
    }

    s.px = proxy.x;
    s.py = proxy.y;
    return false;
  }

  // ── Keyboard suppression ────────────────────────────────────
  _setKeyboard(s, enabled) {
    const keys = [
      s.cursors?.left, s.cursors?.right, s.cursors?.up, s.cursors?.down,
      s.wasd?.left, s.wasd?.right, s.wasd?.up, s.wasd?.down,
    ];
    keys.forEach(k => { if (k) k.enabled = enabled; });
  }

  // ── Overlay UI ─────────────────────────────────────────────
  _buildOverlay(s) {
    const x = 8, y = s.HUD_H + 8, w = 240, h = 64;
    const bg  = s.add.rectangle(x, y, w, h, 0x001122, 0.82).setOrigin(0, 0).setDepth(60);
    const hdr = s.add.text(x + 6, y + 5, '🤖 BOT ACTIVE — _bot.stop() to quit',
      { font: 'bold 10px Courier New', color: '#00ffaa' }).setOrigin(0, 0).setDepth(61);
    this._overlayGoal = s.add.text(x + 6, y + 22, '',
      { font: '10px Courier New', color: '#aaddff' }).setOrigin(0, 0).setDepth(61);
    this._overlayStat = s.add.text(x + 6, y + 38, '',
      { font: '10px Courier New', color: '#ffcc88' }).setOrigin(0, 0).setDepth(61);
    const hint = s.add.text(x + 6, y + 52, '_bot.stats()  for detailed console output',
      { font: '9px Courier New', color: '#556677' }).setOrigin(0, 0).setDepth(61);
    this._overlay = [bg, hdr, this._overlayGoal, this._overlayStat, hint];
  }

  _updateOverlay(s) {
    if (!this._overlayGoal) return;
    const g = this._goal;
    this._overlayGoal.setText(`→ ${g ? g.label : 'idle'}`);
    this._overlayStat.setText(
      `rep: ${s.reputation}  |  samples: ${s.totalSamples}  |  held: ${s.held.length}/3`
    );
  }

  // ── Debug line to target ────────────────────────────────────
  _drawDebug(s) {
    if (!this._dbgGfx) return;
    this._dbgGfx.clear();
    if (!this._goal) return;
    this._dbgGfx.lineStyle(1, 0x00ffaa, 0.35);
    this._dbgGfx.lineBetween(s.px, s.py, this._goal.x, this._goal.y);
    this._dbgGfx.fillStyle(0x00ffaa, 0.45);
    this._dbgGfx.fillCircle(this._goal.x, this._goal.y, 5);
  }

  // ── Scene lookup ───────────────────────────────────────────
  _findScene() {
    return window.game?.scene?.getScene('Game') ?? null;
  }
}

// Expose globally
window._bot = new FacilityBot();
console.log('[FacilityBot] Ready.  _bot.start()  /  _bot.stop()  /  _bot.stats()');

})();
