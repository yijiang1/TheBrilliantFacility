// ════════════════════════════════════════════════════════════════
//  Turns simulated runs into balance numbers, checks and a CSV.
// ════════════════════════════════════════════════════════════════
'use strict';

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function stats(values) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length - 1));
  const r = x => Math.round(x * 10) / 10;
  return { mean: r(mean), sd: r(sd), p10: r(quantile(v, 0.1)), p50: r(quantile(v, 0.5)), p90: r(quantile(v, 0.9)), min: v[0], max: v[v.length - 1], n: v.length };
}
const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

// Per-year totals for one run.
function yearRows(run) {
  const byYear = new Map();
  for (const c of run.cycles) {
    if (!byYear.has(c.year)) byYear.set(c.year, []);
    byYear.get(c.year).push(c);
  }
  return [...byYear.entries()].map(([year, cs]) => {
    const last = cs[cs.length - 1];
    return {
      year, generation: last.generation, cycles: cs.length,
      samples: sum(cs, 'samples'), proposalsDone: sum(cs, 'proposalsDone'), proposalsFailed: sum(cs, 'proposalsFailed'),
      usersLost: sum(cs, 'usersLost'), samplesLost: sum(cs, 'samplesLost'),
      repEarned: sum(cs, 'repEarned'), repLost: sum(cs, 'penaltyRep') + sum(cs, 'repLostToDepartures'),
      beamStops: sum(cs, 'beamStops'), rapidExpired: sum(cs, 'rapidExpired'),
      spent: sum(cs, 'spent'), grant: sum(cs, 'grant'), salary: sum(cs, 'salary'), forfeited: sum(cs, 'forfeited'),
      reputation: last.reputation, funding: last.funding, postdocs: last.postdocs, ring: last.ringNext,
      minFunding: Math.min(...cs.map(c => c.funding)),
    };
  });
}

const YEAR_KEYS = ['samples', 'proposalsDone', 'proposalsFailed', 'usersLost', 'samplesLost', 'repEarned', 'repLost',
  'beamStops', 'rapidExpired', 'spent', 'grant', 'salary', 'forfeited', 'reputation', 'funding', 'postdocs', 'ring'];

function summarize(runs, meta = {}) {
  const ok = runs.filter(r => !r.error);
  const perRunYears = ok.map(yearRows);
  const years = [...new Set(perRunYears.flat().map(y => y.year))].sort((a, b) => a - b);
  const byYear = years.map(year => {
    const rows = perRunYears.map(ys => ys.find(y => y.year === year)).filter(Boolean);
    const out = { year, generation: rows[0]?.generation, runs: rows.length };
    for (const k of YEAR_KEYS) out[k] = stats(rows.map(r => r[k]));
    out.runsInDebt = rows.filter(r => r.minFunding < 0).length;
    return out;
  });
  const finals = ok.map(r => r.cycles[r.cycles.length - 1]).filter(Boolean);
  const botTime = {};
  for (const r of ok) for (const c of r.cycles) for (const [k, s] of Object.entries(c.botTime || {})) botTime[k] = (botTime[k] || 0) + s;
  const totalBot = Object.values(botTime).reduce((a, b) => a + b, 0) || 1;
  const timeShare = Object.fromEntries(Object.entries(botTime).sort((a, b) => b[1] - a[1]).map(([k, s]) => [k, Math.round(1000 * s / totalBot) / 10]));
  const custom = {};
  for (const r of ok) for (const c of r.cycles) for (const [k, n] of Object.entries(c.custom || {})) custom[k] = (custom[k] || 0) + n;

  return {
    ...meta,
    runs: runs.length, completed: ok.length,
    errors: runs.filter(r => r.error).map(r => ({ seed: r.seed, ...r.error })),
    final: {
      reputation: stats(finals.map(c => c.reputation)),
      funding: stats(finals.map(c => c.funding)),
      postdocs: stats(finals.map(c => c.postdocs)),
    },
    byYear,
    botTimeSharePct: timeShare,
    customEvents: custom,
    checks: runChecks(ok, byYear),
  };
}

// Automatic red flags worth a designer's attention.
function runChecks(runs, byYear) {
  const out = [];
  const add = (level, msg) => out.push({ level, msg });
  const debt = runs.filter(r => r.cycles.some(c => c.funding < 0)).length;
  if (debt) add('warn', `${debt}/${runs.length} runs went into debt (funding below zero).`);
  // Techniques of a generation that never reached a beamline once that generation began.
  const seenGenTechs = new Map();
  for (const r of runs) for (const c of r.cycles) {
    if (!seenGenTechs.has(c.generation)) seenGenTechs.set(c.generation, new Set());
    for (const t of c.techs || []) seenGenTechs.get(c.generation).add(t);
  }
  for (const [gen, techs] of seenGenTechs) {
    const prev = seenGenTechs.get(gen - 1);
    if (gen > 1 && prev && [...techs].every(t => prev.has(t))) {
      add('warn', `Generation ${gen} began but no new beamline technique appeared; beamline techniques never change during a run.`);
    }
  }
  for (const y of byYear) {
    if (y.usersLost && y.samples && y.usersLost.mean > 0.5 * y.proposalsDone.mean) {
      add('info', `Year ${y.year}: users who left with samples (${y.usersLost.mean}) are over half the finished proposals (${y.proposalsDone.mean}).`);
      break;
    }
  }
  const pd = Math.max(0, ...runs.map(r => r.cycles[r.cycles.length - 1]?.postdocs || 0));
  if (pd > 2) add('warn', `A run hired ${pd} postdocs; the GDD caps postdocs at 2.`);
  return out;
}

function toCsv(runs) {
  const cols = ['seed', 'year', 'cycleInYear', 'cycle', 'generation', 'committed', 'samples', 'proposalsDone', 'proposalsPartial',
    'proposalsFailed', 'penaltyRep', 'repEarned', 'departures', 'usersLost', 'samplesLost', 'repLostToDepartures', 'beamStops',
    'rapidAccepted', 'rapidExpired', 'ringNext', 'grant', 'salary', 'forfeited', 'fundingAvailable', 'spent', 'purchases',
    'action', 'reputation', 'funding', 'postdocs'];
  const esc = v => { const s = Array.isArray(v) ? v.join('|') : v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.join(',')];
  for (const r of runs) for (const c of r.cycles) lines.push(cols.map(k => esc(k === 'seed' ? r.seed : c[k])).join(','));
  return lines.join('\n') + '\n';
}

function fmtMoney(n) { if (n == null) return '-'; const a = Math.abs(n); return (n < 0 ? '-' : '') + (a >= 1000 ? `${Math.round(a / 1000)}K` : String(Math.round(a))); }

function formatSummary(s) {
  const L = [];
  L.push(`${s.label || 'Simulation'}: ${s.completed}/${s.runs} runs completed` + (s.strategy ? `, strategy ${s.strategy}` : ''));
  const cell = (st, money) => (st ? (money ? fmtMoney(st.mean) : String(st.mean)) : '-');
  const head = ['Year', 'Gen', 'Samples', 'Done', 'Failed', 'UsersLost', 'SampLost', 'RepEarn', 'RepLost', 'EndRep', 'Grant', 'Salary', 'Spent', 'EndFund', 'Postdocs', 'Debt'];
  const rows = s.byYear.map(y => [y.year, y.generation, cell(y.samples), cell(y.proposalsDone), cell(y.proposalsFailed), cell(y.usersLost),
    cell(y.samplesLost), cell(y.repEarned), cell(y.repLost), cell(y.reputation), cell(y.grant, 1), cell(y.salary, 1), cell(y.spent, 1),
    cell(y.funding, 1), cell(y.postdocs), `${y.runsInDebt}/${y.runs}`]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const line = r => r.map((v, i) => String(v).padStart(widths[i])).join('  ');
  L.push('Means per year (each year = 3 cycles):');
  L.push(line(head));
  for (const r of rows) L.push(line(r));
  if (s.final.reputation) L.push(`Final reputation p10/p50/p90: ${s.final.reputation.p10} / ${s.final.reputation.p50} / ${s.final.reputation.p90}`);
  const share = Object.entries(s.botTimeSharePct).slice(0, 6).map(([k, v]) => `${k} ${v}%`).join(', ');
  if (share) L.push(`Where the bot's time went: ${share}`);
  if (Object.keys(s.customEvents || {}).length) L.push(`Custom events: ${JSON.stringify(s.customEvents)}`);
  for (const c of s.checks) L.push(`${c.level === 'warn' ? 'WARN' : 'NOTE'}: ${c.msg}`);
  for (const e of s.errors.slice(0, 3)) L.push(`ERROR seed ${e.seed}: ${e.message}`);
  return L.join('\n');
}

// Paired comparison of variants that ran on identical seeds.
function compareVariants(results, baselineName = 'baseline') {
  const base = results[baselineName];
  if (!base) return [];
  const finalBy = runs => new Map(runs.filter(r => !r.error).map(r => [r.seed, r.cycles[r.cycles.length - 1]]));
  const b = finalBy(base);
  const out = [];
  for (const [name, runs] of Object.entries(results)) {
    if (name === baselineName) continue;
    const v = finalBy(runs);
    const diffs = { reputation: [], funding: [], samples: [], usersLost: [] };
    const tot = rs => ({ samples: rs.reduce((a, c) => a + c.samples, 0), usersLost: rs.reduce((a, c) => a + c.usersLost, 0) });
    for (const [seed, fb] of b) {
      const fv = v.get(seed); if (!fv) continue;
      const tb = tot(base.find(r => r.seed === seed).cycles), tv = tot(runs.find(r => r.seed === seed).cycles);
      diffs.reputation.push(fv.reputation - fb.reputation);
      diffs.funding.push(fv.funding - fb.funding);
      diffs.samples.push(tv.samples - tb.samples);
      diffs.usersLost.push(tv.usersLost - tb.usersLost);
    }
    const ci = arr => { const st = stats(arr); if (!st) return null; const half = 1.96 * st.sd / Math.sqrt(st.n); return { mean: st.mean, ci95: [Math.round((st.mean - half) * 10) / 10, Math.round((st.mean + half) * 10) / 10], n: st.n }; };
    out.push({ variant: name, finalReputation: ci(diffs.reputation), finalFunding: ci(diffs.funding), totalSamples: ci(diffs.samples), totalUsersLost: ci(diffs.usersLost) });
  }
  return out;
}

module.exports = { summarize, toCsv, formatSummary, compareVariants, stats, yearRows };
