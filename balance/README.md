# Balance backend v2

A local Python simulation and experiment backend for designing The Brilliant Facility.
It runs without Phaser, a browser, Discord, or an ML model. PPO training is optional.
It models a complete cycle and a multi-year economy; it does not serve browser game sessions.

## Start here

Run commands from the repository root, using Python 3.9+:

```sh
python3 -m pip install -r rl/requirements-core.txt
python3 rl/balance.py simulate --episodes 100 --seed 42 --output rl/reports/baseline.json
python3 rl/balance.py sweep --episodes 100 --seed 42 --variants balance/variants.example.json --output rl/reports/upgrades.json
python3 rl/balance.py campaign --years 5 --episodes 20 --strategy balanced --output rl/reports/campaign.json
```

Every command writes JSON plus a flat CSV next to it. JSON includes the effective config,
rules version, configuration/catalog/engine fingerprint, seeds, per-episode scores, and summaries.
Use `--events` on `simulate` to include proposal offers, acceptance, sample completions,
losses, payouts, and penalties. Replay by using the same config and seeds with the same
backend version. Runtime package versions are recorded in reports; floating point or
random implementation changes across dependencies can affect replay.

## Change the design

`rl/balance_config.py` defines all supported parameters and validates JSON overrides.
`balance/defaults.json` is the complete default configuration. Prefer small override files,
such as `balance/year4.example.json`, so the changed assumptions are visible:

```sh
python3 rl/balance.py simulate --config balance/year4.example.json --episodes 100 --output rl/reports/year4.json
```

Useful variables include:

| Area | Parameters |
|---|---|
| Pace | `cycle_seconds`, `movement_speed`, processing duration min/max, `room_transit`, `intra_room` |
| Proposals | `year`, `n_jobs`, `proposal_pool_size`, `commitment_strategy`, `max_npc_waiting`, `rapid_review`, `rapid_interval`, `rapid_lifetime` |
| Rewards | `extra_sample_rep`, `rep_jitter`, `commitment_penalty`, `departure_loss_fraction`, `prorate_lost_samples` |
| Deadlines | `deadline_multiplier`, `deadline_uses_upgrades` |
| Equipment | `prep_cap`, `meas_cap`, `prep_speeds` (wet/dry), `meas_speeds` (BL1–4), `npc_positioning` |
| Staffing/hazards | `postdoc_levels`, `ring_stability`, `beam_stops`, `cycle` |
| Economy | grant, salary, carryover, purchase cost, speed-step, paper, and ring-decay fields |
| Simulation | `quantum` (default 0.1s), `shaping` (training bonus weight) |

Speed values multiply processing duration: **0.5 means half the time**.
`commitment_strategy` is `random`, `value` (rep/sample), or `small_batches`.
It selects up to `n_jobs` from an eight-proposal pool before the cycle.
The routing policy is separately chosen with `--policy heuristic` or `--policy random`.
Queued jobs are admitted automatically under the configured NPC waiting cap; PPO learns
movement/processing actions, not proposal selection or shop purchases.

A variants file maps names to configuration overrides. `sweep` always adds an unchanged
`baseline` and runs every variant on identical seeds. It reports paired net-reputation
differences and approximate 95% normal confidence intervals. These intervals describe
seed variability, not uncertainty from approximating the browser. They are not useful
with very few episodes. Candidate policies can cause different offer availability, but
job attributes use a separate random stream from hazards and admission locations.

## Campaigns

`campaign` repeats three cycles per year and carries reputation, funding, ring health,
equipment, and staff forward. `--years` means that many groups of three cycles from the
configured starting cycle. Set `year` and `cycle` consistently when starting mid-campaign.
The shop uses the year just played, matching the browser's unlock timing.

- Annual grant: 200K + cumulative reputation × 500.
- Carryover cap: 100K; salaries: 100K per postdoc/year.
- Year-end ordering: cycle penalties → ring decay → grant/salaries → paper/training → purchases.
- Papers give `min(30, 10 + 2 × samples completed)`; training raises one helper up to level 3.
- Upgrades obey per-cycle purchase restrictions, unlock years, affordability and speed caps.
- Default staff cap is two, as specified in the GDD. It is configurable.
- Negative funding is retained as debt and reported. Future grants must cover it; purchases
  cannot occur without sufficient cash. This makes insolvency visible instead of silently
  forgiving it.

Example purchase strategies: `save`, `speed`, `staff`, `balanced`. They are transparent
baselines in `rl/campaign.py`, not optimized strategies. Automatic hiring keeps a salary
reserve. For a precise experimental plan, use the Python API:

```python
from rl import BalanceConfig, Campaign, run_cycle

campaign = Campaign.new(BalanceConfig())
result = run_cycle(campaign.cycle_config(), seed=42, reputation=campaign.reputation)
campaign.settle(result, action='paper', purchases=['prep_speed_0', 'hire'])
```

`settle` is transactional: invalid plans do not partly mutate the campaign. A mismatched,
uncompleted, or already-settled cycle result is rejected. `history` contains each financial
ledger and `snapshot()` exports current state. This is an in-process API, not an HTTP service.

## Actual score versus training reward

`reputation` is the game's cumulative score, `net_reputation` is the change during the cycle,
`rep_earned` is gross proposal payout, and `penalties` is the actual deducted amount after
the zero floor. A fully finished proposal awards its integer reputation exactly once.
Individual samples do not award reputation. Papers appear separately in campaign ledgers.

By default, losing samples does **not** turn a partially delivered proposal into a full
payout. Remaining station samples can finish; payout is proportional to the original sample
requirement. `proposals_full` counts only all-original-sample deliveries;
`proposals_completed` also includes settled partial deliveries. `proposals_partial` includes
both settled partials and unfinished work. `proposals_failed` counts zero-sample committed
jobs, including departures; these outcome counts are not mutually exclusive categories.

`training_reward` uses potential-based shaping: intermediate progress earns provisional
credit, and losing or settling that work removes the credit. Potential is zero at both
episode boundaries, so the **sum of raw training rewards equals net game reputation**.
This prevents learning to collect samples just to farm bonuses. Per-step rewards still
differ from score changes, so reports and checkpoint selection read the game score directly.
Use `shaping: 0` to disable the provisional credit. PPO uses gamma=1 for the finite-cycle objective,
so a longer travel action does not receive a different discount solely because it consumes
one decision instead of several short waits. GAE still operates on decision transitions.

## Train and evaluate

```sh
python3 -m pip install -r rl/requirements.txt
python3 rl/train.py --output rl/runs/design-v2 --timesteps 500000
python3 rl/train.py --eval-only --model-dir rl/runs/design-v2 --episodes 200 --seed 10000 --report rl/reports/agent.json
```

Training starts with heuristic behavioral cloning, then PPO. `--bc-episodes` and
`--bc-epochs` control cloning; set either to zero to skip it. Each best/final checkpoint
has **its own matching normalization statistics**, plus a version/config manifest.
Checkpoint selection uses actual net reputation. Final evaluation uses the same explicit
seeds for the heuristic and saved agent. Use held-out seeds as above to avoid evaluating
on cloning episodes.

`--checkpoint final` evaluates the last checkpoint instead of the best one.
`--config ... --allow-config-change` explicitly permits transfer to altered rules with a
compatible observation shape. The report labels this a transfer evaluation.
Nonempty training directories are rejected to protect earlier runs.

The original `rl/models/` files are preserved, but **are not compatible with v2**. Their old
scores (roughly 41 versus 62 rep/cycle) used different scoring, observations, deadlines,
and proposal distributions. Retrain before using RL scores with this backend. A short
training smoke test checks the pipeline, not agent quality. A fresh local training run and held-out evaluation are
described in [Initial findings](INITIAL_FINDINGS.md); it is a baseline, not an optimized agent.

## Fidelity and deliberate differences

The browser is not changed by editing backend configs. Keep experiments separate until a
chosen design is implemented in the client. `balance/catalog.json` is the application/era
catalog copied from `js/data.js`; a contract test detects drift. To change applications,
edit this JSON, then deliberately update the client and contract expectations when adopting
the design. Constants shared today are checked, not automatically injected into the game.

Implemented: inventory of three, wet/dry prep, four measurement stations, setup, supervision,
NPC departures, proposals/rapid jobs, beam stops, era gating, staff levels, per-room upgrades,
annual economy, cycle actions and experiment reporting.

Deliberate rule corrections versus the current browser:

- Deadlines use **unupgraded** processing workload × 2.5, so buying speed does not shorten patience.
- Lost samples prorate the final payout; a zero-loss departure does not charge a penalty.
- Setup follows the specific sample/job and cancels if that sample is lost.
- Default two-postdoc cap follows the GDD rather than the uncapped browser shop.

The old deadline and full-payout-after-loss rules can be explored using
`deadline_uses_upgrades: true` and `prorate_lost_samples: false`. These switches do not turn
the backend into an exact browser emulator.

Approximations that still need browser telemetry calibration:

- Movement follows a shortest ring arc between named locations, not wall collision physics.
- Staff use deterministic nearest-room dispatch with travel delays; they do not wander or
  reproduce the browser's collision avoidance. Level 1 follows player-initiated room work;
  level 2 finds unattended active work; level 3 collects completed measurements.
- User Coordination approximates midpoint positioning with angular midpoints on the ring.
- Automatic proposal admission replaces panel clicking. Rapid proposals arrive every 15s
  while below the configured live-job limit; the browser additionally restocks its panel
  immediately on some events.
- Interactions are instantaneous, with some same-room actions batched. Processing, helper
  arrival, and departure ordering is resolved in bounded ticks (default 0.1s); vary `quantum`
  to measure discretization sensitivity. No actions collect results at/after cycle end.
- Beam stops freeze measurements only. Unimplemented GDD hazards remain unimplemented here.

These approximations mean a policy's measured improvement applies to this model first.
Use browser telemetry to calibrate travel time, supervision and offer arrival before making
small balance changes based on predicted throughput.

## Validate

```sh
python3 -m unittest discover -s rl/tests -v
node balance/browser_contract.js
```

The regression suite covers scoring, sample conservation, deadline boundaries, setup loss,
NPC slot ownership, station supervision, beam freezes, staff behavior, seeded replay,
financial transactions, paired reporting, potential-reward conservation, and the live browser completion/catalog contract.
The training integration tests additionally require the optional ML dependencies.
