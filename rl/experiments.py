"""Seeded simulation, policy comparison, and portable JSON/CSV reports."""
import csv
import json
import platform
from pathlib import Path
import numpy as np
if __package__:
    from .balance_config import RULES_VERSION
    from .facility_env import FacilityEnv
else:
    from balance_config import RULES_VERSION
    from facility_env import FacilityEnv


def run_cycle(config, seed, policy='heuristic', reputation=0, events=False):
    env = FacilityEnv(config=config, record_events=events)
    obs, _ = env.reset(seed=seed, options={'reputation': reputation})
    rng = np.random.default_rng(seed ^ 0xABCDEF)
    reward_total = 0.0
    for step in range(100000):
        if callable(policy):
            action = policy(obs)
        elif policy == 'heuristic':
            action = env.heuristic_action()
        elif policy == 'random':
            action = int(rng.integers(env.action_space.n))
        else:
            raise ValueError(f'Unknown policy: {policy}')
        obs, reward, done, truncated, info = env.step(action)
        reward_total += reward
        if done or truncated:
            row = dict(seed=int(seed), steps=step+1, training_reward=reward_total, **info)
            if events:
                row['events'] = env.events
                row['jobs'] = [dict(id=j.job_id, name=j.name, original_samples=j.original_samples,
                                    samples_done=j.done, samples_lost=j.lost_samples,
                                    rep=j.rep, awarded=j.awarded, committed=j.committed)
                               for j in env.jobs.values()]
            env.close()
            return row
    env.close()
    raise RuntimeError(f'Simulation failed to finish within 100000 actions (seed={seed})')


def describe(values):
    x = np.asarray(values, dtype=float)
    if not len(x):
        raise ValueError('At least one observation is required')
    mean = float(x.mean())
    se = float(x.std(ddof=1)/np.sqrt(len(x))) if len(x) > 1 else None
    return dict(n=len(x), mean=mean, std=float(x.std()), p10=float(np.quantile(x, .1)),
                median=float(np.median(x)), p90=float(np.quantile(x, .9)),
                mean_ci95_normal=[mean-1.96*se, mean+1.96*se] if se is not None else None)


def summarize(rows):
    return {key: describe([r[key] for r in rows]) for key in
            ('net_reputation', 'samples_done', 'samples_lost', 'proposals_full',
             'penalties', 'travel_seconds', 'wait_seconds', 'beam_stop_seconds')}


def simulate(config, seeds, policy='heuristic', events=False):
    rows = [run_cycle(config, int(seed), policy, events=events) for seed in seeds]
    return dict(config=config.to_dict(), config_hash=config.fingerprint,
                summary=summarize(rows), episodes=rows)


def paired_difference(baseline, candidate, metric='net_reputation'):
    left, right = baseline['episodes'], candidate['episodes']
    if [r['seed'] for r in left] != [r['seed'] for r in right]:
        raise ValueError('Paired comparisons require identical seeds in identical order')
    return describe([b[metric]-a[metric] for a, b in zip(left, right)])


def write_report(path, report):
    path = Path(path)
    if path.suffix.lower() != '.json':
        raise ValueError('Report path must end in .json (the CSV companion is automatic)')
    path.parent.mkdir(parents=True, exist_ok=True)
    report = dict(rules_version=RULES_VERSION, python_version=platform.python_version(),
                  numpy_version=np.__version__, **report)
    path.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    # Flat, spreadsheet-friendly companion; full events/config remain in JSON.
    rows = []
    if 'episodes' in report:
        rows = report['episodes']
    elif 'variants' in report:
        rows = [dict(variant=name, **row) for name, data in report['variants'].items() for row in data['episodes']]
    elif 'campaigns' in report:
        rows = [dict(campaign_seed=c['seed'], year=r['year'], cycle=r['cycle'],
                     closing_funding=r['closing_funding'], closing_reputation=r['closing_reputation'],
                     grant=r['grant'], salary=r['salary'], debt=r['debt'], **r['result'])
                for c in report['campaigns'] for r in c['cycles']]
    flat = [{k:v for k,v in row.items() if not isinstance(v, (list,dict))} for row in rows]
    if flat:
        columns = list(dict.fromkeys(k for row in flat for k in row))
        with path.with_suffix('.csv').open('w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=columns)
            writer.writeheader()
            writer.writerows(flat)
    return path
