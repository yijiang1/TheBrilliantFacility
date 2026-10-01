"""Validated, versioned inputs for repeatable balance experiments (no ML imports)."""
from dataclasses import asdict, dataclass, fields, replace
from pathlib import Path
import hashlib
import json
import math
from functools import cached_property

ROOT = Path(__file__).resolve().parents[1]
RULES_VERSION = 2
CATALOG = json.loads((ROOT / "balance/catalog.json").read_text())
ENGINE_HASH = hashlib.sha256(b''.join((ROOT / 'rl' / name).read_bytes() for name in
                                    ('balance_config.py', 'facility_env.py', 'campaign.py'))).hexdigest()[:16]


@dataclass(frozen=True)
class BalanceConfig:
    cycle_seconds: float = 180.0
    year: int = 1
    cycle: int = 1
    n_jobs: int = 4
    proposal_pool_size: int = 8
    commitment_strategy: str = 'random'
    max_npc_waiting: int = 2
    prep_cap: int = 1
    meas_cap: int = 1
    prep_min: float = 1.0
    prep_max: float = 2.0
    setup_min: float = 1.0
    setup_max: float = 2.0
    meas_min: float = 2.0
    meas_max: float = 10.0
    prep_speeds: tuple = (1.0, 1.0)  # wet, dry; duration multipliers
    meas_speeds: tuple = (1.0, 1.0, 1.0, 1.0)
    movement_speed: float = 172.0
    room_transit: float = 2.5
    intra_room: float = 2.5
    npc_positioning: bool = False
    deadline_multiplier: float = 2.5
    deadline_uses_upgrades: bool = False
    departure_loss_fraction: float = 0.5
    prorate_lost_samples: bool = True
    commitment_penalty: int = 8
    extra_sample_rep: int = 8
    rep_jitter: int = 3
    rapid_review: bool = True
    rapid_interval: float = 15.0
    rapid_lifetime: float = 40.0
    offer_limit: int = 5
    ring_stability: float = 98.0
    beam_stops: bool = True
    postdoc_levels: tuple = ()
    quantum: float = 0.1
    shaping: float = 0.2
    start_funding: int = 200000
    base_grant: int = 200000
    grant_per_rep: int = 500
    carryover_cap: int = 100000
    postdoc_salary: int = 100000
    postdoc_hire_cost: int = 100000
    max_postdocs: int = 2
    prep_speed_cost: int = 10000
    meas_speed_cost: int = 50000
    prep_capacity_cost: int = 150000
    maintenance_cost: int = 80000
    coordination_cost: int = 100000
    speed_step: float = 0.05
    minimum_speed: float = 0.5
    ring_decay: float = 2.0
    ring_repair: float = 5.0
    ring_floor: float = 30.0
    paper_base: int = 10
    paper_per_sample: int = 2
    paper_cap: int = 30

    def __post_init__(self):
        for key in ("prep_speeds", "meas_speeds", "postdoc_levels"):
            object.__setattr__(self, key, tuple(getattr(self, key)))
        ints = {"year", "cycle", "n_jobs", "proposal_pool_size", "max_npc_waiting", "prep_cap", "meas_cap",
                "commitment_penalty", "extra_sample_rep", "rep_jitter", "offer_limit",
                "start_funding", "base_grant", "grant_per_rep", "carryover_cap",
                "postdoc_salary", "postdoc_hire_cost", "max_postdocs", "prep_speed_cost",
                "meas_speed_cost", "prep_capacity_cost", "maintenance_cost", "coordination_cost",
                "paper_base", "paper_per_sample", "paper_cap"}
        bools = {"npc_positioning", "deadline_uses_upgrades", "prorate_lost_samples", "rapid_review", "beam_stops"}
        for field in fields(self):
            value = getattr(self, field.name)
            if field.name == 'commitment_strategy':
                if value not in ('random', 'value', 'small_batches'):
                    raise ValueError('commitment_strategy must be random, value, or small_batches')
            elif field.name in bools:
                if type(value) is not bool:
                    raise ValueError(f"{field.name} must be boolean")
            elif isinstance(value, tuple):
                if any(type(x) not in (int, float) or not math.isfinite(x) or x <= 0 for x in value):
                    raise ValueError(f"{field.name} must contain positive finite numbers")
            elif type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                raise ValueError(f"{field.name} must be a nonnegative finite number")
            elif field.name in ints and type(value) is not int:
                raise ValueError(f"{field.name} must be an integer")
        for key in ("cycle_seconds", "year", "cycle", "max_npc_waiting", "prep_cap", "meas_cap",
                    "movement_speed", "deadline_multiplier", "rapid_interval", "rapid_lifetime",
                    "offer_limit", "quantum", "minimum_speed", "speed_step"):
            if getattr(self, key) <= 0:
                raise ValueError(f"{key} must be positive")
        for stage in ("prep", "setup", "meas"):
            if not 0 < getattr(self, stage + "_min") <= getattr(self, stage + "_max"):
                raise ValueError(f"Invalid {stage} duration range")
        if len(self.prep_speeds) != 2 or len(self.meas_speeds) != 4:
            raise ValueError("Need two prep speeds and four measurement speeds")
        if any(type(x) is not int or x not in (1, 2, 3) for x in self.postdoc_levels):
            raise ValueError("Postdoc levels must be integers 1–3")
        if self.max_npc_waiting > 5 or self.offer_limit > 5:
            raise ValueError("The facility has five NPC/proposal slots")
        if len(self.postdoc_levels) > self.max_postdocs:
            raise ValueError("Postdoc count exceeds configured cap")
        if not 0 <= self.ring_stability <= 100 or not 0 <= self.ring_floor <= 100:
            raise ValueError("Ring stability must be within 0–100")
        if self.departure_loss_fraction > 1 or self.minimum_speed > 1:
            raise ValueError("Loss fraction and minimum speed must be at most 1")
        if not 0.01 <= self.quantum <= 1:
            raise ValueError("quantum must be between 0.01 and 1 second")

    def to_dict(self):
        return asdict(self)

    def changed(self, **kwargs):
        return replace(self, **kwargs)

    @cached_property
    def fingerprint(self):
        payload = {"rules_version": RULES_VERSION, "engine_hash": ENGINE_HASH,
                   "config": self.to_dict(), "catalog": CATALOG}
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]

    @classmethod
    def load(cls, path=None):
        values = json.loads(Path(path).read_text()) if path else {}
        if not isinstance(values, dict):
            raise ValueError("Config must be a JSON object")
        unknown = set(values) - {f.name for f in fields(cls)}
        if unknown:
            raise ValueError(f"Unknown config fields: {sorted(unknown)}")
        return cls(**values)


def applications(year):
    return [app for era in CATALOG if era["start_year"] <= year for app in era["applications"]]
