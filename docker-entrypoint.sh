#!/bin/sh
# Boot script. If Backblaze B2 credentials are set, the SQLite database is made
# DURABLE with Litestream: restored from B2 on start-up and continuously
# replicated back. If they are not set, the app runs directly on the local
# (possibly ephemeral) disk — the quick-launch path, where data resets on
# restart.
#
# The same image therefore serves both modes; which one runs is decided purely
# by whether B2 is configured.
set -e

mkdir -p "$DATA_DIR"

if [ -n "$B2_KEY_ID" ] && [ -n "$B2_BUCKET_NAME" ]; then
  # Only restore when there is no local database yet (fresh ephemeral boot). On
  # a host with a persistent disk the file already exists and we just replicate.
  if [ ! -f "$DB_PATH" ]; then
    echo "[litestream] no local database — restoring from B2 if a backup exists…"
    litestream restore -if-replica-exists -config /app/litestream.yml "$DB_PATH" || true
  fi
  echo "[litestream] durable storage ON — replicating to B2 and starting the app"
  exec litestream replicate -config /app/litestream.yml -exec "node index.js"
else
  echo "[litestream] durable storage OFF (no B2 credentials) — data will reset on restart"
  exec node index.js
fi
