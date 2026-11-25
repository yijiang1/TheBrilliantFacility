// ════════════════════════════════════════════════════════════════
//  Headless simulation engine.
//
//  Loads the real game scripts from js/ into an isolated VM context on
//  top of a headless Phaser stand-in, applies a level file, lets the
//  FacilityBot (js/bot.js) or a strategy play, and records what happened
//  each cycle. Because it runs the game's own code, any rule or hazard
//  added to js/ is simulated automatically.
// ════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createPhaserStub } = require('./phaser-stub');
const { installProbes, newCycleCounters } = require('./probes');
const { applyStrategy } = require('./strategies');

const ROOT = path.resolve(__dirname, '..');
// Same order as BrilliantFacility.html. online.js is skipped: it builds the
// lobby DOM and the game treats a missing window.coop as solo play.
const GAME_SCRIPTS = ['js/data.js', 'js/ProposalReviewScene.js', 'js/CycleEndScene.js',
  'js/YearEndScene.js', 'js/game.js', 'js/bot.js'];

// ── Seeded RNG (mulberry32) ─────────────────────────────────────
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A DOM element that accepts anything (used for the few DOM touches in game.js).
function makeElement() {
  const el = {
    style: {}, dataset: {}, children: [], textContent: '', innerHTML: '', value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; }, append() {}, remove() {},
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
    querySelector: () => makeElement(), querySelectorAll: () => [], click() {}, focus() {}, blur() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, left: 0, top: 0 }),
  };
  el.parentElement = el;
  return el;
}

// Deep merge plain objects (arrays replace).
function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

// Replace single-line top-level `const NAME = ...;` declarations in data.js.
function overrideConstants(source, constants, file) {
  for (const [name, value] of Object.entries(constants || {})) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new Error(`Level constant "${name}" is not an UPPER_CASE constant name`);
    const re = new RegExp(`^const ${name}(\\s*)=[^\\n]*;`, 'm');
    if (!re.test(source)) throw new Error(`Level constant "${name}" is not a single-line const in ${file}`);
    source = source.replace(re, `const ${name}$1= ${JSON.stringify(value)};`);
  }
  return source;
}

class SimRun {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 1;
    this.level = opts.level || {};
    this.fps = opts.fps || 30;
    this.verbose = !!opts.verbose;
    this.strategy = opts.strategy || this.level.strategy || 'bot';
    this.width = opts.width || 1280;
    this.height = opts.height || 800;
    this.cycles = [];
    this.logs = [];
    this.error = null;
    this._timers = [];
    this._raf = [];
    this._timerId = 0;
    this._build();
  }

  // ── Build the isolated game world ─────────────────────────────
  _build() {
    const rng = makeRng(this.seed);
    const self = this;
    const host = {
      width: this.width, height: this.height, random: rng, makeElement,
      onGame: (g) => { self.game = g; },
    };
    const Phaser = createPhaserStub(host);
    const storage = new Map();
    const localStorage = {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k),
      clear: () => storage.clear(),
    };
    const simNow = () => (this.game ? this.game._time : 0);
    const EPOCH = Date.UTC(2026, 0, 1);
    const RealDate = Date;
    class SimDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(EPOCH + simNow()); }
      static now() { return EPOCH + simNow(); }
    }
    const logFn = (lvl) => (...a) => {
      const line = a.map(x => (typeof x === 'string' ? x : safeJson(x))).join(' ');
      if (self.logs.length < 2000) self.logs.push(`[${lvl}] ${line}`);
      if (self.verbose) process.stderr.write(`[sim ${lvl}] ${line}\n`);
    };
    const ctx = {
      Phaser,
      console: { log: logFn('log'), info: logFn('info'), warn: logFn('warn'), error: logFn('error'), table: logFn('table'), debug: () => {} },
      innerWidth: this.width, innerHeight: this.height, devicePixelRatio: 1,
      localStorage, sessionStorage: localStorage,
      document: {
        getElementById: () => makeElement(), createElement: () => makeElement(),
        querySelector: () => makeElement(), querySelectorAll: () => [],
        body: makeElement(), head: makeElement(), documentElement: makeElement(),
        addEventListener() {}, removeEventListener() {}, hidden: false, activeElement: makeElement(),
      },
      location: { search: '', hash: '', protocol: 'http:', host: 'sim', hostname: 'sim', href: 'http://sim/', origin: 'http://sim' },
      history: { replaceState() {}, pushState() {} },
      navigator: { userAgent: 'tbf-sim', clipboard: { writeText: async () => {} } },
      // Telemetry and any other network calls are disabled in the simulator.
      fetch: () => Promise.resolve({ ok: true, json: async () => ({}), text: async () => '' }),
      FormData: class { append() {} },
      Blob: class { constructor(p) { this.parts = p; } },
      URL: Object.assign(function URL(u) { return new globalThis.URL(u); }, { createObjectURL: () => 'blob:sim', revokeObjectURL: () => {} }),
      URLSearchParams,
      alert: () => {},
      performance: { now: simNow },
      setTimeout: (fn, ms = 0, ...args) => { const id = ++this._timerId; this._timers.push({ id, at: simNow() + Math.max(0, ms), fn, args }); return id; },
      clearTimeout: (id) => { this._timers = this._timers.filter(t => t.id !== id); },
      setInterval: () => 0, clearInterval: () => {},
      requestAnimationFrame: (fn) => { this._raf.push(fn); return this._raf.length; },
      cancelAnimationFrame: () => {},
      addEventListener() {}, removeEventListener() {},
    };
    ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
    this.ctx = vm.createContext(ctx);
    // Seed the game's own Math.random and freeze its clock to simulation time.
    this.ctx.__rng = rng;
    this.ctx.__SimDate = SimDate;
    vm.runInContext('Math.random = __rng; Date = __SimDate;', this.ctx);

    const level = this.level;
    for (const rel of GAME_SCRIPTS) {
      let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      if (rel === 'js/data.js') src = overrideConstants(src, level.constants, rel);
      vm.runInContext(src, this.ctx, { filename: rel });
      if (rel === 'js/data.js') this._applyLevelData();
    }
    this.sim = { cycle: newCycleCounters(), events: [] };
    installProbes(this);
    applyStrategy(this, this.strategy);
    // window.simEvent(name, n): optional hook game code may call to count
    // custom events (e.g. a new hazard). Undefined in the browser.
    this.ctx.simEvent = (name, n = 1) => { const c = this.sim.cycle.custom; c[name] = (c[name] || 0) + n; };
  }

  _applyLevelData() {
    const lvl = this.level;
    this.ctx.__level = JSON.parse(JSON.stringify({ rules: lvl.rules || {}, generations: lvl.generations || null }));
    this.ctx.__deepMerge = deepMerge;
    vm.runInContext(`
      __deepMerge(RULES, __level.rules);
      if (Array.isArray(__level.generations)) {
        GENERATION_DATA.splice(0, GENERATION_DATA.length, ...__level.generations);
      } else if (__level.generations) {
        for (const [gen, patch] of Object.entries(__level.generations)) {
          const g = GENERATION_DATA.find(x => String(x.gen) === String(gen));
          if (g) __deepMerge(g, patch); else GENERATION_DATA.push(Object.assign({ gen: Number(gen) }, patch));
        }
        GENERATION_DATA.sort((a, b) => a.startYear - b.startYear);
      }
    `, this.ctx);
  }

  // Initial save state: a brand-new game, then the level's "start" block.
  _startState() {
    const rules = vm.runInContext('RULES', this.ctx);
    const state = {
      cycle: 1, cycleInYear: 1, year: 1,
      reputation: rules.start.reputation, ringBase: rules.start.ringBase, funding: rules.start.funding,
      upgrades: { prepCap: 1, measCap: 1, prepSpeedMap: { prep: 1.0, prep2: 1.0 }, measSpeedMap: [1.0, 1.0, 1.0, 1.0],
        extraJobSlots: 0, postdocs: 0, postdocLevels: [], postdocNames: [], ringMaint: false, npcPositioning: false },
    };
    const start = this.level.start || {};
    deepMerge(state, JSON.parse(JSON.stringify(start)));
    if (start.year && !start.cycle) state.cycle = (start.year - 1) * 3 + (state.cycleInYear || 1);
    if (Array.isArray(state.upgrades.postdocLevels) && state.upgrades.postdocs > state.upgrades.postdocNames.length) {
      const names = vm.runInContext('POSTDOC_NAMES', this.ctx);
      while (state.upgrades.postdocNames.length < state.upgrades.postdocs) state.upgrades.postdocNames.push(names[state.upgrades.postdocNames.length]);
    }
    while (state.upgrades.postdocLevels.length < (state.upgrades.postdocs || 0)) state.upgrades.postdocLevels.push(1);
    return state;
  }

  // ── Main loop ─────────────────────────────────────────────────
  frame(dt) {
    this.game.step(dt);
    const now = this.game._time;
    if (this._raf.length) { const r = this._raf; this._raf = []; for (const fn of r) fn(now); }
    if (this._timers.length) {
      this._timers.sort((a, b) => a.at - b.at || a.id - b.id);
      while (this._timers.length && this._timers[0].at <= now) {
        const t = this._timers.shift();
        t.fn(...t.args);
      }
    }
  }

  run({ cycles = 3 } = {}) {
    const dt = 1000 / this.fps;
    const started = Date.now();
    const cycleSec = vm.runInContext('CYCLE_SEC', this.ctx);
    // Budget: a cycle plus generous menu time; anything longer is a stall.
    const budgetMs = cycles * (cycleSec + 60) * 1000 + 10000;
    try {
      // Boot → Tutorial, then start a new game the way the Start button does.
      this.frame(dt); this.frame(dt);
      const tut = this.game.scene.getScene('Tutorial');
      vm.runInContext('_bot.start()', this.ctx);
      tut.scene.start('ProposalReview', this._startState());
      while (this.cycles.length < cycles) {
        this.frame(dt);
        if (this.game._time > budgetMs) {
          const active = this.game.scene.getScenes(true).map(s => s.__key).join(', ');
          throw new Error(`Simulation stalled: ${this.cycles.length}/${cycles} cycles after ${(budgetMs / 1000) | 0}s of game time (active scenes: ${active})`);
        }
      }
    } catch (err) {
      this.error = { message: err.message, stack: String(err.stack || '').split('\n').slice(0, 8).join('\n'),
        atGameSec: Math.round((this.game?._time || 0) / 1000), cyclesCompleted: this.cycles.length };
    }
    return {
      seed: this.seed,
      strategy: typeof this.strategy === 'string' ? this.strategy : (this.strategy.name || 'custom'),
      cycles: this.cycles,
      error: this.error,
      wallMs: Date.now() - started,
      gameSec: Math.round((this.game?._time || 0) / 1000),
      logTail: this.error ? this.logs.slice(-15) : undefined,
    };
  }
}

function safeJson(x) { try { return JSON.stringify(x); } catch { return String(x); } }

function runSim(opts) { return new SimRun(opts).run({ cycles: opts.cycles }); }

module.exports = { SimRun, runSim, deepMerge, makeRng };
