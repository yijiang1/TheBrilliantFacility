"""
train.py — Train and evaluate a PPO agent on FacilityEnv.

Quick start
    pip install -r requirements.txt
    python train.py               # train + evaluate
    python train.py --eval-only   # evaluate a saved model

Outputs
    models/ppo_facility.zip       trained policy
    models/ppo_facility_stats     normalisation statistics
"""

import argparse
import os
import time
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from stable_baselines3 import PPO
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.vec_env import VecNormalize
from stable_baselines3.common.callbacks import EvalCallback
from stable_baselines3.common.monitor import Monitor

from facility_env import FacilityEnv

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(MODEL_DIR, exist_ok=True)
MODEL_PATH = os.path.join(MODEL_DIR, "ppo_facility")
STATS_PATH = os.path.join(MODEL_DIR, "ppo_facility_stats")


# ── Environment factory ───────────────────────────────────────────────────────

def make_env(n_jobs: int = 4, seed: int = 0):
    def _init():
        env = FacilityEnv(n_jobs=n_jobs)
        env = Monitor(env)
        env.reset(seed=seed)
        return env
    return _init


# ── Heuristic baseline ────────────────────────────────────────────────────────

def run_heuristic(n_episodes: int = 100, n_jobs: int = 4, seed: int = 42) -> dict:
    """Run the rule-based bot (mirrors bot.js _decide) and collect stats."""
    env = FacilityEnv(n_jobs=n_jobs)
    rng = np.random.default_rng(seed)
    reps, samples = [], []

    for ep in range(n_episodes):
        obs, _ = env.reset(seed=int(rng.integers(1 << 31)))
        done = False
        while not done:
            action = env.heuristic_action()
            _, _, done, _, _ = env.step(action)
        reps.append(env.reputation)
        total = sum(j.done for j in env.jobs.values())
        samples.append(total)

    return {
        "rep_mean":     float(np.mean(reps)),
        "rep_std":      float(np.std(reps)),
        "rep_max":      float(np.max(reps)),
        "samples_mean": float(np.mean(samples)),
    }


# ── RL agent evaluation ───────────────────────────────────────────────────────

def run_agent(model: PPO, vec_env: VecNormalize,
              n_episodes: int = 100, n_jobs: int = 4) -> dict:
    """Evaluate a trained PPO agent."""
    eval_env = VecNormalize(
        make_vec_env(make_env(n_jobs=n_jobs), n_envs=1),
        norm_obs=True, norm_reward=False, clip_obs=10.0,
    )
    # Copy running statistics from training env so normalisation is consistent
    eval_env.obs_rms  = vec_env.obs_rms
    eval_env.ret_rms  = vec_env.ret_rms
    eval_env.training = False

    reps, samples = [], []

    for _ in range(n_episodes):
        obs = eval_env.reset()
        done = False
        final_info = {}
        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, _, dones, infos = eval_env.step(action)
            done = bool(dones[0])
            if done:
                # SB3 auto-resets on done=True; terminal stats live in the
                # terminal step's info dict before the env resets.
                final_info = infos[0]
        reps.append(int(final_info.get("reputation", 0)))
        samples.append(int(final_info.get("samples_done", 0)))

    return {
        "rep_mean":     float(np.mean(reps)),
        "rep_std":      float(np.std(reps)),
        "rep_max":      float(np.max(reps)),
        "samples_mean": float(np.mean(samples)),
    }


# ── Behavioural cloning pre-training ─────────────────────────────────────────

def bc_pretrain(
    model:    PPO,
    vec_env:  VecNormalize,
    n_demos:  int   = 2000,
    n_epochs: int   = 30,
    lr:       float = 3e-4,
    n_jobs:   int   = 4,
    seed:     int   = 0,
) -> None:
    """
    Pre-train the PPO policy via behavioural cloning on heuristic demonstrations.

    Collects n_demos heuristic episodes, normalises observations using the
    training env's running statistics, and minimises cross-entropy between
    the policy's action distribution and the heuristic labels.
    """
    print("── Behavioural cloning pre-training ──")
    env = FacilityEnv(n_jobs=n_jobs)
    rng = np.random.default_rng(seed)
    obs_buf, act_buf = [], []

    for ep in range(n_demos):
        obs, _ = env.reset(seed=int(rng.integers(1 << 31)))
        done = False
        while not done:
            action = env.heuristic_action()
            obs_buf.append(obs.copy())
            act_buf.append(action)
            obs, _, done, _, _ = env.step(action)

    obs_np = np.array(obs_buf, dtype=np.float32)
    act_np = np.array(act_buf, dtype=np.int64)
    n_samples = len(obs_np)
    print(f"   collected {n_demos} episodes → {n_samples:,} state-action pairs")

    # Apply VecNormalize's obs scaling (same as training) so the policy input
    # distribution matches what it will see during PPO training.
    obs_mean = vec_env.obs_rms.mean.astype(np.float32)
    obs_std  = np.sqrt(vec_env.obs_rms.var.astype(np.float32) + 1e-8)
    obs_norm = np.clip((obs_np - obs_mean) / obs_std, -10.0, 10.0)

    obs_t = torch.FloatTensor(obs_norm)
    act_t = torch.LongTensor(act_np)
    loader = DataLoader(TensorDataset(obs_t, act_t), batch_size=512, shuffle=True)

    # Jointly update the policy (actor + value net) via BC loss on the actor.
    optim = torch.optim.Adam(model.policy.parameters(), lr=lr)
    ce    = nn.CrossEntropyLoss()

    for epoch in range(n_epochs):
        total_loss = 0.0
        for batch_obs, batch_act in loader:
            latent_pi, _ = model.policy.mlp_extractor(batch_obs)
            logits = model.policy.action_net(latent_pi)
            loss = ce(logits, batch_act)
            optim.zero_grad()
            loss.backward()
            optim.step()
            total_loss += loss.item()
        avg = total_loss / len(loader)
        if (epoch + 1) % 10 == 0:
            print(f"   epoch {epoch+1:3d}/{n_epochs}  loss={avg:.4f}")

    print("   BC pre-training complete\n")


# ── Training ──────────────────────────────────────────────────────────────────

def train(
    total_timesteps: int = 500_000,
    n_envs:          int = 8,
    n_jobs:          int = 4,
    seed:            int = 42,
):
    print(f"\n{'='*60}")
    print("  The Brilliant Facility — PPO training")
    print(f"  timesteps={total_timesteps:,}  envs={n_envs}  jobs={n_jobs}")
    print(f"{'='*60}\n")

    # Vectorised + normalised training environment
    vec_env = make_vec_env(make_env(n_jobs=n_jobs, seed=seed), n_envs=n_envs)
    vec_env = VecNormalize(vec_env, norm_obs=True, norm_reward=True, clip_obs=10.0)

    # Separate eval environment — obs stats are synced from vec_env before each
    # evaluation so the policy sees properly-normalised observations.
    eval_env = VecNormalize(
        make_vec_env(make_env(n_jobs=n_jobs, seed=seed + 99), n_envs=1),
        norm_obs=True, norm_reward=False, clip_obs=10.0,
    )

    class _SyncedEvalCallback(EvalCallback):
        """Syncs obs normalisation stats from the training env before each eval."""
        def _on_step(self) -> bool:
            if self.eval_freq > 0 and self.n_calls % self.eval_freq == 0:
                self.eval_env.obs_rms = vec_env.obs_rms
                self.eval_env.training = False
            return super()._on_step()

    eval_callback = _SyncedEvalCallback(
        eval_env,
        best_model_save_path=MODEL_DIR,
        log_path=MODEL_DIR,
        eval_freq=max(10_000 // n_envs, 1),
        n_eval_episodes=20,
        deterministic=True,
        verbose=0,
    )

    model = PPO(
        "MlpPolicy",
        vec_env,
        n_steps=2048,
        batch_size=256,
        n_epochs=10,
        learning_rate=3e-4,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.01,          # encourage exploration early on
        vf_coef=0.5,
        max_grad_norm=0.5,
        policy_kwargs=dict(net_arch=[256, 256]),
        verbose=1,
        seed=seed,
    )

    print("── Heuristic baseline (before training) ──")
    baseline = run_heuristic(n_episodes=200, n_jobs=n_jobs, seed=seed)
    print(f"   rep  {baseline['rep_mean']:.1f} ± {baseline['rep_std']:.1f}  "
          f"(max {baseline['rep_max']:.0f})")
    print(f"   samples/cycle  {baseline['samples_mean']:.1f}\n")

    # Seed vec_env obs stats with a short warm-up so BC obs normalisation is
    # meaningful (pure-zero mean / unit-var at init would distort scaling).
    _warmup_obs = []
    env_tmp = FacilityEnv(n_jobs=n_jobs)
    rng_tmp = np.random.default_rng(seed)
    for _ in range(500):
        obs, _ = env_tmp.reset(seed=int(rng_tmp.integers(1 << 31)))
        done = False
        while not done:
            _warmup_obs.append(obs)
            obs, _, done, _, _ = env_tmp.step(env_tmp.heuristic_action())
    _warmup_arr = np.array(_warmup_obs, dtype=np.float32)
    vec_env.obs_rms.update(_warmup_arr)

    bc_pretrain(model, vec_env, n_demos=2000, n_epochs=30, n_jobs=n_jobs, seed=seed)

    t0 = time.time()
    model.learn(total_timesteps=total_timesteps, callback=eval_callback)
    elapsed = time.time() - t0
    print(f"\nTraining finished in {elapsed:.0f}s "
          f"({total_timesteps / elapsed:.0f} steps/s)\n")

    model.save(MODEL_PATH)
    vec_env.save(STATS_PATH)
    print(f"Model saved → {MODEL_PATH}.zip")

    print("── RL agent evaluation (after training) ──")
    agent_stats = run_agent(model, vec_env, n_episodes=200, n_jobs=n_jobs)
    print(f"   rep  {agent_stats['rep_mean']:.1f} ± {agent_stats['rep_std']:.1f}  "
          f"(max {agent_stats['rep_max']:.0f})")
    print(f"   samples/cycle  {agent_stats['samples_mean']:.1f}\n")

    print("── Comparison ──")
    delta = agent_stats["rep_mean"] - baseline["rep_mean"]
    pct   = 100 * delta / max(baseline["rep_mean"], 1)
    sign  = "+" if delta >= 0 else ""
    print(f"   Rep/cycle: {sign}{delta:.1f} ({sign}{pct:.1f}%) vs heuristic\n")

    return model, vec_env


# ── Eval-only mode ────────────────────────────────────────────────────────────

def eval_only(n_jobs: int = 4):
    if not os.path.exists(MODEL_PATH + ".zip"):
        print("No saved model found. Run without --eval-only first.")
        return

    dummy_env = VecNormalize(
        make_vec_env(make_env(n_jobs=n_jobs), n_envs=1),
        norm_obs=True, norm_reward=True, clip_obs=10.0,
    )
    vec_env = VecNormalize.load(STATS_PATH, dummy_env)
    model   = PPO.load(MODEL_PATH, env=vec_env)

    print("\n── Heuristic baseline ──")
    b = run_heuristic(n_episodes=200, n_jobs=n_jobs)
    print(f"   rep {b['rep_mean']:.1f} ± {b['rep_std']:.1f}  samples {b['samples_mean']:.1f}")

    print("\n── Trained agent ──")
    a = run_agent(model, vec_env, n_episodes=200, n_jobs=n_jobs)
    print(f"   rep {a['rep_mean']:.1f} ± {a['rep_std']:.1f}  samples {a['samples_mean']:.1f}")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--timesteps", type=int, default=500_000)
    parser.add_argument("--envs",      type=int, default=8)
    parser.add_argument("--jobs",      type=int, default=4)
    parser.add_argument("--seed",      type=int, default=42)
    parser.add_argument("--eval-only", action="store_true")
    args = parser.parse_args()

    if args.eval_only:
        eval_only(n_jobs=args.jobs)
    else:
        train(
            total_timesteps=args.timesteps,
            n_envs=args.envs,
            n_jobs=args.jobs,
            seed=args.seed,
        )
