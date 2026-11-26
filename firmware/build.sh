#!/usr/bin/env bash
# Build the firmware with the Zephyr SDK from the ZMK build image (no local toolchain needed).
#   ./build.sh            fetch Zephyr on first run, then build:
#                           build/merged.hex                   MCUboot + app, for the first wired flash
#                           build/app/zephyr/zephyr.signed.bin app only, for updates over Bluetooth
#   ./build.sh pristine   clean build
# Images are signed with keys/discyboi-ec-p256.pem (created on first run, not in git: back it up,
# a board flashed with MCUboot only accepts updates signed with that key).
# MCUboot's imgtool needs cbor2/click/cryptography, which the image lacks: they are installed
# into .pydeps with the host's pip (same Python 3.12 as the image).
set -euo pipefail
cd "$(dirname "$0")"
IMAGE=zmkfirmware/zmk-build-arm:stable
PRISTINE=auto; [ "${1:-}" = pristine ] && PRISTINE=always
# The image header's version (MCUboot, checked by the web app) is only re-read from app/VERSION
# when the configuration is regenerated, which a VERSION-only change doesn't trigger.
WANT="$(sed -n 's/^VERSION_MAJOR = //p;s/^VERSION_MINOR = //p;s/^PATCHLEVEL = //p' app/VERSION | paste -sd.)"
HAVE="$(sed -n 's/^CONFIG_MCUBOOT_IMGTOOL_SIGN_VERSION="\([0-9.]*\)+.*/\1/p' build/app/zephyr/.config 2>/dev/null || true)"
[ -z "$HAVE" ] || [ "$HAVE" = "$WANT" ] || { echo "version $HAVE -> $WANT: clean build"; PRISTINE=always; }
# Stamp the git commit into the image (shown by the web app next to the version from app/VERSION).
ID="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
[ -z "$(git status --porcelain -- . 2>/dev/null)" ] || ID="$ID-dirty"
STAMP="#define DISCY_BUILD_ID \"$ID\""
[ "$(cat app/src/build_id.h 2>/dev/null)" = "$STAMP" ] || echo "$STAMP" > app/src/build_id.h
[ -d .pydeps ] || python3 -m pip install -q --target .pydeps cbor2 click cryptography
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e PYTHONPATH=/ws/.pydeps -v "$PWD:/ws" -w /ws "$IMAGE" bash -c "
  set -e
  [ -d .west ] || west init -l app
  [ -d bootloader/mcuboot ] || west update --narrow -o=--depth=1
  [ -f keys/discyboi-ec-p256.pem ] || { mkdir -p keys; python3 bootloader/mcuboot/scripts/imgtool.py keygen -k keys/discyboi-ec-p256.pem -t ecdsa-p256; chmod 600 keys/discyboi-ec-p256.pem; }
  west build --sysbuild -p $PRISTINE -b discyboi/nrf54l15/cpuapp -d build app -- \\
    -DBOARD_ROOT=/ws/app -DDTS_ROOT=/ws/app \\
    -DSB_CONFIG_BOOT_SIGNATURE_KEY_FILE=\\\"/ws/keys/discyboi-ec-p256.pem\\\"
  python3 -c 'from intelhex import IntelHex as H; m = H(\"build/mcuboot/zephyr/zephyr.hex\"); m.merge(H(\"build/app/zephyr/zephyr.signed.hex\")); m.write_hex_file(\"build/merged.hex\")'
"
echo "firmware $(sed -n 's/^VERSION_MAJOR = //p;s/^VERSION_MINOR = //p;s/^PATCHLEVEL = //p' app/VERSION | paste -sd.)+$ID"
echo "-> build/merged.hex (first flash), build/app/zephyr/zephyr.signed.bin (Bluetooth update)"
