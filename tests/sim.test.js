// Headless simulator tests: run the real game scripts with the bot.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runSim } = require('../sim/engine');
const { summarize } = require('../sim/report');

test('plays full cycles through every scene without errors', () => {
  const r = runSim({ seed: 7, cycles: 3 });
  assert.equal(r.error, null, r.error && r.error.stack);
  assert.equal(r.cycles.length, 3);
  assert.deepEqual(r.cycles.map(c => c.cycleInYear), [1, 2, 3]);
  for (const c of r.cycles) {
    assert.ok(c.samples > 0, 'bot should finish samples');
    assert.ok(Number.isFinite(c.reputation) && c.reputation >= 0);
    assert.ok(Number.isFinite(c.funding));
    assert.ok(c.action === 'paper' || c.action === 'train');
  }
  assert.ok(r.cycles[2].grant > 0, 'year-end cycle pays a grant');
});

test('the same seed replays identically', () => {
  const strip = r => JSON.stringify(r.cycles);
  assert.equal(strip(runSim({ seed: 3, cycles: 2 })), strip(runSim({ seed: 3, cycles: 2 })));
});

test('level rules and constants reach the game code', () => {
  const base = runSim({ seed: 5, cycles: 3, strategy: 'save' });
  const rich = runSim({ seed: 5, cycles: 3, strategy: 'save', level: { rules: { economy: { grantBase: 900000 } } } });
  assert.equal(rich.cycles[2].grant - base.cycles[2].grant, 700000);
  const short = runSim({ seed: 5, cycles: 1, level: { constants: { CYCLE_SEC: 60 } } });
  assert.equal(short.error, null);
  assert.ok(short.gameSec < 90, `a 60s cycle should end quickly, took ${short.gameSec}s`);
  assert.throws(() => runSim({ seed: 1, cycles: 1, level: { constants: { NOT_A_CONSTANT: 1 } } }), /not a single-line const/);
});

test('start state and strategies apply', () => {
  const r = runSim({ seed: 2, cycles: 1, strategy: 'save',
    level: { start: { year: 4, reputation: 300, funding: 50000, upgrades: { postdocs: 1, postdocLevels: [2] } } } });
  assert.equal(r.error, null, r.error && r.error.stack);
  assert.equal(r.cycles[0].year, 4);
  assert.equal(r.cycles[0].generation, 2);
  assert.deepEqual(r.cycles[0].purchases, []);
  assert.equal(r.cycles[0].action, 'paper');
});

test('summary reports per-year balance numbers', () => {
  const runs = [1, 2].map(seed => runSim({ seed, cycles: 3 }));
  const s = summarize(runs);
  assert.equal(s.completed, 2);
  assert.equal(s.byYear.length, 1);
  assert.ok(s.byYear[0].reputation.mean > 0);
  assert.ok(Object.keys(s.botTimeSharePct).length > 0);
});
