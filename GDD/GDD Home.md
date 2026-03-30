# The Brilliant Facility — GDD v0.5
*2026 | Draft — Prototype-Validated*

A Synchrotron Facility Management Game.

## Sections

1. [[1. Game Overview]]
2. [[2. Scene Flow & Structure]]
3. [[3. Active Cycle]]
4. [[4. Proposal System]]
5. [[5. Hazards]]
6. [[6. Progression]]
7. [[7. Facility Eras]]
8. [[8. HUD & UI]]
9. [[9. Tech Stack & Roadmap]]
10. [[10. Open Design Questions]]
11. [[11. Glossary]]

## What Changed in v0.5

- Ring Stability is now **fixed during a run** (no in-cycle decay). Starts at 98% on cycle 1.
- Ring Stability drops **2% per cycle** (was 8 pts/year), flooring at 30%.
- Beam Stop trigger redesigned: **single probability roll per cycle** (chance = 100% − ring stability).
- Beam Stop duration: 0.5–1.0 game days in cycle 1; maximum grows by 0.5 real seconds each subsequent cycle.
- Beam Stop no longer costs ring stability when it fires.
- Ring Maintenance upgrade effect pending redesign.
- Scene flow locked: Boot → Proposal Review → Game → Cycle End (+ shop) → Proposal Review.
- Tech stack confirmed: Phaser.js prototype → Godot 4 production port.
