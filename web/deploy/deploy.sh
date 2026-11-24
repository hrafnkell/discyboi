#!/usr/bin/env bash
# Build the web app and deploy it with its server to a host running a systemd user service.
#   deploy/deploy.sh [user@host] [remote dir]      (defaults: hrafnkell@192.168.1.91 ~/srv/discyboi)
# The database (data/) and .env on the host are never touched.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${1:-hrafnkell@192.168.1.91}
DIR=${2:-srv/discyboi}

bun run build
ssh "$HOST" "mkdir -p ~/$DIR/data ~/.config/systemd/user"
rsync -az --delete dist/ "$HOST:$DIR/dist/"
rsync -az --delete server/ "$HOST:$DIR/server/"
rsync -az package.json "$HOST:$DIR/"
rsync -az deploy/discyboi.service "$HOST:.config/systemd/user/discyboi.service"
ssh "$HOST" "systemctl --user daemon-reload && systemctl --user enable discyboi >/dev/null 2>&1 && systemctl --user restart discyboi && sleep 1 && systemctl --user is-active discyboi"
