#!/bin/sh
# Some platforms (Railway) mount volumes owned by root. Fix ownership, then permanently drop to the unprivileged `node` user.
set -e
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${DATA_DIR:-/data}" 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
