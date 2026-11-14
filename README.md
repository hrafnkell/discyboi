# discyboi

A flight tracker that mounts on a disc golf disc and reports each throw over Bluetooth. The goal is enough sensor data for reliable flight prediction:

- release detection and release speed
- hyzer angle and nose angle
- spin rate
- wobble / off-axis torque

The hardware is a small round PCB built around an nRF54L15 BLE SoC and IMUs read over SPI. It runs from a rechargeable cell and is meant to be sealed (potted or conformal-coated) into the disc.

## Revisions

| Rev | Radio | Sensors | Power | Status |
|---|---|---|---|---|
| [v1](v1/) | Bare nRF54L15-QFAA chip, with its own crystals, matching network and chip antenna | ADXL375 (±200 g) | Battery connector, P-FET reverse-polarity protection, MCP1700 3.0 V | Superseded |
| [v2](v2/) | Holyiot 26001A module (nRF54L15, chip antenna) | ADXL375 (±200 g) + LSM6DSV16X | LiPo pads, MCP73831 charger, MCP1700 3.0 V | Superseded |
| [v3](v3/) | Fanstel BC15M module (nRF54L15, PCB antenna, 6 × 9.6 mm) | 2 × LSM6DSV320X (one at the centre, one at r = 9 mm) | LiPo pads, MCP73831 (100 mA), MCP1700 3.0 V | Superseded (LiPo cells are hard to get shipped) |
| **[v4](v4/)** | **Fanstel BC15M** | **2 × LSM6DSV320X** | **CR2032 in a clip on the back**, 100 µF bulk, MCP1700 3.0 V. Charger kept but not fitted (LIR2032 option) | **Current.** Ø34 mm. Gerbers and BOMs are in `v4/jlcpcb/` |

v4 runs from a CR2032 in a clip on the back of the board instead of a LiPo (small LiPo cells are hard to get shipped to Iceland). v3 replaced the ADXL375 with a second LSM6DSV320X. Each one has a ±320 g high-g accelerometer next to the IMU, and placing one 9 mm off-centre means spin rate can be computed from centripetal acceleration well past the gyro's 4000 dps limit. See the [v4 README](v4/README.md) for specs, the full pinout and how to regenerate the board.

## Layout

```
NOTES.md               original design notes: part choices, power and mechanical considerations
DS_lsm6dsv320x.pdf     IMU datasheet
holyiot/               photos of the Holyiot 26001A module (v2)
v1/ … v4/              KiCad projects, one per board revision
v4/gen/                Python generators for v4's schematic, footprints and PCB (source of truth)
v4/jlcpcb/             fabrication outputs (gerbers, BOM, CPL)
v4/enclosure/          OpenSCAD case (base + screw-on battery lid), STLs, centring jig
ENG_CD_C_BAT_HLD_*.pdf TE/Linx coin-cell clip drawings (003 = CR2032, used on v4)
firmware/              Zephyr firmware for v3 and v4 (same pinout)
web/                   three.js flight lab: flight simulator, Web Bluetooth client, throw history
```

## Tools

- KiCad 9 (schematic, PCB, `kicad-cli` for ERC/DRC and exports)
- Freerouting (`~/Downloads/freerouting*.AppImage`) for autorouting v3 and v4
- JLCPCB for fabrication. Mouser for the parts (single-supplier BOM)

## Firmware

[`firmware/`](firmware/) holds a preliminary Zephyr (v4.0) application for v3 and v4 (same pinout). It builds and its analysis maths passes host tests, but it hasn't run on hardware yet.

- **Detection:** finds throws with a pull/release state machine at 960 Hz, keeping a 3 s ring buffer.
- **Measurements:** release speed, hyzer, nose and launch angles, spin (from the gyro, or centripetal when the gyro saturates), wobble and flight time.
- **BLE:** sends each result, plus the battery level, and can send the raw capture for offline analysis.
- **Build:** `firmware/build.sh` runs the build in Docker. Flashing is over SWD (Tag-Connect), with logs over RTT.

See the [firmware README](firmware/README.md) for the BLE protocol and the bring-up TODO list.

## Web

[`web/`](web/) is a browser app (Vite + TypeScript + three.js, run with bun). It simulates disc flights from speed, spin, hyzer, nose and launch angle plus a disc's flight numbers, and animates them in 3D. It receives throws from the disc over Web Bluetooth (or from a fake disc with `?fake=1`) and keeps a throw history. See the [web README](web/README.md).
