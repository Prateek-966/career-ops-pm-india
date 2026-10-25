#!/bin/sh
set -eu

# Render mounts the persistent disk at /app. Keep code in the immutable image
# and sync it in without overwriting the user's CV, tracker, reports, or config.
STATE_ROOT=/app
SOURCE_ROOT=/opt/career-ops

mkdir -p "$STATE_ROOT"
rsync -a \
  --exclude '/.env' \
  --exclude '/cv.md' \
  --exclude '/article-digest.md' \
  --exclude '/portals.yml' \
  --exclude '/data/***' \
  --exclude '/reports/***' \
  --exclude '/output/***' \
  --exclude '/jds/***' \
  --exclude '/.career-ops-web/***' \
  --exclude '/config/profile.yml' \
  --exclude '/modes/_profile.md' \
  --exclude '/node_modules/***' \
  --exclude '/web/node_modules/***' \
  "$SOURCE_ROOT/" "$STATE_ROOT/"

ln -sfn "$SOURCE_ROOT/node_modules" "$STATE_ROOT/node_modules"
ln -sfn "$SOURCE_ROOT/web/node_modules" "$STATE_ROOT/web/node_modules"

cd "$STATE_ROOT/web"
exec npm run start -- -H 0.0.0.0 -p "$PORT"