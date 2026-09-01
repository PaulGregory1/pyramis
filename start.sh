#!/bin/sh
# Démarre Pyra et ouvre le navigateur. Le serveur n'écoute que sur 127.0.0.1.
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install
node scripts/fix-pty.mjs >/dev/null 2>&1
node server.mjs &
PID=$!
sleep 1
open "http://127.0.0.1:${PORT:-4331}"
wait $PID
