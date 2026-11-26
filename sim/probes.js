// ════════════════════════════════════════════════════════════════
//  Probes: read-only instrumentation wrapped around real game methods.
//
//  Each probe wraps one scene method, calls the original unchanged, and
//  counts what happened. To measure something new (for example a new
//  hazard), add an entry to PROBES, or call window.simEvent?.('name')
//  from game code; custom events appear under `custom` in every cycle row.
// ════════════════════════════════════════════════════════════════
'use strict';

const vm = require('vm');

function newCycleCounters() {
  return {
    committed: 0, committedRep: 0,
    departures: 0, usersLost: 0, samplesLost: 0, repLostToDepartures: 0,
    beamStops: 0,
    rapidAccepted: 0, rapidExpired: 0,
    activeAtEnd: 0, queuedAtEnd: 0, heldAtEnd: 0,
    purchases: [], action: null,
    botTime: {},
    custom: {},
  };
}

// target: global class name in the game scripts. before/after get (run, scene, args, memo).
const PROBES = [
  { target: 'GameScene', method: 'create',
    before(run) { run.sim.cycle = newCycleCounters(); },
    after(run, s) {
      const c = run.sim.cycle;
      c.committed = (s.committedProposals || []).length;
      c.committedRep = (s.committedProposals || []).reduce((a, p) => a + (p.rep || 0), 0);
    } },

  { target: 'GameScene', method: 'userNpcLeaves',
    before(run, s, [j], memo) {
      const held = (s.held || []).filter(h => h.jobId === j.id).length;
      const lost = (j.unstarted || 0) + held;
      const c = run.sim.cycle;
      c.departures++;
      if (lost > 0) c.usersLost++;
      c.samplesLost += lost;
      memo.rep = s.reputation;
    },
    after(run, s, _a, memo) { run.sim.cycle.repLostToDepartures += Math.max(0, memo.rep - s.reputation); } },

  { target: 'GameScene', method: 'triggerBeamDump',
    before(run, s) { if (!s.beamDump) run.sim.cycle.beamStops++; } },

  { target: 'GameScene', method: 'acceptProposalBySlot',
    before(run, s, _a, memo) { memo.pending = (s.pending || []).length; },
    after(run, s, _a, memo) { if ((s.pending || []).length < memo.pending) run.sim.cycle.rapidAccepted++; } },

  { target: 'GameScene', method: 'onTick',
    before(run, s, _a, memo) { memo.expiring = (s.pending || []).filter(p => p.timeLeft <= 1); },
    after(run, s, _a, memo) {
      for (const p of memo.expiring) if (!s.pending.includes(p) && p.timeLeft <= 0) run.sim.cycle.rapidExpired++;
    } },

  { target: 'GameScene', method: 'endYear',
    before(run, s) {
      const c = run.sim.cycle;
      c.activeAtEnd = (s.active || []).length;
      c.queuedAtEnd = (s.commitQueue || []).length;
      c.heldAtEnd = (s.held || []).length;
    } },

  { target: 'CycleEndScene', method: 'botBuyUpgrade',
    before(run, cs, [key], memo) { memo.cost = cs.upgButtons?.find(e => e.u.key === key)?.u.cost ?? null; },
    after(run, cs, [key], memo, ret) { if (ret) run.sim.cycle.purchases.push({ key, cost: memo.cost }); } },

  { target: 'CycleEndScene', method: 'botChooseAction',
    after(run, cs, [key], _m, ret) { if (ret) run.sim.cycle.action = key; } },

  { target: 'CycleEndScene', method: 'nextScene',
    before(run, cs) { run.cycles.push(buildCycleRow(run, cs)); } },
];

function buildCycleRow(run, cs) {
  const d = cs.d, c = run.sim.cycle;
  const rules = vm.runInContext('RULES', run.ctx);
  const up = cs.upgrades || {};
  const isYearEnd = d.cycleInYear === 3;
  const carryover = isYearEnd ? Math.min(d.funding || 0, rules.economy.carryoverCap) : null;
  const salary = isYearEnd ? (up.postdocs || 0) * rules.economy.postdocSalary : 0;
  const grant = isYearEnd ? cs.funding - carryover + salary : 0;
  const meas = up.measSpeedMap || [1, 1, 1, 1];
  const prep = up.prepSpeedMap || { prep: 1, prep2: 1 };
  const gen = vm.runInContext(`getGeneration(${Number(d.year) || 1})`, run.ctx);
  const botTime = {};
  for (const [k, ms] of Object.entries(c.botTime)) botTime[k] = Math.round(ms / 100) / 10;
  return {
    year: d.year, cycleInYear: d.cycleInYear, cycle: d.cycle, generation: gen,
    techs: d.beamlineTechs,
    committed: c.committed, committedRep: c.committedRep,
    samples: d.yearSamples,
    proposalsDone: d.proposalsDone, proposalsPartial: d.proposalsPartial,
    proposalsFailed: (d.penalties || []).length,
    penaltyRep: (d.penalties || []).reduce((a, p) => a + Math.abs(p.penalty || 0), 0),
    repEarned: d.repEarned,
    departures: c.departures, usersLost: c.usersLost, samplesLost: c.samplesLost,
    repLostToDepartures: c.repLostToDepartures,
    beamStops: c.beamStops,
    rapidAccepted: c.rapidAccepted, rapidExpired: c.rapidExpired,
    activeAtEnd: c.activeAtEnd, queuedAtEnd: c.queuedAtEnd, heldAtEnd: c.heldAtEnd,
    ringNext: d.ringBase,
    grant, salary, carryover, forfeited: isYearEnd ? Math.max(0, (d.funding || 0) - carryover) : 0,
    fundingAvailable: cs.funding,
    spent: cs.spent,
    purchases: c.purchases.map(p => p.key),
    action: c.action,
    reputation: cs.d.reputation,
    funding: cs.funding - cs.spent,
    postdocs: up.postdocs || 0,
    postdocLevels: [...(up.postdocLevels || [])],
    prepSpeed: { wet: prep.prep, dry: prep.prep2 },
    measSpeed: [...meas],
    prepCap: up.prepCap || 1,
    ringMaint: !!up.ringMaint,
    robots: up.robots ? JSON.parse(JSON.stringify(up.robots)) : null,
    measCap: up.measCap || 1,
    victoryLap: !!d.victoryLap,   // this cycle ran fully automated
    botTime,
    custom: { ...c.custom },
  };
}

function wrap(run, probe) {
  const Cls = vm.runInContext(probe.target, run.ctx);
  const orig = Cls.prototype[probe.method];
  if (typeof orig !== 'function') throw new Error(`Probe target missing: ${probe.target}.${probe.method}`);
  Cls.prototype[probe.method] = function (...args) {
    const memo = {};
    if (probe.before) probe.before(run, this, args, memo);
    const ret = orig.apply(this, args);
    if (probe.after) probe.after(run, this, args, memo, ret);
    return ret;
  };
}

function installProbes(run, extra = []) {
  for (const p of [...PROBES, ...extra]) wrap(run, p);
  // Where the bot spent its time, by goal (e.g. "wait meas", "NPC", "idle").
  const gameScene = run.game.scene.getScene('Game');
  gameScene.events.on('postupdate', (_t, delta) => {
    const bot = run.ctx._bot;
    if (!bot || !bot.enabled || !run.game.scene.isActive('Game')) return;
    const label = bot._goal ? bot._goal.label : 'idle';
    const bucket = label.replace(/BL-\d+|→.*$|:.*$/g, '').trim().replace(/\s+/g, ' ') || 'idle';
    const t = run.sim.cycle.botTime;
    t[bucket] = (t[bucket] || 0) + delta;
  });
}

module.exports = { installProbes, newCycleCounters, PROBES };
