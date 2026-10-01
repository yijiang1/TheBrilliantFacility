import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from balance_config import BalanceConfig
from facility_env import ACTION_WAIT, FacilityEnv
from jev_play import ACTION_CRITERIA, JevClient, JevPolicy, semantic_state


class FakeResponse:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class JevPlayTests(unittest.TestCase):
    def env(self):
        env = FacilityEnv(config=BalanceConfig(n_jobs=1, rapid_review=False, beam_stops=False))
        env.reset(seed=4)
        return env

    def test_client_sends_choice_and_parses_answer(self):
        captured = {}

        def opener(request, timeout):
            captured["payload"] = json.loads(request.data)
            captured["timeout"] = timeout
            probabilities = {name: 0.0 for name in ACTION_CRITERIA}
            probabilities["npc_1"] = 1.0
            return FakeResponse({
                "model": "jev-test",
                "answers": {"next_action": {
                    "type": "choice", "choice": "npc_1", "confidence": 1.0,
                    "probabilities": probabilities,
                }},
                "usage": {"input_tokens": 123, "output_tokens": 45},
            })

        client = JevClient("secret", timeout=3, opener=opener)
        choice, confidence, _, usage = client.choose({"cycle": {"seconds_left": 10}})
        self.assertEqual((choice, confidence), ("npc_1", 1.0))
        self.assertEqual(usage["input_tokens"], 123)
        self.assertEqual(captured["timeout"], 3)
        self.assertEqual(captured["payload"]["questions"]["next_action"]["type"], "choice")
        self.assertNotIn("secret", json.dumps(captured["payload"]))

    def test_semantic_state_has_pipeline_and_conserves_samples(self):
        env = self.env()
        state = semantic_state(env)
        self.assertEqual(state["cycle"]["current_location"], env.loc)
        self.assertEqual(state["rules"]["inventory_capacity"], 3)
        for job in state["jobs"]:
            samples = job["samples"]
            self.assertEqual(samples["total"], sum(samples[key] for key in ("done", "uncollected", "in_flight", "lost")))

    def test_wait_is_cached(self):
        env = self.env()

        class Client:
            calls = 0

            def choose(self, _state):
                self.calls += 1
                probabilities = {name: 0.0 for name in ACTION_CRITERIA}
                probabilities["wait"] = 1.0
                return "wait", 1.0, probabilities, {"input_tokens": 1, "output_tokens": 1}

        client = Client()
        policy = JevPolicy(env, client)
        self.assertEqual(policy.action(), ACTION_WAIT)
        self.assertEqual(policy.action(), ACTION_WAIT)
        self.assertEqual(client.calls, 1)
        self.assertEqual(policy.stats.cached_actions, 1)

    def test_low_confidence_uses_heuristic(self):
        env = self.env()

        class Client:
            def choose(self, _state):
                probabilities = {name: 0.0 for name in ACTION_CRITERIA}
                probabilities["wait"] = 1.0
                return "wait", 0.01, probabilities, {"input_tokens": 1, "output_tokens": 1}

        expected = env.heuristic_action()
        policy = JevPolicy(env, Client(), min_confidence=0.15)
        self.assertEqual(policy.action(), expected)
        self.assertEqual(policy.stats.low_confidence_fallbacks, 1)


if __name__ == "__main__":
    unittest.main()
