# Headless game simulator

Runs the real game, the scripts in `js/`, without a browser, at about 50× real
time. The FacilityBot from `js/bot.js` plays every cycle. The simulator then reports
the balance numbers per year: samples, proposals, users who left, reputation,
grants, salaries, spending and funding.

It needs only Node 22. No `npm install` is needed.

```sh
node sim/run.js                                    # baseline: 20 runs × 5 years
node sim/run.js --level sim/levels/gen2-start.json --runs 50 --years 3
node sim/run.js --strategy balanced --out sim/reports/balanced
node sim/run.js --variants sim/levels/variants.example.json --runs 40 --years 3
node --test tests/sim.test.js
```

## Why it can't drift from the game

The simulator doesn't copy the rules. It loads `js/data.js`, the scene files,
`js/game.js` and `js/bot.js` into an isolated Node VM. They run on a small headless
stand-in for Phaser (`sim/phaser-stub.js`), which provides scene switching, timers,
keyboard keys that are never pressed, and display objects that draw nothing.
Anything you change or add in `js/` is simulated the next time you run it, including
new hazards, upgrades, eras and formulas.

Each run uses its own seed for the game's `Math.random`, and its clock is simulation
time, so a seed always replays the same game. The online co-op script and the
Discord telemetry don't run in the simulator.

The Python simulator in `rl/` and `balance/` is a separate copy of the rules, kept
for RL training. Use this one to check what the game itself does.

## Levels are data

A level file sets up the starting state and changes rules without editing the
game. Levels can extend each other.

```json
{
  "extends": "baseline.json",
  "name": "gen2-start",
  "start":       { "year": 4, "reputation": 400, "funding": 300000, "ringBase": 80,
                   "upgrades": { "postdocs": 1, "postdocLevels": [2], "prepCap": 2 } },
  "rules":       { "economy": { "grantPerRep": 600 }, "upgrades": { "measSpeed": { "cost": 40000 } } },
  "constants":   { "CYCLE_SEC": 240, "DUR_MEAS_MAX": 8.0 },
  "generations": { "2": { "startYear": 3 } },
  "strategy":    "balanced"
}
```

| Block | What it changes |
|---|---|
| `start` | The save state the game starts from: year, cycleInYear, reputation, funding, ringBase, upgrades, beamlineTechs. Anything left out is a new game. |
| `rules` | The `RULES` object in `js/data.js`: start values, grant and salary, carryover cap, ring decay, penalties, paper formula, and upgrade costs and unlock years. The browser uses the same object. |
| `constants` | Any single-line `const` in `js/data.js`, such as `CYCLE_SEC`, `MAX_HELD`, `PROPOSAL_LIFE`, `MAX_ACTIVE` and the `DUR_*` processing times. |
| `generations` | `GENERATION_DATA`. Give an array to replace every era, or an object keyed by generation number to change or add one era, its techniques, applications and start year. |
| `strategy` | Who makes the decisions between cycles. See below. |

To make a new kind of number tunable per level, move it into `RULES` in
`js/data.js` and read it from there in the game. The simulator then picks it up
with no other change.

## Strategies

In-cycle play is always the FacilityBot. A strategy changes only the decisions
between cycles, through the same bot API the scenes expose, so the shop's real
prices, limits and unlock years apply.

| Preset | Proposals | Shop | Action |
|---|---|---|---|
| `bot` | bot | bot's own priority order | train, else paper |
| `save` | bot | buys nothing | paper |
| `speed` | bot | measurement, then prep speed | paper |
| `staff` | bot | postdocs (max 2), prep room, user coordination; keeps 100K | train, else paper |
| `balanced` | bot | measurement, prep room, coordination, postdocs (max 2), prep speed, ring; keeps 100K | train, else paper |

Or pass a JSON file or a `strategy` object:

```json
{ "name": "two-postdocs", "preset": "bot", "maxPostdocs": 2,
  "proposals": { "count": 4 }, "upgrades": ["measSpeed", "extraJob", "prepCap"],
  "reserve": 100000, "action": "train" }
```

## Comparing variants

`--variants FILE` takes a map of variant names to level overrides. It runs each
variant and an unchanged `baseline` on the same seeds and prints paired
differences with 95% confidence intervals. See `sim/levels/variants.example.json`.

## What gets measured

Each cycle produces one row (`--out` writes them to CSV and JSON).

| Field | Meaning |
|---|---|
| `samples`, `proposalsDone`, `proposalsPartial`, `proposalsFailed` | What the cycle delivered, as the cycle-end screen counts it |
| `departures`, `usersLost`, `samplesLost`, `repLostToDepartures` | Users whose leave timer ran out, the ones who left with samples still owed, and the cost |
| `penaltyRep` | Reputation lost for committed proposals with no samples done |
| `beamStops`, `rapidAccepted`, `rapidExpired` | Hazard and rapid-review activity |
| `grant`, `salary`, `carryover`, `forfeited` | Year-end economy. `forfeited` is funding lost to the carryover cap |
| `spent`, `purchases`, `action`, `reputation`, `funding`, `postdocs` | Shop and between-cycle choice, and the state after them |
| `botTime` | Seconds the bot spent on each goal. A goal that keeps growing points to a bottleneck |
| `custom` | Counts from `window.simEvent?.('name')` calls in game code |

The summary also flags common problems, such as debt, more than two postdocs, users
leaving with samples, or an era that never brings new beamline techniques.

## Adding hazards later

Hazards added to `js/game.js` are simulated automatically. To count one, either:

- call `window.simEvent?.('motorSlip')` where it fires, which does nothing in the
  browser, or
- add an entry to `PROBES` in `sim/probes.js` that wraps the method, as the beam
  stop probe does.

The bot may need a goal for a new hazard, such as walking to the hutch to fix a
jam. Without one, the simulator shows the cost of the bot ignoring it.

## Limits

- Results describe the FacilityBot, not a person. It is a greedy player with
  fixed habits, such as allowing at most two users waiting at once.
- The default is 30 frames per game second, and the browser runs at 60. At both
  rates, the year totals agreed within run-to-run noise. Use `--fps 60` for
  final numbers.
- Nothing is drawn, so the simulator can't catch visual bugs.
