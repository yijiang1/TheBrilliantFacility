// ════════════════════════════════════════════════════════════════
//  ProgressBar — reusable bg + fill + optional label
//  Usage:
//    const bar = new ProgressBar(scene, x, y, w, h, opts);
//    bar.setFraction(0.6).setFillStyle(0x44ccaa).setLabel('PREP').show();
//    bar.hide();
//  opts: { bgColor, bgAlpha, fillColor, depth, labelYOffset }
// ════════════════════════════════════════════════════════════════
class ProgressBar {
  constructor(scene, x, y, w, h, opts = {}) {
    const { bgColor = 0x1a1a2a, bgAlpha = 0.55, fillColor = 0x44ccff,
            depth = 25, labelYOffset = 0 } = opts;
    this.w = w; this.h = h; this._labelYOffset = labelYOffset;
    this.bg   = scene.add.rectangle(x, y, w, h, bgColor, bgAlpha)
                  .setOrigin(0, 0.5).setAlpha(0).setDepth(depth);
    this.fill = scene.add.rectangle(x, y, 1, h, fillColor)
                  .setOrigin(0, 0.5).setAlpha(0).setDepth(depth + 1);
    this.lbl  = scene.add.text(x + w / 2, y + labelYOffset, '',
                  { font: 'bold 11px Courier New', color: '#ffffff' })
                  .setOrigin(0.5).setAlpha(0).setDepth(depth + 2);
  }
  setPosition(x, y) {
    this.bg.setPosition(x, y);
    this.fill.setPosition(x, y);
    this.lbl.setPosition(x + this.w / 2, y + this._labelYOffset);
    return this;
  }
  setFraction(f) {
    this.fill.setDisplaySize(Math.max(1, this.w * Phaser.Math.Clamp(f, 0, 1)), this.h);
    return this;
  }
  setFillStyle(color) { this.fill.setFillStyle(color); return this; }
  setLabel(text, color) {
    this.lbl.setText(text);
    if (color !== undefined) this.lbl.setStyle({ color });
    return this;
  }
  show() {
    this.bg.setAlpha(1); this.fill.setAlpha(1); this.lbl.setAlpha(1);
    return this;
  }
  hide() {
    this.bg.setAlpha(0); this.fill.setAlpha(0); this.lbl.setAlpha(0);
    return this;
  }
  destroy() { this.bg.destroy(); this.fill.destroy(); this.lbl.destroy(); }
}

// ════════════════════════════════════════════════════════════════
//  TutorialScene — 3-page intro shown on first launch
// ════════════════════════════════════════════════════════════════
class TutorialScene extends Phaser.Scene {
  constructor() { super('Tutorial'); }

  create() {
    document.getElementById('game-container').style.visibility = 'visible';
    this.page = 0;
    this._po = [];   // page objects
    this._no = [];   // nav objects
    this._show();
  }

  // ── helpers ──────────────────────────────────────────────────
  _o(obj) { this._po.push(obj); return obj; }
  _n(obj) { this._no.push(obj); return obj; }
  _clear(arr) { arr.forEach(o => o.destroy()); arr.length = 0; }

  _show() {
    this._clear(this._po);
    this._clear(this._no);
    [this._page0, this._page1, this._page2][this.page].call(this);
    this._nav();
  }

  _bg()           { this._o(this.add.rectangle(GW/2, GH/2, GW, GH, 0xeef4fc)); }
  _header(t, sub) {
    this._o(this.add.rectangle(GW/2, 36, GW, 72, 0xd0e0f0));
    this._o(this.add.rectangle(GW/2, 72, GW, 2, 0x0088aa, 0.4));
    this._o(this.add.text(GW/2, 24, t,   {font:'bold 26px Courier New', color:'#062a6a', letterSpacing:4}).setOrigin(0.5));
    this._o(this.add.text(GW/2, 54, sub, {font:'bold 13px Courier New', color:'#1a4a8a', letterSpacing:2}).setOrigin(0.5));
    this._o(this.add.text(GW - 12, 66, VERSION, {font:'11px Courier New', color:'#6a8aaa'}).setOrigin(1, 1));
  }

  // ── Page 0: Overview ─────────────────────────────────────────
  _page0() {
    this._bg();
    this._header('THE BRILLIANT FACILITY', 'SYNCHROTRON FACILITY MANAGEMENT');

    this._o(this.add.text(GW/2, 120, 'YOU ARE THE BEAMLINE SCIENTIST',
      {font:'bold 20px Courier New', color:'#0a3a8a', letterSpacing:2}).setOrigin(0.5));
    this._o(this.add.text(GW/2, 160,
      'Researchers from around the world submit proposals for beam time at your synchrotron facility.\n' +
      'Your job is to run their samples through the beamlines and deliver results.',
      {font:'16px Courier New', color:'#1a2a4a', align:'center', lineSpacing:8}).setOrigin(0.5));

    // Three-box flow diagram
    const FLOW = [
      {x:GW/2-320, title:'PROPOSALS',   body:'Researchers submit\napplications for beam time', col:0x1a6a9a, tc:'#062a6a', bg:0xe6f0fa},
      {x:GW/2,     title:'EXPERIMENTS', body:'You run samples through\nthe synchrotron beamlines', col:0x1a8a4a, tc:'#064a1a', bg:0xe6f5ea},
      {x:GW/2+320, title:'REPUTATION',  body:'Success earns reputation\nand annual funding',        col:0xa37600, tc:'#5a3000', bg:0xfcf6e6},
    ];
    FLOW.forEach(f => {
      this._o(this.add.rectangle(f.x, 320, 260, 120, f.bg).setStrokeStyle(2, f.col));
      this._o(this.add.text(f.x, 280, f.title, {font:'bold 16px Courier New', color:f.tc, letterSpacing:2}).setOrigin(0.5));
      this._o(this.add.text(f.x, 320, f.body,  {font:'15px Courier New', color:f.tc, align:'center', lineSpacing:8}).setOrigin(0.5));
    });
    this._o(this.add.text(GW/2-160, 320, '→', {font:'bold 32px Courier New', color:'#3a5a7a'}).setOrigin(0.5));
    this._o(this.add.text(GW/2+160, 320, '→', {font:'bold 32px Courier New', color:'#3a5a7a'}).setOrigin(0.5));

    // Year structure panel
    this._o(this.add.rectangle(GW/2, 480, 800, 100, 0xe8f0f8).setStrokeStyle(2, 0xaabbdd));
    this._o(this.add.text(GW/2, 455, 'YEAR STRUCTURE',
      {font:'bold 15px Courier New', color:'#1a4a8a', letterSpacing:2}).setOrigin(0.5));
    this._o(this.add.text(GW/2, 485,
      '3 proposal cycles per year  •  Each cycle ≈ 3 minutes of real time\n' +
      'Complete proposals to earn reputation  •  Reputation grows your annual grant',
      {font:'15px Courier New', color:'#1a2a4a', align:'center', lineSpacing:8}).setOrigin(0.5));

    this._o(this.add.text(GW/2, GH-62,
      'Press [→] or NEXT to continue  •  [SPACE] or [ENTER] to advance',
      {font:'bold 14px Courier New', color:'#3a5a7a', align:'center'}).setOrigin(0.5));
  }

  // ── Page 1: Sample Workflow ───────────────────────────────────
  _page1() {
    this._bg();
    this._header('RUNNING AN EXPERIMENT', 'THE SAMPLE WORKFLOW — 4 STEPS');

    const STEPS = [
      {num:'1', name:'USER NPC',           col:0x1a6aaa, tc:'#062a6a', bg:0xe6f0fa,
       desc:'Walk up to a researcher and press [SPACE] to collect their raw sample.'},
      {num:'2', name:'WET LAB / DRY LAB',  col:0x1a8a4a, tc:'#064a1a', bg:0xe6f5ea,
       desc:'Go to the correct lab (🧪 Wet or 🔩 Dry). Deposit with [SPACE]. Auto-preps. Pick up once ready.'},
      {num:'3', name:'BEAMLINE HUTCH',     col:0xa34600, tc:'#5a2000', bg:0xfcf0e6,
       desc:'Press [SPACE] to start experiment setup, then stay near the hutch while the bar fills.'},
      {num:'4', name:'CONTROL ROOM',       col:0x1a7a8a, tc:'#064a5a', bg:0xe6f4f6,
       desc:'Deposit the prepped sample [SPACE]. Auto-scan runs. Collect the result when done!'},
    ];

    const SY = 110, SH = 90, GAP = 12;
    STEPS.forEach((s, i) => {
      const y  = SY + i * (SH + GAP);
      const cy = y + SH / 2;
      // Card background
      this._o(this.add.rectangle(GW/2, cy, 960, SH, s.bg).setStrokeStyle(2, s.col, 0.5));
      // Left accent bar
      this._o(this.add.rectangle(GW/2 - 470, cy, 8, SH - 12, s.col));
      // Step circle + number
      this._o(this.add.circle(GW/2 - 410, cy, 22, s.col));
      this._o(this.add.text(GW/2 - 410, cy, s.num, {font:'bold 18px Courier New', color:'#ffffff'}).setOrigin(0.5));
      // Station name + description
      this._o(this.add.text(GW/2 - 360, cy - 14, s.name, {font:'bold 18px Courier New', color:s.tc}));
      this._o(this.add.text(GW/2 - 360, cy + 10,  s.desc, {font:'15px Courier New',      color:'#2a3a5a', wordWrap:{width:820}}));
      // Connector arrow between steps
      if (i < STEPS.length - 1) {
        this._o(this.add.text(GW/2 - 410, y + SH + GAP / 2, '↓',
          {font:'bold 18px Courier New', color:'#3a6a8a'}).setOrigin(0.5));
      }
    });

    const noteY = Math.min(GH - 64, SY + 4 * (SH + GAP) + 20);
    this._o(this.add.rectangle(GW/2, noteY, 800, 36, 0xd0e0f0).setStrokeStyle(2, 0x8ab4d8));
    this._o(this.add.text(GW/2, noteY,
      'Carry up to 3 samples at once  •  Up to 3 proposals run simultaneously',
      {font:'bold 15px Courier New', color:'#062a6a', align:'center'}).setOrigin(0.5));
  }

  // ── Page 2: Controls + Tips + Start ──────────────────────────
  _page2() {
    this._bg();
    this._header('READY TO BEGIN', 'CONTROLS & TIPS');

    // Left column — Controls
    const leftX = GW/2 - 280;
    this._o(this.add.text(leftX - 200, 110, 'CONTROLS', {font:'bold 18px Courier New', color:'#062a6a', letterSpacing:2}));
    const CTRL = [
      ['WASD / ↑↓←→', 'Move scientist'],
      ['[SPACE]',     'Pick up / Deposit /\nInteract'],
      ['[SPACE]',     'Use Beamline Hutch\n(stay nearby to finish)'],
      ['[ESC]',       'Pause game'],
    ];
    CTRL.forEach(([key, desc], i) => {
      const y = 160 + i * 68;
      this._o(this.add.rectangle(leftX, y + 16, 440, 60, 0xffffff, 0.9).setStrokeStyle(2, 0xddeeff));
      this._o(this.add.text(leftX - 200, y - 4,  key,  {font:'bold 16px Courier New', color:'#1a5a9a'}));
      this._o(this.add.text(leftX - 20,  y - 4, desc, {font:'15px Courier New',      color:'#2a3a5a', lineSpacing:6}));
    });

    // Right column — Tips
    const rightX = GW/2 + 280;
    this._o(this.add.text(rightX - 200, 110, 'GOOD TO KNOW', {font:'bold 18px Courier New', color:'#062a6a', letterSpacing:2}));
    const TIPS = [
      "Don't overcommit! Unfinished proposals\ncause reputation penalties at cycle end.",
      "Prep Table and Scan Console actions\npause if you walk away from the station.",
      "Reputation unlocks bigger annual funding\ngrants. Spend funding on lab upgrades.",
      "The synchrotron ring degrades each cycle.\nKeep health above 60% or get penalties.",
    ];
    TIPS.forEach((tip, i) => {
      const y = 160 + i * 90;
      this._o(this.add.rectangle(rightX, y + 16, 480, 80, 0xe6f0fa).setStrokeStyle(2, 0x8ab4d8));
      this._o(this.add.text(rightX - 220, y - 10, tip, {font:'16px Courier New', color:'#1a2a4a', lineSpacing:6}));
    });

    // START GAME / CONTINUE button
    const bx = GW / 2, by = GH - 140;
    const save = loadGame();
    if (save) {
      // Continue saved game (primary)
      const cbg = this._o(this.add.rectangle(bx, by, 320, 56, 0x0a7a44).setStrokeStyle(3, 0x2aaa66));
      const ctx = this._o(this.add.text(bx, by, 'CONTINUE  ▶',
        {font:'bold 20px Courier New', color:'#ffffff', letterSpacing:3}).setOrigin(0.5));
      cbg.setInteractive({useHandCursor:true});
      cbg.on('pointerover',  () => cbg.setFillStyle(0x0a9a55));
      cbg.on('pointerout',   () => cbg.setFillStyle(0x0a7a44));
      cbg.on('pointerdown',  () => this._continueGame());
      ctx.setInteractive({useHandCursor:true});
      ctx.on('pointerdown',  () => this._continueGame());
      // Save summary
      const genNum  = getGeneration(save.year || 1);
      const genName = GENERATION_DATA[genNum - 1].name;
      this._o(this.add.text(bx, by + 40,
        `Year ${save.year}  ·  Cycle ${save.cycleInYear}/3  ·  ${genName}  ·  ⭐ ${save.reputation}`,
        {font:'bold 13px Courier New', color:'#2a6a46', align:'center'}).setOrigin(0.5));
      // New game link
      const ng = this._o(this.add.text(bx, by + 65, '[ new game — erase save ]',
        {font:'bold 13px Courier New', color:'#4a6070'}).setOrigin(0.5));
      ng.setInteractive({useHandCursor:true});
      ng.on('pointerover', () => ng.setStyle({color:'#cc5544'}));
      ng.on('pointerout',  () => ng.setStyle({color:'#4a6070'}));
      ng.on('pointerdown', () => this._startGame());
    } else {
      // Fresh start
      const bbg = this._o(this.add.rectangle(bx, by, 320, 56, 0x0d3a8a).setStrokeStyle(3, 0x4a8add));
      const btx = this._o(this.add.text(bx, by, 'START GAME  ▶',
        {font:'bold 20px Courier New', color:'#ffffff', letterSpacing:3}).setOrigin(0.5));
      bbg.setInteractive({useHandCursor:true});
      bbg.on('pointerover',  () => bbg.setFillStyle(0x1a5aaa));
      bbg.on('pointerout',   () => bbg.setFillStyle(0x0d3a8a));
      bbg.on('pointerdown',  () => this._startGame());
      btx.setInteractive({useHandCursor:true});
      btx.on('pointerdown',  () => this._startGame());
    }
  }

  // ── Navigation bar ────────────────────────────────────────────
  _nav() {
    const TOTAL = 3, cy = GH - 28;
    // Page dots
    for (let i = 0; i < TOTAL; i++) {
      this._n(this.add.circle(GW/2 + (i - 1) * 24, cy, 5, i === this.page ? 0x0d3a8a : 0xbcccdd));
    }
    // Prev button
    if (this.page > 0) {
      const p = this._n(this.add.text(80, cy, '◀  PREV',
        {font:'bold 13px Courier New', color:'#1a5a9a'}).setOrigin(0.5));
      p.setInteractive({useHandCursor:true});
      p.on('pointerdown', () => { this.page--; this._show(); });
    }
    // Next button + skip link
    if (this.page < TOTAL - 1) {
      const nx = this._n(this.add.text(GW - 80, cy, 'NEXT  ▶',
        {font:'bold 13px Courier New', color:'#1a5a9a'}).setOrigin(0.5));
      nx.setInteractive({useHandCursor:true});
      nx.on('pointerdown', () => { this.page++; this._show(); });

      const sk = this._n(this.add.text(GW - 80, cy - 32, '[ SKIP INTRO ]',
        {font:'bold 12px Courier New', color:'#aa3322'}).setOrigin(0.5));
      sk.setInteractive({useHandCursor:true});
      sk.on('pointerover', () => sk.setStyle({color:'#ff2200'}));
      sk.on('pointerout', () => sk.setStyle({color:'#aa3322'}));
      sk.on('pointerdown', () => this._startGame());
    }
    // Keyboard navigation
    this.input.keyboard.off('keydown-RIGHT');
    this.input.keyboard.off('keydown-LEFT');
    this.input.keyboard.off('keydown-ENTER');
    this.input.keyboard.off('keydown-SPACE');
    this.input.keyboard.on('keydown-RIGHT', () => {
      if (this.page < TOTAL - 1) { this.page++; this._show(); }
    });
    this.input.keyboard.on('keydown-LEFT', () => {
      if (this.page > 0) { this.page--; this._show(); }
    });
    this.input.keyboard.on('keydown-ENTER', () => {
      if (this.page === TOTAL - 1) this._startGame(); else { this.page++; this._show(); }
    });
    this.input.keyboard.on('keydown-SPACE', () => {
      if (this.page === TOTAL - 1) this._startGame(); else { this.page++; this._show(); }
    });
  }

  _startGame() {
    clearSave();
    this.scene.start('ProposalReview', {
      cycle:1, cycleInYear:1, year:1, reputation:0, ringBase:98, funding:200000,
      upgrades:{prepCap:1, measCap:1, prepSpeedMap:{prep:1.0,prep2:1.0}, measSpeedMap:[1.0,1.0,1.0,1.0], extraJobSlots:0, postdocs:0, postdocLevels:[], postdocNames:[], ringMaint:false},
    });
  }

  _continueGame() {
    const save = loadGame();
    if (save) this.scene.start('ProposalReview', save);
    else this._startGame();
  }
}

class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() {
    document.getElementById('game-container').style.visibility = 'visible';
    this.scene.start('Tutorial');
  }
}

// ════════════════════════════════════════════════════════════════
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(d) {
    this.cycle           = (d&&d.cycle)           || 1;
    this.cycleInYear     = (d&&d.cycleInYear)     || 1;
    this.year            = (d&&d.year)            || 1;
    this.committedProposals = (d&&d.committedProposals) || [];
    this.carryRep   = (d&&d.reputation) || 0;
    this.carryRing  = (d&&d.ringBase)   || 100;
    this.funding    = (d&&d.funding)    !== undefined ? d.funding : 200000;
    this.upgrades   = (d&&d.upgrades)   || {
      prepCap:1, measCap:1,
      prepSpeedMap:{prep:1.0,prep2:1.0}, measSpeedMap:[1.0,1.0,1.0,1.0],
      extraJobSlots:0, postdocs:0, postdocLevels:[], postdocNames:[],
      ringMaint:false, npcPositioning:false,
    };
    // Migrate old saves: single postdocLevel → per-postdoc arrays
    if (!Array.isArray(this.upgrades.postdocLevels)) {
      const oldLv = this.upgrades.postdocLevel || 1;
      this.upgrades.postdocLevels = Array(this.upgrades.postdocs || 0).fill(oldLv);
    }
    if (!Array.isArray(this.upgrades.postdocNames)) {
      this.upgrades.postdocNames = [];
      const count = this.upgrades.postdocs || 0;
      for (let i = 0; i < count; i++)
        this.upgrades.postdocNames.push(pickPostdocName(this.upgrades.postdocNames));
    }
    this.beamlineTechs = (d&&d.beamlineTechs) || pickBeamlineTechs(this.year);
  }

  create() {
    // ── Core state ──
    this.yearTimer    = CYCLE_SEC;
    this.ringStab     = this.carryRing;
    this.reputation   = this.carryRep;
    this.totalSamples = 0;
    this.yearSamples  = 0;
    this.jobIdCtr     = 0;
    this.cycleProposalsDone = 0;
    this.cycleRepEarned     = 0;
    this.cycleStartWall     = Date.now();
    this.sampleLog          = [];   // per-sample completion events
    this.proposalLog        = [];   // per-proposal outcomes

    this.pending = [];  // rapid-review proposals during gameplay
    this.active  = [];  // jobs in flight

    // Speed multipliers must be set before _rollJobDurations is called below
    // Per-room maps: prepSpeedMap keyed by prep table ('prep'/'prep2'), measSpeedMap indexed by blIdx
    this._prepSpeedMap = this.upgrades.prepSpeedMap || {prep:1.0, prep2:1.0};
    this._measSpeedMap = this.upgrades.measSpeedMap || [1.0,1.0,1.0,1.0];

    // Stable NPC slot assignment — each active job keeps a fixed NPC position
    this.npcSlotUsed = new Array(MAX_SLOTS).fill(false);

    const INITIAL_ACTIVE = 1;
    this.commitQueue = [];
    const shuffled = [...this.committedProposals].sort(() => Math.random() - 0.5);
    for (const p of shuffled) {
      const job = {
        id: this.jobIdCtr++, name: p.name, tech: p.tech,
        totalSamples: p.samples, rep: p.rep,
        done: 0, unstarted: p.samples,
        committed: true, labType: p.labType || 'dry',
      };
      if (this.active.length < INITIAL_ACTIVE) {
        this._rollJobDurations(job);
        job.npcSlot = this._claimNpcSlot(job);
        this.active.push(job);
      } else {
        this.commitQueue.push(job);
      }
    }
                        // unstarted = how many samples still need collecting from user

    // ── Player inventory ──
    // held[]: up to MAX_HELD items, each {jobId, stage:'raw'|'prepped'|'exp_setup_done'}
    this.held = [];

    // ── Station slot queues (autonomous processing) ──
    // Each slot: {jobId, doneAt, toStage}
    this.prepSlotsFor = { prep: [], prep2: [] };   // independent per-table, capacity = this.prepCap each
    this.measSlots   = [];   // capacity = this.measCap
    this.prepCap = this.upgrades.prepCap  || 1;
    this.measCap = this.upgrades.measCap  || 1;

    // Beam dump state
    this.beamDump        = false;   // is beam dump active?
    this.beamDumpTimer   = 0;       // seconds remaining
    this.beamDumpFrozeAt = null;    // Date.now() when dump started (to extend doneAt)

    // ── Experiment setup state (player-performed action) ──
    this.expSetupProg = 0;
    this.doingExpSetup = false;
    this._durExpSetup = (DUR_EXP_SETUP_MIN + DUR_EXP_SETUP_MAX) / 2;
    this.activeExpSetupIdx = -1;

    // Layout
    this.HUD_H  = 64;
    this.BOARD_W = 0;      // Removed left board
    this.JOBS_W  = 260;    // Widened right panel
    this.PLAY_W  = GW - this.BOARD_W - this.JOBS_W;
    this.CX = this.PLAY_W / 2;
    this.CY = this.HUD_H + (GH - this.HUD_H) / 2;
    this.RING_RAD = 190;   // Central storage ring radius
    this.PREP_RAD = 275;   // Prep room outer radius

    this.buildFloor();
    this.buildLayout();
    this.buildStationGfx();
    this.buildUserNPCs();
    this.buildActivePanel();
    this.buildPlayer();       // player AFTER stations so it renders on top
    this.buildPostdocs();     // postdocs after player (depth 9, under player depth 10)
    this.buildProgressBar();  // progress bar AFTER player
    this.buildHUD();
    
    // Auto-fill the proposal hub to capacity now that UI exists
    this.restockProposalHub();
    this.refreshNPCs();

    this.cursors  = this.input.keyboard.createCursorKeys();
    this.wasd     = this.input.keyboard.addKeys({up:'W',down:'S',left:'A',right:'D'});
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.pKey     = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.gamePaused = false;

    this.buildPauseOverlay();
    this.buildBeamDumpOverlay();

    this.time.addEvent({delay:1000, callback:this.onTick,    callbackScope:this, loop:true});
    this.schedulePotentialBeamStop();
    this.scheduleSpawn(3000);
    // Seed one rapid-review proposal after a short delay
    this.time.delayedCall(20000, () => this.spawnProposal(), [], this);

    // Show NPCs for any pre-loaded committed proposals
    this.time.delayedCall(100, () => this.refreshNPCs(), [], this);

    if (new URLSearchParams(window.location.search).has('dev')) this.buildDevPanel();
  }

  buildPauseOverlay() {
    const cx = this.PLAY_W / 2, cy = this.HUD_H + (GH - this.HUD_H) / 2;
    this.pauseOverlay = this.add.rectangle(cx, cy, this.PLAY_W, GH - this.HUD_H, 0x000022)
      .setAlpha(0).setDepth(50);
    this.pauseTxt = this.add.text(cx, cy - 40, 'PAUSED',
      {font:'bold 48px Courier New', color:'#ffffff', letterSpacing:6})
      .setOrigin(0.5).setAlpha(0).setDepth(51);
    this.pauseHint = this.add.text(cx, cy + 10, 'press ESC to resume',
      {font:'16px Courier New', color:'#aaccee', letterSpacing:2})
      .setOrigin(0.5).setAlpha(0).setDepth(51);

    // Save & Quit button
    const sqBg = this.add.rectangle(cx, cy + 56, 240, 36, 0x1a3a6a)
      .setStrokeStyle(1, 0x4a7ab0).setAlpha(0).setDepth(51).setInteractive({ useHandCursor: true });
    const sqTxt = this.add.text(cx, cy + 56, '💾  Save & Quit to Menu',
      {font:'14px Courier New', color:'#aaccff'})
      .setOrigin(0.5).setAlpha(0).setDepth(52);
    sqBg.on('pointerover',  () => sqBg.setFillStyle(0x2a5a9a));
    sqBg.on('pointerout',   () => sqBg.setFillStyle(0x1a3a6a));
    sqBg.on('pointerdown',  () => this._saveAndQuit());

    this.pauseSaveBtn  = sqBg;
    this.pauseSaveTxt  = sqTxt;

    // Prevent browser default ESC behaviour (e.g. exiting fullscreen) from bubbling
    this.input.keyboard.addCapture(Phaser.Input.Keyboard.KeyCodes.ESC);
  }

  togglePause() {
    this.gamePaused = !this.gamePaused;
    const a = this.gamePaused ? 1 : 0;
    this.pauseOverlay.setAlpha(this.gamePaused ? 0.5 : 0);
    this.pauseTxt.setAlpha(a);
    this.pauseHint.setAlpha(a);
    this.pauseSaveBtn.setAlpha(a);
    this.pauseSaveTxt.setAlpha(a);
    if (this.gamePaused) this.pauseSaveBtn.setInteractive({ useHandCursor: true });
    else this.pauseSaveBtn.disableInteractive();
  }

  _saveAndQuit() {
    saveGame({
      cycle: this.cycle, cycleInYear: this.cycleInYear, year: this.year,
      reputation: this.reputation,
      ringBase: this.carryRing,
      funding: this.funding,
      upgrades: this.upgrades,
      beamlineTechs: this.beamlineTechs,
    });
    this.scene.start('Tutorial');
  }

  buildBeamDumpOverlay() {
    // Beam dump: compact top banner just below HUD, no mid-screen overlay
    const bannerY = this.HUD_H + 14;
    this.dumpBanner = this.add.rectangle(GW/2, bannerY, GW, 24, 0x330000, 0.92)
      .setOrigin(0.5).setAlpha(0).setDepth(31);

    this.dumpTitle = this.add.text(GW/2 - 80, bannerY, '⚡ BEAM DUMP',
      {font:'bold 13px Courier New', color:'#ff6666', letterSpacing:2})
      .setOrigin(0.5).setAlpha(0).setDepth(32);

    this.dumpCountdown = this.add.text(GW/2 + 60, bannerY, '',
      {font:'bold 13px Courier New', color:'#ffeeaa'})
      .setOrigin(0.5).setAlpha(0).setDepth(32);

    this.dumpSub = this.add.text(GW/2 - 10, bannerY + 0, '',  // unused but kept for showDumpOverlay compat
      {font:'12px Courier New', color:'#ffcccc'}).setAlpha(0).setDepth(32);

    // Subtle HUD tint only — no dimmer over the play field
    this.dumpHudStripe = this.add.rectangle(GW/2, this.HUD_H/2, GW, this.HUD_H, 0xff4400, 0.12)
      .setOrigin(0.5).setAlpha(0).setDepth(14);

    // dumpDimmer kept as null so showDumpOverlay doesn't break
    this.dumpDimmer = null;
  }

  triggerBeamDump() {
    if (this.beamDump) return;
    // Duration grows by 0.5 real seconds each cycle; 1 game day = 2 real seconds
    // Cycle 1: 1–2s (0.5–1 day), Cycle 2: 1–2.5s, Cycle 3: 1–3s, ...
    const minSec = 1;
    const maxSec = 2 + (this.cycle - 1) * 0.5;
    const dur     = Math.max(1, Math.round(Phaser.Math.FloatBetween(minSec, maxSec)));
    this.beamDump        = true;
    this.beamDumpTimer   = dur;
    this.beamDumpFrozeAt = this.time.now;
    this.showDumpOverlay(true);
    this.flash(`💥 BEAM STOP! ${(dur / 2).toFixed(1)}-day downtime`, '#cc1100');
  }

  endBeamDump() {
    // Measurements will automatically resume ticking via update() now that beamDump is false
    this.beamDump        = false;
    this.beamDumpTimer   = 0;
    this.beamDumpFrozeAt = null;
    this.showDumpOverlay(false);
    this.redrawBeam();
    this.flash('✅ Beam restored — measurements resuming', '#1a7a3a');
  }

  showDumpOverlay(on) {
    const a = on ? 1 : 0;
    if (this.dumpDimmer) this.dumpDimmer.setAlpha(on ? 0.13 : 0);
    this.dumpBanner.setAlpha(a);
    this.dumpTitle.setAlpha(a);
    this.dumpSub.setAlpha(a);
    this.dumpCountdown.setAlpha(a);
    this.dumpHudStripe.setAlpha(on ? 1 : 0);
  }

  scheduleSpawn(delay) {
    this.time.addEvent({ delay, callback:()=>{
      this.spawnProposal();
      this.scheduleSpawn(Phaser.Math.Between(10000,20000));
    }, callbackScope:this});
  }

  // ── Permanent floor (never rebuilt) ──────────────────────
  buildFloor() {
    const g = this.add.graphics();
    g.fillStyle(C.hudBg);  g.fillRect(0,0,GW,this.HUD_H);
    g.lineStyle(1,C.wall); g.lineBetween(0,this.HUD_H,GW,this.HUD_H);
    g.fillStyle(C.jobsBg);  g.fillRect(GW-this.JOBS_W,this.HUD_H,this.JOBS_W,GH-this.HUD_H);
    g.lineStyle(1,C.wall);  g.lineBetween(GW-this.JOBS_W,this.HUD_H,GW-this.JOBS_W,GH);
    g.fillStyle(0xcecac4); g.fillRect(0, this.HUD_H, this.PLAY_W, GH - this.HUD_H);
  }

  // ── Board graphics (rebuilt when sliders change) ──────────
  buildLayout() {
    this.boardGroup = this.boardGroup || [];
    const bg = obj => { this.boardGroup.push(obj); return obj; };

    // Prep room circle
    const g = bg(this.add.graphics());
    g.fillStyle(C.prepRoom);
    g.fillCircle(this.CX, this.CY, this.PREP_RAD);

    this.beamlineAngles = [45, 135, 225, 315].map(a => a + (this.beamlineRotOffset || 0));
    const ctrlLen = 60, ctrlWid = 76;
    const hutchLen = 60, hutchWid = 76;
    this.roomGeo = [];

    this.beamlineAngles.forEach((deg, idx) => {
      const rad = Phaser.Math.DegToRad(deg);
      
      // Sink slightly to ensure visual corners don't detach from the circle
      const dist = this.PREP_RAD + Math.max(ctrlLen, hutchLen)/2 - 10;
      const baseX = this.CX + Math.cos(rad) * dist;
      const baseY = this.CY + Math.sin(rad) * dist;

      // Tangent vector for side-by-side shift
      const tX = -Math.sin(rad);
      const tY = Math.cos(rad);
      const shiftDist = (ctrlWid + hutchWid) / 4; // place them exactly touching

      const x1 = baseX - tX * shiftDist;
      const y1 = baseY - tY * shiftDist;
      const x2 = baseX + tX * shiftDist;
      const y2 = baseY + tY * shiftDist;

      bg(this.add.rectangle(x1, y1, ctrlLen, ctrlWid, C.prepRoom).setRotation(rad).setDepth(3));
      
      // Calculate a corner offset relative to the room's rotation
      const lX = 14, lY = -22; 
      const oX = lX * Math.cos(rad) - lY * Math.sin(rad);
      const oY = lX * Math.sin(rad) + lY * Math.cos(rad);
      
      bg(this.add.text(x1 + oX, y1 + oY, '💻', {font:'16px Arial', alpha:0.45}).setOrigin(0.5).setDepth(4));
      
      bg(this.add.rectangle(x2, y2, hutchLen, hutchWid, C.hutch).setRotation(rad).setDepth(3));
      bg(this.add.text(x2 + oX, y2 + oY, '🔬', {font:'16px Arial', alpha:0.45}).setOrigin(0.5).setDepth(4));

      this.roomGeo.push(
        { key: `meas_${idx}`, cx: x1, cy: y1, w: ctrlLen, h: ctrlWid, rad },
        { key: `exp_setup_${idx}`, cx: x2, cy: y2, w: hutchLen, h: hutchWid, rad }
      );

      // BL number sits radially outside the center of the pair
      const lbldist1 = Math.max(ctrlLen, hutchLen) / 2 + 30;
      const lblX1 = baseX + Math.cos(rad) * lbldist1;
      const lblY1 = baseY + Math.sin(rad) * lbldist1;
      bg(this.add.text(lblX1, lblY1, `BL-${idx+1}`,
        {font:'bold 24px Courier New',color:BL_TXT[idx],stroke:'#ffffff',strokeThickness:2,letterSpacing:1}).setOrigin(0.5).setDepth(6));
      
      // Technique name sits slightly further out
      const lbldist2 = Math.max(ctrlLen, hutchLen) / 2 + 50;
      const lblX2 = baseX + Math.cos(rad) * lbldist2;
      const lblY2 = baseY + Math.sin(rad) * lbldist2;
      bg(this.add.text(lblX2, lblY2, this.beamlineTechs[idx],
        {font:'bold 14px Courier New',color:BL_TXT[idx],stroke:'#ffffff',strokeThickness:2,align:'center'}).setOrigin(0.5).setDepth(6));
    });

    const roomOutlineG = bg(this.add.graphics().setDepth(5));
    roomOutlineG.lineStyle(2, C.wall, 1);
    const drawEdges = (g, cx, cy, w, h, rad) => {
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const c = [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>({
        x: cx + x*cos - y*sin, y: cy + x*sin + y*cos
      }));
      for (let i = 0; i < 4; i++) g.lineBetween(c[i].x, c[i].y, c[(i+1)%4].x, c[(i+1)%4].y);
    };
    this.roomGeo.forEach(r => drawEdges(roomOutlineG, r.cx, r.cy, r.w, r.h, r.rad));

    this.roomHighlightG = bg(this.add.graphics().setDepth(6));

    const g2 = bg(this.add.graphics().setDepth(2));
    g2.lineStyle(4, C.wall);
    g2.fillStyle(0xd5e2ec);
    g2.fillCircle(this.CX, this.CY, this.RING_RAD);
    g2.strokeCircle(this.CX, this.CY, this.RING_RAD);
    g2.lineStyle(2, C.wall);
    g2.strokeCircle(this.CX, this.CY, this.PREP_RAD);

    bg(this.add.text(this.CX, this.CY, 'STORAGE RING',
      {font:'bold 15px Courier New',color:'#3a5060',letterSpacing:2}).setOrigin(0.5));

    this.beamGfx = bg(this.add.graphics());
    this.redrawBeam();
  }

  redrawBeam() {
    this.beamGfx.clear();
    // Glowing beam inside the inner ring
    if (!this.beamDump) {
      this.beamGfx.lineStyle(12, 0x44ff88, 0.15); 
      this.beamGfx.strokeCircle(this.CX, this.CY, this.RING_RAD - 9);
      this.beamGfx.lineStyle(4,  0x44ff88, 0.6);  
      this.beamGfx.strokeCircle(this.CX, this.CY, this.RING_RAD - 9);
    }
  }

  // ── Station graphics ──────────────────────────────────────
  buildStationGfx() {
    const bg = obj => { this.boardGroup.push(obj); return obj; };

    // 1. Central Prep Tables (positioned right outside the ring)
    this.stDefs = {
      prep: {
        x: this.CX, y: this.CY - this.RING_RAD - 20, 
        w: 120, h: 36, base: 0x88aadd, hot: 0x88aadd,
        icon: '', label: 'Wet Lab 🧪', r: 50, labType: 'wet'
      },
      prep2: {
        x: this.CX, y: this.CY + this.RING_RAD + 20, 
        w: 120, h: 36, base: 0xccaa77, hot: 0xccaa77,
        icon: '', label: 'Dry Lab 🔩', r: 50, labType: 'dry'
      }
    };
    this.prepKeys = ['prep', 'prep2'];  // prep = wet lab, prep2 = dry lab
    
    // 2. Beamline components: 4 Experiment Setups and 4 Measurement Consoles
    this.beamlines = [];
    const ctrlLen = 60, ctrlWid = 76, hutchLen = 60, hutchWid = 76;
    
    this.beamlineAngles.forEach((deg, i) => {
      const rad = Phaser.Math.DegToRad(deg);
      
      const dist = this.PREP_RAD + Math.max(ctrlLen, hutchLen)/2 - 10;
      const baseX = this.CX + Math.cos(rad) * dist;
      const baseY = this.CY + Math.sin(rad) * dist;

      const tX = -Math.sin(rad);
      const tY = Math.cos(rad);
      const shiftDist = (ctrlWid + hutchWid) / 4; // place them exactly touching

      const x1 = baseX - tX * shiftDist;
      const y1 = baseY - tY * shiftDist;
      const x2 = baseX + tX * shiftDist;
      const y2 = baseY + tY * shiftDist;

      const sk = `meas_${i}`;
      this.stDefs[sk] = {
        blIdx: i, type: 'meas',
        x: x1, y: y1+10,
        w: 0, h: 0, // Hidden box, whole room is interactive
        base: C.measSt, hot: C.measSt,
        icon: '', label: '', r: 0,
        boxCX: x1, boxCY: y1, boxW: ctrlLen, boxH: ctrlWid, boxRad: rad
      };
      
      const lk = `exp_setup_${i}`;
      this.stDefs[lk] = {
        blIdx: i, type: 'exp_setup',
        x: x2, y: y2,
        w: 0, h: 0, // Hidden box, whole room is interactive
        base: C.lockSt, hot: C.lockSt,
        icon: '', label: '', r: 0,
        boxCX: x2, boxCY: y2, boxW: hutchLen, boxH: hutchWid, boxRad: rad
      };
      
      this.beamlines.push({ idx: i, measKey: sk, lockKey: lk });
    });

    this.stGfx = {};
    for (const [k,st] of Object.entries(this.stDefs)) {
      this.stGfx[k] = bg(this.add.graphics());
      this.drawSt(k,false,null,false);
      if(st.icon && st.w > 0) bg(this.add.text(st.x,st.y-5,st.icon,{font:'18px Arial'}).setOrigin(0.5));
      if(st.label && st.w > 0) bg(this.add.text(st.x,st.y+10,st.label,
        {font:'bold 13px Courier New',color:'#ffffff',letterSpacing:1}).setOrigin(0.5));
    }

    // Station processing bars (shown while auto-processing)
    this.stBars = {};
    const barKeys = [...this.prepKeys, ...this.beamlines.map(b => b.measKey)];
    for (const k of barKeys) {
      const st = this.stDefs[k];
      const bw = k.startsWith('meas') ? 96 : 60;
      const bx = (st.boxCX !== undefined ? st.boxCX : st.x) - bw / 2;
      const by = (st.boxCY !== undefined ? st.boxCY : st.y) + 26;
      const bar = new ProgressBar(this, bx, by, bw, 8, { bgColor: 0xddeef8, bgAlpha: 1 });
      this.stBars[k] = bar;
      this.boardGroup.push(bar);
    }

    // "READY" indicators
    this.stReady = {};
    for (const k of barKeys) {
      const st = this.stDefs[k];
      const rdyX = st.boxCX !== undefined ? st.boxCX : st.x;
      const rdyY = st.boxCY !== undefined ? st.boxCY : st.y;
      this.stReady[k] = bg(this.add.text(rdyX, rdyY - 20,'✅ READY',
        {font:'bold 12px Courier New',color:'#1a7a3a'}).setOrigin(0.5).setAlpha(0).setDepth(27));
    }

    // Sample-loaded indicators for each hutch
    this.hutchSampleIcons = {};
    for (const bl of this.beamlines) {
      const st = this.stDefs[bl.lockKey];
      const ico = bg(this.add.text(st.boxCX, st.boxCY + 6, '🧪',
        {font:'18px Arial'}).setOrigin(0.5).setAlpha(0).setDepth(4));
      const lbl = bg(this.add.text(st.boxCX, st.boxCY + 22, 'LOADED',
        {font:'bold 10px Courier New',color:'#1a6a3a'}).setOrigin(0.5).setAlpha(0).setDepth(4));
      this.hutchSampleIcons[bl.idx] = { ico, lbl };
    }
  }

  // ── Board rebuild (called by sliders) ────────────────────
  rebuildBoard() {
    for (const obj of (this.boardGroup || [])) {
      if (!obj) continue;
      if (typeof obj.destroy === 'function' && obj.bg === undefined) obj.destroy(); // Phaser object
      else if (obj.bg) obj.destroy(); // ProgressBar
    }
    this.boardGroup = [];
    this.stGfx = {}; this.stBars = {}; this.stReady = {};
    this.hutchSampleIcons = {}; this.beamlines = []; this.stDefs = {};
    this.buildLayout();
    this.buildStationGfx();
  }

  // ── Board layout sliders (HTML overlay) ──────────────────
  setupBoardSliders() {
    this.beamlineRotOffset = 0;

    const panel = document.createElement('div');
    panel.style.cssText = `
      position:absolute; top:${this.HUD_H + 8}px; left:8px;
      background:rgba(15,25,45,0.93); color:#aaddff;
      font:12px "Courier New"; padding:12px 16px;
      border-radius:6px; border:1px solid #3a6088;
      display:none; z-index:100; width:230px; user-select:none;
    `;

    const title = document.createElement('div');
    title.textContent = '⚙ BOARD LAYOUT';
    title.style.cssText = 'font-weight:bold; margin-bottom:10px; color:#88ccff; letter-spacing:1px;';
    panel.appendChild(title);

    const addSlider = (label, min, max, step, value, onChange) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:10px;';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:3px;';
      const nameSpan = document.createElement('span'); nameSpan.textContent = label;
      const valSpan  = document.createElement('span'); valSpan.textContent = value;
      lbl.appendChild(nameSpan); lbl.appendChild(valSpan);
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = min; slider.max = max;
      slider.step = step; slider.value = value;
      slider.style.cssText = 'width:100%; cursor:pointer; accent-color:#4499cc;';
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        valSpan.textContent = v;
        onChange(v);
      });
      wrap.appendChild(lbl); wrap.appendChild(slider);
      panel.appendChild(wrap);
    };

    addSlider('RING_RAD',     80,  180, 1, this.RING_RAD, v => { this.RING_RAD = v;           this.rebuildBoard(); });
    addSlider('PREP_RAD',    130,  260, 1, this.PREP_RAD, v => { this.PREP_RAD = v;           this.rebuildBoard(); });
    addSlider('BL rotation°', -45,  45, 1, 0,             v => { this.beamlineRotOffset = v;  this.rebuildBoard(); });

    const logBtn = document.createElement('button');
    logBtn.textContent = '📋 Log final values';
    logBtn.style.cssText = `
      margin-top:4px; background:#1a4a7a; color:#aaddff;
      border:1px solid #3a6088; padding:5px 0; cursor:pointer;
      font:12px "Courier New"; width:100%; border-radius:3px;
    `;
    logBtn.addEventListener('click', () => {
      console.log('=== Board layout values ===');
      console.log(`  RING_RAD: ${this.RING_RAD}`);
      console.log(`  PREP_RAD: ${this.PREP_RAD}`);
      console.log(`  beamlineAngles: [${this.beamlineAngles.join(', ')}]`);
    });
    panel.appendChild(logBtn);

    this.sys.game.canvas.parentElement.style.position = 'relative';
    this.sys.game.canvas.parentElement.appendChild(panel);
    this.boardSliderPanel = panel;
  }

  drawSt(key, hot, jobHex, _busy) {
    const st=this.stDefs[key], g=this.stGfx[key];
    g.clear();
    if (st.w <= 0 || st.h <= 0) return; // Skip rendering small boxes for whole-room zones
    g.fillStyle(hot ? st.hot : st.base, 1);
    g.fillRoundedRect(st.x-st.w/2,st.y-st.h/2,st.w,st.h,5);
    g.lineStyle(hot?2:1, hot?(jobHex||0xe07000):0x4a7a9a, hot?1:0.6);
    g.strokeRoundedRect(st.x-st.w/2,st.y-st.h/2,st.w,st.h,5);
  }

  // ── User NPCs ─────────────────────────────────────────────
  buildUserNPCs() {
    this._npcMinR = this.RING_RAD + 30;
    this._npcMaxR = this.PREP_RAD - 15;
    const midR = (this._npcMinR + this._npcMaxR) / 2;
    const prepStPos = this.prepKeys.map(k => ({ x: this.stDefs[k].x, y: this.stDefs[k].y }));
    const prepClearance = 80;

    // Build and cache the list of valid arc angles (same every game, depends only on layout).
    this._npcValidAngles = [];
    for (let deg = 0; deg < 360; deg++) {
      const a  = Phaser.Math.DegToRad(deg);
      const tx = this.CX + Math.cos(a) * midR;
      const ty = this.CY + Math.sin(a) * midR;
      if (prepStPos.every(p => Phaser.Math.Distance.Between(tx, ty, p.x, p.y) >= prepClearance)) {
        this._npcValidAngles.push(a);
      }
    }

    // Assign a random position to every slot (including any already claimed during create()).
    this.npcPos = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      this.npcPos.push(this._pickNpcPos());
    }
    this.npcR = 46;
    this.npcs = this.npcPos.map((pos,i)=>{
      const grp = this.add.container(pos.x,pos.y).setAlpha(0).setDepth(5);
      grp.add([
        this.add.ellipse(0,12,30,9,JOB_HEX[i],0.20),
        this.add.circle(0,0,12,JOB_HEX[i]),
        this.add.rectangle(0,5,15,9,0xffffff,0.45),
        this.add.text(0,0,`U${i+1}`,{font:'bold 11px Courier New',color:'#fff'}).setOrigin(0.5),
      ]);
      const nameTag = this.add.text(0,22,'',
        {font:'11px Courier New',color:JOB_TXT[i],align:'center',wordWrap:{width:80}}).setOrigin(0.5);
      const ring = this.add.circle(0,0,18,0xffffff,0);
      ring.setStrokeStyle(1.5,JOB_HEX[i],0.4);
      // Leave timer bar — added to grp so it bobs with the NPC
      const leaveBarBg   = this.add.rectangle(-14,-24,28,4,0x223344,0.85).setOrigin(0,0.5);
      const leaveBarFill = this.add.rectangle(-14,-24, 1,4,0x44cc88,1 ).setOrigin(0,0.5);
      grp.add([nameTag,ring,leaveBarBg,leaveBarFill]);
      return {grp,nameTag,ring,leaveBarBg,leaveBarFill};
    });
  }

  // Pick a single random valid position in the NPC arc band.
  _pickNpcPos() {
    const angles = this._npcValidAngles;
    const angle  = angles[Math.floor(Math.random() * angles.length)];
    const r      = this._npcMinR + Math.random() * (this._npcMaxR - this._npcMinR);
    return { x: this.CX + Math.cos(angle) * r, y: this.CY + Math.sin(angle) * r };
  }

  // With the npcPositioning upgrade: spawn halfway between the job's prep lab and its beamline hutch.
  _pickNpcPosForJob(job) {
    if (!this.upgrades.npcPositioning || !job) return this._pickNpcPos();
    const prepKey = job.labType === 'wet' ? 'prep' : 'prep2';
    const prep    = this.stDefs[prepKey];
    const bl      = this.beamlines.find(b => this.beamlineTechs[b.idx] === job.tech);
    if (!prep || !bl) return this._pickNpcPos();
    const hutch = this.stDefs[bl.lockKey];
    return { x: (prep.x + hutch.boxCX) / 2, y: (prep.y + hutch.boxCY) / 2 };
  }

  refreshNPCs() {
    // Only show NPCs for active jobs; each job owns a stable NPC slot via job.npcSlot
    for (let i = 0; i < MAX_SLOTS; i++) {
      const npc = this.npcs[i];
      if (!npc) continue;
      const j = this.active.find(a => a.npcSlot === i);
      const visible = !!j && j.done < j.totalSamples && !j.npcGone;
      npc.grp.setAlpha(visible ? 1 : 0);
      if (visible) npc.nameTag.setText(j.name.split(' ').slice(-1)[0]);
      // Leave bar visible whenever the NPC is visible (timer pre-rolled for all active jobs)
      const showBar = visible && j.leaveMs !== undefined;
      npc.leaveBarBg.setVisible(showBar);
      npc.leaveBarFill.setVisible(showBar);
    }
  }

  // ── Active jobs & Pending proposals panel ───────────────
  buildActivePanel() {
    const rx=GW-this.JOBS_W, bx=rx+this.JOBS_W/2;
    this.add.text(bx,this.HUD_H+14,'🔬',{font:'16px Arial'}).setOrigin(0.5);
    this.add.text(bx,this.HUD_H+30,'ACTIVE & PENDING JOBS',
      {font:'bold 11px Courier New',color:'#2a5a7a',letterSpacing:1}).setOrigin(0.5);
    this.queueLbl = this.add.text(bx,this.HUD_H+44,'',
      {font:'11px Courier New',color:'#aa6622'}).setOrigin(0.5);
    
    // Layout 5 slots vertically
    const slotH=Math.floor((GH-this.HUD_H-52)/MAX_SLOTS);
    this.jobSlots=[];

    for(let i=0;i<MAX_SLOTS;i++){
      const sy=this.HUD_H+50+i*slotH;
      const sh=slotH-6;
      
      // Base bg wrapper
      const bg = this.add.rectangle(rx+8,sy,this.JOBS_W-16,sh,0xf0f6fc).setOrigin(0,0).setStrokeStyle(1,0xaaccdd);
      
      // -- ACTIVE JOB ELEMENTS --
      const dot   =this.add.circle(rx+16,sy+16,6,JOB_HEX[i]);
      const name  =this.add.text(rx+28,sy+9,'',{font:'bold 13px Courier New',color:JOB_TXT[i],wordWrap:{width:this.JOBS_W-40}});
      const tech  =this.add.text(rx+8,sy+30,'',{font:'11px Courier New',color:'#2a7a9a'});
      const prog  =this.add.text(rx+8,sy+43,'',{font:'bold 12px Courier New',color:'#00cc88'});
      const state =this.add.text(rx+8,sy+55,'',{font:'12px Courier New',color:'#ccaa44',wordWrap:{width:this.JOBS_W-16}});
      const pipBar = new ProgressBar(this, rx+8, sy+78, this.JOBS_W-16, 8,
        { bgColor:0xd8e8f4, bgAlpha:1, fillColor:JOB_HEX[i], depth:0 });

      // -- PENDING PROPOSAL ELEMENTS --
      const pendTit = this.add.text(rx+8,sy+6, '',{font:'bold 11px Courier New',color:'#2a5a8a',wordWrap:{width:this.JOBS_W-16}});
      const pendSub = this.add.text(rx+8,sy+22,'',{font:'11px Courier New',color:'#4a5a6a',wordWrap:{width:this.JOBS_W-16}});
      const pendRep = this.add.text(rx+8,sy+36,'',{font:'bold 12px Courier New',color:'#b38600'});
      const pendTim = this.add.text(rx+8,sy+48,'',{font:'12px Courier New',color:'#aa4422'});
      const pendBar = new ProgressBar(this, rx+8, sy+62, this.JOBS_W-16, 4,
        { bgColor:0xe8e4e0, bgAlpha:1, fillColor:0xff8844, depth:0 });
      const pendBtn = this.add.text(rx+this.JOBS_W/2,sy+78,'[ CLICK TO ACCEPT ]',
        {font:'bold 13px Courier New',color:'#0a8a5a'}).setOrigin(0.5).setInteractive({useHandCursor:true});
      pendBtn.on('pointerover',()=>pendBtn.setStyle({color:'#0ab877'}));
      pendBtn.on('pointerout', ()=>pendBtn.setStyle({color:'#0a8a5a'}));

      // Store index on the button to know which pending to accept
      pendBtn.on('pointerdown',() => this.acceptProposalBySlot(i));
      bg.setInteractive({useHandCursor:true}).on('pointerdown',() => this.acceptProposalBySlot(i));

      this.jobSlots.push({
        bg,
        dot,name,tech,prog,state,pipBar,
        pendTit,pendSub,pendRep,pendTim,pendBar,pendBtn,
        linkedPendingIdx: -1,
        linkedQueueIdx:   -1,
      });
    }
    this.refreshJobs();
  }

  refreshJobs() {
    const effSlots = MAX_ACTIVE + (this.upgrades ? this.upgrades.extraJobSlots||0 : 0);
    if (this.queueLbl) this.queueLbl.setText('');

    let qIdx = 0; // index into this.commitQueue
    let pIdx = 0; // index into this.pending

    for(let i=0;i<MAX_SLOTS;i++){
      const d=this.jobSlots[i];
      const j=this.active.find(a => a.npcSlot === i);

      if(j){
        // ── Slot is ACTIVE JOB ──
        d.linkedPendingIdx = -1;
        d.linkedQueueIdx   = -1;
        d.bg.setAlpha(1).setFillStyle(0xf0f6fc).setStrokeStyle(1,0xaaccdd);
        d.dot.setAlpha(1);
        [d.name,d.tech,d.prog,d.state].forEach(o=>o.setVisible(true));
        [d.pendTit,d.pendSub,d.pendRep,d.pendTim,d.pendBtn].forEach(o=>o.setVisible(false));
        d.pendBar.hide();

        const labIcon = j.labType === 'wet' ? '🧪' : '🔩';
        d.name.setText(`${labIcon} ${j.name}`);
        const blIdx = this.beamlineTechs.indexOf(j.tech);
        d.tech.setText(j.tech).setStyle({color: blIdx >= 0 ? BL_TXT[blIdx] : '#2a7a9a'});
        d.prog.setText(`${j.done}/${j.totalSamples} done`);

        const inHand  = this.held.filter(h=>h.jobId===j.id).length;
        const inPrep  = this.prepKeys.reduce((n,pk) => n + this.prepSlotsFor[pk].filter(s=>s.jobId===j.id).length, 0);
        const inMeas  = this.measSlots.filter(s=>s.jobId===j.id).length;
        const parts   = [];
        if(j.unstarted>0) parts.push(`${j.unstarted} waiting`);
        if(inHand>0)       parts.push(`${inHand} in hand`);
        if(inPrep>0)       parts.push(`${inPrep} prepping`);
        if(inMeas>0)       parts.push(`${inMeas} measuring`);
        d.state.setText(parts.join(', ') || '→ collect sample');
        d.pipBar.setFraction(j.done/j.totalSamples).setFillStyle(JOB_HEX[i]).show();
      } else if (qIdx < this.commitQueue.length) {
        // ── Slot is QUEUED COMMITTED PROPOSAL (click to activate) ──
        d.linkedPendingIdx = -1;
        d.linkedQueueIdx   = qIdx;
        const p = this.commitQueue[qIdx++];

        d.bg.setAlpha(1).setFillStyle(0xeaf4ff).setStrokeStyle(1,0x4488bb);
        d.dot.setAlpha(0);
        [d.name,d.tech,d.prog,d.state].forEach(o=>o.setVisible(false));
        [d.pendTit,d.pendSub,d.pendRep,d.pendTim,d.pendBtn].forEach(o=>o.setVisible(true));
        d.pipBar.hide();
        d.pendBar.hide();

        const slotsFull = this.active.length >= effSlots;
        const labIcon = p.labType === 'wet' ? '🧪' : '🔩';
        d.pendTit.setText(`📋 ${labIcon} ${p.name}`).setStyle({color:'#1a4a7a'});
        const blIdx = this.beamlineTechs.indexOf(p.tech);
        d.pendSub.setText(p.tech).setStyle({color: blIdx >= 0 ? BL_TXT[blIdx] : '#4a5a6a'});
        d.pendRep.setText(`⭐ +${p.rep} rep`);
        d.pendTim.setText(`📦 ${p.totalSamples || p.samples} samples  ·  committed`).setStyle({color:'#2a5a8a'});
        if (slotsFull) {
          d.pendBtn.setText('[ NO SLOT AVAILABLE ]').setStyle({color:'#888888'});
          d.bg.setFillStyle(0xf4f4f4).setStrokeStyle(1,0xaaaaaa);
        } else {
          d.pendBtn.setText('[ CLICK TO START ]').setStyle({color:'#1a6aaa'});
        }
      } else if (pIdx < this.pending.length) {
        // ── Slot is PENDING RAPID-REVIEW PROPOSAL ──
        d.linkedPendingIdx = pIdx;
        d.linkedQueueIdx   = -1;
        const p = this.pending[pIdx++];
        const f = p.timeLeft / PROPOSAL_LIFE;
        const tc = f>0.5?'#1a8844':f>0.25?'#aa6600':'#cc1100';

        d.bg.setAlpha(1).setFillStyle(0xfffdf4).setStrokeStyle(1,0xddaa44);
        d.dot.setAlpha(0);
        [d.name,d.tech,d.prog,d.state].forEach(o=>o.setVisible(false));
        [d.pendTit,d.pendSub,d.pendRep,d.pendTim,d.pendBtn].forEach(o=>o.setVisible(true));
        d.pipBar.hide();

        const slotsFull = this.active.length >= effSlots;
        const labIcon = p.labType === 'wet' ? '🧪' : '🔩';
        d.pendTit.setText(`⚡ ${labIcon} ${p.name}`).setStyle({color:'#2a5a8a'});
        const blIdx = this.beamlineTechs.indexOf(p.tech);
        d.pendSub.setText(p.tech).setStyle({color: blIdx >= 0 ? BL_TXT[blIdx] : '#4a5a6a'});
        d.pendRep.setText(`⭐ +${p.rep} rep bonus`);
        d.pendTim.setText(`📦 ${p.samples} spl  ⏱ ${p.timeLeft}s`).setStyle({color:tc});
        d.pendBar.setFraction(f).setFillStyle(f>0.5?0x44bb44:f>0.25?0xddaa44:0xff4444).show();
        if (slotsFull) {
          d.pendBtn.setText('[ NO SLOT AVAILABLE ]').setStyle({color:'#888888'});
          d.bg.setFillStyle(0xf4f4f4).setStrokeStyle(1,0xaaaaaa);
        } else {
          d.pendBtn.setText('[ CLICK TO ACCEPT ]').setStyle({color:'#0a8a5a'});
        }
      } else {
        // ── Slot is COMPLETELY EMPTY ──
        d.linkedPendingIdx = -1;
        d.linkedQueueIdx   = -1;
        d.bg.setAlpha(0.3).setFillStyle(0xf0f6fc).setStrokeStyle(1,0xaaccdd);
        d.dot.setAlpha(0.2);
        [d.name,d.tech,d.prog,d.state].forEach(o=>o.setVisible(true));
        [d.pendTit,d.pendSub,d.pendRep,d.pendTim,d.pendBtn].forEach(o=>o.setVisible(false));
        d.pendBar.hide();

        d.name.setText('— empty —');
        d.tech.setText(''); d.prog.setText(''); d.state.setText('');
        d.pipBar.bg.setAlpha(0.25); d.pipBar.fill.setAlpha(0); d.pipBar.lbl.setAlpha(0);
      }
    }
  }

  // ── Player sprite ─────────────────────────────────────────
  buildPlayer() {
    // Spawn inside the main central corridor ring
    const corridorMinR = this.RING_RAD + 20;
    const corridorMaxR = this.PREP_RAD - 20;
    let spawnX = this.CX + corridorMinR, spawnY = this.CY;
    for (let i = 0; i < 200; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = corridorMinR + Math.random() * (corridorMaxR - corridorMinR);
      const cx = this.CX + Math.cos(angle) * r;
      const cy = this.CY + Math.sin(angle) * r;
      
      const inRoom = Object.values(this.stDefs).some(st => this.isPointInSt(st, cx, cy));
      if (!inRoom) { spawnX = cx; spawnY = cy; break; }
    }
    this.px = spawnX;
    this.py = spawnY;
    this.playerMoveAngle = Math.PI / 2;  // default: postdoc starts above player
    this.SPD = 172;

    this.pCon=this.add.container(this.px,this.py).setDepth(10);
    this.pCon.add([
      this.add.circle(0,0,13,C.player),
      this.add.circle(0,-9,7,C.hat),
      this.add.text(0,18,'YOU',{font:'bold 12px Courier New',color:'#0a3a8a'}).setOrigin(0.5),
    ]);


    // Inventory dots above player head
    this.invDots=[];
    for(let i=0;i<MAX_HELD;i++){
      const d=this.add.circle(0,0,7,0xaaaaaa).setVisible(false).setDepth(20);
      const t=this.add.text(0,0,'',{font:'bold 10px Courier New',color:'#fff'}).setOrigin(0.5).setVisible(false).setDepth(21);
      this.invDots.push({d,t});
    }


    const cx=this.BOARD_W+this.PLAY_W/2;
    this.promptTxt=this.add.text(cx,GH-22,'',
      {font:'bold 14px Courier New',color:'#ccaa44',align:'center'}).setOrigin(0.5).setDepth(20);
    this.statusTxt=this.add.text(cx,GH-42,'',
      {font:'14px Courier New',color:'#00cc88',align:'center'}).setOrigin(0.5).setDepth(20);
  }

  // ── Postdoc NPCs ─────────────────────────────────────────────
  buildPostdocs() {
    this.postdocs = [];
    const count = this.upgrades.postdocs || 0;
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * (i === 0 ? 0.75 : 0.25);
      const r = this.PREP_RAD - 30;
      const x = this.CX + Math.cos(angle) * r;
      const y = this.CY + Math.sin(angle) * r;
      const name  = (this.upgrades.postdocNames  || [])[i] || `PD${i+1}`;
      const level = (this.upgrades.postdocLevels || [])[i] || 1;
      const badge = name.slice(0, 3).toUpperCase();
      const grp = this.add.container(x, y).setDepth(9);
      grp.add([
        this.add.ellipse(0, 12, 28, 8, 0x2266aa, 0.25),
        this.add.circle(0, 0, 11, 0x2a66cc),
        this.add.rectangle(0, 5, 13, 8, 0xffffff, 0.4),
        this.add.text(0, 0, badge, {font:'bold 10px Courier New', color:'#fff'}).setOrigin(0.5),
      ]);
      const label = this.add.text(0, -20, 'idle', {font:'10px Courier New', color:'#6699cc'}).setOrigin(0.5);
      grp.add(label);
      this.postdocs.push({ x, y, grp, label, targetX: x, targetY: y, targetKey: null, thinkTimer: 0,
                            state: 'idle', assignedAction: null, followAngle: angle, stuckTimer: 0,
                            name, level });
    }
  }

  updatePostdocs(delta) {
    const SPD = this.SPD, dt = delta / 1000;
    for (const pd of this.postdocs) {
      // L2 idle: trail behind the player, opposite to their movement direction
      if (pd.level >= 2 && pd.state === 'idle') {
        const FOLLOW_DIST = 50;
        const trailAngle = this.playerMoveAngle + Math.PI;
        pd.targetX = this.px + Math.cos(trailAngle) * FOLLOW_DIST;
        pd.targetY = this.py + Math.sin(trailAngle) * FOLLOW_DIST;
      }

      // Both levels use the same action logic; think-timer drives it
      pd.thinkTimer -= delta;
      if (pd.thinkTimer <= 0) {
        pd.thinkTimer = 1500;
        const t = this._postdocTargetL1(pd);
        if (t) {
          pd.targetKey = t.key; pd.targetX = t.x; pd.targetY = t.y;
          pd.assignedAction = t.action;
          pd.state = 'moving';
          pd.label.setText('▶ helping');
        } else {
          // Clear assignment if the action we were helping with is no longer active
          if (pd.assignedAction) {
            pd.assignedAction = null;
            pd.state = 'idle';
          }
          if (pd.state === 'idle') {
            pd.targetKey = null;
            if (pd.level >= 2) {
              // L2: idle target is already updated continuously above; just clear label
              pd.label.setText('');
            } else {
              // L1: wander randomly within the ring corridor
              const a = Math.random() * Math.PI * 2;
              const r = this.RING_RAD + 30 + Math.random() * (this.PREP_RAD - this.RING_RAD - 50);
              pd.targetX = Phaser.Math.Clamp(this.CX + Math.cos(a) * r, 14, this.PLAY_W - 14);
              pd.targetY = Phaser.Math.Clamp(this.CY + Math.sin(a) * r, this.HUD_H + 14, GH - 14);
              pd.label.setText('idle');
            }
          }
        }
      }
      const dx = pd.targetX - pd.x, dy = pd.targetY - pd.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 4) {
        let moved = false;

        // Proactively orbit when the straight path to target crosses the inner ring —
        // avoids the case where one axis still has a sliver of movement and the postdoc
        // inches along without making real progress toward the target.
        if (this._pathCrossesRing(pd.x, pd.y, pd.targetX, pd.targetY)) {
          moved = this._orbitRing(pd, SPD * dt);
        } else {
          const stepX = (dx / dist) * SPD * dt;
          const stepY = (dy / dist) * SPD * dt;
          let movedX = false, movedY = false;
          if (this.isValidPos(pd.x + stepX, pd.y, 8)) { pd.x += stepX; movedX = true; }
          if (this.isValidPos(pd.x, pd.y + stepY, 8)) { pd.y += stepY; movedY = true; }
          moved = movedX || movedY;

          // Fallback: orbit when completely blocked near the ring
          if (!movedX && !movedY) {
            const toCenter = Phaser.Math.Distance.Between(pd.x, pd.y, this.CX, this.CY);
            if (toCenter < this.RING_RAD + 80) moved = this._orbitRing(pd, SPD * dt);
          }
        }

        // Stuck safety valve: if the postdoc hasn't moved in 2 s, force a re-think
        if (moved) {
          pd.stuckTimer = 0;
        } else {
          pd.stuckTimer += delta;
          if (pd.stuckTimer > 2000) { pd.thinkTimer = 0; pd.stuckTimer = 0; }
        }

        pd.grp.setPosition(pd.x, pd.y);
      } else if (pd.state === 'moving' && pd.assignedAction) {
        // Arrived at target — start working (L1 only)
        pd.state = 'working';
        pd.label.setText('⚙ working');
      }
    }
  }

  // True if line segment (x1,y1)→(x2,y2) passes through the inner ring (+ postdoc margin)
  _pathCrossesRing(x1, y1, x2, y2) {
    const r = this.RING_RAD + 8;
    const ddx = x2 - x1, ddy = y2 - y1;
    const fx = x1 - this.CX, fy = y1 - this.CY;
    const a = ddx * ddx + ddy * ddy;
    if (a === 0) return false;
    const b = 2 * (fx * ddx + fy * ddy);
    const c = fx * fx + fy * fy - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    return (t1 > 0 && t1 < 1) || (t2 > 0 && t2 < 1);
  }

  // Orbit the inner ring tangentially; returns true if any movement happened
  _orbitRing(pd, step) {
    const radAngle = Math.atan2(pd.y - this.CY, pd.x - this.CX);
    const cwX  = Math.cos(radAngle + Math.PI / 2), cwY  = Math.sin(radAngle + Math.PI / 2);
    const ccwX = Math.cos(radAngle - Math.PI / 2), ccwY = Math.sin(radAngle - Math.PI / 2);
    const dCW  = (pd.x + cwX  - pd.targetX) ** 2 + (pd.y + cwY  - pd.targetY) ** 2;
    const dCCW = (pd.x + ccwX - pd.targetX) ** 2 + (pd.y + ccwY - pd.targetY) ** 2;
    const orbitX = (dCW < dCCW ? cwX : ccwX) * step;
    const orbitY = (dCW < dCCW ? cwY : ccwY) * step;
    let moved = false;
    if (this.isValidPos(pd.x + orbitX, pd.y, 8)) { pd.x += orbitX; moved = true; }
    if (this.isValidPos(pd.x, pd.y + orbitY, 8)) { pd.y += orbitY; moved = true; }
    return moved;
  }

  // Level 1 AI: only react to player-initiated actions in rooms
  _postdocTargetL1(pd) {
    const candidates = [];

    // 1. Prep rooms — player is in a prep station AND there's an active prep slot
    for (const pk of this.prepKeys) {
      const st = this.stDefs[pk];
      const playerInPrep = this.isPointInSt(st, this.px, this.py);
      const hasActiveSlot = this.prepSlotsFor[pk].some(s => !s.toStage);
      if (!playerInPrep || !hasActiveSlot) continue;
      if (this.postdocs.some(p => p !== pd && p.targetKey === pk)) continue;
      candidates.push({ key: pk, x: st.x, y: st.y, action: { type: 'prep', key: pk } });
    }

    // 2. Experiment setup — player is actively doing experiment setup at a hutch
    if (this.doingExpSetup && this.activeExpSetupIdx >= 0) {
      const bl = this.beamlines[this.activeExpSetupIdx];
      const st = this.stDefs[bl.lockKey];
      const lk = bl.lockKey;
      if (!this.postdocs.some(p => p !== pd && p.targetKey === lk)) {
        candidates.push({ key: lk, x: st.boxCX, y: st.boxCY,
                          action: { type: 'expSetup', key: lk, blIdx: bl.idx } });
      }
    }

    // 3. Scan / measurement — player is in a control room AND there's a started measurement
    for (const bl of this.beamlines) {
      const st = this.stDefs[bl.measKey];
      const playerInMeas = this.isPointInSt(st, this.px, this.py);
      const hasActiveMeas = this.measSlots.some(s => s.blIdx === bl.idx && !s.toStage && s.started);
      if (!playerInMeas || !hasActiveMeas) continue;
      if (this.postdocs.some(p => p !== pd && p.targetKey === bl.measKey)) continue;
      candidates.push({ key: bl.measKey, x: st.boxCX, y: st.boxCY,
                        action: { type: 'scan', key: bl.measKey, blIdx: bl.idx } });
    }

    // If postdoc is already working and its action is still valid, keep it
    if (pd.state === 'working' && pd.assignedAction) {
      const a = pd.assignedAction;
      if (a.type === 'prep') {
        if (this.prepSlotsFor[a.key]?.some(s => !s.toStage)) return { key: a.key, x: pd.targetX, y: pd.targetY, action: a };
      } else if (a.type === 'expSetup') {
        if (this.doingExpSetup && this.activeExpSetupIdx === a.blIdx) return { key: a.key, x: pd.targetX, y: pd.targetY, action: a };
      } else if (a.type === 'scan') {
        if (this.measSlots.some(s => s.blIdx === a.blIdx && !s.toStage && s.started)) return { key: a.key, x: pd.targetX, y: pd.targetY, action: a };
      }
      // Action is no longer valid — will fall through to null
    }

    if (!candidates.length) return null;
    return candidates.sort((a, b) =>
      Phaser.Math.Distance.Between(pd.x, pd.y, a.x, a.y) -
      Phaser.Math.Distance.Between(pd.x, pd.y, b.x, b.y)
    )[0];
  }


  // ── Progress bar (created AFTER player so it renders on top) ─
  buildProgressBar() {
    this.expSetupBar = new ProgressBar(this, 0, 0, 60, 8, {
      bgColor: 0xddeef8, bgAlpha: 1, fillColor: 0xdd4433, depth: 22,
    });
  }

  // ── HUD ───────────────────────────────────────────────────
  buildHUD() {
    this.timerTxt=this.add.text(GW/2,22,this.daysLeft(this.yearTimer),
      {font:'bold 20px Courier New',color:'#1a5a8a'}).setOrigin(0.5).setDepth(15);
    this.cycleLbl=this.add.text(GW/2,44,this.cycleLabel(),
      {font:'12px Courier New',color:'#2a4a6a',letterSpacing:2}).setOrigin(0.5).setDepth(15);

    this.repTxt =this.add.text(20, 32,`⭐ ${this.reputation} rep`,
      {font:'bold 14px Courier New',color:'#6a4d00'}).setOrigin(0, 0.5).setDepth(15);
    this.sampTxt=this.add.text(125, 32,'⬡ 0 samples',
      {font:'bold 14px Courier New',color:'#0a5a30'}).setOrigin(0, 0.5).setDepth(15);
    this.invLabel=this.add.text(250, 32,`🧪 0/${MAX_HELD} held`,
      {font:'bold 14px Courier New',color:'#1a5aaa'}).setOrigin(0, 0.5).setDepth(15);
    this.destLabel=this.add.text(370, 32,'',
      {font:'bold 13px Courier New',color:'#0a7a3a'}).setOrigin(0, 0.5).setDepth(15);

    const ringX = GW - 175;
    this.ringLbl=this.add.text(ringX,15,'RING STABILITY',
      {font:'12px Courier New',color:'#0a4a20',letterSpacing:1}).setDepth(15);
    this.rBg  =this.add.rectangle(ringX,38,158,12,0xc4e0cc).setOrigin(0,0.5).setDepth(15);
    this.rFill=this.add.rectangle(ringX,38,158,12,0x44bb44).setOrigin(0,0.5).setDepth(15);
    this.rPct =this.add.text(ringX+79,38,'100%',
      {font:'bold 12px Courier New',color:'#1a3a1a'}).setOrigin(0.5).setDepth(15);

    this.setupLayoutMode();
  }

  // ── Layout drag mode (press ` to toggle) ─────────────────
  setupLayoutMode() {
    this.layoutMode = false;
    this.layoutObjects = [
      { obj: this.timerTxt, name: 'timerTxt' },
      { obj: this.cycleLbl, name: 'cycleLbl' },
      { obj: this.repTxt,   name: 'repTxt'   },
      { obj: this.sampTxt,  name: 'sampTxt'  },
      { obj: this.invLabel,  name: 'invLabel'  },
      { obj: this.destLabel, name: 'destLabel' },
      { obj: this.ringLbl,   name: 'ringLbl'   },
      { obj: this.rBg,      name: 'rBg'      },
      { obj: this.rFill,    name: 'rFill'    },
      { obj: this.rPct,     name: 'rPct'     },
    ];

    this.layoutBanner = this.add.text(GW/2, GH-18,
      '⚙ LAYOUT MODE  •  drag HUD elements  •  press ` to finish & log positions',
      { font:'12px Courier New', color:'#ffffff',
        backgroundColor:'#223355', padding:{x:8,y:4} })
      .setOrigin(0.5).setDepth(99).setVisible(false);

    this.input.on('drag', (_p, obj, dragX, dragY) => {
      if (!this.layoutMode) return;
      obj.x = dragX; obj.y = dragY;
    });
    this.input.on('dragend', (_p, obj) => {
      if (!this.layoutMode) return;
      console.log(`${obj._layoutName}: x=${Math.round(obj.x)}, y=${Math.round(obj.y)}`);
    });

    this.input.keyboard.on('keydown', e => {
      if (e.key === '`') this.toggleLayoutMode();
    });

    this.setupBoardSliders();
  }

  toggleLayoutMode() {
    this.layoutMode = !this.layoutMode;
    this.layoutBanner.setVisible(this.layoutMode);
    if (this.boardSliderPanel)
      this.boardSliderPanel.style.display = this.layoutMode ? 'block' : 'none';
    for (const { obj, name } of this.layoutObjects) {
      obj._layoutName = name;
      if (this.layoutMode) {
        obj.setInteractive({ draggable: true, useHandCursor: true });
        this.input.setDraggable(obj);
      } else {
        this.input.setDraggable(obj, false);
        obj.disableInteractive();
      }
    }
    if (!this.layoutMode) {
      console.log('=== Final HUD positions ===');
      for (const { obj, name } of this.layoutObjects) {
        console.log(`  ${name}: x=${Math.round(obj.x)}, y=${Math.round(obj.y)}`);
      }
    }
  }

  // ── Timers ────────────────────────────────────────────────
  onTick() {
    if (this.gamePaused) return;
    this.yearTimer=Math.max(0,this.yearTimer-(this.devTickMult||1));

    // Tick beam dump countdown
    if (this.beamDump) {
      this.beamDumpTimer--;
      this.dumpCountdown.setText(`measurements paused — ${(this.beamDumpTimer / 2).toFixed(1)} days remaining`);
      if (this.beamDumpTimer <= 0) this.endBeamDump();
    }
    for(let i=this.pending.length-1;i>=0;i--){
      if(--this.pending[i].timeLeft<=0){
        this.pending.splice(i,1); this.flash('Proposal expired!','#ff4433');
      }
    }
    if(this.pending.length<3&&this.yearTimer%15===0) this.spawnProposal();
    const t=this.yearTimer;
    this.timerTxt.setText(this.daysLeft(t))
      .setStyle({color:t<=30?'#bb1100':t<=60?'#aa5500':'#1a5a8a'});
    this.cycleLbl.setText(this.cycleLabel());
    this.refreshJobs();
    if(t<=0) this.endYear();
  }

  spawnProposal() {
    if(this.gamePaused) return;
    const apps=getAvailableApps(this.year||1);
    const app=apps[Math.floor(Math.random()*apps.length)];
    const tech=this.beamlineTechs[Math.floor(Math.random()*this.beamlineTechs.length)];
    const n=Phaser.Math.Between(app.samples[0],app.samples[1]);
    this.pending.push({name:app.name,tech,samples:n,rep:app.rep+(n-1)*8+Phaser.Math.Between(-3,3),timeLeft:PROPOSAL_LIFE,labType:app.lab||'dry'});
    this.restockProposalHub();
  }

  schedulePotentialBeamStop() {
    // Roll once per cycle: chance = (100 - ringStab)%, e.g. 2% at 98%
    const chance = (100 - this.ringStab) / 100;
    if (Math.random() >= chance) return;
    // Schedule at a random time, avoiding the first and last 20s of the cycle
    const whenMs = Phaser.Math.FloatBetween(0, this.yearTimer) * 1000;
    this.time.delayedCall(whenMs, () => {
      if (!this.beamDump) this.triggerBeamDump();
    }, [], this);
  }

  restockProposalHub() {
    while (this.active.length + this.commitQueue.length + this.pending.length < MAX_SLOTS) {
      const apps=getAvailableApps(this.year||1);
      const app=apps[Math.floor(Math.random()*apps.length)];
      const tech=this.beamlineTechs[Math.floor(Math.random()*this.beamlineTechs.length)];
      const n=Phaser.Math.Between(app.samples[0],app.samples[1]);
      this.pending.push({name:app.name,tech,samples:n,rep:app.rep+(n-1)*8+Phaser.Math.Between(-3,3),timeLeft:PROPOSAL_LIFE,labType:app.lab||'dry'});
    }
    this.refreshJobs();
  }

  // ── Accept pending proposal by clicking its slot ────────
  acceptProposalBySlot(slotIdx) {
    const slotData = this.jobSlots[slotIdx];
    if (!slotData) return;
    const effMax = MAX_ACTIVE + (this.upgrades.extraJobSlots||0);
    if (this.active.length >= effMax) { this.flash('All job slots full!','#ff4433'); return; }

    // Queued committed proposal (player-initiated activation)
    if (slotData.linkedQueueIdx >= 0) {
      const qIdx = slotData.linkedQueueIdx;
      if (!this.commitQueue[qIdx]) return;
      const p = this.commitQueue.splice(qIdx, 1)[0];
      const freeSlot = this._claimNpcSlot(p);
      if (freeSlot < 0) { this.flash('No free user slot!','#ff4433'); return; }
      // commitQueue stores full job objects (built at game start) — reuse and re-roll durations
      p.done = 0;
      p.unstarted = p.totalSamples;
      p.npcGone = false;
      p.npcSlot = freeSlot;
      this._rollJobDurations(p);
      this.active.push(p);
      this.refreshJobs();
      this.refreshNPCs();
      this.flash(`📋 ${p.name} started`, '#0a8844');
      return;
    }

    // Rapid-review (ephemeral bonus) proposal
    if (slotData.linkedPendingIdx >= 0) {
      const pIdx = slotData.linkedPendingIdx;
      if (!this.pending[pIdx]) return;
      const p = this.pending.splice(pIdx, 1)[0];
      const job = {
        id: this.jobIdCtr++, name: p.name, tech: p.tech,
        totalSamples: p.samples, rep: p.rep,
        done: 0, unstarted: p.samples,
        committed: false,   // rapid review — no rep penalty
        labType: p.labType || 'dry',
      };
      const freeSlot = this._claimNpcSlot(job);
      if (freeSlot < 0) { this.flash('No free user slot!','#ff4433'); return; }
      job.npcSlot = freeSlot;
      this._rollJobDurations(job);
      this.active.push(job);
      this.refreshJobs();
      this.refreshNPCs();
      this.flash(`⚡ Rapid job accepted: ${p.name}`, '#0a8844');
    }
  }

  isPointInSt(st, px, py) {
    if (st.boxW !== undefined) {
      // Rotated rectangular collision check
      const cos = Math.cos(-st.boxRad);
      const sin = Math.sin(-st.boxRad);
      const dx = px - st.boxCX;
      const dy = py - st.boxCY;
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      return Math.abs(lx) <= st.boxW / 2 && Math.abs(ly) <= st.boxH / 2;
    }
    // Standard circular collision
    return Phaser.Math.Distance.Between(px, py, st.x, st.y) < st.r;
  }

  // Prevents characters from walking into the grey void
  isValidPos(x, y, margin = 10) {
    const dist = Phaser.Math.Distance.Between(x, y, this.CX, this.CY);
    // 1. Cannot enter the inner storage ring
    if (dist < this.RING_RAD + margin) return false;
    // 2. Free movement inside the main circular corridor
    if (dist <= this.PREP_RAD - margin) return true;
    
    // 3. Seamless movement within combined beamline rooms (Control Room + Hutch are 1 large box)
    const ctrlLen = 60, ctrlWid = 76, hutchLen = 60, hutchWid = 76;
    const pairLen = Math.max(ctrlLen, hutchLen);
    const pairWid = ctrlWid + hutchWid; 

    for (let i = 0; i < this.beamlineAngles.length; i++) {
      const rad = Phaser.Math.DegToRad(this.beamlineAngles[i]);
      const centerDist = this.PREP_RAD + pairLen/2 - 10;
      const baseX = this.CX + Math.cos(rad) * centerDist;
      const baseY = this.CY + Math.sin(rad) * centerDist;
      
      const w = pairLen / 2 - margin;
      const h = pairWid / 2 - margin;
      if (w <= 0 || h <= 0) continue;
      
      const dx = x - baseX;
      const dy = y - baseY;
      const cos = Math.cos(-rad);
      const sin = Math.sin(-rad);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      
      // Extend the inner radial boundary inward by 80px to structurally bridge the gap 
      // between the flat inner wall of the room and the circular outer wall of the corridor ring
      if (lx >= -(w + 80) && lx <= w && Math.abs(ly) <= h) return true;
    }
    
    // 4. Otherwise, must be inside one of the other interactive rooms (like Prep lab)
    for (const k of Object.keys(this.stDefs)) {
      const st = this.stDefs[k];
      if (st.boxW === undefined) continue;
      // Skip the beamline rooms we just checked collectively
      if (st.type === 'meas' || st.type === 'exp_setup') continue;
      
      const w = st.boxW / 2 - margin;
      const h = st.boxH / 2 - margin;
      if (w <= 0 || h <= 0) continue;
      
      const dx = x - st.boxCX;
      const dy = y - st.boxCY;
      const cos = Math.cos(-st.boxRad);
      const sin = Math.sin(-st.boxRad);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      
      if (Math.abs(lx) <= w && Math.abs(ly) <= h) {
        return true;
      }
    }
    return false;
  }

  // ── SPACE key interactions ────────────────────────────────
  tryInteract() {
    // 1. Collect from user NPC — only if actually near one
    for (const j of this.active) {
      if (j.unstarted<=0 || j.npcSlot<0) continue;
      const pos=this.npcPos[j.npcSlot];
      const dist=Phaser.Math.Distance.Between(this.px,this.py,pos.x,pos.y);
      if(dist<this.npcR){
        if(this.held.length>=MAX_HELD){this.flash('Hands full — drop a sample at Prep Table first!','#ff4433');return;}
        const labIcon = j.labType === 'wet' ? '🧪' : '🔩';
        const labName = j.labType === 'wet' ? 'Wet Lab' : 'Dry Lab';
        this.held.push({jobId:j.id,stage:'raw',labType:j.labType||'dry'});
        j.unstarted--;
        this.refreshJobs(); this.refreshNPCs();
        this.flash(`Sample collected from ${j.name} — deposit at ${labName} ${labIcon}`,'#00dd88');
        return;
      }
    }

    // 2. Prep Table interactions — pick up ready output FIRST, then deposit
    for (const pk of this.prepKeys) {
      const prep=this.stDefs[pk];
      const mySlots=this.prepSlotsFor[pk];
      if(this.isPointInSt(prep, this.px, this.py)){
        // 2a. Pick up finished prepped sample (priority — always check this first)
        const readyIdx=mySlots.findIndex(s=>s.toStage==='prepped_ready');
        if(readyIdx>=0){
          if(this.held.length>=MAX_HELD){this.flash('Hands full — no room to pick up!','#ff4433');return;}
          const s=mySlots.splice(readyIdx,1)[0];
          this.held.push({jobId:s.jobId,stage:'prepped'});
          this.refreshJobs();
          const _pj=this.active.find(a=>a.id===s.jobId);
          const _tbl=_pj?this.beamlineTechs.indexOf(_pj.tech):-1;
          const _tstr=_tbl>=0?`BL-${_tbl+1} (${_pj.tech})`:'matching beamline';
          this.flash(`Prepped — head to ${_tstr} → Experiment Setup`,'#44aaff');
          return;
        }
        // 2b. Deposit a raw sample for processing — find one that matches this lab's type
        const rawIdx=this.held.findIndex(h=>h.stage==='raw' && (h.labType||'dry')===this.stDefs[pk].labType);
        if(rawIdx>=0){
          if(mySlots.length>=this.prepCap){
            this.flash(`${this.stDefs[pk].label} busy (capacity ${this.prepCap})`, '#ff8833'); return;
          }
          const item=this.held.splice(rawIdx,1)[0];
          const _pJob = this.active.find(a => a.id === item.jobId);
          const prepDur = (_pJob?.prepDurs?.length > 0)
            ? _pJob.prepDurs.shift()
            : Phaser.Math.FloatBetween(DUR_PREP_MIN, DUR_PREP_MAX) * (this._prepSpeedMap[pk] || 1.0);
          mySlots.push({jobId:item.jobId, remaining:prepDur*1000, total:prepDur*1000});
          this.refreshJobs(); this.refreshNPCs();
          this.flash('Sample deposited — prep in progress...','#44aaff');
          return;
        }
        // Has raw samples but none match this lab — give a helpful hint
        if(this.held.some(h=>h.stage==='raw')){
          const otherLab = this.stDefs[pk].labType === 'wet' ? 'Dry Lab 🔩' : 'Wet Lab 🧪';
          this.flash(`No matching samples — try the ${otherLab}`, '#ff8833');
          return;
        }
      }
    }

    // 3. Experiment setup (player action — Space while holding prepped sample near hutch)
    for (const bl of this.beamlines) {
      const lock = this.stDefs[bl.lockKey];
      if(this.isPointInSt(lock, this.px, this.py)){
        const blTech = this.beamlineTechs[bl.idx];
        const prepIdx = this.held.findIndex(h => {
          if (h.stage !== 'prepped') return false;
          const job = this.active.find(a => a.id === h.jobId);
          return job && job.tech === blTech;
        });
        const blOccupied = this.measSlots.some(s => s.blIdx === bl.idx);
        if(prepIdx>=0 && this.activeExpSetupIdx < 0 && !blOccupied){
          const _sJob = this.active.find(a => a.id === this.held[prepIdx].jobId);
          this.activeExpSetupIdx = bl.idx;
          this.doingExpSetup=true;
          this.expSetupProg=0;
          this._durExpSetup = (_sJob?.setupDurs?.length > 0)
            ? _sJob.setupDurs.shift()
            : Phaser.Math.FloatBetween(DUR_EXP_SETUP_MIN, DUR_EXP_SETUP_MAX);
          return;
        }
        // Has a prepped sample but wrong technique
        if(this.held.some(h=>h.stage==='prepped') && !this.doingExpSetup){
          this.flash(`Wrong beamline! BL-${bl.idx+1} only runs ${blTech}`, '#ff4433');
          return;
        }
      }
    }

    // 4. Measurement console interactions — collect result FIRST, then deposit
    for (const bl of this.beamlines) {
      const meas = this.stDefs[bl.measKey];
      if(this.isPointInSt(meas, this.px, this.py)){
        // 4a. Collect finished measurement result (priority)
        if(this.measSlots.some(s=>s.toStage==='meas_ready' && s.blIdx === bl.idx)){
          this._collectMeasResult(bl.idx);
          return;
        }
        // 4b. Start a waiting measurement
        const waitIdx=this.measSlots.findIndex(s=>!s.started && !s.toStage && s.blIdx === bl.idx);
        if(waitIdx>=0){
          this.measSlots[waitIdx].started = true;
          this.flash(`BL-${bl.idx+1} measurement started!`,'#44ccff');
          return;
        }
        // 4b. Deposit an experiment-ready sample for measurement
        const lockIdx=this.held.findIndex(h=>h.stage==='exp_setup_done' && h.expBlIdx===bl.idx);
        if(lockIdx>=0){
          // Count how many samples are already measuring at THIS specific beamline
          const activeAtBL = this.measSlots.filter(m => m.blIdx === bl.idx).length;
          if(activeAtBL >= this.measCap){
            this.flash(`BL-${bl.idx+1} busy (capacity ${this.measCap}) — wait or try another`,'#ff8833'); return;
          }
          const item=this.held.splice(lockIdx,1)[0];
          const _mJob1 = this.active.find(a => a.id === item.jobId);
          const durMeas1 = (_mJob1?.measDurs?.length > 0)
            ? _mJob1.measDurs.shift()
            : Phaser.Math.FloatBetween(DUR_MEAS_MIN, DUR_MEAS_MAX) * (this._measSpeedMap[bl.idx] || 1.0);
          this.measSlots.push({jobId:item.jobId, remaining:durMeas1*1000, total:durMeas1*1000, blIdx: bl.idx, started: false});
          this.redrawBeam();
          this.refreshJobs(); this.refreshNPCs();
          this.flash(`Sample loaded at BL-${bl.idx+1} — go to Control Room and press [Space] to measure`,'#44ccff');
          return;
        }
      }
    }

    this.flash('Nothing to do here right now','#888888');
  }

  // Shared measurement-result collection: called by player interaction and Lv3 postdoc auto-collect
  _collectMeasResult(blIdx, pdName = null) {
    const rdyIdx = this.measSlots.findIndex(s => s.toStage === 'meas_ready' && s.blIdx === blIdx);
    if (rdyIdx < 0) return;
    const s = this.measSlots.splice(rdyIdx, 1)[0];
    this.redrawBeam();
    const j = this.active.find(a => a.id === s.jobId);
    if (!j) return;
    j.done++;
    this.totalSamples++; this.yearSamples++;
    this.sampTxt.setText(`⬡ ${this.totalSamples} samples`);
    this.sampleLog.push({
      year: this.year, cycle: this.cycle, cycleInYear: this.cycleInYear,
      jobName: j.name, tech: j.tech, labType: j.labType,
      blIdx: this.beamlineTechs.indexOf(j.tech),
      samplesRequired: j.totalSamples,
      completedAtSec: Math.round((Date.now() - this.cycleStartWall) / 1000),
    });
    const prefix = pdName ? `⚙ ${pdName}: ` : '';
    if (j.done >= j.totalSamples) {
      this.reputation += j.rep;
      this.cycleProposalsDone++;
      this.cycleRepEarned += j.rep;
      this.repTxt.setText(`⭐ ${this.reputation} rep`);
      this.flash(`${prefix}🎉 ${j.name} complete! +${j.rep} rep`, '#ffcc33');
      this.proposalLog.push({
        year: this.year, cycle: this.cycle, cycleInYear: this.cycleInYear,
        name: j.name, tech: j.tech, labType: j.labType,
        samplesRequired: j.totalSamples, samplesDone: j.totalSamples,
        repEarned: j.rep, penalty: 0, outcome: 'completed',
      });
      this._releaseNpcSlot(j.npcSlot);
      this.active.splice(this.active.indexOf(j), 1);
      this.restockProposalHub();
    } else {
      this.flash(`${prefix}${j.name}: ${j.done}/${j.totalSamples} done${pdName ? '' : ' — collect next sample'}`, '#00dd88');
    }
    this.refreshJobs(); this.refreshNPCs();
  }

  // ── Update ────────────────────────────────────────────────
  update(_,delta) {
    // ── Pause toggle (always active) ──
    if (Phaser.Input.Keyboard.JustDown(this.pKey)) this.togglePause();
    if (this.gamePaused) {
      if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) this.togglePause();
      return;
    }

    const dt=delta/1000;
    const now=this.time.now;

    // ── Tick station slots (proximity-gated unless automation upgrade) ──
    const hasAuto = this.upgrades && this.upgrades.automation;

    // Prep slots: tick while player or postdoc is near; pause if neither
    for (const pk of this.prepKeys) {
      const nearThis = hasAuto || this.isPointInSt(this.stDefs[pk], this.px, this.py)
        || this.postdocs.some(pd => this.isPointInSt(this.stDefs[pk], pd.x, pd.y));
      for (const s of this.prepSlotsFor[pk]) {
        if (!s.toStage && nearThis) {
          s.remaining -= delta;
          if (s.remaining <= 0) s.toStage = 'prepped_ready';
        }
      }
    }
    // Measurement slots: tick while player is in control room; pause if they leave; beam dump freezes them
    if (!this.beamDump) {
      const _l3AutoCollect = [];
      for(const s of this.measSlots){
        if(!s.toStage && s.started){
          const bl = this.beamlines[s.blIdx];
          const playerNearMeas = hasAuto || this.isPointInSt(this.stDefs[bl.measKey], this.px, this.py)
            || this.postdocs.some(pd => this.isPointInSt(this.stDefs[bl.measKey], pd.x, pd.y));
          if(playerNearMeas) {
            s.remaining -= delta;
            if(s.remaining <= 0) {
              s.toStage = 'meas_ready';
              // Level 3: postdoc present auto-collects the result so the player doesn't have to return
              const l3pd = this.postdocs.find(pd =>
                pd.level >= 3 && this.isPointInSt(this.stDefs[bl.measKey], pd.x, pd.y));
              if (l3pd) _l3AutoCollect.push({ blIdx: bl.idx, pdName: l3pd.name });
            }
          }
        }
      }
      // Process after the loop to avoid mutating measSlots mid-iteration
      for (const { blIdx, pdName } of _l3AutoCollect) this._collectMeasResult(blIdx, pdName);
    }

    // ── Update station bar visuals ──
    this.updateStationBars(now);

    // ── Movement ──
    let dx=0,dy=0;
    if(this.cursors.left.isDown  ||this.wasd.left.isDown)  dx-=1;
    if(this.cursors.right.isDown ||this.wasd.right.isDown) dx+=1;
    if(this.cursors.up.isDown    ||this.wasd.up.isDown)    dy-=1;
    if(this.cursors.down.isDown  ||this.wasd.down.isDown)  dy+=1;
    if(dx&&dy){dx*=0.707;dy*=0.707;}

    // Restrict movement to valid facility areas using slide-enabled collision
    let stepX = dx * this.SPD * dt;
    let stepY = dy * this.SPD * dt;

    let tryMove = (sx, sy) => {
      let nx = this.px + sx, ny = this.py + sy;
      if (this.isValidPos(nx, ny, 12)) {
        this.px = nx; this.py = ny;
        return true;
      }
      return false;
    };

    if (dx !== 0 || dy !== 0) this.playerMoveAngle = Math.atan2(dy, dx);

    if (stepX !== 0 || stepY !== 0) {
      if (!tryMove(stepX, stepY)) {
        // Failed full vector. Try strictly horizontal or vertical
        let movedX = stepX !== 0 && tryMove(stepX, 0);
        let movedY = stepY !== 0 && tryMove(0, stepY);
        
        // Auto-slide: if we pressed ONLY one axis against a diagonal wall and it failed,
        // synthesize the diagonal vector perfectly along the 45-degree angle
        if (!movedX && !movedY) {
          if (stepX === 0 && stepY !== 0) {
            if (!tryMove(Math.abs(stepY), stepY)) tryMove(-Math.abs(stepY), stepY);
          } else if (stepY === 0 && stepX !== 0) {
            if (!tryMove(stepX, Math.abs(stepX))) tryMove(stepX, -Math.abs(stepX));
          }
        }
      }
    }

    this.pCon.setPosition(this.px,this.py);
    this.updatePostdocs(delta);

    // ── Inventory dot display ──
    this.invLabel.setText(`🧪 ${this.held.length}/${MAX_HELD} held`);
    // Destination hint
    if (this.destLabel) {
      const raw     = this.held.find(h => h.stage === 'raw');
      const prepped = this.held.find(h => h.stage === 'prepped');
      const done    = this.held.find(h => h.stage === 'exp_setup_done');
      if (raw) {
        const labType = raw.labType || 'dry';
        const labIcon = labType === 'wet' ? '🧪' : '🔩';
        const labName = labType === 'wet' ? 'Wet Lab' : 'Dry Lab';
        const labCol  = labType === 'wet' ? '#2266cc' : '#8a6a10';
        this.destLabel.setText(`→ ${labName} ${labIcon}`).setStyle({color: labCol});
      } else if (prepped) {
        const pj = this.active.find(a => a.id === prepped.jobId);
        const bi = pj ? this.beamlineTechs.indexOf(pj.tech) : -1;
        this.destLabel.setText(bi >= 0 ? `→ BL-${bi+1} Exp. Setup` : '').setStyle({color: bi >= 0 ? BL_TXT[bi] : '#888888'});
      } else if (done) {
        const bi = done.expBlIdx;
        this.destLabel.setText(`→ BL-${bi+1} Control Room`).setStyle({color: BL_TXT[bi] ?? '#888888'});
      } else {
        this.destLabel.setText('');
      }
    }
    for(let i=0;i<MAX_HELD;i++){
      const item=this.held[i];
      const {d,t}=this.invDots[i];
      if(item){
        // Colour by target beamline (so dot matches the BL label on the map)
        const _ij = this.active.find(a => a.id === item.jobId);
        let _blCol = 0xaaaaaa;
        if (_ij) {
          const _bi = item.stage === 'exp_setup_done' && item.expBlIdx !== undefined
            ? item.expBlIdx
            : this.beamlineTechs.indexOf(_ij.tech);
          if (_bi >= 0) _blCol = BL_HEX[_bi];
        }
        let stageIcon;
        if (item.stage === 'raw') {
          const lt = item.labType || 'dry';
          stageIcon = lt === 'wet' ? 'W' : 'D';
          // Colour raw sample dots by lab type
          _blCol = lt === 'wet' ? 0x2266cc : 0xaa8822;
        } else {
          stageIcon = {prepped:'P',exp_setup_done:'🔒'}[item.stage]||'?';
        }
        d.setPosition(this.px-12+i*14,this.py-26).setFillStyle(_blCol).setVisible(true);
        t.setPosition(this.px-12+i*14,this.py-26).setText(stageIcon).setVisible(true);
      } else {
        d.setVisible(false); t.setVisible(false);
      }
    }

    // ── Pulsing destination highlight on target hutch / control room / prep lab ──
    if (this.roomHighlightG) {
      this.roomHighlightG.clear();
      const pulse = Math.sin(this.time.now / 280) * 0.5 + 0.5; // 0..1
      const alpha = 0.12 + pulse * 0.28;                        // 0.12..0.40
      for (const item of this.held) {
        const job = this.active.find(a => a.id === item.jobId);
        if (!job) continue;
        let targetKey = null;
        let blIdx = -1;
        let col = 0x00ccff;
        if (item.stage === 'raw') {
          // Highlight the correct prep lab
          const lt = item.labType || 'dry';
          targetKey = lt === 'wet' ? 'prep' : 'prep2';
          col = lt === 'wet' ? 0x2266cc : 0xaa8822;
          // Prep stations are small boxes, draw directly
          const st = this.stDefs[targetKey];
          if (st) {
            this.roomHighlightG.fillStyle(col, alpha);
            this.roomHighlightG.fillRoundedRect(st.x - st.w/2 - 4, st.y - st.h/2 - 4, st.w + 8, st.h + 8, 8);
            this.roomHighlightG.lineStyle(2, col, alpha + 0.2);
            this.roomHighlightG.strokeRoundedRect(st.x - st.w/2 - 4, st.y - st.h/2 - 4, st.w + 8, st.h + 8, 8);
          }
          continue;
        } else if (item.stage === 'prepped') {
          blIdx = this.beamlineTechs.indexOf(job.tech);
          if (blIdx >= 0) targetKey = `exp_setup_${blIdx}`;
          col = blIdx >= 0 ? BL_HEX[blIdx] : 0x00ccff;
        } else if (item.stage === 'exp_setup_done' && item.expBlIdx !== undefined) {
          blIdx = item.expBlIdx;
          targetKey = `meas_${blIdx}`;
          col = blIdx >= 0 ? BL_HEX[blIdx] : 0x00ccff;
        }
        if (!targetKey) continue;
        const geo = this.roomGeo.find(r => r.key === targetKey);
        if (!geo) continue;
        const { cx, cy, w, h, rad } = geo;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const corners = [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]]
          .map(([x,y]) => ({ x: cx + x*cos - y*sin, y: cy + x*sin + y*cos }));
        this.roomHighlightG.fillStyle(col, alpha);
        this.roomHighlightG.fillTriangle(
          corners[0].x, corners[0].y, corners[1].x, corners[1].y, corners[2].x, corners[2].y);
        this.roomHighlightG.fillTriangle(
          corners[0].x, corners[0].y, corners[2].x, corners[2].y, corners[3].x, corners[3].y);
      }
    }

    // ── Beamline user NPC leave timers ──
    for (const j of this.active) {
      if (j.npcGone || j.leaveMs === undefined || j.npcSlot < 0) continue;
      const npc = this.npcs[j.npcSlot];
      if (!npc) continue;
      j.leaveMs -= delta;
      if (j.leaveMs <= 0) { this.userNpcLeaves(j); continue; }
      const frac = 1 - Math.max(0, j.leaveMs) / j.leaveMsTotal;
      const col = frac > 0.75 ? 0xff4433 : frac > 0.5 ? 0xffaa33 : 0x44cc88;
      npc.leaveBarFill.setDisplaySize(Math.max(1, 28 * frac), 4).setFillStyle(col);
    }

    // ── Experiment setup progress (player holds Space near hutch with prepped sample) ──
    if (this.doingExpSetup && this.activeExpSetupIdx >= 0) {
      const bl = this.beamlines[this.activeExpSetupIdx];
      const lock = this.stDefs[bl.lockKey];
      const nearLock = Phaser.Math.Distance.Between(this.px, this.py, lock.boxCX, lock.boxCY) < 62
        || this.postdocs.some(pd => pd.state === 'working'
            && pd.assignedAction?.type === 'expSetup'
            && pd.assignedAction?.blIdx === this.activeExpSetupIdx);
      const hasPrepped=this.held.some(h=>h.stage==='prepped');

      if(nearLock&&hasPrepped){
        this.expSetupProg+=dt/this._durExpSetup;
      }
      if(this.expSetupProg>=1){
          // Complete experiment setup — auto-deposit sample into this beamline's measurement
          const idx=this.held.findIndex(h=>h.stage==='prepped');
          const finishedBl = this.activeExpSetupIdx;
          if(idx>=0) {
            const activeAtBL = this.measSlots.filter(s => s.blIdx === finishedBl).length;
            if (activeAtBL < this.measCap) {
              // Auto-deposit into measurement
              const item = this.held.splice(idx, 1)[0];
              const _mJob2 = this.active.find(a => a.id === item.jobId);
              const durMeas2 = (_mJob2?.measDurs?.length > 0)
                ? _mJob2.measDurs.shift()
                : Phaser.Math.FloatBetween(DUR_MEAS_MIN, DUR_MEAS_MAX) * (this._measSpeedMap[finishedBl] || 1.0);
              this.measSlots.push({jobId:item.jobId, remaining:durMeas2*1000, total:durMeas2*1000, blIdx: finishedBl, started: false});
              this.redrawBeam();
              this.flash(`Sample loaded at BL-${finishedBl+1} — go to Control Room and press [Space] to measure`,'#44ccff');
            } else {
              // Beamline full — keep in inventory, locked to this beamline's technique
              this.held[idx].stage='exp_setup_done';
              this.held[idx].expBlIdx=finishedBl;
              this.flash(`BL-${finishedBl+1} busy — wait for a slot to open`,'#ff8833');
            }
          }
          this.doingExpSetup=false; 
          this.expSetupProg=0;
          this.activeExpSetupIdx = -1;
          this.refreshJobs(); this.refreshNPCs();
        }
    }

    // ── Space key (single press) ──
    if(Phaser.Input.Keyboard.JustDown(this.spaceKey)) this.tryInteract();

    // ── Station highlights ──
    if (this.roomHighlightG) this.roomHighlightG.clear();
    for(const [k,st] of Object.entries(this.stDefs)){
      const near = this.isPointInSt(st, this.px, this.py);
      let busy = false;
      if (this.prepKeys.includes(k)) {
        const mySlots = this.prepSlotsFor[k];
        busy = mySlots.length>=this.prepCap && !mySlots.some(s=>s.toStage==='prepped_ready');
      } else if (st.type === 'meas') {
        busy = this.measSlots.filter(s=>s.blIdx===st.blIdx).length >= this.measCap 
               && !this.measSlots.some(s=>s.toStage==='meas_ready' && s.blIdx===st.blIdx);
      }
      this.drawSt(k,near,null,busy);
      // Draw orange highlight border when player is near a room
      if (near && this.roomGeo && this.roomHighlightG) {
        const rg = this.roomGeo.find(r => r.key === k);
        if (rg) {
          this.roomHighlightG.lineStyle(3, 0xe07000, 1);
          const cos = Math.cos(rg.rad), sin = Math.sin(rg.rad);
          const c = [[-rg.w/2,-rg.h/2],[rg.w/2,-rg.h/2],[rg.w/2,rg.h/2],[-rg.w/2,rg.h/2]].map(([x,y])=>({
            x: rg.cx + x*cos - y*sin, y: rg.cy + x*sin + y*cos
          }));
          for (let i = 0; i < 4; i++) this.roomHighlightG.lineBetween(c[i].x, c[i].y, c[(i+1)%4].x, c[(i+1)%4].y);
        }
      }
    }

    // ── NPC ring highlight ──
    for (let i = 0; i < MAX_SLOTS; i++) {
      const npc = this.npcs[i];
      if (!npc) continue;
      const j = this.active.find(a => a.npcSlot === i);
      if (!j || j.unstarted <= 0) { npc.ring.setStrokeStyle(1.5, JOB_HEX[i], 0.3); continue; }
      const dist = Phaser.Math.Distance.Between(this.px, this.py, this.npcPos[i].x, this.npcPos[i].y);
      npc.ring.setStrokeStyle(dist < this.npcR ? 2.5 : 1.5, JOB_HEX[i], dist < this.npcR ? 0.9 : 0.4);
    }

    // ── Proximity prompt ──
    const prompt=this.getPrompt();
    this.promptTxt.setText(prompt);

    // ── Progress bar (experiment setup action or station processing) ──
    if(this.doingExpSetup && this.activeExpSetupIdx >= 0){
      const _lockSt = this.stDefs[this.beamlines[this.activeExpSetupIdx].lockKey];
      const _lbx = _lockSt.boxCX - 30, _lby = _lockSt.boxCY + 26;
      const _nearLock = Phaser.Math.Distance.Between(this.px, this.py, _lockSt.boxCX, _lockSt.boxCY) < 62;
      this.expSetupBar.setPosition(_lbx, _lby)
        .setFraction(this.expSetupProg)
        .setFillStyle(_nearLock ? 0xdd4433 : 0xccaa44)
        .setLabel('SETUP', '#1a3a5a')
        .show();
    } else {
      this.expSetupBar.hide();
    }

    // ── Ring stability bar ──
    const rs=Math.max(0,Math.min(100,this.ringStab));
    this.rFill.setDisplaySize(158*rs/100,12).setFillStyle(rs>60?0x44bb44:rs>30?0xddaa44:0xff4444);
    this.rPct.setText(`${Math.round(rs)}%`);
  }

  // Returns a context-sensitive prompt for what Space will do
  getPrompt() {
    // Near user with unstarted samples
    for(let i=0;i<MAX_SLOTS;i++){
      const j=this.active[i];
      if(!j||j.unstarted<=0) continue;
      if(Phaser.Math.Distance.Between(this.px,this.py,this.npcPos[i].x,this.npcPos[i].y)<this.npcR)
        return this.held.length<MAX_HELD?`[Space] Collect sample from ${j.name}`:'Hands full!';
    }
    // Near any prep table
    for (const pk of this.prepKeys) {
      const prep=this.stDefs[pk];
      const mySlots=this.prepSlotsFor[pk];
      if(this.isPointInSt(prep, this.px, this.py)){
        const labLabel = this.stDefs[pk].label;
        // Check if player has a matching raw sample
        const hasMatchingRaw = this.held.some(h => {
          if (h.stage !== 'raw') return false;
          const reqLab = h.labType || 'dry';
          return reqLab === this.stDefs[pk].labType;
        });
        const hasAnyRaw = this.held.some(h => h.stage === 'raw');
        if(mySlots.some(s=>s.toStage==='prepped_ready')) return `[Space] Pick up prepped sample ✅`;
        if(hasMatchingRaw && mySlots.length<this.prepCap) return `[Space] Deposit sample for prep`;
        if(hasAnyRaw && !hasMatchingRaw) return `Wrong lab — check sample type`;
        if(mySlots.length>=this.prepCap) return `${labLabel} busy`;
        return labLabel;
      }
    }
    
    // Near any experiment setup (hutch)
    for (const bl of this.beamlines) {
      const lock=this.stDefs[bl.lockKey];
      if(this.isPointInSt(lock, this.px, this.py)){
        const blTech = this.beamlineTechs[bl.idx];
        const _occupied = this.measSlots.some(s => s.blIdx === bl.idx);
        if(_occupied) return `BL-${bl.idx+1} hutch occupied — wait for measurement to finish`;
        if(this.doingExpSetup && this.activeExpSetupIdx === bl.idx) return 'Hold still — setting up experiment...';
        const hasMatch = !this.doingExpSetup && this.held.some(h => {
          if (h.stage !== 'prepped') return false;
          const job = this.active.find(a => a.id === h.jobId);
          return job && job.tech === blTech;
        });
        if(hasMatch) return `[Space] Begin BL-${bl.idx+1} experiment setup`;
        if(this.held.some(h=>h.stage==='prepped')&&!this.doingExpSetup) return `Wrong beamline — BL-${bl.idx+1} runs ${blTech}`;
        return `BL-${bl.idx+1}: ${blTech}`;
      }
    }
    
    // Near any measurement console
    for (const bl of this.beamlines) {
      const meas=this.stDefs[bl.measKey];
      if(this.isPointInSt(meas, this.px, this.py)){
        const activeBLMeas = this.measSlots.filter(s => s.blIdx === bl.idx);
        if(activeBLMeas.some(s=>s.toStage==='meas_ready')) return `[Space] Collect BL-${bl.idx+1} measurement result ✅`;
        if(activeBLMeas.some(s=>!s.started && !s.toStage)) return `[Space] Start BL-${bl.idx+1} measurement`;
        if(activeBLMeas.some(s=>s.started && !s.toStage)) return `BL-${bl.idx+1} measuring...`;
        if(this.held.some(h=>h.stage==='exp_setup_done' && h.expBlIdx===bl.idx) && activeBLMeas.length<this.measCap) return `[Space] Load sample into BL-${bl.idx+1}`;
        if(activeBLMeas.length>=this.measCap) return `BL-${bl.idx+1} busy — capacity ${this.measCap}`;
        return `Load a sample at BL-${bl.idx+1} hutch first`;
      }
    }
    if(this.active.length===0) return 'Click proposals on the left board to start jobs';
    return '';
  }

  // Update station processing bar visuals
  updateStationBars(_now) {
    const barKeys = [...this.prepKeys, ...this.beamlines.map(b => b.measKey)];
    const hasAuto = this.upgrades && this.upgrades.automation;
    
    for(const k of barKeys){
      const st = this.stDefs[k];
      const isMeas = st.type === 'meas';
      const blIdx = isMeas ? st.blIdx : null;
      
      const isPrep = this.prepKeys.includes(k);
      const slots = isMeas ? this.measSlots.filter(s => s.blIdx === blIdx) : isPrep ? this.prepSlotsFor[k] : [];
      const bar = this.stBars[k];
      const rdy = this.stReady[k];

      // For meas stations: only show bar once scan is triggered (started); prep stations always show
      const active = slots.filter(s => !s.toStage && (isMeas ? s.started : true));
      const ready  = slots.some(s => s.toStage);

      const playerNear = hasAuto || this.isPointInSt(st, this.px, this.py)
        || this.postdocs.some(pd => this.isPointInSt(st, pd.x, pd.y));
      if (active.length > 0 && bar) {
        const s = active[0];
        const started = s.started !== false;  // always true here: meas filtered to started, prep has no flag
        const total = s.total || (isMeas ? (DUR_MEAS_MIN+DUR_MEAS_MAX)/2*1000 : (DUR_PREP_MIN+DUR_PREP_MAX)/2*1000);
        const frac = Math.min(1, Math.max(0, (total - Math.max(0, s.remaining)) / total));
        const paused = !playerNear && started;
        const label = isMeas ? `ACQUIRING DATA` : 'PREP';
        bar.setFraction(frac)
           .setFillStyle(!started ? 0x8899aa : paused ? 0xccaa44 : 0x44ccaa)
           .setLabel(label, '#1a3a5a')
           .show();
      } else if (bar) {
        bar.hide();
      }

      if (rdy) {
        rdy.setAlpha(ready ? 1 : 0).setDepth(27);
      }
    }

    // Update hutch sample-loaded indicators
    if (this.hutchSampleIcons) {
      for (const bl of this.beamlines) {
        const hasSample = this.measSlots.some(s => s.blIdx === bl.idx);
        const icons = this.hutchSampleIcons[bl.idx];
        if (icons) {
          icons.ico.setAlpha(hasSample ? 1 : 0);
          icons.lbl.setAlpha(hasSample ? 1 : 0);
        }
      }
    }
  }

  daysLeft(s) {
    // Map remaining seconds → remaining days (180s = 90 days)
    const days = Math.ceil(s / CYCLE_SEC * DAYS_PER_CYCLE);
    return `${Math.max(0, days)} days left`;
  }

  cycleLabel() {
    return `CYCLE ${this.cycleInYear} / YEAR ${this.year}`;
  }

  fmt(s){return `${Math.floor(s/60)}:${String(Math.max(0,s%60)).padStart(2,'0')}`;}

  flash(msg,color='#1a7a3a'){
    if (!this.flashTxt || !this.flashBg) return;
    this.statusTxt.setText(msg).setStyle({color});
    if(this._ft) this._ft.remove();
    this._ft=this.time.delayedCall(2800,()=>this.statusTxt.setText(''));
  }

  // Claim the first free NPC slot index for a newly-activated job.
  // Pass the job so the npcPositioning upgrade can place the NPC in the right spot.
  _claimNpcSlot(job = null) {
    for (let i = 0; i < this.npcSlotUsed.length; i++) {
      if (!this.npcSlotUsed[i]) {
        this.npcSlotUsed[i] = true;
        // Re-position on claim. Guard: npcs/validAngles aren't ready during early create() init pass;
        // buildUserNPCs() handles initial placement for those slots.
        if (this.npcs && this._npcValidAngles) {
          const pos = this._pickNpcPosForJob(job);
          this.npcPos[i] = pos;
          this.npcs[i].grp.setPosition(pos.x, pos.y);
        }
        return i;
      }
    }
    return -1;
  }

  _releaseNpcSlot(i) {
    if (i >= 0 && i < this.npcSlotUsed.length) this.npcSlotUsed[i] = false;
  }

  // Pre-roll all processing durations for a job and compute its precise leave window.
  // Called once when the job enters active. Durations are consumed in order as samples
  // are processed, so the leave timer reflects exactly the work this proposal requires.
  _rollJobDurations(job) {
    job.prepDurs  = [];
    job.setupDurs = [];
    job.measDurs  = [];
    let totalSec = 0;
    for (let k = 0; k < job.totalSamples; k++) {
      const prepKey = job.labType === 'wet' ? 'prep' : 'prep2';
      const measIdx = this.beamlineTechs.indexOf(job.tech);
      const prep  = Phaser.Math.FloatBetween(DUR_PREP_MIN,  DUR_PREP_MAX)  * (this._prepSpeedMap[prepKey] || 1.0);
      const setup = Phaser.Math.FloatBetween(DUR_EXP_SETUP_MIN, DUR_EXP_SETUP_MAX);
      const meas  = Phaser.Math.FloatBetween(DUR_MEAS_MIN,  DUR_MEAS_MAX)  * (measIdx >= 0 ? this._measSpeedMap[measIdx] : 1.0);
      job.prepDurs.push(prep);
      job.setupDurs.push(setup);
      job.measDurs.push(meas);
      totalSec += prep + setup + meas;
    }
    job.leaveMsTotal = totalSec * 2.5 * 1000;  // ×2.5 overhead for player movement between stations
    job.leaveMs      = job.leaveMsTotal;
  }

  userNpcLeaves(j) {
    const lost = j.unstarted;
    const originalTotal = j.totalSamples;
    j.unstarted = 0;
    j.npcGone   = true;
    // Shrink totalSamples to what was actually collected — lets normal completion fire
    // once the in-flight samples finish processing
    j.totalSamples = originalTotal - lost;
    // Rep penalty: proportional to fraction of samples abandoned
    const repLoss = Math.max(1, Math.round(lost / originalTotal * j.rep * 0.5));
    this.reputation = Math.max(0, this.reputation - repLoss);
    this.repTxt.setText(`⭐ ${this.reputation} rep`);
    // Free the NPC slot — queued proposals do NOT auto-promote; player must accept via right panel
    this._releaseNpcSlot(j.npcSlot);
    j.npcSlot = -1;
    // If no samples were ever collected, remove the job entirely
    if (j.totalSamples <= 0) this.active.splice(this.active.indexOf(j), 1);
    this.flash(`${j.name}'s user left — ${lost} sample${lost>1?'s':''} lost  −${repLoss} rep`, '#ff4433');
    this.refreshNPCs();
    this.refreshJobs();
  }

  endYear(){
    // Rep penalty for committed proposals where player did 0 samples
    // (includes still-queued proposals that never ran)
    const allCommitted = [
      ...this.active.filter(j => j.committed && j.done === 0),
      ...(this.commitQueue || []),
    ];
    const penalties = allCommitted.map(j => ({ name: j.name, penalty: -8 }));
    for (const p of penalties) this.reputation = Math.max(0, this.reputation + p.penalty);

    const proposalsPartial = this.active.filter(j => j.done > 0 && j.done < j.totalSamples).length;

    // Log partial proposals (some samples done, not all)
    for (const j of this.active.filter(j => j.done > 0 && j.done < j.totalSamples)) {
      this.proposalLog.push({
        year: this.year, cycle: this.cycle, cycleInYear: this.cycleInYear,
        name: j.name, tech: j.tech, labType: j.labType || 'dry',
        samplesRequired: j.totalSamples, samplesDone: j.done,
        repEarned: 0, penalty: 0, outcome: 'partial',
      });
    }
    // Log failed proposals (committed, 0 samples done → −8 rep penalty each)
    for (const j of allCommitted) {
      this.proposalLog.push({
        year: this.year, cycle: this.cycle, cycleInYear: this.cycleInYear,
        name: j.name, tech: j.tech, labType: j.labType || 'dry',
        samplesRequired: j.totalSamples, samplesDone: 0,
        repEarned: 0, penalty: -8, outcome: 'failed',
      });
    }

    this.scene.start('CycleEnd',{
      cycle:this.cycle, cycleInYear:this.cycleInYear, year:this.year,
      yearSamples:this.yearSamples,
      reputation:this.reputation,
      ringBase:Math.min(100,Math.max(30,this.carryRing - 2 + (this.upgrades.ringMaint ? 5 : 0))),
      funding: this.funding,
      upgrades: this.upgrades,
      beamlineTechs: this.beamlineTechs,
      penalties,
      proposalsDone:    this.cycleProposalsDone,
      proposalsPartial,
      repEarned:        this.cycleRepEarned,
      proposalLog:      this.proposalLog,
      sampleLog:        this.sampleLog,
      playDurationSec:  Math.round((Date.now() - this.cycleStartWall) / 1000),
    });
  }

  // ── Dev panel (enabled via ?dev URL param) ────────────────
  buildDevPanel() {
    const btnW = 58, btnH = 22, gap = 5;
    const buttons = [
      { label: '⏩ Cycle',  action: () => { this.yearTimer = 0; this.endYear(); } },
      { label: '+$100k',    action: () => { this.funding += 100000; } },
      { label: '+20 ⭐',   action: () => { this.reputation += 20; this.repTxt.setText(`⭐ ${this.reputation} rep`); } },
      { label: '+1 Cy',     action: () => this._devAdvanceCycle() },
      { label: '+1 Yr',     action: () => this._devAdvanceYear() },
      { label: '1×',        action: () => this._cycleDevSpeed() },
    ];
    const panelW = buttons.length * (btnW + gap) + gap + 28;
    const panelH = btnH + 16;
    const px = GW - panelW - 4, py = GH - panelH - 4;

    const bg = this.add.graphics().setDepth(200);
    bg.fillStyle(0x001122, 0.88);
    bg.fillRoundedRect(px, py, panelW, panelH, 5);
    this.add.text(px + 5, py + panelH / 2, 'DEV', {
      font: 'bold 8px Courier New', color: '#ff7700'
    }).setOrigin(0, 0.5).setDepth(201);

    buttons.forEach((btn, i) => {
      const bx = px + 28 + i * (btnW + gap);
      const by = py + 7;
      const btnBg = this.add.rectangle(bx + btnW / 2, by + btnH / 2, btnW, btnH, 0x1a3d6b)
        .setDepth(201).setInteractive({ useHandCursor: true });
      const txt = this.add.text(bx + btnW / 2, by + btnH / 2, btn.label, {
        font: '10px Courier New', color: '#aaccff'
      }).setOrigin(0.5).setDepth(202);
      if (i === buttons.length - 1) this._devSpeedBtn = txt;
      btnBg.on('pointerdown', btn.action);
      btnBg.on('pointerover', () => btnBg.setFillStyle(0x2a5ea0));
      btnBg.on('pointerout',  () => btnBg.setFillStyle(0x1a3d6b));
    });
  }

  _cycleDevSpeed() {
    const speeds = [1, 2, 4, 8];
    const cur = this.devTickMult || 1;
    this.devTickMult = speeds[(speeds.indexOf(cur) + 1) % speeds.length];
    this._devSpeedBtn.setText(`${this.devTickMult}×`);
  }

  _devAdvanceCycle() {
    this.cycleInYear = (this.cycleInYear % 3) + 1;
    if (this.cycleInYear === 1) this.year += 1;
    this.cycle += 1;
    this.flash(`DEV: jumped to Cycle ${this.cycleInYear} / Year ${this.year}`, '#ff8800');
  }

  _devAdvanceYear() {
    this.year += 1;
    this.cycleInYear = 1;
    // Simulate the annual grant for the new year
    const grant = 200000 + Math.floor(this.reputation * 500);
    this.funding = Math.min(this.funding, 100000) + grant;
    this.flash(`DEV: jumped to Year ${this.year}  💰+${fmtK(grant)} grant`, '#ff8800');
  }
}



// ════════════════════════════════════════════════════════════════
// HiDPI fix: auto-set text resolution so text textures match canvas resolution
const _origTextFactory = Phaser.GameObjects.GameObjectFactory.prototype.text;
Phaser.GameObjects.GameObjectFactory.prototype.text = function(x, y, text, style) {
  const obj = _origTextFactory.call(this, x, y, text, style);
  obj.setResolution(DPR);
  return obj;
};

// ── Save / Load ───────────────────────────────────────────────
const SAVE_KEY = 'tbf_save';

function saveGame(data) {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
}

function loadGame() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); }
  catch { return null; }
}

function clearSave() {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem('tbf_stats');
}

// ── Telemetry — sends cycle record to Discord webhook ─────────
function sendTelemetry(record) {
  if (!TELEMETRY_WEBHOOK) return;
  const upg = Object.keys(record.upgrades || {}).join(', ') || 'none';
  const embed = JSON.stringify({
    username: 'TBF Stats',
    embeds: [{
      title: `Y${record.year} C${record.cycleInYear} — ${record.samples} samples`,
      color: 0x1a6aaa,
      fields: [
        { name: 'Reputation', value: String(record.reputation), inline: true },
        { name: 'Funding',    value: `$${record.funding}`,      inline: true },
        { name: 'Rep earned', value: String(record.repEarned),  inline: true },
        { name: 'Proposals done',    value: String(record.proposalsDone),    inline: true },
        { name: 'Proposals partial', value: String(record.proposalsPartial), inline: true },
        { name: 'Failed',            value: String(record.failed),           inline: true },
        { name: 'Upgrades', value: upg },
      ],
      footer: { text: record.ts },
    }],
  });

  // Send embed card
  fetch(TELEMETRY_WEBHOOK, { method:'POST', headers:{'Content-Type':'application/json'}, body: embed })
    .catch(() => {});

  // Send raw JSON as a downloadable file attachment
  const filename = `tbf_Y${record.year}C${record.cycleInYear}_${record.ts.slice(0,19).replace(/:/g,'-')}.json`;
  const form = new FormData();
  form.append('file', new Blob([JSON.stringify(record, null, 2)], {type:'application/json'}), filename);
  fetch(TELEMETRY_WEBHOOK, { method:'POST', body: form })
    .catch(() => {});
}

// ── Upgrade name helper ───────────────────────────────────────
function _activeUpgradeNames(upg) {
  if (!upg) return [];
  const names = [];
  if (upg.ringMaint)                  names.push('ringMaint');
  if (upg.prepSpeedMap) Object.entries(upg.prepSpeedMap).forEach(([k,v]) => { if (v < 1) names.push(`prepSpeed_${k}`); });
  if (upg.measSpeedMap) upg.measSpeedMap.forEach((v,i) => { if (v < 1) names.push(`measSpeed_bl${i}`); });
  if ((upg.prepCap    || 1)  > 1)     names.push('prepCap');
  if ((upg.measCap    || 1)  > 1)     names.push('measCap');
  if ((upg.extraJobSlots||0) > 0)     names.push('extraJobSlots');
  if ((upg.postdocs   || 0)  > 0)     names.push('postdocs');
  if ((upg.postdocLevels||[]).some(l => l > 1)) names.push('postdocLevel2');
  return names;
}

// ── Dev stats (localStorage) ──────────────────────────────────
function saveStatRecord(record) {
  const all = JSON.parse(localStorage.getItem('tbf_stats') || '[]');
  all.push(record);
  localStorage.setItem('tbf_stats', JSON.stringify(all));
}
function exportStats() {
  const data = JSON.parse(localStorage.getItem('tbf_stats') || '[]');
  if (!data.length) { alert('No stats recorded yet.'); return; }
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `tbf_stats_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
function clearStats() {
  localStorage.removeItem('tbf_stats');
}

const game = new Phaser.Game({
  type:Phaser.AUTO,
  backgroundColor:'#cecac4',
  parent:'game-container',
  scene:[BootScene,TutorialScene,ProposalReviewScene,GameScene,CycleEndScene,YearEndScene],
  scale:{
    mode:Phaser.Scale.FIT,
    autoCenter:Phaser.Scale.CENTER_BOTH,
    width:GW,
    height:GH,
    resolution:DPR,
  },
});

window.addEventListener('resize', () => {
  game.scale.refresh();
});
