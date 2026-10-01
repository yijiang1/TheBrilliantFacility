"""Campaign state and upgrade transactions, independent of Gym and PPO."""
from dataclasses import asdict, dataclass, field
if __package__:
    from .balance_config import BalanceConfig
else:
    from balance_config import BalanceConfig


@dataclass
class Campaign:
    rules: BalanceConfig = field(default_factory=BalanceConfig)
    year: int = 1
    cycle: int = 1
    reputation: int = 0
    funding: int = 200000
    ring: float = 98.0
    prep_speeds: list = field(default_factory=lambda: [1.0, 1.0])
    meas_speeds: list = field(default_factory=lambda: [1.0]*4)
    postdoc_levels: list = field(default_factory=list)
    prep_cap: int = 1
    ring_maintenance: bool = False
    npc_positioning: bool = False
    history: list = field(default_factory=list)

    @classmethod
    def new(cls, rules):
        return cls(rules=rules, year=rules.year, cycle=rules.cycle,
                   funding=rules.start_funding, ring=rules.ring_stability,
                   prep_speeds=list(rules.prep_speeds), meas_speeds=list(rules.meas_speeds),
                   postdoc_levels=list(rules.postdoc_levels), prep_cap=rules.prep_cap,
                   npc_positioning=rules.npc_positioning)

    def cycle_config(self):
        return self.rules.changed(year=self.year, cycle=self.cycle,
                                  ring_stability=self.ring, prep_speeds=self.prep_speeds,
                                  meas_speeds=self.meas_speeds, prep_cap=self.prep_cap,
                                  postdoc_levels=self.postdoc_levels,
                                  npc_positioning=self.npc_positioning)

    def purchase(self, key, bought):
        """Atomic purchase; returns a receipt, or raises without changing state."""
        r = self.rules
        if key in bought:
            raise ValueError(f'{key}: already purchased this cycle')
        if key.startswith('prep_speed_'):
            index = int(key.removeprefix('prep_speed_'))
            if index not in (0, 1) or self.prep_speeds[index] <= r.minimum_speed+1e-9:
                raise ValueError(f'{key}: unavailable')
            cost = r.prep_speed_cost
            def apply():
                self.prep_speeds[index] = max(r.minimum_speed, round(self.prep_speeds[index]-r.speed_step, 8))
        elif key.startswith('meas_speed_'):
            index = int(key.removeprefix('meas_speed_'))
            if index not in range(4) or self.meas_speeds[index] <= r.minimum_speed+1e-9:
                raise ValueError(f'{key}: unavailable')
            cost = r.meas_speed_cost
            def apply():
                self.meas_speeds[index] = max(r.minimum_speed, round(self.meas_speeds[index]-r.speed_step, 8))
        elif key == 'hire':
            if len(self.postdoc_levels) >= r.max_postdocs:
                raise ValueError('Staff cap reached')
            cost = r.postdoc_hire_cost
            apply = lambda: self.postdoc_levels.append(1)
        elif key == 'prep_capacity':
            if self.year < 2 or self.prep_cap >= 2:
                raise ValueError('Prep capacity unavailable')
            cost = r.prep_capacity_cost
            apply = lambda: setattr(self, 'prep_cap', 2)
        elif key == 'maintenance':
            if self.year < 2 or self.ring_maintenance:
                raise ValueError('Maintenance unavailable')
            cost = r.maintenance_cost
            apply = lambda: setattr(self, 'ring_maintenance', True)
        elif key == 'coordination':
            if self.year < 2 or self.npc_positioning:
                raise ValueError('Coordination unavailable')
            cost = r.coordination_cost
            apply = lambda: setattr(self, 'npc_positioning', True)
        else:
            raise ValueError(f'Unknown upgrade: {key}')
        if self.funding < cost:
            raise ValueError(f'{key}: insufficient funding')
        self.funding -= cost
        apply()
        bought.add(key)
        return dict(upgrade=key, cost=cost)

    def settle(self, result, action='paper', purchases=()):
        """Settle once per cycle, with browser ordering: grant, free action, shop.

        Debt is retained and reported, not silently forgiven. Explicit purchase lists
        are transactional: invalid plans leave the campaign unchanged.
        """
        import copy
        candidate = copy.deepcopy(self)
        row = candidate._settle(result, action, purchases)
        self.__dict__.update(candidate.__dict__)
        return row

    def _settle(self, result, action, purchases):
        r = self.rules
        if result.get('config_hash') != self.cycle_config().fingerprint:
            raise ValueError('Cycle result configuration does not match campaign')
        if result.get('time_left') != 0:
            raise ValueError('Cannot settle an unfinished cycle')
        if result.get('reputation') != self.reputation + result.get('net_reputation', 0):
            raise ValueError('Cycle result starting reputation does not match campaign')
        self.reputation = result['reputation']
        self.ring = min(100, max(r.ring_floor, self.ring-r.ring_decay+(r.ring_repair if self.ring_maintenance else 0)))
        row = dict(year=self.year, cycle=self.cycle, cycle_in_year=(self.cycle-1)%3+1,
                   result=result, opening_funding=self.funding, grant=0, salary=0,
                   discarded_funding=0, action=action, purchases=[])
        if self.cycle % 3 == 0:
            carry = min(self.funding, r.carryover_cap)
            row['discarded_funding'] = self.funding-carry
            row['grant'] = r.base_grant + self.reputation*r.grant_per_rep
            row['salary'] = len(self.postdoc_levels)*r.postdoc_salary
            self.funding = carry + row['grant']-row['salary']
        if action == 'paper':
            row['paper_rep'] = min(r.paper_cap, r.paper_base+result['samples_done']*r.paper_per_sample)
            self.reputation += row['paper_rep']
        elif action.startswith('train:'):
            index = int(action.split(':')[1])
            if index < 0 or index >= len(self.postdoc_levels) or self.postdoc_levels[index] >= 3:
                raise ValueError('Postdoc cannot be trained')
            self.postdoc_levels[index] += 1
        else:
            raise ValueError('Action must be paper or train:INDEX')
        bought = set()
        for key in purchases:
            row['purchases'].append(self.purchase(key, bought))
        row.update(closing_funding=self.funding, debt=max(0, -self.funding),
                   closing_reputation=self.reputation, ring=self.ring,
                   postdoc_levels=list(self.postdoc_levels))
        self.history.append(row)
        self.cycle += 1
        if self.cycle % 3 == 1:
            self.year += 1
        return row

    def snapshot(self):
        return {k: v for k, v in asdict(self).items() if k != 'history'}


def automatic_plan(campaign, result, strategy):
    """Transparent example strategies, not claims of optimal purchasing."""
    if strategy not in ('save', 'speed', 'staff', 'balanced'):
        raise ValueError('Unknown campaign strategy')
    action = 'paper'
    if strategy in ('staff', 'balanced'):
        trainable = [i for i, level in enumerate(campaign.postdoc_levels) if level < 3]
        if trainable:
            action = f'train:{min(trainable, key=lambda i: campaign.postdoc_levels[i])}'
    # Preview annual settlement to budget against the actual available funds.
    import copy
    preview = copy.deepcopy(campaign)
    preview.settle(result, action)
    preview.year = campaign.year  # shop unlocks use the year just played
    candidates = []
    if strategy == 'staff':
        candidates = ['hire', 'maintenance', 'coordination']
    elif strategy == 'speed':
        candidates = [f'meas_speed_{i}' for i in range(4)] + ['prep_speed_0', 'prep_speed_1']
    elif strategy == 'balanced':
        candidates = ['maintenance', 'hire', 'coordination', 'prep_capacity',
                      'prep_speed_0', 'prep_speed_1'] + [f'meas_speed_{i}' for i in range(4)]
    selected, bought = [], set()
    for key in candidates:
        if key == 'hire':
            # Keep a salary reserve; users can explicitly test risky plans via API.
            salary = (len(preview.postdoc_levels)+1)*campaign.rules.postdoc_salary
            if preview.funding-campaign.rules.postdoc_hire_cost < salary:
                continue
        try:
            preview.purchase(key, bought)
            selected.append(key)
        except ValueError:
            pass
    return action, selected
