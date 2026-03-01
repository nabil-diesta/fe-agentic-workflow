# niesta-listener

A small FastAPI server that runs locally on your MacBook (port 4000). It reads Codex session files and runs Codex commands on instruction from Niesta.

## What it does

1. **Sessions API** — Walks `~/.codex/sessions`, parses `.jsonl` session files, and exposes them via REST (all sessions, active only, or by `session_id`).
2. **Executor** — Receives tasks from Niesta and runs `codex "<task>"` in a given directory, returning a `task_id` and tracking running processes.

## Setup

### 1. Python 3.11

```bash
python3 --version  # should be 3.11+
```

Use `pyenv`, Homebrew, or system Python as you prefer.

### 2. Install dependencies

```bash
cd niesta-listener
pip install -r requirements.txt
```

### 3. Optional: override config via .env

Create a `.env` in this directory (or export in your shell):

```bash
# Optional overrides (defaults shown)
WORK_REPO_PATH=~/sites/diesta-agent
CODEX_SESSIONS_PATH=~/.codex/sessions
NIESTA_API_URL=http://72.62.7.232:8000
LISTENER_PORT=4000
```

### 4. Start the listener

**One-off (foreground):**

```bash
./start.sh
```

Or:

```bash
uvicorn main:app --host 0.0.0.0 --port 4000 --reload
```

**With logging to file:**

`start.sh` checks if port 4000 is free; if so, it starts uvicorn and appends output to `~/.niesta/listener.log`. If the port is in use, it exits without starting.

```bash
chmod +x start.sh
./start.sh
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{ "status": "ok", "port": 4000 }` |
| GET | `/sessions` | All parsed Codex sessions (cached 30s) |
| GET | `/sessions/active` | Only active sessions (last activity < 24h) |
| GET | `/sessions/{session_id}` | Single session details |
| POST | `/run-codex` | Body: `{ "task": "...", "cwd": "..." }` — runs codex, returns `task_id`, `pid`, etc. |
| GET | `/running-tasks` | All currently running codex processes |
| GET | `/status` | Uptime, session count, running tasks |

CORS is allowed for all origins so an Angular (or other) dashboard can call the API from any host.

## Add to MacBook Login Items (auto-start)

1. Open **System Settings → General → Login Items** (or **System Preferences → Users & Groups → Login Items** on older macOS).
2. Click **+** and add an item that runs the listener at login.

**Option A — AppleScript app**

- Open **Script Editor**, create a new document:
  ```applescript
  do shell script "cd /path/to/niesta-listener && ./start.sh"
  ```
- Save as Application (e.g. `Niesta Listener.app`).
- Add that app to Login Items.

**Option B — launchd (recommended)**

Create `~/Library/LaunchAgents/com.niesta.listener.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.niesta.listener</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>uvicorn</string>
    <string>main:app</string>
    <string>--host</string>
    <string>0.0.0.0</string>
    <string>--port</string>
    <string>4000</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/absolute/path/to/niesta-listener</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/you/.niesta/listener.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/.niesta/listener.err.log</string>
</dict>
</plist>
```

Replace `/absolute/path/to/niesta-listener` and `/Users/you` with your paths. Then:

```bash
launchctl load ~/Library/LaunchAgents/com.niesta.listener.plist
```

The listener will start at login and log to `~/.niesta/listener.log` and `listener.err.log`.

## Config (config.py)

- `CODEX_SESSIONS_PATH` — default `~/.codex/sessions`
- `WORK_REPO_PATH` — default `~/sites/diesta-agent` (override with `WORK_REPO_PATH` in `.env`)
- `NIESTA_API_URL` — default `http://72.62.7.232:8000`
- `LISTENER_PORT` — default `4000`

## Session parsing

- Sessions are read from all `.jsonl` files under `CODEX_SESSIONS_PATH`.
- Fields are taken from `session_meta` and the last `token_count` / rate-limit events.
- **status**: `active` (< 24h), `idle` (24–72h), `forgotten` (> 72h).
- Results are cached for 30 seconds to limit filesystem reads.

Malformed or unreadable JSONL files are skipped; the server does not crash on bad input.
