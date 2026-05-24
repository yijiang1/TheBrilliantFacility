"""
facility_env.py — Gymnasium environment for The Brilliant Facility

Simulates the core game loop for RL training without Phaser or a browser.

Pipeline per sample:
    collect raw from NPC  →  prep table (proximity-gated timer)
    →  experiment setup at hutch  →  measurement ctrl room (proximity-gated)
    →  collect result  →  reputation earned

Key simplifications vs the web game
    Movement   : discrete named locations + precomputed travel-time matrix
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
from typing import Optional

import numpy as np
import gymnasium as gym
from gymnasium import spaces

# ── Constants (data.js) ──────────────────────────────────────────────────────

CYCLE_SEC      = 180.0
MAX_HELD       = 3
MAX_JOB_SLOTS  = 5       # base; upgrades can increase

DUR_PREP_MIN   = 1.0     # seconds
DUR_PREP_MAX   = 2.0
DUR_SETUP_MIN  = 1.0
DUR_SETUP_MAX  = 2.0
DUR_MEAS_MIN   = 2.0
DUR_MEAS_MAX   = 10.0

# leave_ms_total = sum(per-sample processing times) × this overhead factor
NPC_OVERHEAD   = 2.5

# rep loss on NPC departure: max(1, round(lost/total × rep × 0.5))
NPC_LEAVE_FACTOR = 0.5

# ── Facility geometry (game.js) ───────────────────────────────────────────────

SPD      = 172.0    # player movement speed, px/s
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

# seconds to enter/exit a beamline room from the corridor
ROOM_TRANSIT = 2.5
# seconds to move between hutch and ctrl within the same beamline room
INTRA_ROOM   = 2.5


def _build_travel_matrix() -> np.ndarray:
    """Precompute travel time (seconds) between every pair of locations."""
    T = np.zeros((N_LOCS, N_LOCS), dtype=np.float32)
    for i, a in enumerate(LOCS):
        for j, b in enumerate(LOCS):
            if i == j:
                continue
            if PEER.get(a) == b:          # same beamline room
                T[i, j] = INTRA_ROOM
                continue
            # Normalise to [0, 2π) before taking the shorter arc,
            # so mixed positive/negative angle pairs don't go out of range.
            ang_diff = (LOC_ANGLE[a] - LOC_ANGLE[b]) % (2 * math.pi)
            arc_dist = min(ang_diff, 2 * math.pi - ang_diff) * CORR_R
            T[i, j] = (arc_dist / SPD
                       + (ROOM_TRANSIT if IN_BL_ROOM[a] else 0.0)
                       + (ROOM_TRANSIT if IN_BL_ROOM[b] else 0.0))
    return T


TRAVEL_TIME = _build_travel_matrix()   # shape (15, 15)

# ── Application catalogue (data.js) ──────────────────────────────────────────
#   (name, min_samples, max_samples, base_rep, lab_type)

APPS: list[tuple] = [
    ("Mineral ID",         1, 2, 12, "dry"),
    ("Steel Alloy",        1, 2, 16, "dry"),
    ("Crystal Structure",  1, 3, 20, "wet"),
    ("Pigment Analysis",   1, 2, 10, "wet"),
    ("Catalyst Study",     2, 3, 14, "dry"),
    ("Protein Fragment",   2, 3, 17, "wet"),
    ("Environmental",      1, 3, 11, "dry"),
    ("Pharmaceutical",     2, 4, 20, "wet"),
    ("Battery Electrode",  2, 3, 15, "dry"),
    ("Drug Target",        2, 4, 16, "wet"),
    ("Geological Core",    3, 5, 20, "dry"),
    ("Archaeological",     1, 3, 13, "wet"),
    ("Semiconductor",      2, 4, 17, "dry"),
    ("Nanocomposite",      2, 4, 18, "wet"),
    ("Virus Particle",     3, 5, 18, "wet"),
    ("Quantum Material",   2, 4, 16, "dry"),
    ("Operando Battery",   2, 4, 15, "dry"),
    ("Neural Tissue",      3, 5, 17, "wet"),
    ("Ultrafast Dynamics", 2, 3, 20, "wet"),
    ("Nano-device",        2, 4, 16, "dry"),
]

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

    def __post_init__(self):
        if self.unstarted == 0:
            self.unstarted = self.total_samples


# ── Gymnasium environment ─────────────────────────────────────────────────────

class FacilityEnv(gym.Env):
    """
    One episode = one 180-second game cycle.

    Observation  flat float32 vector (see _obs_dim for breakdown).
    Action       Discrete(16): navigate to one of 15 locations, or WAIT.
    Reward       reputation earned per sample minus reputation lost on NPC departure.
                 Awarded per-sample (rep/total_samples each) so the signal is
                 dense enough for PPO to learn from without shaped bonuses.
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        n_jobs:          int   = 4,    # committed proposals per cycle
        prep_cap:        int   = 1,    # slots per prep table (upgradeable)
        meas_cap:        int   = 1,    # meas slots per beamline (upgradeable)
        prep_speed:      float = 1.0,  # timer multiplier (<1.0 = faster)
        meas_speed:      float = 1.0,
        max_npc_waiting: int   = 2,    # NPC arrival throttle
    ):
        super().__init__()
        self.n_jobs          = n_jobs
        self.prep_cap        = prep_cap
        self.meas_cap        = meas_cap
        self.prep_speed      = prep_speed
        self.meas_speed      = meas_speed
        self.max_npc_waiting = max_npc_waiting

        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(self._obs_dim(),), dtype=np.float32
        )
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
                + 6 + 5 * 5)

    # ── Reset ─────────────────────────────────────────────────────────────────

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        self._init_state()
        self._maybe_accept_jobs()
        return self._observe(), {}

    def _init_state(self):
        self.time_left       = CYCLE_SEC
        self.loc             = "wet_prep"
        self.held:      list[HeldItem]  = []
        self.prep_wet:  list[PrepSlot]  = []
        self.prep_dry:  list[PrepSlot]  = []
        self.meas_slots: list[MeasSlot] = []
        self.exp_setup_bl   = -1     # beamline index while setup in progress, else -1
        self.exp_setup_prog = 0.0
        self.exp_setup_dur  = 1.0
        self.reputation     = 0
        self._step_reward   = 0.0
        self.done           = False
        self._job_queue:    list[Job] = []
        self.jobs:          dict[int, Job] = {}
        self._next_jid      = 0
        self._npc_slots_used: set[int] = set()
        self._generate_jobs()

    def _generate_jobs(self):
        for _ in range(self.n_jobs):
            row = APPS[int(self.rng.integers(len(APPS)))]
            name, lo, hi, base_rep, lab = row
            n = int(self.rng.integers(lo, hi + 1))
            rep = int(base_rep + (n - 1) * 8 + self.rng.integers(-3, 4))
            bl = int(self.rng.integers(4))
            jid = self._next_jid; self._next_jid += 1
            job = Job(job_id=jid, name=name, lab_type=lab,
                      bl_idx=bl, total_samples=n, rep=rep)
            self._roll_durations(job)
            self._job_queue.append(job)

    def _roll_durations(self, job: Job):
        """Pre-roll per-sample timings and derive the NPC leave budget (game.js:_rollJobDurations)."""
        total_sec = 0.0
        for _ in range(job.total_samples):
            prep  = float(self.rng.uniform(DUR_PREP_MIN,  DUR_PREP_MAX))  * self.prep_speed
            setup = float(self.rng.uniform(DUR_SETUP_MIN, DUR_SETUP_MAX))
            meas  = float(self.rng.uniform(DUR_MEAS_MIN,  DUR_MEAS_MAX))  * self.meas_speed
            job.prep_durs.append(prep)
            job.setup_durs.append(setup)
            job.meas_durs.append(meas)
            total_sec += prep + setup + meas
        leave_sec = total_sec * NPC_OVERHEAD
        job.leave_ms = job.leave_ms_total = leave_sec * 1000.0

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
            slot = int(self.rng.choice(free))
            job.npc_slot = slot
            self._npc_slots_used.add(slot)
            self.jobs[job.job_id] = job

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

    def step(self, action: int):
        if self.done:
            return self._observe(), 0.0, True, False, {}

        self._step_reward = 0.0

        if action == ACTION_WAIT or action >= N_LOCS:
            dt = min(self._time_to_next_event(), self.time_left)
            self._advance(dt, at_loc=self.loc)
        else:
            dest   = LOCS[action]
            travel = float(TRAVEL_TIME[LOC_IDX[self.loc]][action])
            if travel <= 0:
                # Already at dest — interact first (free, matches old behaviour for
                # productive actions like collecting a ready measurement).  Only
                # advance time when the interaction was a no-op, so an agent that
                # repeatedly issues "go to current location" with nothing to do
                # cannot spin forever without consuming sim time.
                snap = self._state_snapshot()
                self._interact_at(dest)
                if not self._state_changed(snap):
                    dt = min(self._time_to_next_event(), self.time_left)
                    self._advance(dt, at_loc=self.loc)
            else:
                travel = min(travel, self.time_left)
                self._advance(travel, at_loc=None)   # no proximity gating in transit
                self.loc = dest
                self._interact_at(dest)

        self._maybe_accept_jobs()

        if self.time_left <= 0:
            self.done = True

        return self._observe(), float(self._step_reward), self.done, False, {
            "reputation":   self.reputation,
            "time_left":    self.time_left,
            "samples_done": sum(j.done for j in self.jobs.values()),
        }

    # ── Time advance ──────────────────────────────────────────────────────────

    def _advance(self, dt: float, at_loc: Optional[str]):
        """
        Advance all timers by dt seconds.
        at_loc enables proximity gating for prep/meas/setup timers.
        NPC leave timers always tick regardless of player position.
        """
        if dt <= 0:
            return
        dt = min(dt, self.time_left)
        self.time_left -= dt

        # NPC leave timers — always decrement
        for job in list(self.jobs.values()):
            if job.unstarted > 0 and not job.npc_gone and job.npc_slot >= 0:
                job.leave_ms -= dt * 1000.0
                if job.leave_ms <= 0:
                    self._npc_leaves(job)

        # Prep timers — only when player is at the matching prep station
        if at_loc in ("wet_prep", "dry_prep"):
            slots = self.prep_wet if at_loc == "wet_prep" else self.prep_dry
            for ps in slots:
                if not ps.ready:
                    ps.remaining -= dt
                    if ps.remaining <= 0:
                        ps.ready = True

        # Measurement timers — only when player is at the matching ctrl room
        if at_loc is not None and at_loc.endswith("_ctrl"):
            bl = int(at_loc[2])
            for ms in self.meas_slots:
                if ms.bl_idx == bl and ms.started and not ms.ready:
                    ms.remaining -= dt
                    if ms.remaining <= 0:
                        ms.ready = True

        # Experiment setup — only at the matching hutch while holding a prepped item
        if (at_loc is not None and at_loc.endswith("_hutch")
                and self.exp_setup_bl >= 0 and int(at_loc[2]) == self.exp_setup_bl):
            if any(h.stage == "prepped" for h in self.held):
                self.exp_setup_prog += dt / self.exp_setup_dur
                if self.exp_setup_prog >= 1.0:
                    self._complete_exp_setup()

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
            if job.unstarted > 0 and not job.npc_gone and job.npc_slot >= 0:
                candidates.append(max(job.leave_ms / 1000.0, 0.01))

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
                # Shaping: reward for advancing the pipeline (prep → hutch stage)
                self._step_reward += 0.2 * job.rep / max(1, job.total_samples)
            slots.remove(ps)

        # Deposit raw samples of matching lab type
        for item in [h for h in self.held if h.stage == "raw" and h.lab_type == lab]:
            if len(slots) >= self.prep_cap:
                break
            job = self.jobs.get(item.job_id)
            dur = (job.prep_durs.pop(0) if job and job.prep_durs
                   else float(self.rng.uniform(DUR_PREP_MIN, DUR_PREP_MAX)) * self.prep_speed)
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
                       else float(self.rng.uniform(DUR_SETUP_MIN, DUR_SETUP_MAX)))
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
            if item.stage == "prepped" and item.bl_idx == bl:
                job = self.jobs.get(item.job_id)
                dur = (job.meas_durs.pop(0) if job and job.meas_durs
                       else float(self.rng.uniform(DUR_MEAS_MIN, DUR_MEAS_MAX)) * self.meas_speed)
                self.held.remove(item)
                self.meas_slots.append(MeasSlot(
                    job_id=item.job_id, bl_idx=bl,
                    remaining=dur, total=dur, started=False,
                ))
                # Shaping: reward for completing exp setup
                if job:
                    self._step_reward += 0.2 * job.rep / max(1, job.total_samples)
                return

    def _interact_ctrl(self, loc: str):
        bl = int(loc[2])

        # Collect completed measurements
        for ms in [m for m in self.meas_slots if m.bl_idx == bl and m.ready]:
            self.meas_slots.remove(ms)
            job = self.jobs.get(ms.job_id)
            if job and not job.completed:
                job.done += 1
                # Per-sample reward so PPO gets a dense signal
                sample_rep = job.rep / job.total_samples
                self._step_reward += sample_rep
                self.reputation   += int(sample_rep)
                if job.done >= job.total_samples:
                    job.completed = True

        # Start any deposited-but-not-yet-started measurements
        for ms in self.meas_slots:
            if ms.bl_idx == bl and not ms.started:
                ms.started = True

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
                    # Shaping: reward for starting the pipeline (NPC → prep stage)
                    self._step_reward += 0.2 * job.rep / max(1, job.total_samples)
                    if job.unstarted == 0:
                        # NPC has given all samples — free the slot
                        self._npc_slots_used.discard(slot)
                break

    # ── NPC departure (game.js:userNpcLeaves) ────────────────────────────────

    def _npc_leaves(self, job: Job):
        lost        = job.unstarted
        original    = job.total_samples
        job.unstarted = 0
        job.npc_gone  = True

        held_lost = sum(1 for h in self.held if h.job_id == job.job_id)
        self.held = [h for h in self.held if h.job_id != job.job_id]

        total_lost = lost + held_lost
        job.total_samples = original - total_lost

        if total_lost > 0 and original > 0:
            penalty = max(1, round(total_lost / original * job.rep * NPC_LEAVE_FACTOR))
            penalty = min(penalty, self.reputation)
            self._step_reward -= penalty
            self.reputation   -= penalty

        self._npc_slots_used.discard(job.npc_slot)
        job.npc_slot = -1

    # ── Observation ───────────────────────────────────────────────────────────

    def _observe(self) -> np.ndarray:
        obs: list[float] = []

        # Time remaining (normalised 0–1)
        obs.append(self.time_left / CYCLE_SEC)

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

        return np.clip(np.array(obs, dtype=np.float32), 0.0, 1.0)

    # ── Heuristic baseline (mirrors the JS bot's priority queue) ─────────────

    def heuristic_action(self) -> int:
        """
        Rule-based action matching bot.js _decide priority order.
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
