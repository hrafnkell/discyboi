# discyboi flight lab (web)

A three.js app that simulates and animates disc golf flights. You can enter the release parameters by hand, or receive them from the discyboi hardware over Web Bluetooth. Throws are kept in this browser, or in an account on the discyboi server.

```sh
bun install
bun run server   # accounts + throw history API on :8787 (optional; SQLite in data/)
bun run dev      # http://localhost:5173/lab/   (?fake=1 for a simulated disc; proxies /api to :8787)
bun test         # protocol, conversion and flight-model tests
bun run build    # type-check + production build in dist/
```

**Pages:** `/` is the landing page (`index.html` + `src/landing.css`, no script; its images are in `public/img/`). The app is under `/lab/`: the flight lab at `/lab/` and the throws page at `/lab/throws.html`. The server redirects the old `/throws.html` and `/?throw=…` links there. It is deployed at [discyboi.com](https://discyboi.com).

The dev server listens on all interfaces, so you can open it from another device at `http://<this machine's IP>:5173`. Vite prints the network URLs on startup.

Web Bluetooth only works in **Chrome or Edge**, on desktop or Android, over https or localhost. Firefox and iOS Safari don't support it. Over a plain-http LAN address the 3D view works, but *Connect disc* doesn't: use an https tunnel or `localhost` for that.

## Using it

- **Disc:** pick an archetype preset (putter … max-distance driver) or enter custom flight numbers.
- **Release:**
  - A live preview at the top of the card shows the disc at release from behind (hyzer) and from the side (nose, plus an arrow for the flight path). It updates as you move the sliders.
  - Choose hand and style.
  - Set speed (m/s), spin (rpm), hyzer (+ = hyzer, − = anhyzer), nose (disc pitch relative to the horizon) and launch angle (flight path above the horizon).
  - The panel shows the resulting angle of attack (nose − launch). Slightly negative means nose down, which is good.
- **Aim and wind:** aim left/right; wind speed and the direction it comes from.
- **Keys:** `Space` throws, `R` replays, `1`–`5` switch camera (chase, tee, side, top, free).
- **Free camera:** orbits the disc and follows it in flight. Left drag rotates around the disc, right drag (or two-finger drag) pans, scroll or pinch zooms. Switching to Free or making a new throw re-centres on the disc.
- **Chase and side cameras:** drag to orbit around the disc, in flight or after it lands. Scroll or pinch to zoom.
- **Top camera:** drag to move the map, scroll or pinch to zoom.
- **Tee camera:** drag sideways to turn the aim (the Aim slider follows). A line with arrows on the ground shows the aim, and the camera looks down it until the next throw.
- Each view keeps its own orbit, pan and zoom across throws. Double-click or double-tap resets the current view.
- **Distance markers:** rings every 25 m, and ticks every 5 m along the centre line with a label every 25 m. Labels keep a minimum on-screen size when you zoom out.
- **Landing marker:** shows the flight (carry) distance, the skip/slide after landing and the total. A red dot marks where the disc stopped.
- **History:**
  - Click a throw to replay it. Tick the box to keep its path on screen as a ghost.
  - Type the *actual* distance after walking to the disc. These measurements are what will be used to calibrate the model against reality later.
  - Export everything as JSON.
- **Disc connection:** *Connect disc* subscribes to the Throw and Status characteristics. Each throw is converted, simulated and added to the history automatically.
  - Set the board mount (face up or face down in the disc). It flips the spin direction.
  - The thrower's hand comes from the Release panel. Backhand vs forehand is inferred from the spin direction.

## Throws page (`lab/throws.html`)

A separate page for reviewing throws, reached from **Throws →** in the flight lab's top bar. It doesn't need WebGL, so it also works on phones. It suits field work, where the release numbers matter more than the 3D flight.

- **Live:** it updates as throws arrive. You can connect the disc on this page, and throws recorded in a flight-lab tab also show up straight away (the tabs share localStorage).
- **Recording:** the disc, hand and board mount used for throws from the disc. *Follow latest* opens each new throw in the detail view. *Speak* reads out each new throw: the metrics you've set targets for, otherwise speed, nose and hyzer. *Save raw data* fetches the full sensor recording from the disc after each throw (about 86 KB, several seconds, and the disc ignores throws until it's done). Signed in, it is stored with the throw, which then shows `disc +raw` in the list; signed out, it downloads as a `.bin` file. The file is the 32-byte header packet followed by the samples, as described under "Raw download" in `firmware/README.md`.
- **Latest throw:** big tiles for speed, spin, hyzer, nose, launch, angle of attack, wobble and simulated distance, each with the difference from the average of the other throws in range.
- **Range:** *Session* (since you pressed *New session*), today, 7 days or all.
- **Trend:** one metric over the throws in range. Dashed line is the mean, the shaded band is the target. Click a dot to open that throw.
- **Throws table:** click a row for its details. Tick up to 6 to compare. The × at the end of a row deletes that throw: press it, then press *Delete?* within three seconds. With throws ticked, *Delete ticked (n)* above the table deletes them all the same way. Deleting is permanent and, signed in, also removes the throw's raw recording and applies on your other devices.
- **Stats:** mean, spread (standard deviation) and range per metric, with an optional target min/max. Targets colour the tiles and table cells and count hits ("4/9 on target").
- **Detail:** every number, the disc's flags (angles measured or estimated, spin source, landing), actual distance and a note, plus the simulated path from above and from the side. *Open in flight lab* replays it in 3D (`index.html?throw=<id>`).
- **Compare:** throws side by side with differences against the first one ticked (A), and their paths overlaid.
- **Import/Export:** JSON. Import merges by throw id, so importing a file twice doesn't duplicate.

Throws from the disc without a valid speed are kept (angles only) and marked as not simulated.

## Accounts and the server (`server/`)

Without an account, or with no server running, throws are saved in the browser's localStorage: the newest 500, on that device only. **Sign in** (top bar, both pages) switches the history to your account on the server:

- **Bigger history:** 20,000 throws per account by default, the same on every device you sign in on.
- **Live across devices:** a phone with the throws page open sees throws recorded on the computer within a second, over a server-sent event stream.
- **Offline-safe:** changes apply immediately and queue in the browser until the server has them. The dot on the account button is green when saved, amber while saving, red when the server can't be reached.
- **Uploading old throws:** the account menu offers to upload the throws saved in this browser. It copies them, and re-uploading never makes duplicates. Signing out shows the browser's own history again.

The server is `bun run server`: `server/main.ts` (Bun.serve) and `server/db.ts` (bun:sqlite). It stores users (argon2id password hashes), login sessions (only a SHA-256 of the cookie token is stored; HttpOnly, SameSite=Lax cookie, 60 days) and throws (the client's record as JSON, keyed by user and throw id). It refuses cross-site writes by checking Origin, and limits failed logins per IP and per IP + username. If `dist/` exists it also serves the built site, so production is `bun run build && bun run server` on one port.

| Env | Default | |
|---|---|---|
| `PORT` | 8787 | |
| `DISCYBOI_DB` | `data/discyboi.db` | SQLite file (git-ignored); back it up by copying it while the server is stopped |
| `DISCYBOI_SIGNUP` | `open` | `closed` stops new accounts |
| `DISCYBOI_MAX_THROWS` | 20000 | per account; the oldest are dropped beyond it |
| `DISCYBOI_TRUST_PROXY` | off | `1` behind a reverse proxy (the Vite dev proxy counts), so rate limits see real client IPs and https is detected |
| `DISCYBOI_FIRMWARE` | `firmware/` | folder with the disc firmware on offer, served under `/firmware/` (see below) |
| `DISCYBOI_MAX_INTEREST` | 2000 | most sign-ups kept from the landing page's "want a board?" form |
| `DISCYBOI_ORIGINS` | | extra allowed origins for writes, comma separated |

Over plain http on a LAN the session cookie and password travel unencrypted. That's fine at home, but put it behind https (e.g. `tailscale serve`, which Web Bluetooth also needs) before using it anywhere else, and set sign-up to `closed` once your accounts exist if the server is reachable from the internet.

API (JSON, cookie session): `GET /api/me`, `POST /api/signup|login|logout|password`, `GET /api/throws`, `POST /api/throws` (bulk upsert, ≤1000), `DELETE /api/throws[/id]`, `GET /api/events` (SSE: put / del / clear / prefs), `GET|PUT /api/prefs` (shared session start), `GET|PUT /api/captures/<throw id>` (raw sensor recording, binary, ≤256 KB, newest 1000 kept). `POST /api/interest` (landing-page sign-up: name, email, board or kit, optional note; no account, 5 per IP per hour, a hidden honeypot field drops bots).

**Board sign-ups:** `bun server/interest.ts` lists the people who used the landing page's form (`--csv` for a spreadsheet, `--delete <email>` to take someone off). On the host: `ssh <host> 'cd ~/srv/discyboi && ~/.bun/bin/bun server/interest.ts'`. One entry per email: signing up again replaces the details. The answer is the same whether or not the email was already listed, so the form can't be used to check who signed up.

**Disc firmware updates:** the server serves `firmware/manifest.json` and the signed image it names under `/firmware/`, without sign-in. `firmware/release.sh` in the repo puts them there; web deploys leave the folder alone. When a connected disc reports an older version than the manifest (or the same number from a different commit), an **Update firmware** button appears next to Connect. The page checks the file's size and SHA-256, uploads it over the disc's mcumgr SMP service, restarts the disc, reconnects and compares the version it then reports. A disc only boots images signed with the project's key, and goes back to its previous firmware if the new one doesn't start. Details are in `firmware/README.md`, "Updates over Bluetooth".

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
src/ui/       panels: disc picker, release, history, stats, device, account
src/ble/      protocol (byte layouts), Web Bluetooth client, firmware update (mcumgr SMP), fake device
src/store/    history (localStorage or account) + settings, API client, records from disc throws
server/       Bun + SQLite: accounts, sessions, throws, live events; serves dist/
src/throws/   throws page: metrics, SVG charts (paths, trend), page
```

`scene/world.ts` takes a `Hole` (tee, basket, obstacles), which is the hook for courses and scoring later.
