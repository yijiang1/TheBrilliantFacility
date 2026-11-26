// ════════════════════════════════════════════════════════════════
//  Between-cycle strategies for simulated players.
//
//  In-cycle play (movement, samples, accepting rapid proposals) is always
//  the FacilityBot from js/bot.js. A strategy only changes the decisions
//  between cycles: how many proposals to commit, what to buy, and whether
//  to write a paper or train a postdoc. It acts through the same bot API
//  the scenes expose (botSelectProposals, botBuyUpgrade, botChooseAction),
//  so the shop's real prices, limits and unlock years apply.
//
//  A strategy is a preset name or a spec object:
//    {
//      "name": "my-plan",
//      "proposals": "bot" | { "count": 4 },
//      "upgrades": "bot" | "none" | ["measSpeed", "prepCap", "extraJob", ...],
//      "maxPostdocs": 2,        // stop hiring at this many
//      "reserve": 100000,       // never spend below this much funding
//      "action": "bot" | "paper" | "train",  // "train" falls back to paper
//      "playerSpeed": 0.8,      // scales how fast the player walks (1 = the bot's full speed)
//      "thinkMs": 1000          // the player picks a new goal at most this often (bot: 250)
//    }
//  Upgrade keys: prepSpeed_prep, prepSpeed_prep2, measSpeed_0..3, extraJob,
//  prepCap, ringMaint, cryoActivator, and the Robots tab: prepBot, consoleBot,
//  hutchBot, courierBot, receptionBot, sampleChanger, facilityOS (robot keys
//  can be bought more than once until their max). "prepSpeed", "measSpeed"
//  and "robots" expand to all of their keys.
//
//  perfect / typical / weaker are the robot-path skill presets used to check
//  when the facility becomes fully automated (sim/README.md).
// ════════════════════════════════════════════════════════════════
'use strict';

const PRESETS = {
  bot:      { name: 'bot', proposals: 'bot', upgrades: 'bot', action: 'bot' },
  save:     { name: 'save', proposals: 'bot', upgrades: 'none', action: 'paper' },
  speed:    { name: 'speed', proposals: 'bot', upgrades: ['measSpeed', 'prepSpeed'], action: 'paper' },
  staff:    { name: 'staff', proposals: 'bot', upgrades: ['extraJob', 'prepCap'], maxPostdocs: 2, reserve: 100000, action: 'bot' },
  balanced: { name: 'balanced', proposals: 'bot', upgrades: ['measSpeed', 'prepCap', 'cryoActivator', 'extraJob', 'prepSpeed', 'ringMaint'], maxPostdocs: 2, reserve: 100000, action: 'bot' },
  // Robot path, by player skill
  perfect:  { name: 'perfect', proposals: 'bot', upgrades: ['facilityOS', 'robots'], maxPostdocs: 0, reserve: 0, action: 'paper', playerSpeed: 1 },
  typical:  { name: 'typical', proposals: 'bot', upgrades: ['facilityOS', 'robots', 'prepCap', 'cryoActivator'], maxPostdocs: 1, reserve: 0, action: 'bot', playerSpeed: 0.75, thinkMs: 1000 },
  weaker:   { name: 'weaker', proposals: 'bot', upgrades: ['extraJob', 'prepCap', 'measSpeed', 'facilityOS', 'robots'], maxPostdocs: 2, reserve: 50000, action: 'bot', playerSpeed: 0.6, thinkMs: 2000 },
};

const ROBOT_KEYS = ['prepBot', 'consoleBot', 'hutchBot', 'courierBot', 'receptionBot'];

function expandKeys(list) {
  const out = [];
  for (const k of list) {
    if (k === 'measSpeed') out.push('measSpeed_0', 'measSpeed_1', 'measSpeed_2', 'measSpeed_3');
    else if (k === 'prepSpeed') out.push('prepSpeed_prep', 'prepSpeed_prep2');
    else if (k === 'robots') out.push(...ROBOT_KEYS);
    else out.push(k);
  }
  return out;
}

function resolveStrategy(s) {
  if (!s) return PRESETS.bot;
  if (typeof s === 'string') {
    if (!PRESETS[s]) throw new Error(`Unknown strategy "${s}". Presets: ${Object.keys(PRESETS).join(', ')}`);
    return PRESETS[s];
  }
  if (s.preset) return { ...resolveStrategy(s.preset), ...s };
  return { ...PRESETS.bot, ...s };
}

function applyStrategy(run, strategySpec) {
  const spec = resolveStrategy(strategySpec);
  run.strategy = spec;
  const bot = run.ctx._bot;
  const proto = Object.getPrototypeOf(bot);

  if (spec.proposals && spec.proposals !== 'bot') {
    const count = spec.proposals.count;
    bot._doSelectProposals = function (cs) {
      proto._doSelectProposals.call(this, cs);
      if (Number.isFinite(count)) cs.botSelectProposals(cs.selected.slice(0, Math.max(1, count)));
    };
  }

  if (spec.upgrades !== 'bot') {
    const priority = spec.upgrades === 'none' ? [] : expandKeys(spec.upgrades || []);
    const maxPostdocs = spec.maxPostdocs ?? Infinity;
    const reserve = spec.reserve || 0;
    bot._doCycleUpgrades = function (cs) {
      let bought = true;
      while (bought) {
        bought = false;
        for (const key of priority) {
          if (key === 'extraJob' && (cs.upgrades.postdocs || 0) >= maxPostdocs) continue;
          const entry = cs.upgButtons.find(e => e.u.key === key);
          if (!entry) continue;
          if (cs.funding - cs.spent - entry.u.cost < reserve) continue;
          if (cs.botBuyUpgrade(key)) { bought = true; break; }
        }
      }
    };
  } else if (spec.maxPostdocs !== undefined) {
    // Bot's own shop order, but respect a hiring cap.
    bot._doCycleUpgrades = function (cs) {
      const orig = cs.botBuyUpgrade;
      cs.botBuyUpgrade = (key) => (key === 'extraJob' && (cs.upgrades.postdocs || 0) >= spec.maxPostdocs) ? false : orig.call(cs, key);
      try { proto._doCycleUpgrades.call(this, cs); } finally { delete cs.botBuyUpgrade; }
    };
  }

  if (spec.playerSpeed && spec.playerSpeed !== 1) {
    bot._moveToward = function (s, delta, tx, ty) { return proto._moveToward.call(this, s, delta * spec.playerSpeed, tx, ty); };
  }

  if (spec.thinkMs && spec.thinkMs > 250) {
    // Hesitation: keep the current goal until thinkMs has passed (the bot re-decides every 250 ms).
    let since = 0;
    bot._decide = function (s) {
      since += 250;
      if (this._goal && since < spec.thinkMs) return this._goal;
      since = 0;
      return proto._decide.call(this, s);
    };
  }

  if (spec.action === 'paper') {
    bot._doCycleAction = function (cs) { cs.botChooseAction('paper'); };
  } else if (spec.action === 'train') {
    bot._doCycleAction = function (cs) { if (!cs.botChooseAction('train')) cs.botChooseAction('paper'); };
  }
}

module.exports = { PRESETS, resolveStrategy, applyStrategy };
