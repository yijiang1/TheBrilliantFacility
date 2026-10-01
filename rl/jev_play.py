"""Play seeded facility cycles with TypeSafe AI's Jev decision model.

Jev receives semantic game state rather than the environment's dense numeric
observation.  The policy caches WAIT decisions until a discrete game event
occurs, avoiding API calls for the simulator's 100 ms progress ticks.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

if __package__:
    from .balance_config import BalanceConfig
    from .experiments import paired_difference, run_cycle, summarize, write_report
    from .facility_env import ACTION_WAIT, LOCS, FacilityEnv
else:
    from balance_config import BalanceConfig
    from experiments import paired_difference, run_cycle, summarize, write_report
    from facility_env import ACTION_WAIT, LOCS, FacilityEnv


API_URL = "https://api.typesafe.ai/v1/systemone"

ACTION_CRITERIA = {
    "wet_prep": "Go to the wet preparation table; deposit raw wet samples, collect ready wet samples, or stay nearby while wet preparation runs.",
    "dry_prep": "Go to the dry preparation table; deposit raw dry samples, collect ready dry samples, or stay nearby while dry preparation runs.",
    **{
        f"bl{index}_hutch": f"Go to beamline {index + 1}'s hutch to set up a prepped sample."
        for index in range(4)
    },
    **{
        f"bl{index}_ctrl": f"Go to beamline {index + 1}'s control room to start or supervise a measurement, or collect a ready result."
        for index in range(4)
    },
    **{
        f"npc_{index}": f"Go to visitor position {index + 1} to collect a raw sample before its owner leaves."
        for index in range(5)
    },
    "wait": "Remain at the current location until the next meaningful event. Use when nearby work is actively progressing or no trip is useful.",
}

QUESTION = {
    "type": "choice",
    "instructions": (
        "Choose the single best immediate action for the facility director. "
        "Maximize completed-proposal reputation, avoid losing samples or missing "
        "visitor deadlines, minimize wasted travel, and respect inventory and station capacity. "
        "Preparation, experiment setup, and measurement progress only while the director "
        "is at the relevant station. Make a reactive next-step decision, not a long plan."
    ),
    "criteria": ACTION_CRITERIA,
}


class JevAPIError(RuntimeError):
    """A Jev request failed or returned an unusable response."""


@dataclass
class JevStats:
    calls: int = 0
    cached_actions: int = 0
    low_confidence_fallbacks: int = 0
    error_fallbacks: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    latency_seconds: float = 0.0


class JevClient:
    def __init__(self, api_key, model="jev-latest", timeout=10.0, opener=urlopen):
        if not api_key:
            raise ValueError("Set TYPESAFE_API_KEY before running Jev")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.opener = opener

    def choose(self, state):
        payload = json.dumps({
            "state": state,
            "model": self.model,
            "questions": {"next_action": QUESTION},
        }, separators=(",", ":")).encode()
        request = Request(
            API_URL,
            data=payload,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "TheBrilliantFacility-Jev/1",
            },
            method="POST",
        )
        try:
            with self.opener(request, timeout=self.timeout) as response:
                result = json.loads(response.read())
        except HTTPError as exc:
            detail = exc.read(500).decode(errors="replace")
            raise JevAPIError(f"Jev HTTP {exc.code}: {detail}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise JevAPIError(f"Jev request failed: {exc}") from exc
        try:
            answer = result["answers"]["next_action"]
            choice = answer["choice"]
            confidence = float(answer["confidence"])
            probabilities = answer["probabilities"]
            if choice not in ACTION_CRITERIA or set(probabilities) != set(ACTION_CRITERIA):
                raise KeyError("invalid action set")
            usage = result.get("usage", {})
            return choice, confidence, probabilities, {
                "input_tokens": int(usage.get("input_tokens", 0)),
                "output_tokens": int(usage.get("output_tokens", 0)),
                "model": result.get("model", self.model),
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise JevAPIError("Jev returned an invalid next_action answer") from exc


def _round(value, digits=3):
    return round(float(value), digits)


def semantic_state(env):
    """Return a compact, readable snapshot containing all decision-relevant state."""
    elapsed = env.elapsed
    beam_stopped = env.beam_start <= elapsed < env.beam_end
    jobs = []
    for job in sorted(env.jobs.values(), key=lambda item: item.job_id):
        in_flight = sum(item.job_id == job.job_id for item in env.held)
        in_flight += sum(slot.job_id == job.job_id for slot in env.prep_wet + env.prep_dry)
        in_flight += sum(slot.job_id == job.job_id for slot in env.meas_slots)
        jobs.append({
            "id": job.job_id,
            "name": job.name,
            "committed": job.committed,
            "lab": job.lab_type,
            "beamline": job.bl_idx + 1,
            "reputation": job.rep,
            "samples": {
                "total": job.original_samples,
                "done": job.done,
                "uncollected": job.unstarted,
                "in_flight": in_flight,
                "lost": job.lost_samples,
            },
            "visitor_position": job.npc_slot + 1 if job.npc_slot >= 0 else None,
            "visitor_seconds_left": _round(job.leave_ms / 1000, 1) if job.npc_slot >= 0 else None,
            "offer_seconds_left": _round(job.offer_expires - elapsed, 1)
            if not job.committed and job in env._job_queue else None,
            "completed": job.completed,
        })
    return {
        "game": "The Brilliant Facility",
        "objective": "Finish all samples in proposals to earn reputation before the cycle ends.",
        "rules": {
            "inventory_capacity": 3,
            "pipeline": "visitor -> matching prep table -> assigned beamline hutch -> assigned control room -> collect result",
            "proximity_gated": True,
        },
        "cycle": {
            "seconds_left": _round(env.time_left, 1),
            "current_location": env.loc,
            "reputation": env.reputation,
            "beam_stopped": beam_stopped,
        },
        "held": [
            {"job_id": item.job_id, "stage": item.stage, "lab": item.lab_type, "beamline": item.bl_idx + 1}
            for item in env.held
        ],
        "prep": {
            "wet": [
                {"job_id": slot.job_id, "ready": slot.ready, "seconds_left": _round(slot.remaining, 1)}
                for slot in env.prep_wet
            ],
            "dry": [
                {"job_id": slot.job_id, "ready": slot.ready, "seconds_left": _round(slot.remaining, 1)}
                for slot in env.prep_dry
            ],
            "capacity_per_table": env.prep_cap,
        },
        "experiment_setup": {
            "active": env.exp_setup_bl >= 0,
            "beamline": env.exp_setup_bl + 1 if env.exp_setup_bl >= 0 else None,
            "job_id": env.exp_setup_job,
            "progress": _round(env.exp_setup_prog),
        },
        "measurements": [
            {
                "job_id": slot.job_id,
                "beamline": slot.bl_idx + 1,
                "started": slot.started,
                "ready": slot.ready,
                "seconds_left": _round(slot.remaining, 1),
            }
            for slot in env.meas_slots
        ],
        "measurement_capacity_per_beamline": env.meas_cap,
        "jobs": jobs,
        "queued_proposals": len(env._job_queue),
        "postdocs": [dict(worker) for worker in env.postdocs],
    }


def decision_signature(env):
    """Discrete events that should invalidate a cached WAIT decision."""
    def urgency(job):
        if job.npc_slot < 0:
            return None
        seconds = job.leave_ms / 1000
        return 0 if seconds <= 10 else 1 if seconds <= 20 else 2

    return (
        env.loc,
        tuple((item.job_id, item.stage) for item in env.held),
        tuple((slot.job_id, slot.ready) for slot in env.prep_wet + env.prep_dry),
        tuple((slot.job_id, slot.bl_idx, slot.started, slot.ready) for slot in env.meas_slots),
        (env.exp_setup_job, env.exp_setup_bl >= 0),
        tuple((job.job_id, job.done, job.unstarted, job.npc_slot, urgency(job), job.completed)
              for job in sorted(env.jobs.values(), key=lambda item: item.job_id)),
        env.beam_start <= env.elapsed < env.beam_end,
        len(env._job_queue),
    )


class JevPolicy:
    def __init__(self, env, client, min_confidence=0.15, strict=False):
        self.env = env
        self.client = client
        self.min_confidence = min_confidence
        self.strict = strict
        self.stats = JevStats()
        self._cached_wait_signature = None

    def action(self):
        signature = decision_signature(self.env)
        if signature == self._cached_wait_signature:
            self.stats.cached_actions += 1
            return ACTION_WAIT
        started = time.monotonic()
        try:
            choice, confidence, _probabilities, usage = self.client.choose(semantic_state(self.env))
            self.stats.calls += 1
            self.stats.latency_seconds += time.monotonic() - started
            self.stats.input_tokens += usage["input_tokens"]
            self.stats.output_tokens += usage["output_tokens"]
            if confidence < self.min_confidence:
                self.stats.low_confidence_fallbacks += 1
                fallback = self.env.heuristic_action()
                choice = LOCS[fallback] if fallback != ACTION_WAIT else "wait"
        except JevAPIError:
            self.stats.calls += 1
            self.stats.latency_seconds += time.monotonic() - started
            self.stats.error_fallbacks += 1
            if self.strict:
                raise
            fallback = self.env.heuristic_action()
            choice = LOCS[fallback] if fallback != ACTION_WAIT else "wait"
        if choice == "wait":
            self._cached_wait_signature = signature
            return ACTION_WAIT
        self._cached_wait_signature = None
        return LOCS.index(choice)


def run_jev_cycle(config, seed, client, min_confidence=0.15, strict=False):
    env = FacilityEnv(config=config, record_events=False)
    _observation, _info = env.reset(seed=seed)
    policy = JevPolicy(env, client, min_confidence=min_confidence, strict=strict)
    reward_total = 0.0
    for step in range(100000):
        _observation, reward, done, truncated, info = env.step(policy.action())
        reward_total += reward
        if done or truncated:
            row = dict(seed=int(seed), steps=step + 1, training_reward=reward_total, **info,
                       jev=asdict(policy.stats))
            env.close()
            return row
    env.close()
    raise RuntimeError(f"Jev simulation exceeded 100000 actions (seed={seed})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config")
    parser.add_argument("--episodes", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--model", default="jev-latest")
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--min-confidence", type=float, default=0.15)
    parser.add_argument("--strict", action="store_true", help="Stop instead of using the heuristic after API errors")
    parser.add_argument("--report", default="rl/reports/jev_evaluation.json")
    args = parser.parse_args()
    if args.episodes < 1 or args.timeout <= 0 or not 0 <= args.min_confidence <= 1:
        parser.error("episodes and timeout must be positive; confidence must be between 0 and 1")
    api_key = os.environ.get("TYPESAFE_API_KEY")
    if not api_key:
        parser.error("TYPESAFE_API_KEY is not set")
    config = BalanceConfig.load(args.config)
    client = JevClient(api_key, model=args.model, timeout=args.timeout)
    seeds = list(range(args.seed, args.seed + args.episodes))
    baseline_rows = [run_cycle(config, seed) for seed in seeds]
    jev_rows = [run_jev_cycle(config, seed, client, args.min_confidence, args.strict) for seed in seeds]
    baseline = dict(config=config.to_dict(), config_hash=config.fingerprint,
                    summary=summarize(baseline_rows), episodes=baseline_rows)
    candidate = dict(config=config.to_dict(), config_hash=config.fingerprint,
                     summary=summarize(jev_rows), episodes=jev_rows)
    report = {
        "command": "jev-evaluate",
        "model": args.model,
        "variants": {"heuristic": baseline, "jev": candidate},
        "paired_net_rep_difference": paired_difference(baseline, candidate),
    }
    path = write_report(args.report, report)
    print(json.dumps({
        "report": str(Path(path).resolve()),
        "paired_net_rep_difference": report["paired_net_rep_difference"],
        "jev_calls": sum(row["jev"]["calls"] for row in jev_rows),
        "jev_input_tokens": sum(row["jev"]["input_tokens"] for row in jev_rows),
        "jev_latency_seconds": sum(row["jev"]["latency_seconds"] for row in jev_rows),
    }, indent=2))


if __name__ == "__main__":
    main()
