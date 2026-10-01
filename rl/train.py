"""Train PPO on versioned balance rules; select checkpoints by actual game score.

New runs never overwrite the legacy models/ directory. Each checkpoint includes
its own normalization statistics and a manifest. Evaluation uses identical seeds.
"""
import argparse
import json
from importlib.metadata import version
from pathlib import Path
import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback, EvalCallback
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize
import gymnasium as gym
if __package__:
    from .balance_config import BalanceConfig, RULES_VERSION
    from .facility_env import FacilityEnv
    from .experiments import simulate, paired_difference, write_report
else:
    from balance_config import BalanceConfig, RULES_VERSION
    from facility_env import FacilityEnv
    from experiments import simulate, paired_difference, write_report


class GameScoreReward(gym.Wrapper):
    """Evaluation rewards exclude training-only shaping bonuses."""
    def reset(self, **kwargs):
        obs, info = self.env.reset(**kwargs)
        self.previous = info['reputation']
        return obs, info

    def step(self, action):
        obs, _, done, truncated, info = self.env.step(action)
        reward = info['reputation'] - self.previous
        self.previous = info['reputation']
        return obs, reward, done, truncated, info


class SaveBestStats(BaseCallback):
    def __init__(self, path):
        super().__init__()
        self.path = str(path)

    def _on_step(self):
        self.model.get_vec_normalize_env().save(self.path)
        return True


def bc_pretrain(model, vec_env, config, episodes, epochs, seed):
    if not episodes or not epochs:
        return
    env = FacilityEnv(config=config, record_events=False)
    observations, actions = [], []
    for episode in range(episodes):
        obs, _ = env.reset(seed=seed+episode)
        for _ in range(100000):
            action = env.heuristic_action()
            observations.append(obs)
            actions.append(action)
            obs, _, done, _, _ = env.step(action)
            if done:
                break
        else:
            raise RuntimeError('BC demonstration exceeded step limit')
    obs = np.asarray(observations, dtype=np.float32)
    vec_env.obs_rms.update(obs)
    inputs = torch.as_tensor(vec_env.normalize_obs(obs), device=model.device)
    targets = torch.as_tensor(actions, dtype=torch.long, device=model.device)
    optimizer = torch.optim.Adam(model.policy.parameters(), lr=3e-4)
    for _ in range(epochs):
        order = torch.randperm(len(inputs), device=model.device)
        for indices in order.split(256):
            distribution = model.policy.get_distribution(inputs[indices])
            loss = -distribution.log_prob(targets[indices]).mean()
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
    env.close()


def train(config, output, total_timesteps=500000, n_envs=8, seed=42,
          n_steps=256, bc_episodes=20, bc_epochs=5, eval_episodes=20):
    output = Path(output)
    if output.exists() and any(output.iterdir()):
        raise ValueError('Training output must be empty; use a new run directory')
    output.mkdir(parents=True, exist_ok=True)
    vec = VecNormalize(make_vec_env(lambda: FacilityEnv(config=config, record_events=False),
                                   n_envs=n_envs, seed=seed), norm_obs=True, norm_reward=True)
    evaluation = VecNormalize(make_vec_env(lambda: GameScoreReward(FacilityEnv(config=config, record_events=False)),
                                          n_envs=1, seed=seed+1000000), norm_obs=True, norm_reward=False)
    evaluation.training = False
    model = PPO('MlpPolicy', vec, n_steps=n_steps, batch_size=min(256, n_steps*n_envs),
                n_epochs=10, learning_rate=3e-4, gamma=1.0, gae_lambda=.95,
                ent_coef=.01, policy_kwargs=dict(net_arch=[256, 256]),
                seed=seed, device='cpu', verbose=1)
    manifest = dict(rules_version=RULES_VERSION, observation_version=2,
                    packages={name:version(name) for name in ('numpy','gymnasium','torch','stable-baselines3')},
                    observation_shape=list(vec.observation_space.shape),
                    config=config.to_dict(), config_hash=config.fingerprint,
                    seed=seed, training_reward='game score delta + potential difference (zero episode total)',
                    training_parameters=dict(total_timesteps=total_timesteps, n_envs=n_envs, n_steps=n_steps,
                                             bc_episodes=bc_episodes, bc_epochs=bc_epochs, eval_episodes=eval_episodes),
                    selection_metric='net game reputation; no shaping',
                    gamma_per_decision=1.0,
                    checkpoints={'best': {'model':'best_model.zip','stats':'best_stats.pkl'},
                                 'final': {'model':'final_model.zip','stats':'final_stats.pkl'}})
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    bc_pretrain(model, vec, config, bc_episodes, bc_epochs, seed)
    # EvalCallback synchronizes normalization statistics before evaluation.
    callback = EvalCallback(evaluation, callback_on_new_best=SaveBestStats(output/'best_stats.pkl'),
                            best_model_save_path=str(output), log_path=str(output),
                            eval_freq=max(1, min(10000, total_timesteps)//n_envs),
                            n_eval_episodes=eval_episodes, deterministic=True)
    try:
        model.learn(total_timesteps=total_timesteps, callback=callback)
        model.save(output/'final_model')
        vec.save(output/'final_stats.pkl')
    finally:
        vec.close()
        evaluation.close()
    return output


class SavedPolicy:
    def __init__(self, directory, config, checkpoint='best', allow_config_change=False):
        directory = Path(directory)
        manifest = json.loads((directory/'manifest.json').read_text())
        if manifest['rules_version'] != RULES_VERSION or manifest['observation_version'] != 2:
            raise ValueError('Incompatible model rules or observations; retrain this model')
        if manifest['config_hash'] != config.fingerprint and not allow_config_change:
            raise ValueError('Model configuration differs; use its config or explicitly allow a transfer evaluation')
        files = manifest['checkpoints'][checkpoint]
        raw = DummyVecEnv([lambda: FacilityEnv(config=config, record_events=False)])
        if list(raw.observation_space.shape) != manifest['observation_shape']:
            raw.close()
            raise ValueError('Model observation dimensions differ from the experiment')
        self.norm = VecNormalize.load(directory/files['stats'], raw)
        self.norm.training = False
        self.norm.norm_reward = False
        self.model = PPO.load(directory/files['model'], device='cpu')

    def __call__(self, observation):
        action, _ = self.model.predict(self.norm.normalize_obs(observation), deterministic=True)
        return int(action)

    def close(self):
        self.norm.close()


def evaluate(directory, config, seeds, checkpoint='best', allow_config_change=False):
    policy = SavedPolicy(directory, config, checkpoint, allow_config_change)
    try:
        baseline = simulate(config, seeds, 'heuristic')
        agent = simulate(config, seeds, policy)
        return dict(command='evaluate', model=str(Path(directory).resolve()), checkpoint=checkpoint,
                    transfer_evaluation=allow_config_change,
                    variants={'heuristic':baseline, 'agent':agent},
                    paired_net_rep_difference=paired_difference(baseline, agent))
    finally:
        policy.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config')
    parser.add_argument('--output', help='New training run directory')
    parser.add_argument('--model-dir', help='Versioned run directory to evaluate')
    parser.add_argument('--report', default='rl/reports/evaluation.json')
    parser.add_argument('--timesteps', type=int, default=500000)
    parser.add_argument('--envs', type=int, default=8)
    parser.add_argument('--n-steps', type=int, default=256)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--episodes', type=int, default=100)
    parser.add_argument('--bc-episodes', type=int, default=20)
    parser.add_argument('--bc-epochs', type=int, default=5)
    parser.add_argument('--eval-episodes', type=int, default=20)
    parser.add_argument('--eval-only', action='store_true')
    parser.add_argument('--checkpoint', choices=['best','final'], default='best')
    parser.add_argument('--allow-config-change', action='store_true')
    args = parser.parse_args()
    try:
        if min(args.timesteps, args.envs, args.episodes, args.eval_episodes) < 1 or args.n_steps < 2 or min(args.seed,args.bc_episodes,args.bc_epochs) < 0:
            raise ValueError('Invalid training/evaluation counts')
        if args.eval_only:
            if not args.model_dir:
                raise ValueError('--eval-only requires --model-dir; legacy models must be retrained for v2')
            saved = json.loads((Path(args.model_dir)/'manifest.json').read_text())
            config = BalanceConfig.load(args.config) if args.config else BalanceConfig(**saved['config'])
            report = evaluate(args.model_dir, config, list(range(args.seed,args.seed+args.episodes)),
                              args.checkpoint, args.allow_config_change)
            write_report(args.report, report)
            print(json.dumps(report['paired_net_rep_difference'], indent=2))
        else:
            if not args.output:
                raise ValueError('Training requires --output pointing to a new run directory')
            config = BalanceConfig.load(args.config)
            path = train(config, args.output, args.timesteps, args.envs, args.seed,
                         args.n_steps, args.bc_episodes, args.bc_epochs, args.eval_episodes)
            print(f'Run saved: {path.resolve()}')
    except (ValueError, OSError, KeyError) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
