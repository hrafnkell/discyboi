#!/usr/bin/env bash
# Publish the built firmware to the web app's host. The app then offers it to any connected
# disc that runs something older ("Update firmware" next to the Connect button).
#   ./release.sh [user@host] [remote dir]      (defaults: hrafnkell@192.168.1.91 ~/srv/discyboi)
# Run ./build.sh first, from a clean checkout: the image must carry the commit it was built from.
# Only the signed image is published; the signing key never leaves keys/.
set -euo pipefail
cd "$(dirname "$0")"
HOST=${1:-hrafnkell@192.168.1.91}
DIR=${2:-srv/discyboi}
BIN=build/app/zephyr/zephyr.signed.bin
die() { echo "release: $*" >&2; exit 1; }

[ -f "$BIN" ] || die "no build: run ./build.sh"
ID="$(sed -n 's/^#define DISCY_BUILD_ID "\(.*\)"$/\1/p' app/src/build_id.h)"
NUM="$(sed -n 's/^VERSION_MAJOR = //p;s/^VERSION_MINOR = //p;s/^PATCHLEVEL = //p' app/VERSION | paste -sd.)"
VER="$NUM+$ID"
case "$ID" in
  ""|nogit|*-dirty) die "the build is from uncommitted changes ($VER): commit, then ./build.sh" ;;
esac
[ "$ID" = "$(git rev-parse --short HEAD)" ] || die "the build is from commit $ID, not the current one: run ./build.sh"
# The version text is inside the image (the disc reports it), so a stale build shows here.
grep -aqF "$VER" "$BIN" || die "$BIN is not version $VER: run ./build.sh"

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
FILE="discyboi-$NUM-$ID.bin"
cp "$BIN" "$OUT/$FILE"
printf '{"version":"%s","file":"%s","size":%s,"sha256":"%s"}\n' \
  "$VER" "$FILE" "$(stat -c %s "$BIN")" "$(sha256sum "$BIN" | cut -d' ' -f1)" > "$OUT/manifest.json"

ssh "$HOST" "mkdir -p ~/$DIR/firmware"
# Image first, manifest last: the manifest never points at a file that isn't there yet.
rsync -az "$OUT/$FILE" "$HOST:$DIR/firmware/"
rsync -az "$OUT/manifest.json" "$HOST:$DIR/firmware/"
echo "published firmware $VER -> $HOST:$DIR/firmware/$FILE"
