# discyboi firmware (preliminary)

Zephyr firmware for the [v4 board](../v4/README.md). It detects throws with the two LSM6DSV320X IMUs, works out release speed, angles and spin, and reports them over BLE. It can also send the raw 3-second capture of each throw so the algorithms can be refined offline.

**Status: runs on the v4 board.** It now boots through MCUboot and takes updates over Bluetooth (not yet tried on hardware). First boot on 2026-11-23: both IMUs answer (3 blinks) and motion moves the state machine from IDLE to ARMED. Bluetooth and real throws are still to be checked. The analysis maths is tested on the host with synthetic throws (`test/`), and the thresholds will need tuning against real throws.

## Building

```sh
./build.sh            # first run fetches Zephyr v4.0 (+ Nordic HAL, MCUboot) into this folder
./build.sh pristine   # clean build
```

The build runs in the `zmkfirmware/zmk-build-arm:stable` Docker image, which uses Zephyr SDK 0.16.9. No local toolchain is needed. MCUboot's signing tool needs a few Python packages the image lacks, so the first run installs them into `.pydeps/` with the host's `pip`.

The build makes MCUboot and the app (sysbuild) and signs the app:

| File | Use |
|---|---|
| `build/merged.hex` | MCUboot + app. The first, wired flash. |
| `build/app/zephyr/zephyr.signed.bin` | The app alone. Updates over Bluetooth. |
| `build/app/zephyr/zephyr.elf` | Symbols, for the RTT log. |

**Signing key:** `keys/discyboi-ec-p256.pem` is created on the first build and is not in git. **Back it up.** A board running MCUboot only accepts updates signed with that key, so without it the board needs another wired flash.

- **Zephyr:** upstream, not the nRF Connect SDK. It uses the open-source Bluetooth controller (`BT_LL_SW_SPLIT`).
- **Board:** `discyboi/nrf54l15/cpuapp`, defined in `app/boards/discyboi/`.
- **Battery:** `CONFIG_DISCY_BATTERY_AUTO=y` (default) picks the battery-level curve itself. It uses the coin-cell curve until VBAT has been seen above 3.45 V, then switches to the LiPo curve for the rest of the session (a CR2032 never reads that high). Force one with `CONFIG_DISCY_BATTERY_COIN=y` or `CONFIG_DISCY_BATTERY_LIPO=y` in `prj.conf`.

## Flashing and logs

The debug connector is the Tag-Connect TC2030 footprint J2. Seen from the top, flat edge up:

```
   (2) SWDIO   (4) SWDCLK   (6) –
   (1) +3V0    (3) NRESET   (5) GND
```

### With a Raspberry Pi Pico (RP2040) and probe-rs

This is the cheapest route, and the one used for first bring-up.

1. Flash `debugprobe_on_pico.uf2` from [raspberrypi/debugprobe](https://github.com/raspberrypi/debugprobe/releases) onto the Pico: hold BOOTSEL, plug it in, and drag the file onto the drive. It becomes a CMSIS-DAP probe.
2. Wire it to J2 (soldered 30 AWG wires or pogo pins, if you don't have the TC2030 cable):

   | Pico | J2 |
   |---|---|
   | GP2 (pin 4) | 4 SWDCLK |
   | GP3 (pin 5) | 2 SWDIO |
   | GND (pin 3) | 5 GND |
   | 3V3 OUT (pin 36) | 1 +3V0, only with no cell in the clip |

   **Power from the Pico or from a coin cell, never both.** The Pico's 3.3 V would back-feed through U2 (or a wire link fitted in its place) into the CR2032.
3. Install [probe-rs](https://probe.rs) (0.32 or later lists the `nRF54L15`) and run, on the host:

```sh
probe-rs info                                            # debug port should be Nordic, part 0x1c0
probe-rs erase --chip nRF54L15 --allow-erase-all         # first time only: a new nRF54L15 is locked
probe-rs download --chip nRF54L15 --binary-format hex build/merged.hex   # MCUboot + app
probe-rs reset --chip nRF54L15
probe-rs attach --chip nRF54L15 build/app/zephyr/zephyr.elf               # RTT log
```

- Flash **merged.hex**: it holds MCUboot and the *signed* app. MCUboot refuses an unsigned image, so `probe-rs run …/zephyr.elf` flashes a board that never starts the app.
- `probe-rs info` reports `debug entry not present` on the two memory APs even after unlocking. That's normal for this chip. To check that it's unlocked, read the erased flash with `probe-rs read --chip nRF54L15 b32 0x0 4`, which should return `ffffffff`.
- probe-rs warns that RTT channels 1 and 2 aren't initialised. The log is on channel 0, so ignore it.
- With power from the Pico and no cell, the battery reads a few hundred mV (0 %). That's expected.

### With a J-Link or an nRF54L15 DK

Connect through the Tag-Connect TC2030 on J2, then run these on the host, not in Docker:

```sh
nrfutil device recover                                   # first time only: a new nRF54L15 may be locked
nrfutil device program --firmware build/merged.hex --options chip_erase_mode=ERASE_RANGES_TOUCHED_BY_FIRMWARE
nrfutil device reset
JLinkRTTViewer   # or JLinkRTTLogger: logs go over RTT (there's no UART)
```

**LED at boot:** 3 blinks means everything is up. 10 fast blinks means an IMU didn't answer; the RTT log says which one.

### Updates over Bluetooth

Once MCUboot is on the board, the app is updated over Bluetooth and the debug leads aren't needed. The firmware runs the mcumgr SMP service next to the discyboi service.

1. Build, then copy `build/app/zephyr/zephyr.signed.bin` to your phone.
2. Disconnect the web app: the disc takes one connection at a time.
3. In **nRF Connect Device Manager** (Android/iOS), pick `discyboi`, then Image → Firmware Upgrade. Select the file and choose mode **Test only**. From a PC, the `mcumgr` CLI works too: `mcumgr --conntype ble --connstring peer_name=discyboi image upload zephyr.signed.bin`, then `image test <hash>` and `reset`.
4. The disc resets, MCUboot swaps in the new image and the app boots. If both IMUs answer, the app confirms the new image itself (RTT: `new firmware confirmed`).

If the new image crashes or an IMU fails on that first boot, it isn't confirmed, and the next reset brings back the previous firmware. Pull and refit the cell to force that reset.

- **Signature:** MCUboot only boots images signed with `keys/discyboi-ec-p256.pem`. The SMP service itself is open, though: anyone in range can upload, but only a signed image ever runs.
- **First boot after an update takes a few seconds longer** while MCUboot swaps the slots. Don't pull the cell during that time. The swap resumes after a power cut, but there's no reason to test that.

## How it works

| State | IMUs | Moves on when |
|---|---|---|
| **IDLE** | Centre IMU accel only, low-power 30 Hz | \|a\| moves more than 0.35 g away from 1 g → ARMED |
| **ARMED** | Both IMUs at 960 Hz: gyro + ±16 g + ±320 g. Every sample goes into a 3 s ring buffer | Centre accel > 4 g for 20 ms → PULL. 30 s without motion → IDLE |
| **PULL** | Recording | Accel < 2.5 g while spinning > 200 rpm for 5 ms → POST (release). 1.5 s with no release → ARMED |
| **POST** | Recording 0.5 s after release | Buffer frozen, analysis runs → FLIGHT |
| **FLIGHT** | Not recording | Impact > 6 g, spin < 60 rpm, or 15 s → result sent → ARMED |

The data-ready interrupt from the centre IMU (INT1, pulsed) paces sampling, and both IMUs are read in one SPI burst each.

**Analysis** (`src/analysis.c`):
1. Finds a still 100 ms window before the pull. Its mean accelerometer reading defines "up".
2. Integrates the gyro from there to release to track orientation.
3. Rotates the accelerometer into the world frame, removes gravity and integrates to get the release velocity.

From the velocity and the disc normal at release it computes:
- **speed**
- **hyzer:** roll about the flight direction
- **nose:** pitch, relative to horizontal
- **launch angle**

It also measures:
- **spin:** the average over the 20 ms after release. Above ~4000 dps (≈667 rpm) the gyro saturates. Spin then comes from the centripetal difference between the rim IMU and the centre IMU: ω = √(Δa / r).
- **wobble:** the RMS of off-axis rotation over the 0.5 s after release.
- **peak g** and **pull duration**.

There is no magnetometer, so compass heading is unknown, but none of the outputs need it.

### Known limitations

- **No still moment:** if the disc never sits still in the 2.5 s before the throw (a run-up, for example), there's no reference for "up". Speed and angles are then not reported; spin, wobble and flight time still are.
- **Drift:** integration drift grows with the time between the still moment and release.
- **Rim spin bias:** while the disc spins up during the pull, tangential acceleration slightly inflates the rim IMU's spin estimate. This mostly affects the orientation during the pull.
- **Timing:** sample timing assumes exactly 960 Hz. The IMU's ODR is only good to a few percent unless it's corrected with `INTERNAL_FREQ_FINE` or high-accuracy ODR mode.
- **Mounting:** the firmware assumes the board's z axis is the disc's spin axis and the centre IMU is on it.

## BLE

The device advertises as `discyboi` (connectable, ~0.5 s interval) with the standard **Battery Service** and the custom service below. All values are little-endian.

**Service `6d2b0001-5f3c-4b8a-9e0d-d15cb0100000`**

| Characteristic | UUID | Properties | Content |
|---|---|---|---|
| Throw | `6d2b0002-…` | read, notify | Latest throw result (26 bytes, below) |
| Status | `6d2b0003-…` | read, notify | `u8 state` (0 idle, 1 armed, 2 pull, 3 post, 4 flight), `u8 downloading`, `u16 battery_mv`, `u32 throws` |
| Control | `6d2b0004-…` | write | `0x01` download the last capture, `0x02` abort the download, `0x10` blink the LED to identify the disc |
| Data | `6d2b0005-…` | notify | Raw capture download |

**Throw result**

| Field | Type | Unit |
|---|---|---|
| throw_id | u32 | |
| flags | u16 | bit0 angles valid, bit1 speed valid, bit2 spin from centripetal, bit3 landing detected, bit4 reference was only a calm (not still) moment, so speed and angles are approximate, bit5 no speed/angles: nothing calm before the pull, bit6 no speed/angles: implausible velocity |
| spin_rpm | i16 | rpm, + = counter-clockwise seen from the top of the board |
| speed_cms | u16 | cm/s |
| hyzer_cdeg | i16 | 0.01°, + = right edge down |
| nose_cdeg | i16 | 0.01°, + = nose up |
| launch_cdeg | i16 | 0.01° above horizontal |
| wobble_dps | u16 | °/s RMS |
| peak_dg | u16 | 0.1 g |
| pull_ms | u16 | ms |
| flight_ms | u16 | ms |
| battery_mv | u16 | mV |

**Raw download.** Subscribe to Data, then write `0x01` to Control. The device sends three kinds of packet:

1. **Header** (`type 0x00`): version, sample size (30), throw id, sample count, pull and release indices, ODR, rim radius, and the scale factors (dps/LSB, g/LSB low-g, g/LSB high-g as floats).
2. **Samples** (`type 0x01`): `u8 count`, `u16 first index`, then `count` samples. Each sample is 15 × `i16`: centre gyro xyz, centre accel xyz, centre high-g xyz, rim accel xyz, rim high-g xyz.
3. **End** (`type 0x02`): `u8 status` (0 complete, 1 aborted, 2 nothing to send / busy), then `u16 samples sent`.

Request a large MTU (247) first. That gives 8 samples per packet, so a full capture is about 360 packets, a few seconds on 2M PHY. New throws aren't captured while a download is running.

## Layout

```
build.sh                  Docker build
app/west.yml              manifest: Zephyr v4.0 + cmsis, hal_nordic, segger, tinycrypt
app/boards/discyboi/      board definition (pins from v4/gen/design.py)
app/dts/bindings/         devicetree binding for the IMUs
app/src/imu.c             LSM6DSV320X register driver (SPI)
app/src/capture.c         sampling thread + throw state machine
app/src/analysis.c        release speed / angles / spin / wobble
app/src/ble.c             GATT service, raw download
app/src/battery.c         VBAT via AIN2, Battery Service
app/src/led.c             status LED
test/                     host test: synthetic throws through analysis.c (`make -C test`)
```

## Bring-up TODO

- **Clocks:** check whether the BC15M has a 32.768 kHz crystal. The build currently uses the calibrated RC oscillator.
- **Regulator:** check whether the BC15M has the DC/DC inductor fitted. The build currently uses LDO mode.
- **IMUs:** confirm WHO_AM_I (0x73) on both IMUs and the axis directions on the real board.
- **Tuning:** tune the thresholds (pull 4 g, release 2.5 g, landing 6 g) against real throws.
- **Power:** measure current in IDLE and ARMED. Consider the IMU's own wake-up interrupt for IDLE instead of polling at 30 Hz.
- **Updates:** add MCUboot + BLE DFU (the flash partitions already leave room).
