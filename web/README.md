# discyboi flight lab (web)

A three.js app that simulates and animates disc golf flights. You can enter the release parameters by hand, or receive them from the discyboi hardware over Web Bluetooth. Throws are kept in a local history.

```sh
bun install
bun run dev      # http://localhost:5173        (?fake=1 for a simulated disc)
bun test         # protocol, conversion and flight-model tests
bun run build    # type-check + production build in dist/
```

Web Bluetooth only works in **Chrome or Edge**, on desktop or Android, over https or localhost. Firefox and iOS Safari don't support it.

## Using it

- **Disc:** pick an archetype preset (putter … max-distance driver) or enter custom flight numbers.
- **Release:**
  - A live preview at the top of the card shows the disc at release from behind (hyzer) and from the side (nose, plus an arrow for the flight path). It updates as you move the sliders.
  - Choose hand and style.
  - Set speed (m/s), spin (rpm), hyzer (+ = hyzer, − = anhyzer), nose (disc pitch relative to the horizon) and launch angle (flight path above the horizon).
  - The panel shows the resulting angle of attack (nose − launch). Slightly negative means nose down, which is good.
- **Aim and wind:** aim left/right; wind speed and the direction it comes from.
- **Keys:** `Space` throws, `R` replays, `1`–`5` switch camera (chase, tee, side, top, free).
- **Free camera:** orbits the disc and follows it in flight. Drag to rotate, scroll or pinch to zoom, right-drag to pan.
- **History:**
  - Click a throw to replay it. Tick the box to keep its path on screen as a ghost.
  - Type the *actual* distance after walking to the disc. These measurements are what will be used to calibrate the model against reality later.
  - Export everything as JSON.
- **Disc connection:** *Connect disc* subscribes to the Throw and Status characteristics. Each throw is converted, simulated and added to the history automatically.
  - Set the board mount (face up or face down in the disc). It flips the spin direction.
  - The thrower's hand comes from the Release panel. Backhand vs forehand is inferred from the spin direction.

## Flight model (`src/sim/`)

- **State:** a 6-DOF-style disc state of position, velocity, disc normal and spin, integrated with RK4 at 2 ms.
- **Aerodynamics:** Hummel/Potts-style lift, drag and pitching-moment coefficients as functions of angle of attack.
- **Gyroscopic precession:** the disc is treated as a gyroscope, so a pitching moment rolls the disc instead of pitching it: `dn/dt = M / (Izz·ω)`.
  - Turn and fade emerge from this, and they mirror correctly for forehand and left-handed throws.
  - More spin flies straighter.
- **Flight numbers → coefficients** (`aero.ts`):
  - **speed:** lower drag and a higher "design airspeed"
  - **glide:** more lift
  - **turn:** nose-down moment growing with airspeed / design speed
  - **fade:** nose-up moment growing as the disc slows
- **Calibration:** the shared constants in `TUNE` are fitted so that a flat backhand with a stable driver goes:

  | Speed | Distance |
  |---|---|
  | 20 m/s | ~75 m |
  | 22 m/s | ~90 m |
  | 25 m/s | ~110 m |
  | 27 m/s | ~125 m |
  | 30 m/s | ~150 m |

  `test/flight.test.ts` enforces this within ±15%. `scripts/explore.ts` prints a table of distance and drift per disc and speed for re-tuning. Override constants with `TUNE='{"kFade":0.005}' bun scripts/explore.ts`.
- **Ground:** after landing the disc slides to a stop with friction. Skips and rollers aren't modelled.

Flight numbers are manufacturer opinion, so expect the right *shape* and roughly the right distance. Real throws from the hardware, plus the measured distances in the history, are the path to real accuracy.

## Conventions

- **Simulator frame:** x downrange, y left, z up. The scene maps this to three.js y-up in `scene/coords.ts`.
- **Hardware fields:** `firmware/README.md` documents the BLE fields.
  - `hyzer_cdeg` (+ = right edge down) and `nose_cdeg` use the upward disc normal, so they don't depend on mounting.
  - `spin_rpm` is relative to the board top.
  - `sim/convert.ts` does the conversion, and `test/convert.test.ts` round-trips it through the same angle definitions as `analysis.c`.

## Layout

```
src/sim/      flight model, presets, firmware -> params conversion (no DOM; tested with bun test)
src/scene/    world (field, basket, trees), disc mesh, playback + trail, cameras
src/ui/       panels: disc picker, release, history, stats, device
src/ble/      protocol (byte layouts), Web Bluetooth client, fake device
src/store/    localStorage history + settings
```

`scene/world.ts` takes a `Hole` (tee, basket, obstacles), which is the hook for courses and scoring later.
