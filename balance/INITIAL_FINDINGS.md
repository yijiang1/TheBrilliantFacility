# Initial v2 balance study

These are simulator results, not measured browser performance. All cycle variants used
the same 100 seeds (42–141), the heuristic routing policy, and the default first-year rules.
Upgrade variants compare effects, not equal purchase budgets or payback periods.

| Variant | Mean net rep/cycle | Samples/cycle | Paired rep change (approx. 95% CI) |
|---|---:|---:|---:|
| baseline | 33.31 | 6.31 | — |
| faster_prep | 36.61 | 6.63 | +3.30 [+0.45, +6.15] |
| faster_measurement | 42.79 | 7.24 | +9.48 [+6.12, +12.84] |
| one_trained_postdoc | 22.39 | 6.38 | -10.92 [-14.43, -7.41] |
| value_selection | 40.30 | 6.37 | +6.99 [+3.40, +10.58] |
| legacy_deadline_formula | 31.75 | 7.16 | -1.56 [-5.96, +2.84] |

Faster measurements and value-based proposal selection improved this policy’s net score.
One level-3 postdoc increased sample throughput slightly but reduced net reputation. The
heuristic does not plan around helpers, and staff dispatch is approximated; this result
should prompt policy/trace inspection, not a conclusion that postdocs inherently hurt play.

The five-year campaign study ran 20 seeds (42–61) with the `balanced` purchasing strategy.
Mean ending reputation: **575.85**. Mean ending funding:
**$75,525**. **0/20** campaigns entered debt.
These figures depend on the current strategy, prices, paper bonuses, and simulation assumptions.

Generated local reports (ignored by Git):

- [Upgrade JSON](../rl/reports/initial-upgrade-study.json) / [CSV](../rl/reports/initial-upgrade-study.csv)
- [Campaign JSON](../rl/reports/initial-campaign-study.json) / [CSV](../rl/reports/initial-campaign-study.csv)

See [the backend guide](README.md) for reproduction commands and fidelity limits.


## Fresh agent evaluation

A new v2 PPO run used 200,000 requested training steps, four environments, 200
heuristic demonstration episodes and 15 cloning epochs. Best-checkpoint selection used
actual reputation. The final comparison used 200 held-out seeds (10000–10199):

| Policy | Mean net reputation/cycle | Mean samples/cycle |
|---|---:|---:|
| Heuristic | 33.74 | 6.31 |
| Fresh PPO (best checkpoint) | 19.34 | 4.43 |

Paired score difference: **-14.40**, approximate 95% CI
**[-17.35, -11.46]**.
The trained agent underperforms; use the heuristic as the current default, not this PPO
policy as an estimate of optimal play. Additional observation/policy and training work is
needed before using learned behavior as a strong-player benchmark.

An earlier development run learned to exploit additive pipeline bonuses. The backend now
uses potential-based shaping whose total is zero over an episode, with tests covering
abandoned work and score conservation. PPO still needs tuning despite that correction.

- [Current model manifest](../rl/runs/design-v2-potential/manifest.json)
- [Held-out evaluation JSON](../rl/reports/v2-agent-evaluation.json) / [CSV](../rl/reports/v2-agent-evaluation.csv)

Reproduce the training and evaluation from the repository root, selecting a fresh output
directory for training:

```sh
python3 rl/train.py --output rl/runs/my-v2-run --timesteps 200000 --envs 4 --bc-episodes 200 --bc-epochs 15
python3 rl/train.py --eval-only --model-dir rl/runs/my-v2-run --episodes 200 --seed 10000 --report rl/reports/my-v2-evaluation.json
```

Validation: 27 regression/integration tests passed, including real checkpoint save/reload,
plus 50 random-action episodes terminated with training/game-score conservation. The
100-seed upgrade study and 20 five-year campaigns also completed and exported JSON/CSV.
