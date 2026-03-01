#!/usr/bin/env bash
# Start niesta-listener on port 4000. Logs to ~/.niesta/listener.log

set -e
LISTENER_PORT=4000
LOG_DIR=~/.niesta
LOG_FILE="$LOG_DIR/listener.log"

if command -v lsof &>/dev/null; then
  if lsof -i ":$LISTENER_PORT" -sTCP:LISTEN -t &>/dev/null; then
    echo "Port $LISTENER_PORT is already in use. Exiting."
    exit 1
  fi
fi

mkdir -p "$LOG_DIR"
cd "$(dirname "$0")"
exec uvicorn main:app --host 0.0.0.0 --port "$LISTENER_PORT" --reload >> "$LOG_FILE" 2>&1
