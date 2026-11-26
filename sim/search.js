#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
//  Search shop buying orders — a stronger "perfect" player for the robot path
//
//    node sim/search.js --skill perfect --evals 100 --runs 6
//    node sim/search.js --skill typical --years 7 --out sim/reports/search-typical
//
//  In-cycle play is the FacilityBot (at the chosen skill). A candidate is a
//  between-cycle plan: the shop priority order, which non-robot upgrades to
//  buy at all, how many postdocs, the funding reserve, and paper vs train.
//  Every candidate plays the same seeds. Candidates are ranked by
//    1. mean first fully automated cycle (runs that never get there count
//       as one cycle past the horizon), then
//    2. mean reputation at the end of the horizon.
//  The search is random sampling followed by local search (swap, move,
//  toggle and setting mutations) around the best plans found.
// ════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort } = require('worker_threads');

if (!isMainThread) {
  const { runSim } = require('./engine');
  parentPort.on('message', job => {
    let result;
    try {
      const r = runSim(job.opts);
      const rows = r.cycles || [];
      const vl = rows.find(c => c.victoryLap);
      const os_ = rows.find(c => c.robots && c.robots.os);
      result = { seed: job.opts.seed, error: r.error ? String(r.error.message || r.error) : null,
        victory: vl ? vl.cycle : null, osAfter: os_ ? os_.cycle : null,
        rep: rows.length ? rows[rows.length - 1].reputation : 0,
        repByCycle: rows.map(c => c.reputation) };
    } catch (e) { result = { seed: job.opts.seed, error: String(e.message || e) }; }
    parentPort.postMessage({ id: job.id, result });
  });
  return;
}

const { loadLevel } = require('./run');
const { PRESETS } = require('./strategies');

const ROBOTS = ['prepBot', 'consoleBot', 'hutchBot', 'courierBot', 'receptionBot'];
const EXTRAS = ['sampleChanger', 'extraJob', 'prepCap', 'cryoActivator', 'measSpeed', 'prepSpeed', 'ringMaint'];
const SKILLS = {
  perfect: { playerSpeed: 1 },
  typical: { playerSpeed: PRESETS.typical.playerSpeed, thinkMs: PRESETS.typical.thinkMs },
  weaker:  { playerSpeed: PRESETS.weaker.playerSpeed, thinkMs: PRESETS.weaker.thinkMs },
};

function parseArgs(argv) {
  const a = { level: path.join(__dirname, 'levels', 'baseline.json'), skill: 'perfect', evals: 100, random: 40,
    runs: 6, years: 6, seed: 101, fps: 30, rngSeed: 7 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], next = () => argv[++i];
    switch (k) {
      case '--level': a.level = next(); break;
      case '--skill': a.skill = next(); break;
      case '--evals': a.evals = +next(); break;
      case '--random': a.random = +next(); break;
      case '--runs': a.runs = +next(); break;
      case '--years': a.years = +next(); break;
      case '--seed': a.seed = +next(); break;
      case '--search-seed': a.rngSeed = +next(); break;
      case '--workers': a.workers = +next(); break;
      case '--out': a.out = next(); break;
      case '-h': case '--help':
        console.log('Usage: node sim/search.js [--skill perfect|typical|weaker] [--evals N] [--random N] [--runs N] [--years N] [--seed N] [--search-seed N] [--workers N] [--out PATH]');
        process.exit(0);
      default: throw new Error(`Unknown option ${k}`);
    }
  }
  if (!SKILLS[a.skill]) throw new Error(`Unknown skill ${a.skill}`);
  return a;
}

// Small seeded RNG for the search itself (the game has its own).
function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ── Plans ────────────────────────────────────────────────────
// { order: [keys...], use: {extra: bool}, postdocs: 0..2, reserve, action }
function randomPlan(rnd) {
  const order = [...ROBOTS, ...EXTRAS];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const use = Object.fromEntries(EXTRAS.map(k => [k, rnd() < 0.4]));
  return { order, use, postdocs: Math.floor(rnd() * 3), reserve: [0, 0, 50000, 100000][Math.floor(rnd() * 4)],
    action: rnd() < 0.5 ? 'paper' : 'train' };
}

function presetPlan(name) {
  const p = PRESETS[name];
  const list = p.upgrades.filter(k => k !== 'facilityOS');
  const order = [];
  for (const k of list) { if (k === 'robots') order.push(...ROBOTS); else order.push(k); }
  for (const k of [...ROBOTS, ...EXTRAS]) if (!order.includes(k)) order.push(k);
  const use = Object.fromEntries(EXTRAS.map(k => [k, list.includes(k)]));
  return { order, use, postdocs: Math.min(2, p.maxPostdocs ?? 2), reserve: p.reserve || 0, action: p.action === 'paper' ? 'paper' : 'train' };
}

function mutate(plan, rnd) {
  const p = JSON.parse(JSON.stringify(plan));
  const n = 1 + Math.floor(rnd() * 2);
  for (let m = 0; m < n; m++) {
    const r = rnd();
    if (r < 0.3) {            // swap two keys
      const i = Math.floor(rnd() * p.order.length), j = Math.floor(rnd() * p.order.length);
      [p.order[i], p.order[j]] = [p.order[j], p.order[i]];
    } else if (r < 0.55) {    // move one key
      const i = Math.floor(rnd() * p.order.length), j = Math.floor(rnd() * p.order.length);
      const [k] = p.order.splice(i, 1); p.order.splice(j, 0, k);
    } else if (r < 0.8) {     // toggle an extra
      const k = EXTRAS[Math.floor(rnd() * EXTRAS.length)];
      p.use[k] = !p.use[k];
    } else if (r < 0.9) {
      p.postdocs = Math.floor(rnd() * 3);
    } else if (r < 0.95) {
      p.reserve = [0, 50000, 100000][Math.floor(rnd() * 3)];
    } else {
      p.action = p.action === 'paper' ? 'train' : 'paper';
    }
  }
  return p;
}

const planKey = p => JSON.stringify([p.order.filter(k => ROBOTS.includes(k) || p.use[k]), p.postdocs, p.reserve, p.action]);

function toStrategy(plan, skill, name) {
  const upgrades = ['facilityOS', ...plan.order.filter(k => ROBOTS.includes(k) || (plan.use[k] && !(k === 'extraJob' && plan.postdocs === 0)))];
  return { name, proposals: 'bot', upgrades, maxPostdocs: plan.postdocs, reserve: plan.reserve,
    action: plan.action === 'paper' ? 'paper' : 'train', ...SKILLS[skill] };
}

function describe(plan) {
  const keys = plan.order.filter(k => ROBOTS.includes(k) || (plan.use[k] && !(k === 'extraJob' && plan.postdocs === 0)));
  return `${keys.join(' > ')} | postdocs ≤${plan.postdocs} | reserve ${plan.reserve / 1000}K | ${plan.action}`;
}

// ── Evaluation ───────────────────────────────────────────────
class Pool {
  constructor(n) {
    this.workers = Array.from({ length: n }, () => new Worker(__filename));
    this.queue = []; this.waiting = new Map(); this.idle = [...this.workers]; this.nextId = 0;
    for (const w of this.workers) w.on('message', m => { const cb = this.waiting.get(m.id); this.waiting.delete(m.id); this.idle.push(w); cb(m.result); this._pump(); });
  }
  run(opts) { return new Promise(res => { this.queue.push({ id: this.nextId++, opts, res }); this._pump(); }); }
  _pump() {
    while (this.idle.length && this.queue.length) {
      const job = this.queue.shift(), w = this.idle.pop();
      this.waiting.set(job.id, job.res); w.postMessage({ id: job.id, opts: job.opts });
    }
  }
  close() { this.workers.forEach(w => w.terminate()); }
}

async function evaluate(pool, plan, args, level, label) {
  const cycles = args.years * 3;
  const strategy = toStrategy(plan, args.skill, label);
  const runs = await Promise.all(Array.from({ length: args.runs }, (_, i) =>
    pool.run({ seed: args.seed + i, level, cycles, fps: args.fps, strategy })));
  const fail = cycles + 1;
  const ok = runs.filter(r => !r.error);
  const vic = ok.map(r => r.victory || fail);
  return { plan, label, desc: describe(plan), runs,
    errors: runs.length - ok.length,
    meanVictory: vic.reduce((a, b) => a + b, 0) / Math.max(1, vic.length),
    automated: ok.filter(r => r.victory).length,
    meanRep: ok.reduce((a, r) => a + r.rep, 0) / Math.max(1, ok.length),
    victories: vic };
}

const better = (a, b) => a.errors !== b.errors ? a.errors < b.errors
  : Math.abs(a.meanVictory - b.meanVictory) > 1e-9 ? a.meanVictory < b.meanVictory : a.meanRep > b.meanRep;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const level = loadLevel(args.level);
  const pool = new Pool(args.workers || Math.max(1, os.cpus().length - 1));
  const rnd = mulberry(args.rngSeed);
  const seen = new Map();
  const results = [];
  const t0 = Date.now();

  const consider = async (plan, label) => {
    const key = planKey(plan);
    if (seen.has(key)) return seen.get(key);
    const r = await evaluate(pool, plan, args, level, label);
    seen.set(key, r); results.push(r);
    const v = r.victories.map(c => (c > args.years * 3 ? '—' : c)).join(',');
    console.log(`[${results.length}/${args.evals}] ${label.padEnd(10)} victory ${r.meanVictory.toFixed(2)} (${v}) rep ${Math.round(r.meanRep)}  ${r.desc}`);
    return r;
  };

  // Baselines: the presets, then random plans (in parallel batches).
  for (const name of ['perfect', 'typical', 'weaker']) await consider(presetPlan(name), `preset:${name}`);
  const batch = 2;   // candidates evaluated side by side, so the worker pool stays busy
  while (results.length < Math.min(args.evals, args.random)) {
    await Promise.all(Array.from({ length: batch }, () => consider(randomPlan(rnd), 'random')));
  }
  // Local search around the current top plans.
  while (results.length < args.evals) {
    const top = [...results].sort((a, b) => (better(a, b) ? -1 : 1)).slice(0, 5);
    await Promise.all(Array.from({ length: batch }, () => {
      const parent = top[Math.floor(rnd() * Math.min(top.length, rnd() < 0.5 ? 1 : top.length))];
      return consider(mutate(parent.plan, rnd), 'local');
    }));
  }
  pool.close();

  const ranked = [...results].sort((a, b) => (better(a, b) ? -1 : 1));
  console.log(`\nTop plans (${args.skill} skill, seeds ${args.seed}–${args.seed + args.runs - 1}, ${args.years} years, ${((Date.now() - t0) / 60000).toFixed(1)} min):`);
  ranked.slice(0, 8).forEach((r, i) => console.log(`${i + 1}. victory ${r.meanVictory.toFixed(2)}, automated ${r.automated}/${r.runs.length}, rep ${Math.round(r.meanRep)}  ${r.desc}`));
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(`${args.out}.json`, JSON.stringify({ args, ranked: ranked.map(r => ({ ...r, strategy: toStrategy(r.plan, args.skill, 'best') })) }, null, 1));
    fs.writeFileSync(`${args.out}.best.json`, JSON.stringify(toStrategy(ranked[0].plan, args.skill, `search-${args.skill}`), null, 2));
    console.log(`Wrote ${args.out}.json and ${args.out}.best.json (use with: node sim/run.js --strategy ${args.out}.best.json)`);
  }
}

main().catch(e => { console.error(e.stack || e.message); process.exit(2); });
