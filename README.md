# Booyah Dash

A fast top-down arena survival game that runs entirely in your browser. Drop in, grab a weapon off the floor, survive ten waves inside a shrinking zone, and take the Booyah.

I built this because I kept wanting a quick game I could open and play for five minutes without installing anything or signing up anywhere — no account, no download, no loading screens. Just open `index.html` and you're in the arena.

## Play it

**No install needed.** Open the game in your browser:

- **Online:** https://codewithkrrish.github.io/booyahdash/ (once GitHub Pages is enabled on the repo)
- **Locally:** clone the repo and open `index.html` — or serve it with `python3 -m http.server` and visit `http://localhost:8000`

## How to play

1. **Drop in.** You spawn in the middle of the arena with a pistol. A medkit and an SMG are already on the floor — grab them before wave 1 arrives.
2. **Clear the wave.** Enemies spawn from the edges. Rushers chase you, brutes soak up bullets, gunners keep their distance and shoot back.
3. **Respect the zone.** The safe zone shrinks on a timer and drifts across the map. Outside it, your health ticks down. The minimap always shows where safe is.
4. **Take the Booyah.** Clear wave 10 and the run is yours. Feeling good? Keep going in endless mode.

### Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrow keys | Move |
| Mouse | Aim |
| Click (hold) | Shoot |
| `Space` / `Shift` | Dash (short burst, brief invulnerability, 2.4s cooldown) |
| `Esc` / `P` | Pause |
| `M` | Mute |
| Touch | Drag left side to move, hold Fire to shoot (auto-aims), tap Dash |

## The arsenal

Weapons drop from fallen enemies and spawn on the floor. Picking one up replaces your current gun — when its ammo runs out, you fall back to the pistol.

| Weapon | Damage | Fire rate | Ammo | Notes |
| --- | --- | --- | --- | --- |
| Pistol | 34 | Medium | Infinite | Your starting sidearm. Never runs dry. |
| SMG | 17 | Very fast | 120 | Sprays fast up close. Burns ammo quickly. |
| Scattergun | 24 × 6 pellets | Slow | 30 | Devastating up close, useless at range. |
| Longshot Rifle | 78 | Slow | 36 | Longest range in the game. The answer to gunners. |

Medkits heal 40 HP, armor pickups add 25 armor (absorbs damage first, max 50).

## The enemy

| Enemy | From wave | Behaviour |
| --- | --- | --- |
| Rusher | 1 | Fast, fragile, comes straight at you in numbers. |
| Gunner | 3 | Keeps its distance and shoots. Break line of sight or close the gap. |
| Brute | 4 | Slow, heavy, big health bar. Save the rifle for these. |

Waves get bigger every round, and kills pay more the deeper you go. Clearing a wave pays a bonus of 250 × the wave number.

## Scoring

Your best runs are saved in your browser (localStorage) under "Local Legends" — score, wave reached, kills, and survival time. Nothing leaves your device.

## Project structure

```
booyahdash/
├── index.html        # page, HUD, overlays, info sections
├── css/style.css     # the whole look — dark arena theme
├── js/
│   ├── engine.js     # pure game rules (waves, zone, scoring, collisions)
│   ├── audio.js      # synthesized WebAudio sound effects, no audio files
│   └── game.js       # canvas loop, input, rendering, HUD
└── tests/
    └── engine.test.js
```

The rules in `engine.js` are deliberately kept free of DOM and canvas code, so they can be tested in plain Node. `game.js` owns rendering and input only.

## Run the tests

```sh
node --test tests/engine.test.js
```

11 tests, covering wave scaling, zone shrink, collision, scoring, drops, and the local leaderboard (including corrupt storage). They have to pass before anything ships.

## What I left out (honest limitations)

- **No multiplayer.** It's a solo arena game. The engine is written so the wave/zone rules could be reused, but there is no netcode here.
- **No save mid-run.** Quit and the run is over. Runs are short by design.
- **Sound is synthesized.** All effects are WebAudio oscillators and noise — no recorded audio, so they sound retro by design.
- **Desktop-first balance.** Touch controls work (joystick + auto-aim fire), but the game is tuned for keyboard and mouse.
- **One arena.** The crate/rock layout is fixed so the map is learnable. A random map generator is the obvious next step if I come back to this.

## License

MIT — see [LICENSE](LICENSE). Made by [Krrish](https://github.com/codewithkrrish).
