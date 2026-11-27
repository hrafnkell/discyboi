#!/usr/bin/env bash
# Build the web app and deploy it with its server to a host running a systemd user service.
#   deploy/deploy.sh [user@host] [remote dir]
# Defaults come from DEPLOY_HOST and DEPLOY_DIR in the repo's .env (git-ignored; see .env.example).
# The database (data/) and .env on the host are never touched.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f ../.env ] && . ../.env
HOST=${1:-${DEPLOY_HOST:-}}
DIR=${2:-${DEPLOY_DIR:-srv/discyboi}}
[ -n "$HOST" ] || { echo "deploy: no host: set DEPLOY_HOST in .env (see .env.example) or pass user@host" >&2; exit 1; }

bun run build
ssh "$HOST" "mkdir -p ~/$DIR/data ~/.config/systemd/user"
rsync -az --delete dist/ "$HOST:$DIR/dist/"
rsync -az --delete server/ "$HOST:$DIR/server/"
rsync -az package.json "$HOST:$DIR/"
rsync -az deploy/discyboi.service "$HOST:.config/systemd/user/discyboi.service"
ssh "$HOST" "systemctl --user daemon-reload && systemctl --user enable discyboi >/dev/null 2>&1 && systemctl --user restart discyboi && sleep 1 && systemctl --user is-active discyboi"
