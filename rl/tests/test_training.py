import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@unittest.skipUnless(importlib.util.find_spec('stable_baselines3'), 'Optional ML dependencies not installed')
class TrainingTests(unittest.TestCase):
    def test_train_reload_both_checkpoints_and_paired_eval(self):
        from balance_config import BalanceConfig
        from train import train, SavedPolicy, evaluate
        config = BalanceConfig(cycle_seconds=15, n_jobs=1, rapid_review=False, beam_stops=False)
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            train(config, directory, total_timesteps=32, n_envs=1, n_steps=16,
                  bc_episodes=1, bc_epochs=1, eval_episodes=1)
            manifest = json.loads((Path(directory)/'manifest.json').read_text())
            self.assertEqual(manifest['config_hash'], config.fingerprint)
            for checkpoint in ('best','final'):
                policy = SavedPolicy(directory,config,checkpoint)
                policy.close()
                files = manifest['checkpoints'][checkpoint]
                self.assertTrue((Path(directory)/files['model']).exists())
                self.assertTrue((Path(directory)/files['stats']).exists())
            report = evaluate(directory,config,[101,102])
            self.assertEqual(report['paired_net_rep_difference']['n'],2)
            with self.assertRaises(ValueError):
                SavedPolicy(directory,config.changed(year=2))
            with self.assertRaises(ValueError):
                SavedPolicy(directory,config.changed(prep_cap=2),allow_config_change=True)
            with self.assertRaises(ValueError):
                train(config,directory,total_timesteps=32)

    def test_evaluation_reward_excludes_shaping(self):
        from train import GameScoreReward
        from facility_env import FacilityEnv, LOC_IDX
        from balance_config import BalanceConfig
        env = GameScoreReward(FacilityEnv(config=BalanceConfig(n_jobs=1,rapid_review=False,beam_stops=False)))
        env.reset(seed=2)
        job = next(iter(env.unwrapped.jobs.values()))
        _,reward,_,_,info=env.step(LOC_IDX[f'npc_{job.npc_slot}'])
        self.assertEqual(reward,info['reputation'])
        self.assertGreater(env.unwrapped._step_reward,reward)


if __name__ == '__main__':
    unittest.main()
