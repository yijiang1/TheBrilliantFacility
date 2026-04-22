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
