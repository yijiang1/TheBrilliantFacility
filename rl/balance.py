"""CLI: simulate cycles, compare tuning variants, and forecast campaigns."""
import argparse
import json
from pathlib import Path
import numpy as np
if __package__:
    from .balance_config import BalanceConfig
    from .campaign import Campaign, automatic_plan
    from .experiments import simulate, run_cycle, paired_difference, describe, write_report
else:
    from balance_config import BalanceConfig
    from campaign import Campaign, automatic_plan
    from experiments import simulate, run_cycle, paired_difference, describe, write_report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('simulate', 'sweep', 'campaign'):
        p = sub.add_parser(command)
        p.add_argument('--config', help='Partial JSON overrides of BalanceConfig')
        p.add_argument('--episodes', type=int, default=20)
        p.add_argument('--seed', type=int, default=42)
        p.add_argument('--output', required=True, help='JSON report path (CSV also written)')
        p.add_argument('--policy', choices=['heuristic', 'random'], default='heuristic')
        if command == 'simulate':
            p.add_argument('--events', action='store_true')
        elif command == 'sweep':
            p.add_argument('--variants', required=True, help='JSON mapping names to config overrides')
        else:
            p.add_argument('--years', type=int, default=5)
            p.add_argument('--strategy', choices=['save', 'speed', 'staff', 'balanced'], default='balanced')
    args = parser.parse_args(argv)
    try:
        if args.episodes < 1 or args.seed < 0:
            raise ValueError('episodes must be positive and seed nonnegative')
        if Path(args.output).suffix.lower() != '.json':
            raise ValueError('--output must end in .json')
        config = BalanceConfig.load(args.config)
        seeds = list(range(args.seed, args.seed+args.episodes))
        common = dict(command=args.command, policy=args.policy, seeds=seeds)
        if args.command == 'simulate':
            report = dict(**common, **simulate(config, seeds, args.policy, args.events))
            print(json.dumps(report['summary'], indent=2))
        elif args.command == 'sweep':
            overrides = json.loads(Path(args.variants).read_text())
            if not isinstance(overrides, dict) or not overrides or 'baseline' in overrides:
                raise ValueError('Variants must be a nonempty object; baseline is reserved')
            # Validate every variant before starting expensive work.
            configs = {name: config.changed(**values) for name, values in overrides.items()}
            variants = {'baseline': simulate(config, seeds, args.policy)}
            for name, variant in configs.items():
                variants[name] = simulate(variant, seeds, args.policy)
                variants[name]['paired_net_rep_difference'] = paired_difference(variants['baseline'], variants[name])
                print(name, json.dumps(variants[name]['paired_net_rep_difference']), flush=True)
            report = dict(**common, variants=variants)
        else:
            if args.years < 1:
                raise ValueError('years must be positive')
            campaigns = []
            for seed in seeds:
                c = Campaign.new(config)
                cycle_seeds = np.random.SeedSequence(seed).generate_state(args.years*3)
                for cycle_seed in cycle_seeds:
                    result = run_cycle(c.cycle_config(), int(cycle_seed), args.policy, c.reputation)
                    action, purchases = automatic_plan(c, result, args.strategy)
                    c.settle(result, action, purchases)
                campaigns.append(dict(seed=seed, final=c.snapshot(), cycles=c.history))
            report = dict(**common, config=config.to_dict(), config_hash=config.fingerprint,
                          years=args.years, strategy=args.strategy, campaigns=campaigns,
                          final_funding=describe([c['final']['funding'] for c in campaigns]),
                          final_reputation=describe([c['final']['reputation'] for c in campaigns]),
                          campaigns_with_debt=sum(any(r['debt'] > 0 for r in c['cycles']) for c in campaigns))
            print(json.dumps({k:report[k] for k in ('final_funding','final_reputation','campaigns_with_debt')}, indent=2))
        path = write_report(args.output, report)
        print(f'Report: {path.resolve()}\nCSV: {path.with_suffix(".csv").resolve()}')
    except (ValueError, TypeError, OSError) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
