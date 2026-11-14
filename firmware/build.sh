#!/usr/bin/env bash
# Build the firmware with the Zephyr SDK from the ZMK build image (no local toolchain needed).
#   ./build.sh            fetch Zephyr on first run, then build -> build/zephyr/zephyr.hex
#   ./build.sh pristine   clean build
set -euo pipefail
cd "$(dirname "$0")"
IMAGE=zmkfirmware/zmk-build-arm:stable
PRISTINE=auto; [ "${1:-}" = pristine ] && PRISTINE=always
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/ws" -w /ws "$IMAGE" bash -c "
  set -e
  [ -d .west ] || west init -l app
  [ -d zephyr ] || west update --narrow -o=--depth=1
  west build -p $PRISTINE -b discyboi/nrf54l15/cpuapp -d build app
"
echo "-> build/zephyr/zephyr.hex"
