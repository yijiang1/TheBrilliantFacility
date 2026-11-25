#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
//  The Brilliant Facility — headless simulator CLI
//
//    node sim/run.js                                  # baseline level, 20 runs × 5 years
//    node sim/run.js --level sim/levels/gen2-start.json --runs 50 --years 3
//    node sim/run.js --strategy balanced --out sim/reports/balanced
//    node sim/run.js --variants sim/levels/variants.example.json --runs 40
//
//  See sim/README.md for the level file format.
// ════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

if (!isMainThread) {
  const { runSim } = require('./engine');
  const { jobs } = workerData;
  for (const job of jobs) parentPort.postMessage({ id: job.id, result: runSim(job.opts) });
  return;
}

const { summarize, toCsv, formatSummary, compareVariants } = require('./report');
const { deepMerge } = require('./engine');

const HELP = `Usage: node sim/run.js [options]
  --level FILE        level file (default sim/levels/baseline.json)
  --runs N            independent runs, seeds seed..seed+N-1 (default 20)
  --years N           years to play, 3 cycles each (default 5)
  --cycles N          play exactly N cycles instead of --years
  --seed N            first seed (default 1)
  --strategy S        preset (bot, save, speed, staff, balanced) or a JSON file
  --variants FILE     JSON map of variant name → level overrides, run on the same seeds
  --fps N             simulation frames per game second (default 30; browser is 60)
  --workers N         parallel worker threads (default: CPU count - 1)
  --out PATH          write PATH.json (full results) and PATH.csv (one row per cycle)
  --quiet             print only errors
  --verbose           echo the game's console output
`;

function parseArgs(argv) {
  const a = { level: path.join(__dirname, 'levels', 'baseline.json'), runs: 20, years: 5, seed: 1, fps: 30 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], next = () => argv[++i];
    switch (k) {
      case '--level': a.level = next(); break;
      case '--runs': a.runs = +next(); break;
      case '--years': a.years = +next(); break;
      case '--cycles': a.cycles = +next(); break;
      case '--seed': a.seed = +next(); break;
      case '--strategy': a.strategy = next(); break;
      case '--variants': a.variants = next(); break;
      case '--fps': a.fps = +next(); break;
      case '--workers': a.workers = +next(); break;
      case '--out': a.out = next(); break;
      case '--quiet': a.quiet = true; break;
      case '--verbose': a.verbose = true; break;
      case '-h': case '--help': process.stdout.write(HELP); process.exit(0);
      default: throw new Error(`Unknown option ${k}\n${HELP}`);
    }
  }
  return a;
}

// Load a level, following "extends" chains (paths relative to the file).
function loadLevel(file, seen = new Set()) {
  const abs = path.resolve(file);
  if (seen.has(abs)) throw new Error(`Level extends itself: ${abs}`);
  seen.add(abs);
  const lvl = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!lvl.extends) return lvl;
  const parent = loadLevel(path.resolve(path.dirname(abs), lvl.extends), seen);
  const { extends: _e, ...rest } = lvl;
  return deepMerge(JSON.parse(JSON.stringify(parent)), rest);
}

function loadStrategy(s) {
  if (!s) return undefined;
  if (s.endsWith('.json')) return JSON.parse(fs.readFileSync(s, 'utf8'));
  return s;
}

function runPool(jobs, workers) {
  return new Promise((resolve, reject) => {
    const results = new Array(jobs.length);
    const n = Math.max(1, Math.min(workers, jobs.length));
    const buckets = Array.from({ length: n }, () => []);
    jobs.forEach((j, i) => buckets[i % n].push(j));
    let live = n;
    for (const bucket of buckets) {
      const w = new Worker(__filename, { workerData: { jobs: bucket } });
      w.on('message', m => { results[m.id] = m.result; });
      w.on('error', reject);
      w.on('exit', () => { if (--live === 0) resolve(results); });
    }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const level = loadLevel(args.level);
  const strategy = loadStrategy(args.strategy) || level.strategy || 'bot';
  const cycles = args.cycles || args.years * 3;
  const workers = args.workers || Math.max(1, os.cpus().length - 1);
  const variants = args.variants
    ? { baseline: {}, ...JSON.parse(fs.readFileSync(args.variants, 'utf8')) }
    : { [level.name || 'level']: {} };

  const jobs = [];
  for (const [name, patch] of Object.entries(variants)) {
    const lvl = deepMerge(JSON.parse(JSON.stringify(level)), patch);
    const strat = patch.strategy || strategy;
    for (let i = 0; i < args.runs; i++) {
      jobs.push({ id: jobs.length, variant: name, opts: { seed: args.seed + i, level: lvl, cycles, fps: args.fps, strategy: strat, verbose: args.verbose } });
    }
  }
  const t0 = Date.now();
  const results = await runPool(jobs, workers);
  const byVariant = {};
  jobs.forEach((j, i) => { (byVariant[j.variant] = byVariant[j.variant] || []).push(results[i]); });

  const summaries = {};
  for (const [name, runs] of Object.entries(byVariant)) {
    const strat = variants[name].strategy || strategy;
    summaries[name] = summarize(runs, { label: name, level: args.level, strategy: typeof strat === 'string' ? strat : (strat.name || 'custom'),
      seeds: [args.seed, args.seed + args.runs - 1], cycles, fps: args.fps });
  }
  const comparison = args.variants ? compareVariants(byVariant) : undefined;

  if (!args.quiet) {
    for (const s of Object.values(summaries)) { console.log(formatSummary(s)); console.log(''); }
    if (comparison) {
      console.log('Paired differences vs baseline (same seeds, mean and 95% CI):');
      for (const c of comparison) {
        const f = x => (x ? `${x.mean} [${x.ci95[0]}, ${x.ci95[1]}]` : '-');
        console.log(`  ${c.variant}: final rep ${f(c.finalReputation)}, final funding ${f(c.finalFunding)}, samples ${f(c.totalSamples)}, users lost ${f(c.totalUsersLost)}`);
      }
    }
    console.log(`${jobs.length} runs × ${cycles} cycles in ${((Date.now() - t0) / 1000).toFixed(1)}s on ${Math.min(workers, jobs.length)} workers.`);
  }
  const errors = Object.values(summaries).flatMap(s => s.errors);
  if (errors.length) {
    console.error(`${errors.length} run(s) failed. First error:\n${errors[0].stack}`);
    const bad = results.find(r => r.error);
    if (bad?.logTail?.length) console.error(`Last game log lines:\n${bad.logTail.join('\n')}`);
  }
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    const payload = { generatedBy: 'sim/run.js', args, level, summaries, comparison, runs: byVariant };
    fs.writeFileSync(`${args.out}.json`, JSON.stringify(payload, null, 1));
    fs.writeFileSync(`${args.out}.csv`, Object.entries(byVariant).map(([name, runs], i) =>
      toCsv(runs).split('\n').map((l, j) => (j === 0 ? (i === 0 ? `variant,${l}` : null) : l ? `${name},${l}` : null)).filter(Boolean).join('\n')).join('\n') + '\n');
    if (!args.quiet) console.log(`Wrote ${args.out}.json and ${args.out}.csv`);
  }
  process.exitCode = errors.length ? 1 : 0;
}

module.exports = { loadLevel };
if (require.main === module) main().catch(e => { console.error(e.stack || e.message); process.exit(2); });
