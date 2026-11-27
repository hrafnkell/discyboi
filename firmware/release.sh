#!/usr/bin/env bash
# Publish the built firmware to the web app's host. The app then offers it to any connected
# disc that runs something older ("Update firmware" next to the Connect button).
#   ./release.sh [user@host] [remote dir]
# Defaults come from DEPLOY_HOST and DEPLOY_DIR in the repo's .env (git-ignored; see .env.example).
# It also makes a GitHub release, tag firmware-v<version> on the build's commit, with the same
# files (needs the gh CLI, logged in; NO_GITHUB=1 skips it). The web app can't update from there
# (GitHub's downloads don't allow cross-origin fetches), but builders get the first-flash image at
# https://github.com/hrafnkell/discyboi/releases/latest/download/discyboi-full.hex
# Run ./build.sh first, from a clean checkout: the image must carry the commit it was built from.
# Publishes the signed app image (for updates over Bluetooth) and merged.hex, MCUboot + app, for the
# first wired flash of a new board (also as discyboi-full.hex, the link on the build page). Boards
# flashed with it take the published updates. The signing key never leaves keys/.
set -euo pipefail
cd "$(dirname "$0")"
[ -f ../.env ] && . ../.env
HOST=${1:-${DEPLOY_HOST:-}}
DIR=${2:-${DEPLOY_DIR:-srv/discyboi}}
BIN=build/app/zephyr/zephyr.signed.bin
HEX=build/merged.hex
die() { echo "release: $*" >&2; exit 1; }
[ -n "$HOST" ] || die "no host: set DEPLOY_HOST in .env (see .env.example) or pass user@host"

[ -f "$BIN" ] && [ -f "$HEX" ] || die "no build: run ./build.sh"
[ "$HEX" -nt "$BIN" ] || [ "$(stat -c %Y "$HEX")" = "$(stat -c %Y "$BIN")" ] || die "$HEX is older than $BIN: run ./build.sh"
ID="$(sed -n 's/^#define DISCY_BUILD_ID "\(.*\)"$/\1/p' app/src/build_id.h)"
NUM="$(sed -n 's/^VERSION_MAJOR = //p;s/^VERSION_MINOR = //p;s/^PATCHLEVEL = //p' app/VERSION | paste -sd.)"
VER="$NUM+$ID"
case "$ID" in
  ""|nogit|*-dirty) die "the build is from uncommitted changes ($VER): commit, then ./build.sh" ;;
esac
[ "$ID" = "$(git rev-parse --short HEAD)" ] || die "the build is from commit $ID, not the current one: run ./build.sh"
# The version text is inside the image (the disc reports it), so a stale build shows here.
grep -aqF "$VER" "$BIN" || die "$BIN is not version $VER: run ./build.sh"
# MCUboot's header carries its own copy (what the web app checks against the manifest). It can
# go stale when only app/VERSION changed; build.sh then builds pristine, but check anyway.
HDR="$(od -An -t u1 -j 20 -N 4 "$BIN" | awk '{print $1"."$2"."($3+256*$4)}')"
[ "$HDR" = "$NUM" ] || die "$BIN's MCUboot header says $HDR, not $NUM: run ./build.sh pristine"

# GitHub release (below): its commit must already be on GitHub. Checked first, so nothing half-happens.
TAG="firmware-v$NUM"
SHA="$(git rev-parse HEAD)"
if [ "${NO_GITHUB:-}" != 1 ]; then
  git fetch -q origin && git merge-base --is-ancestor "$SHA" "origin/$(git rev-parse --abbrev-ref HEAD)" ||
    die "commit $ID isn't on GitHub yet: push first (or NO_GITHUB=1 to skip the GitHub release)"
fi

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
FILE="discyboi-$NUM-$ID.bin"
FULL="discyboi-$NUM-$ID.hex"
cp "$BIN" "$OUT/$FILE"
cp "$HEX" "$OUT/$FULL"
cp "$HEX" "$OUT/discyboi-full.hex"
printf '{"version":"%s","file":"%s","size":%s,"sha256":"%s","full":"%s"}\n' \
  "$VER" "$FILE" "$(stat -c %s "$BIN")" "$(sha256sum "$BIN" | cut -d' ' -f1)" "$FULL" > "$OUT/manifest.json"

ssh "$HOST" "mkdir -p ~/$DIR/firmware"
# Image first, manifest last: the manifest never points at a file that isn't there yet.
rsync -az "$OUT/$FILE" "$OUT/$FULL" "$OUT/discyboi-full.hex" "$HOST:$DIR/firmware/"
rsync -az "$OUT/manifest.json" "$HOST:$DIR/firmware/"
echo "published firmware $VER -> $HOST:$DIR/firmware/$FILE (+ $FULL, discyboi-full.hex)"

# ---- GitHub release
[ "${NO_GITHUB:-}" = 1 ] && exit 0
PREV="$(git tag --list 'firmware-v*' --sort=-v:refname | grep -vx "$TAG" | head -1 || true)"
{
  echo "Firmware $VER for the v4 board."
  echo
  echo "- **New board:** flash \`discyboi-full.hex\` (MCUboot + app) over SWD once; see https://discyboi.com/build/#flash."
  echo "- **Updates:** connect the disc in https://discyboi.com/lab/ and press *Update firmware*. \`$FILE\` is that update image."
  echo
  if [ -n "$PREV" ]; then echo "Changes since $PREV:"; git log --format='- %s' "$PREV..$SHA" -- . ; else echo "First firmware release on GitHub."; fi
} > "$OUT/notes.md"
if gh release view "$TAG" >/dev/null 2>&1; then
  # Same version rebuilt: move the tag to this commit and replace the files.
  git tag -f "$TAG" "$SHA" >/dev/null && git push -qf origin "refs/tags/$TAG"
  gh release upload "$TAG" "$OUT/$FILE" "$OUT/$FULL" "$OUT/discyboi-full.hex" --clobber
  gh release edit "$TAG" --notes-file "$OUT/notes.md" --latest >/dev/null
else
  gh release create "$TAG" "$OUT/$FILE" "$OUT/$FULL" "$OUT/discyboi-full.hex" --target "$SHA" \
    --title "Firmware $NUM" --notes-file "$OUT/notes.md" --latest >/dev/null
fi
echo "GitHub release $TAG: https://github.com/hrafnkell/discyboi/releases/tag/$TAG"
