I'm making a disc golf flight tracker that's on the disc, and reports back via bluetooth. Needs good sensors for dependable flight prediction - Need release detection, release speed, hyzer angle, nose angle, spin rate

Let's try to build this schematic +pcb in kicad. Using LCSC parts (will order using jlcpcb). Surface mount components, round pcb. Will probably order the module separately and solder it on.
freerouting is in ~/Downloads/freerouting*.AppImage

Holyiot nrf54l15 26001A module (chip antenna) 10x12.5mm
I put some pictures in the holyiot folder.


Core 
nRF54L15 module (holyiot 26001a, Fanstel BM15C / Raytac AN54LQ-15 / Ezurio BL54L15) — SoC + crystals + antenna + certification in one part
Decoupling caps on the module’s supply (a 0.1 µF + a 1–10 µF bulk)
SWD programming pads — SWDIO, SWDCLK, RESET, VDD, GND (a Tag-Connect footprint saves space vs a header)
User LED + current-limit resistor; optional small button


Sensors (both routes — this is the point of the board)
ADXL375 (±200 g) — your spin + release/impact sensor, with its decoupling caps
ICM-42688-P (6-axis) — since you’re going custom, put the good IMU on, not the LSM6DS3TR-C. Low noise, high ODR, for orientation, hyzer angle, and wobble/OAT, with decoupling

Run both on SPI, not I2C — separate chip-select lines, shared clock/data. At the 1–4 kHz sample rates you want for the release window, SPI gives you the headroom I2C doesn’t.

Power — and one real gotcha

The battery choice forces a regulator decision:

Coin cell (3 V) sits inside the nRF54L15’s 1.7–3.6 V range, so it can run direct, no regulator. The catch: a BLE transmit spike (~5–15 mA) can brown out a CR2032. Use a healthy bulk cap right at the radio, and prefer a rechargeable LiR2032 if you’ll cycle it a lot.

Debug / programming note

Unlike the nRF52840, the nRF54L15 has no native USB, so there’s no USB bootloader. You program via SWD, and for logs you use RTT over that same SWD (free, no extra parts) rather than a USB-UART bridge. For a sealed disc you’d do firmware updates over BLE DFU in the field and keep the SWD pads just for bring-up. Don’t spend parts on a USB connector unless you specifically want one.

Don’t forget (mechanical/reliability)

Center the mass for disc balance, keep the antenna away from the battery and ground pour (easy with a module — respect its keep-out), and foam-pot or conformal-coat the assembly since even a net catch is a shock event. ESD protection on any exposed charge contacts.

Net of it: with the module route your from-scratch board is really just module + ADXL375 + ICM-42688-P + charger + regulator + battery + a handful of passives and pads — very buildable as a first custom PCB, and JLCPCB-assembly-friendly.
