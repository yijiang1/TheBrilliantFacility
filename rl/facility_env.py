"""
facility_env.py — Gymnasium environment for The Brilliant Facility

Simulates the core game loop for RL training without Phaser or a browser.

Pipeline per sample:
    collect raw from NPC  →  prep table (proximity-gated timer)
    →  experiment setup at hutch  →  measurement ctrl room (proximity-gated)
    →  collect result  →  reputation earned

Key simplifications vs the web game
    Movement   : discrete named locations + configurable shortest-arc travel times
    Proximity  : binary — at location or not (no partial 50-px radius)
    NPC slots  : 5 fixed positions evenly spaced around the ring corridor
    No rendering, Phaser, or browser runtime

Usage
    env = FacilityEnv()
    obs, _ = env.reset()
    obs, reward, done, truncated, info = env.step(action)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
if __package__:
    from .balance_config import BalanceConfig, applications, RULES_VERSION
else:
    from balance_config import BalanceConfig, applications, RULES_VERSION

import numpy as np
import gymnasium as gym
from gymnasium import spaces

# Player inventory capacity matches the browser.
MAX_HELD = 3

# ── Facility geometry (game.js) ───────────────────────────────────────────────

RING_RAD = 190.0    # inner ring radius, px
PREP_RAD = 275.0    # outer prep-room radius, px
CORR_R   = (RING_RAD + PREP_RAD) / 2   # mid-corridor radius ≈ 232 px

# ── Named locations ───────────────────────────────────────────────────────────
#
# 15 navigation targets; action 15 = WAIT at current location.
#
# Angles (radians, counter-clockwise from +x axis):
#   Prep stations : top (π/2) and bottom (−π/2) of the ring
#   Beamlines     : NE 45°, NW 135°, SW 225°, SE 315°
#   NPC slots     : 5 positions evenly at 72° intervals starting from 0°

LOCS = [
    "wet_prep",    # 0  wet-lab prep table
    "dry_prep",    # 1  dry-lab prep table
    "bl0_hutch",   # 2  beamline-0 experiment hutch
    "bl0_ctrl",    # 3  beamline-0 measurement control room
    "bl1_hutch",   # 4
    "bl1_ctrl",    # 5
    "bl2_hutch",   # 6
    "bl2_ctrl",    # 7
    "bl3_hutch",   # 8
    "bl3_ctrl",    # 9
    "npc_0",       # 10
    "npc_1",       # 11
    "npc_2",       # 12
    "npc_3",       # 13
    "npc_4",       # 14
]
N_LOCS      = len(LOCS)          # 15
ACTION_WAIT = N_LOCS              # 15 → wait at current location
N_ACTIONS   = N_LOCS + 1         # 16

LOC_IDX = {loc: i for i, loc in enumerate(LOCS)}

_BL_ANGLES  = [math.pi / 4, 3 * math.pi / 4, -3 * math.pi / 4, -math.pi / 4]
_NPC_ANGLES = [i * 2 * math.pi / 5 for i in range(5)]

LOC_ANGLE: dict[str, float] = {
    "wet_prep":  math.pi / 2,
    "dry_prep": -math.pi / 2,
    **{f"bl{i}_hutch": _BL_ANGLES[i] for i in range(4)},
    **{f"bl{i}_ctrl":  _BL_ANGLES[i] for i in range(4)},
    **{f"npc_{i}":     _NPC_ANGLES[i] for i in range(5)},
}

IN_BL_ROOM: dict[str, bool] = {loc: loc[:2] == "bl" for loc in LOCS}

# Within-room peer: hutch ↔ ctrl for the same beamline
PEER = {
    **{f"bl{i}_hutch": f"bl{i}_ctrl"  for i in range(4)},
    **{f"bl{i}_ctrl":  f"bl{i}_hutch" for i in range(4)},
}

# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class HeldItem:
    job_id:   int
    stage:    str   # "raw" | "prepped"
    lab_type: str   # "wet" | "dry"
    bl_idx:   int   # which beamline this job's measurement goes to


@dataclass
class PrepSlot:
    job_id:    int
    remaining: float   # seconds until ready
    total:     float
    ready:     bool = False


@dataclass
class MeasSlot:
    job_id:    int
    bl_idx:    int
    remaining: float
    total:     float
    started:   bool = False
    ready:     bool = False


@dataclass
class Job:
    job_id:        int
    name:          str
    lab_type:      str   # "wet" | "dry"
    bl_idx:        int   # beamline index 0-3
    total_samples: int
    rep:           int
    done:          int   = 0
    unstarted:     int   = 0   # raw samples not yet collected by player
    npc_gone:      bool  = False
    completed:     bool  = False
    npc_slot:      int   = -1  # which NPC slot (-1 = queued, not yet summoned)
    leave_ms:      float = 0.0
    leave_ms_total: float = 0.0
    prep_durs:     list  = field(default_factory=list)
    setup_durs:    list  = field(default_factory=list)
    meas_durs:     list  = field(default_factory=list)

    committed: bool = True
    original_samples: int = 0
    lost_samples: int = 0
    penalty_paid: int = 0
    awarded: int = 0
    expired: bool = False
    offer_expires: float = 0.0

    def __post_init__(self):
        if self.original_samples == 0:
            self.original_samples = self.total_samples
        if self.unstarted == 0:
            self.unstarted = self.total_samples


# ── Gymnasium environment ─────────────────────────────────────────────────────

class FacilityEnv(gym.Env):
    """
    One episode = one 180-second game cycle.

    Observation  flat float32 vector (see _obs_dim for breakdown).
    Action       Discrete(16): navigate to one of 15 locations, or WAIT.
    Reward       proposal reputation minus penalties plus potential-based shaping.
                 Game score is tracked independently in info/reputation.
    """

    metadata = {"render_modes": []}

    def __init__(self, n_jobs=None, prep_cap=None, meas_cap=None,
                 prep_speed=None, meas_speed=None, max_npc_waiting=None,
                 config=None, legacy_observation=False, record_events=True):
        super().__init__()
        self.config = config or BalanceConfig()
        overrides = {k: v for k, v in dict(n_jobs=n_jobs, prep_cap=prep_cap,
                     meas_cap=meas_cap, max_npc_waiting=max_npc_waiting).items() if v is not None}
        if prep_speed is not None:
            overrides['prep_speeds'] = (prep_speed,) * 2
        if meas_speed is not None:
            overrides['meas_speeds'] = (meas_speed,) * 4
        self.config = self.config.changed(**overrides)
        self.n_jobs = self.config.n_jobs
        self.prep_cap = self.config.prep_cap
        self.meas_cap = self.config.meas_cap
        self.max_npc_waiting = self.config.max_npc_waiting
        self.legacy_observation = legacy_observation
        self.record_events = record_events
        self.observation_space = spaces.Box(low=0.0, high=1.0, shape=(self._obs_dim(),), dtype=np.float32)
        self.action_space = spaces.Discrete(N_ACTIONS)
        self.rng = np.random.default_rng()
        self._init_state()

    # ── Observation dimensionality ────────────────────────────────────────────

    def _obs_dim(self) -> int:
        # time_remaining            : 1
        # current location (one-hot): N_LOCS = 15
        # held items (×MAX_HELD)    : 3 × 8   (stage×2, lab×2, bl_idx×4)
        # prep slots (2 tbl × cap)  : 2 × prep_cap × 3  (processing, ready, progress)
        # meas slots (4 bl × cap)   : 4 × meas_cap × 5  (empty, not-started, running, ready, progress)
        # exp setup state           : 6  (active, bl_idx×4, progress)
        # NPC state (5 slots)       : 5 × 5  (present, unstarted_frac, urgency, lab_wet, lab_dry)
        return (1 + N_LOCS + MAX_HELD * 8
                + 2 * self.prep_cap * 3
                + 4 * self.meas_cap * 5
                + 6 + 5 * 5 + (0 if self.legacy_observation else 5 * 8 + 8))

    # ── Reset ─────────────────────────────────────────────────────────────────

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        # Independent streams: upgrades and policy choices never alter job attributes.
        seeds = self.rng.integers(0, 2**32, size=3)
        self.job_rng, self.hazard_rng, self.slot_rng = [np.random.default_rng(int(x)) for x in seeds]
        self._init_state()
        if options:
            unknown = set(options) - {'reputation'}
            if unknown:
                raise ValueError(f'Unknown reset options: {sorted(unknown)}')
            rep = options.get('reputation', 0)
            if type(rep) is not int or rep < 0:
                raise ValueError('Starting reputation must be a nonnegative integer')
            self.reputation = self.starting_reputation = rep
        self._maybe_accept_jobs()
        return self._observe(), self.summary()

    def _init_state(self):
        if not hasattr(self, 'job_rng'):
            self.job_rng = np.random.default_rng(0)
            self.hazard_rng = np.random.default_rng(1)
            self.slot_rng = np.random.default_rng(2)
        self.time_left = self.config.cycle_seconds
        self.loc = 'wet_prep'
        self.held = []
        self.prep_wet, self.prep_dry, self.meas_slots = [], [], []
        self.exp_setup_bl = -1
        self.exp_setup_job = None
        self.exp_setup_prog, self.exp_setup_dur = 0.0, 1.0
        self.reputation = 0
        self.starting_reputation = 0
        self.rep_earned = 0
        self.penalties = 0
        self._step_reward = 0.0
        self.done = False
        self._job_queue = []
        self.jobs = {}
        self._next_jid = 0
        self._npc_slots_used = set()
        self.events = []
        self.metrics = dict(travel_seconds=0.0, wait_seconds=0.0, beam_stop_seconds=0.0,
                            prep_busy_seconds=0.0, meas_busy_seconds=0.0)
        self.postdocs = [dict(level=level, loc='wet_prep', target=None, eta=0.0)
                         for level in self.config.postdoc_levels]
        self.beam_start = float('inf')
        self.beam_end = float('inf')
        if self.config.beam_stops and self.hazard_rng.random() < (100-self.config.ring_stability)/100:
            self.beam_start = float(self.hazard_rng.uniform(0, self.config.cycle_seconds))
            duration = int(float(self.hazard_rng.uniform(1, 2+(self.config.cycle-1)*0.5)) + 0.5)
            self.beam_end = self.beam_start + duration
        self.next_rapid = self.config.rapid_interval
        self._generate_jobs()

    @property
    def elapsed(self):
        return self.config.cycle_seconds - self.time_left

    def _event(self, kind, **data):
        if self.record_events:
            self.events.append(dict(time=round(self.elapsed, 6), kind=kind, **data))

    def _new_job(self, committed=True):
        apps = applications(self.config.year)
        app = apps[int(self.job_rng.integers(len(apps)))]
        n = int(self.job_rng.integers(app['min_samples'], app['max_samples']+1))
        rep = app['base_rep'] + (n-1)*self.config.extra_sample_rep + int(self.job_rng.integers(-self.config.rep_jitter, self.config.rep_jitter+1))
        job = Job(self._next_jid, app['name'], app['lab'], int(self.job_rng.integers(4)), n,
                  max(0, rep), committed=committed)
        self._next_jid += 1
        self._roll_durations(job)
        self.jobs[job.job_id] = job
        return job

    def _generate_jobs(self):
        if not self.n_jobs:
            return
        proposals = [self._new_job() for _ in range(max(self.n_jobs, self.config.proposal_pool_size))]
        if self.config.commitment_strategy == 'value':
            proposals.sort(key=lambda j: (-j.rep/j.original_samples, j.original_samples))
        elif self.config.commitment_strategy == 'small_batches':
            proposals.sort(key=lambda j: (j.original_samples, -j.rep))
        self._job_queue = proposals[:self.n_jobs]
        self.jobs = {j.job_id: j for j in self._job_queue}
        self._event('proposal_review', selected=[j.job_id for j in self._job_queue],
                    offered=[dict(id=j.job_id, name=j.name, samples=j.original_samples, rep=j.rep)
                             for j in proposals])

    def _roll_durations(self, job):
        base_total, upgraded_total = 0.0, 0.0
        for _ in range(job.original_samples):
            prep = float(self.job_rng.uniform(self.config.prep_min, self.config.prep_max))
            setup = float(self.job_rng.uniform(self.config.setup_min, self.config.setup_max))
            meas = float(self.job_rng.uniform(self.config.meas_min, self.config.meas_max))
            p = prep * self.config.prep_speeds[0 if job.lab_type == 'wet' else 1]
            m = meas * self.config.meas_speeds[job.bl_idx]
            job.prep_durs.append(p)
            job.setup_durs.append(setup)
            job.meas_durs.append(m)
            base_total += prep + setup + meas
            upgraded_total += p + setup + m
        budget = upgraded_total if self.config.deadline_uses_upgrades else base_total
        job.leave_ms = job.leave_ms_total = budget * self.config.deadline_multiplier * 1000

    # ── NPC throttle ──────────────────────────────────────────────────────────

    def _maybe_accept_jobs(self):
        """Accept queued jobs one at a time while below the NPC-waiting cap."""
        while self._job_queue:
            waiting = sum(
                1 for j in self.jobs.values()
                if j.unstarted > 0 and not j.npc_gone and j.npc_slot >= 0
            )
            if waiting >= self.max_npc_waiting:
                break
            free = [i for i in range(5) if i not in self._npc_slots_used]
            if not free:
                break
            job = self._job_queue.pop(0)
            slot = int(self.slot_rng.choice(free))
            job.npc_slot = slot
            self._npc_slots_used.add(slot)
            self._event('job_accepted', job_id=job.job_id, committed=job.committed)

    # ── Step ──────────────────────────────────────────────────────────────────

    # ── State-change detection helpers ───────────────────────────────────────

    def _state_snapshot(self) -> tuple:
        """Lightweight tuple capturing the parts of state that interactions can change."""
        return (
            self._step_reward,
            len(self.held),
            tuple((ms.started, ms.ready) for ms in self.meas_slots),
            tuple(ps.ready for ps in self.prep_wet + self.prep_dry),
            self.exp_setup_bl,
        )

    def _state_changed(self, snap: tuple) -> bool:
        return snap != self._state_snapshot()

    def travel_time(self, origin, dest):
        if origin == dest:
            return 0.0
        if PEER.get(origin) == dest:
            return self.config.intra_room
        def angle(loc):
            if self.config.npc_positioning and loc.startswith('npc_'):
                slot = int(loc[4])
                job = next((j for j in self.jobs.values() if j.npc_slot == slot and not j.npc_gone), None)
                if job:
                    a = LOC_ANGLE['wet_prep' if job.lab_type == 'wet' else 'dry_prep']
                    b = LOC_ANGLE[f'bl{job.bl_idx}_hutch']
                    return math.atan2(math.sin(a)+math.sin(b), math.cos(a)+math.cos(b))
            return LOC_ANGLE[loc]
        diff = (angle(origin)-angle(dest)) % (2*math.pi)
        return min(diff, 2*math.pi-diff)*CORR_R/self.config.movement_speed + self.config.room_transit*(int(IN_BL_ROOM[origin])+int(IN_BL_ROOM[dest]))

    def step(self, action):
        if not self.action_space.contains(action):
            raise ValueError(f'Invalid action: {action}')
        action = int(action)
        if self.done:
            return self._observe(), 0.0, True, False, self.summary()
        potential_before = self._potential()
        self._step_reward = 0.0
        if action == ACTION_WAIT:
            dt = min(self._time_to_next_event(), self.time_left)
            self.metrics['wait_seconds'] += dt
            self._advance(dt, self.loc)
        else:
            dest = LOCS[action]
            travel = self.travel_time(self.loc, dest)
            if travel > 0:
                available = self.time_left
                self.metrics['travel_seconds'] += min(travel, available)
                self._advance(min(travel, available), None)
                # No teleporting or collecting at/after the cycle boundary.
                if travel < available and self.time_left > 1e-9:
                    self.loc = dest
                    self._interact_at(dest)
            else:
                snap = self._state_snapshot()
                self._interact_at(dest)
                if not self._state_changed(snap):
                    dt = min(self._time_to_next_event(), self.time_left)
                    self.metrics['wait_seconds'] += dt
                    self._advance(dt, self.loc)
        if self.time_left <= 1e-9:
            self._finish_cycle()
        else:
            self._maybe_accept_jobs()
        self._step_reward += self.config.shaping * (self._potential() - potential_before)
        return self._observe(), float(self._step_reward), self.done, False, self.summary()

    def _potential(self):
        """Work-in-progress credit; zero at both episode boundaries.

        With gamma=1, shaping telescopes to zero over every episode. Failed or
        abandoned pipeline work cannot inflate the agent's total reward.
        """
        if self.done:
            return 0.0
        units = {}
        for item in self.held:
            units[item.job_id] = units.get(item.job_id, 0) + (1 if item.stage == 'raw' else 2)
        for slot in self.prep_wet + self.prep_dry:
            units[slot.job_id] = units.get(slot.job_id, 0) + (2 if slot.ready else 1)
        for slot in self.meas_slots:
            units[slot.job_id] = units.get(slot.job_id, 0) + 3
        return sum((units.get(j.job_id, 0) + 3*j.done) * j.rep/j.original_samples
                   for j in self.jobs.values() if not j.completed)

    def _lose_rep(self, amount, job, reason):
        actual = min(self.reputation, amount)
        self.reputation -= actual
        self.penalties += actual
        job.penalty_paid += actual
        self._step_reward -= actual
        self._event('penalty', job_id=job.job_id, reason=reason, assessed=amount, paid=actual)

    def _finish_cycle(self):
        if self.done:
            return
        self.time_left = 0.0
        for job in self.jobs.values():
            if job.committed and job.done == 0 and not job.completed and not job.npc_gone:
                self._lose_rep(self.config.commitment_penalty, job, 'unstarted_commitment')
        self.done = True
        self._event('cycle_end', reputation=self.reputation)

    def _finish_job(self, job):
        if job.completed or job.total_samples <= 0 or job.done < job.total_samples:
            return
        fraction = job.done / job.original_samples if self.config.prorate_lost_samples else 1.0
        payout = int(job.rep * fraction + 0.5)
        job.awarded = payout
        self.reputation += payout
        self.rep_earned += payout
        self._step_reward += payout
        job.completed = True
        self._release_slot(job)
        self._event('job_completed', job_id=job.job_id, samples=job.done,
                    original_samples=job.original_samples, reputation=payout)

    def _release_slot(self, job):
        self._npc_slots_used.discard(job.npc_slot)
        job.npc_slot = -1

    def _staff_targets(self):
        targets = []
        for loc, slots in [('wet_prep', self.prep_wet), ('dry_prep', self.prep_dry)]:
            if any(not s.ready for s in slots):
                targets.append(loc)
        for bl in range(4):
            if any(s.bl_idx == bl and s.started and not s.ready for s in self.meas_slots):
                targets.append(f'bl{bl}_ctrl')
        if self.exp_setup_bl >= 0:
            targets.append(f'bl{self.exp_setup_bl}_hutch')
        return targets

    def _advance(self, dt, at_loc):
        end = max(0.0, self.time_left - min(dt, self.time_left))
        while self.time_left > end + 1e-9:
            chunk = min(self.config.quantum, self.time_left-end)
            # Split at global events so stops/offers do not depend on action length.
            boundaries = [self.beam_start, self.beam_end]
            if self.config.rapid_review:
                boundaries.append(self.next_rapid)
            for boundary in boundaries:
                if boundary > self.elapsed + 1e-9:
                    chunk = min(chunk, boundary-self.elapsed)
            blocked = self.beam_start <= self.elapsed < self.beam_end
            targets = self._staff_targets()
            assigned = {pd['target'] for pd in self.postdocs if pd['target'] in targets}
            for pd in self.postdocs:
                if pd['target'] not in targets:
                    pd['target'] = None
                if pd['target'] is None:
                    candidates = [t for t in targets if t not in assigned and (pd['level'] >= 2 or t == at_loc)]
                    if candidates:
                        target = min(candidates, key=lambda t: self.travel_time(pd['loc'], t))
                        pd['target'] = target
                        pd['eta'] = self.travel_time(pd['loc'], target)
                if pd['target']:
                    assigned.add(pd['target'])
            # Staff arriving during this tick begin work on the next tick.
            helpers = {pd['target'] for pd in self.postdocs if pd['target'] and pd['eta'] <= 1e-9}
            near = helpers | ({at_loc} if at_loc else set())
            self.time_left = max(end, self.time_left-chunk)
            if blocked:
                self.metrics['beam_stop_seconds'] += chunk
            for job in list(self.jobs.values()):
                if not job.completed and not job.npc_gone and job.npc_slot >= 0:
                    job.leave_ms -= chunk*1000
                    if job.leave_ms <= 1e-7:
                        self._npc_leaves(job)
            for loc, slots in [('wet_prep', self.prep_wet), ('dry_prep', self.prep_dry)]:
                if loc in near:
                    for ps in slots:
                        if not ps.ready:
                            self.metrics['prep_busy_seconds'] += min(chunk, ps.remaining)
                            ps.remaining = max(0.0, ps.remaining-chunk)
                            ps.ready = ps.remaining <= 1e-9
            for ms in list(self.meas_slots):
                loc = f'bl{ms.bl_idx}_ctrl'
                if loc in near and not blocked and ms.started and not ms.ready:
                    self.metrics['meas_busy_seconds'] += min(chunk, ms.remaining)
                    ms.remaining = max(0.0, ms.remaining-chunk)
                    ms.ready = ms.remaining <= 1e-9
                    if ms.ready and self.time_left > 1e-9 and any(pd['level'] >= 3 and pd['target'] == loc and pd['eta'] <= 1e-9 for pd in self.postdocs):
                        self._collect_result(ms)
            if self.exp_setup_bl >= 0 and f'bl{self.exp_setup_bl}_hutch' in near:
                if any(h.job_id == self.exp_setup_job and h.stage == 'prepped' for h in self.held):
                    self.exp_setup_prog += chunk/self.exp_setup_dur
                    if self.exp_setup_prog >= 1-1e-9:
                        self._complete_exp_setup()
            for pd in self.postdocs:
                if pd['target']:
                    pd['eta'] = max(0.0, pd['eta']-chunk)
                    if pd['eta'] == 0:
                        pd['loc'] = pd['target']
            if self.config.rapid_review and self.elapsed >= self.next_rapid-1e-9:
                self.next_rapid += self.config.rapid_interval
                waiting = sum(not j.completed and not j.expired and j.total_samples > 0 for j in self.jobs.values())
                if waiting < self.config.offer_limit and self.time_left > 1e-9:
                    job = self._new_job(committed=False)
                    job.offer_expires = self.elapsed+self.config.rapid_lifetime
                    self._job_queue.append(job)
                    self._event('rapid_offer', job_id=job.job_id)
            for job in list(self._job_queue):
                if not job.committed and self.elapsed >= job.offer_expires:
                    self._job_queue.remove(job)
                    job.expired = True
            if self.time_left > 1e-9:
                self._maybe_accept_jobs()

    def summary(self):
        return dict(rules_version=RULES_VERSION, config_hash=self.config.fingerprint,
                    reputation=self.reputation, net_reputation=self.reputation-self.starting_reputation,
                    rep_earned=self.rep_earned, penalties=self.penalties,
                    time_left=self.time_left, samples_done=sum(j.done for j in self.jobs.values()),
                    samples_lost=sum(j.lost_samples for j in self.jobs.values()),
                    proposals_completed=sum(j.completed for j in self.jobs.values()),
                    proposals_full=sum(j.completed and j.done == j.original_samples for j in self.jobs.values()),
                    proposals_partial=sum(0 < j.done < j.original_samples for j in self.jobs.values()),
                    proposals_failed=sum(j.committed and j.done == 0 for j in self.jobs.values()),
                    **self.metrics)

    def _time_to_next_event(self) -> float:
        """Shortest time until anything changes at the current location."""
        candidates = [max(self.time_left, 0.01)]

        if self.loc in ("wet_prep", "dry_prep"):
            slots = self.prep_wet if self.loc == "wet_prep" else self.prep_dry
            for ps in slots:
                if not ps.ready:
                    candidates.append(max(ps.remaining, 0.01))

        if self.loc.endswith("_ctrl"):
            bl = int(self.loc[2])
            for ms in self.meas_slots:
                if ms.bl_idx == bl and ms.started and not ms.ready:
                    candidates.append(max(ms.remaining, 0.01))

        if (self.loc.endswith("_hutch") and self.exp_setup_bl >= 0
                and int(self.loc[2]) == self.exp_setup_bl):
            rem = (1.0 - self.exp_setup_prog) * self.exp_setup_dur
            candidates.append(max(rem, 0.01))

        for job in self.jobs.values():
            if not job.completed and not job.npc_gone and job.npc_slot >= 0:
                candidates.append(max(job.leave_ms / 1000.0, 0.01))

        if self.postdocs or self.config.rapid_review:
            candidates.append(self.config.quantum)
        return min(candidates)

    # ── Interactions ──────────────────────────────────────────────────────────

    def _interact_at(self, loc: str):
        if loc in ("wet_prep", "dry_prep"):
            self._interact_prep(loc)
        elif loc.endswith("_hutch"):
            self._interact_hutch(loc)
        elif loc.endswith("_ctrl"):
            self._interact_ctrl(loc)
        elif loc.startswith("npc_"):
            self._interact_npc(loc)

    def _interact_prep(self, loc: str):
        lab   = "wet" if loc == "wet_prep" else "dry"
        slots = self.prep_wet if lab == "wet" else self.prep_dry

        # Pick up any ready prepped samples
        for ps in [s for s in slots if s.ready]:
            if len(self.held) >= MAX_HELD:
                break
            job = self.jobs.get(ps.job_id)
            if job:
                self.held.append(HeldItem(
                    job_id=ps.job_id, stage="prepped",
                    lab_type=lab, bl_idx=job.bl_idx,
                ))
            slots.remove(ps)

        # Deposit raw samples of matching lab type
        for item in [h for h in self.held if h.stage == "raw" and h.lab_type == lab]:
            if len(slots) >= self.prep_cap:
                break
            job = self.jobs.get(item.job_id)
            dur = (job.prep_durs.pop(0) if job and job.prep_durs
                   else self.config.prep_min * self.config.prep_speeds[0 if lab == 'wet' else 1])
            self.held.remove(item)
            slots.append(PrepSlot(job_id=item.job_id, remaining=dur, total=dur))

    def _interact_hutch(self, loc: str):
        bl = int(loc[2])

        # One experiment setup runs at a time (globally)
        if self.exp_setup_bl >= 0:
            return

        # Beamline must have room for another measurement
        running = sum(1 for ms in self.meas_slots if ms.bl_idx == bl)
        if running >= self.meas_cap:
            return

        # Need a prepped item destined for this beamline
        for item in self.held:
            if item.stage == "prepped" and item.bl_idx == bl:
                job = self.jobs.get(item.job_id)
                dur = (job.setup_durs.pop(0) if job and job.setup_durs
                       else self.config.setup_min)
                self.exp_setup_job = item.job_id
                self.exp_setup_bl   = bl
                self.exp_setup_prog = 0.0
                self.exp_setup_dur  = dur
                return

    def _complete_exp_setup(self):
        bl = self.exp_setup_bl
        self.exp_setup_bl   = -1
        self.exp_setup_prog = 0.0

        # Move the matching prepped item into a measurement slot
        for item in list(self.held):
            if item.stage == "prepped" and item.bl_idx == bl and item.job_id == self.exp_setup_job:
                job = self.jobs.get(item.job_id)
                self.exp_setup_job = None
                dur = (job.meas_durs.pop(0) if job and job.meas_durs
                       else self.config.meas_min * self.config.meas_speeds[bl])
                self.held.remove(item)
                self.meas_slots.append(MeasSlot(
                    job_id=item.job_id, bl_idx=bl,
                    remaining=dur, total=dur, started=False,
                ))
                return

    def _interact_ctrl(self, loc: str):
        bl = int(loc[2])

        for ms in [m for m in self.meas_slots if m.bl_idx == bl and m.ready]:
            self._collect_result(ms)

        # Start any deposited-but-not-yet-started measurements
        for ms in self.meas_slots:
            if ms.bl_idx == bl and not ms.started:
                ms.started = True

    def _collect_result(self, ms):
        self.meas_slots.remove(ms)
        job = self.jobs.get(ms.job_id)
        if job and not job.completed:
            job.done += 1
            self._event('sample_completed', job_id=job.job_id)
            self._finish_job(job)

    def _interact_npc(self, loc: str):
        slot = int(loc[4])
        for job in self.jobs.values():
            if job.npc_slot == slot and job.unstarted > 0 and not job.npc_gone:
                if len(self.held) < MAX_HELD:
                    self.held.append(HeldItem(
                        job_id=job.job_id, stage="raw",
                        lab_type=job.lab_type, bl_idx=job.bl_idx,
                    ))
                    job.unstarted -= 1

                break

    # ── NPC departure (game.js:userNpcLeaves) ────────────────────────────────

    def _npc_leaves(self, job):
        if job.npc_gone or job.completed:
            return
        held_lost = sum(h.job_id == job.job_id for h in self.held)
        self.held = [h for h in self.held if h.job_id != job.job_id]
        lost = job.unstarted + held_lost
        job.unstarted = 0
        job.npc_gone = True
        job.lost_samples += lost
        job.total_samples -= lost
        if self.exp_setup_job == job.job_id:
            self.exp_setup_job = None
            self.exp_setup_bl = -1
            self.exp_setup_prog = 0.0
        if lost:
            penalty = max(1, int(lost/job.original_samples*job.rep*self.config.departure_loss_fraction+0.5))
            self._lose_rep(penalty, job, 'npc_departure')
        self._release_slot(job)
        self._event('npc_departed', job_id=job.job_id, samples_lost=lost)
        self._finish_job(job)

    # ── Observation ───────────────────────────────────────────────────────────

    def _observe(self) -> np.ndarray:
        obs: list[float] = []

        # Time remaining (normalised 0–1)
        obs.append(self.time_left / self.config.cycle_seconds)

        # Current location one-hot
        loc_oh = [0.0] * N_LOCS
        if self.loc in LOC_IDX:
            loc_oh[LOC_IDX[self.loc]] = 1.0
        obs.extend(loc_oh)

        # Held items (3 slots × 8 binary features)
        for i in range(MAX_HELD):
            if i < len(self.held):
                h = self.held[i]
                obs += [
                    float(h.stage    == "raw"),
                    float(h.stage    == "prepped"),
                    float(h.lab_type == "wet"),
                    float(h.lab_type == "dry"),
                    float(h.bl_idx   == 0),
                    float(h.bl_idx   == 1),
                    float(h.bl_idx   == 2),
                    float(h.bl_idx   == 3),
                ]
            else:
                obs += [0.0] * 8

        # Prep slots (2 tables × prep_cap × 3 features)
        for slots in (self.prep_wet, self.prep_dry):
            for ci in range(self.prep_cap):
                if ci < len(slots):
                    ps = slots[ci]
                    prog = 1.0 - ps.remaining / ps.total if ps.total > 0 else 1.0
                    obs += [
                        float(not ps.ready),   # processing
                        float(ps.ready),       # ready to pick up
                        min(prog, 1.0),        # 0 = just deposited, 1 = done
                    ]
                else:
                    obs += [0.0, 0.0, 0.0]    # empty slot

        # Measurement slots (4 beamlines × meas_cap × 5 features)
        for bl in range(4):
            bl_ms = [ms for ms in self.meas_slots if ms.bl_idx == bl]
            for ci in range(self.meas_cap):
                if ci < len(bl_ms):
                    ms   = bl_ms[ci]
                    prog = 1.0 - ms.remaining / ms.total if ms.total > 0 else 1.0
                    obs += [
                        0.0,                                           # not empty
                        float(not ms.started),                         # deposited, not started
                        float(ms.started and not ms.ready),            # running
                        float(ms.ready),                               # ready to collect
                        min(prog, 1.0),
                    ]
                else:
                    obs += [1.0, 0.0, 0.0, 0.0, 0.0]                 # empty

        # Experiment setup (6 features)
        obs += [
            float(self.exp_setup_bl >= 0),
            float(self.exp_setup_bl == 0),
            float(self.exp_setup_bl == 1),
            float(self.exp_setup_bl == 2),
            float(self.exp_setup_bl == 3),
            min(self.exp_setup_prog, 1.0),
        ]

        # NPC state (5 slots × 5 features)
        by_slot = {j.npc_slot: j for j in self.jobs.values() if j.npc_slot >= 0}
        for si in range(5):
            if si in by_slot:
                j = by_slot[si]
                obs += [
                    1.0,
                    j.unstarted / max(1, j.total_samples),
                    max(0.0, j.leave_ms / max(1.0, j.leave_ms_total)),  # 1=fresh, 0=leaving
                    float(j.lab_type == "wet"),
                    float(j.lab_type == "dry"),
                ]
            else:
                obs += [0.0, 0.0, 0.0, 0.0, 0.0]

        if not self.legacy_observation:
            for si in range(5):
                j = by_slot.get(si)
                obs.extend(([j.rep/100, j.original_samples/10, j.done/max(1,j.original_samples)]
                            + [float(j.bl_idx == b) for b in range(4)]
                            + [j.leave_ms/1000/self.config.cycle_seconds]) if j else [0.0]*8)
            obs.extend([len(self._job_queue)/10, self.config.ring_stability/100,
                        float(self.beam_start <= self.elapsed < self.beam_end),
                        len(self.postdocs)/max(1,self.config.max_postdocs),
                        self.config.prep_speeds[0], self.config.prep_speeds[1],
                        self.reputation/1000, self.config.year/20])
        return np.clip(np.array(obs, dtype=np.float32), 0.0, 1.0)

    # ── Heuristic baseline (inspired by the JS bot's priority queue) ─────────────

    def heuristic_action(self) -> int:
        """
        Rule-based routing inspired by bot.js; admission and staff are modeled separately.
        Use this as a baseline to evaluate whether RL has improved.
        """
        # 1. Held exp_setup_done → already handled (no separate stage here;
        #    setup completes automatically and item moves to meas_slots)

        # 2. Collect ready measurement results
        for bl in range(4):
            if any(ms.bl_idx == bl and ms.ready for ms in self.meas_slots):
                return LOC_IDX[f"bl{bl}_ctrl"]

        # 3. Stay at ctrl room while measurement running (proximity gate)
        for bl in range(4):
            if any(ms.bl_idx == bl and ms.started and not ms.ready
                   for ms in self.meas_slots):
                ctrl = f"bl{bl}_ctrl"
                if self.loc == ctrl:
                    return ACTION_WAIT
                return LOC_IDX[ctrl]

        # 4. Start deposited (not-started) measurement
        for bl in range(4):
            if any(ms.bl_idx == bl and not ms.started for ms in self.meas_slots):
                return LOC_IDX[f"bl{bl}_ctrl"]

        # 5. Stay at hutch while exp setup in progress
        if self.exp_setup_bl >= 0:
            hutch = f"bl{self.exp_setup_bl}_hutch"
            if self.loc == hutch:
                return ACTION_WAIT
            return LOC_IDX[hutch]

        # 6. Trigger exp setup (holding prepped item, beamline free)
        for item in self.held:
            if item.stage == "prepped":
                bl = item.bl_idx
                occupied = sum(1 for ms in self.meas_slots if ms.bl_idx == bl)
                if occupied < self.meas_cap:
                    return LOC_IDX[f"bl{bl}_hutch"]
                # beamline occupied — fall through

        # 7. Pick up finished prep
        for slots, loc in ((self.prep_wet, "wet_prep"), (self.prep_dry, "dry_prep")):
            if any(ps.ready for ps in slots) and len(self.held) < MAX_HELD:
                return LOC_IDX[loc]

        # 8. Deposit raw sample (prefer table that has capacity)
        raw_items = [h for h in self.held if h.stage == "raw"]
        if raw_items:
            for item in raw_items:
                tbl = "wet_prep" if item.lab_type == "wet" else "dry_prep"
                slots = self.prep_wet if item.lab_type == "wet" else self.prep_dry
                if len(slots) < self.prep_cap:
                    return LOC_IDX[tbl]
            # All tables full — wait at first table
            item = raw_items[0]
            tbl = "wet_prep" if item.lab_type == "wet" else "dry_prep"
            if self.loc == tbl:
                return ACTION_WAIT
            return LOC_IDX[tbl]

        # 9. Collect from NPC — batch by lab type, urgency overrides
        if len(self.held) < MAX_HELD:
            candidates = [
                j for j in self.jobs.values()
                if j.unstarted > 0 and not j.npc_gone and j.npc_slot >= 0
            ]
            if candidates:
                held_raw = [h for h in self.held if h.stage == "raw"]
                dominant = None
                if held_raw:
                    wet = sum(1 for h in held_raw if h.lab_type == "wet")
                    dominant = "wet" if wet >= len(held_raw) - wet else "dry"
                URGENT_S = 20.0
                def _score(j: Job) -> float:
                    urgent  = j.leave_ms / 1000.0 < URGENT_S
                    matched = dominant is not None and j.lab_type == dominant
                    return (-float(urgent), -float(matched), j.leave_ms)
                best = min(candidates, key=_score)
                return LOC_IDX[f"npc_{best.npc_slot}"]

        return ACTION_WAIT
