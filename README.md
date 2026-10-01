# The Brilliant Facility

A top-down arcade management game where you run an X-ray synchrotron research facility.

As the Facility Director, you race between laboratory stations, collect and process samples, manage cascading hazards, and make strategic decisions about which research proposals to pursue — all under the pressure of a ticking beamtime clock.

## How It Works

- Each playthrough spans multiple years. A year has three 90-day beamtime cycles.
- Each cycle is a **3-minute real-time action phase**.
- Between cycles, buy upgrades. At year end, earn funding based on your reputation.
- Start with a 1990s-era synchrotron and grow it into a world-class facility.

## Play

Open [`BrilliantFacility.html`](BrilliantFacility.html) in any modern browser. No install needed.

## Online co-op (2 players)

Run `npm ci` and `npm start`, then open `http://localhost:3000`. Create a private
room, share its invite link, and have both players click **Ready**. The host starts
the session and chooses proposals; each player moves independently. Press **E**
near your teammate to pass a sample.

For a friend on another network, deploy the included Node server and create the
room from its public HTTPS URL. Localhost links are only usable on your own
computer. Deployment files and reconnect limitations are in the
[online co-op guide](docs/ONLINE_COOP.md). The first version runs the simulation
in the host's browser, so the host must keep the game open.

## Developer Mode

Add `?dev` to the URL to enable the dev panel during gameplay:

```
BrilliantFacility.html?dev
```

This adds a small overlay in the corner with:

| Button | Action |
|--------|--------|
| `+$100k` | Add 100K funding |
| `+20 ⭐` | Add 20 reputation |
| `+1 Cy` | Skip to next cycle |
| `+1 Yr` | Skip to next year (applies grant) |
| `1×` | Cycle through time speeds: 1×, 2×, 4×, 8× |

## AI Playtesting Bot

`js/bot.js` is always loaded. Open the browser console and use:

| Command | Action |
|---------|--------|
| `_bot.start()` | Bot takes over — keyboard is suppressed |
| `_bot.stop()` | Return control to the player |
| `_bot.stats()` | Print cycle metrics to the console |
| `_bot.speed(n)` | Set time multiplier (requires `?dev`; e.g. `_bot.speed(4)`) |

The bot automates everything: in-cycle movement (greedy priority queue over measurement → prep → NPC collection), proposal selection between cycles, and upgrade purchases. Watch the overlay label to see what it's prioritising — sustained time on any one goal reveals a design bottleneck.

### Balance backend and RL training

`rl/` provides a configurable Python backend for seeded cycle simulations, upgrade
comparisons, multi-year campaign forecasts, and optional PPO training.

```bash
python3 -m pip install -r rl/requirements-core.txt
python3 rl/balance.py simulate --episodes 100 --output rl/reports/baseline.json
python3 rl/balance.py sweep --episodes 100 --variants balance/variants.example.json --output rl/reports/upgrades.json
python3 rl/balance.py campaign --years 5 --episodes 20 --output rl/reports/campaign.json
```

Reports include actual game reputation, sample completion/loss, travel/wait time, and
JSON/CSV exports. Training rewards are tracked separately. The backend includes corrected
deadline and partial-payout rules; its movement and staff simulation approximate the browser.

See **[Balance backend guide](balance/README.md)** for configuration, fidelity limits,
Python API, tests, and training commands. Original models in `rl/models/` are preserved
as legacy artifacts; their historical ~62 vs ~41 scores are not comparable to v2 and
new models must be trained for the corrected rules.

### Jev decision-model experiment

The seeded Python environment can also be played by TypeSafe AI's hosted Jev model.
The API key stays in the local process; it is never sent to the browser or stored in
the repository.

```bash
export TYPESAFE_API_KEY="..."
python3 -m rl.jev_play --episodes 1 --strict
```

The command compares Jev with the heuristic on identical seeds and writes JSON/CSV
results to `rl/reports/jev_evaluation.*`. Jev receives a semantic state snapshot and
chooses among the environment's 16 actions. Repeated `WAIT` ticks are cached until a
meaningful state change, and low-confidence answers fall back to the heuristic unless
`--min-confidence 0` is used.

## Design Pillars

- **Brilliant** — Every mechanic is grounded in real synchrotron science.
- **Frantic** — The clock is always ticking. Beamtime is sacred and finite.
- **Strategic** — Pre-cycle proposal selection matters as much as execution.
- **Growing** — The facility evolves across four generations of light sources.
- **Rewarding** — Every sample counted, every paper published, every upgrade earned.

## Game Design Document

The full GDD is in the [`GDD/`](GDD/) folder.

## Tech Stack

- **Prototype:** Phaser.js 3.60, single HTML file, JavaScript (ES6+)
- **Production (planned):** Godot 4, targeting Steam

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
