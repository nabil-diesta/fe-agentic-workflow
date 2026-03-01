"""Load all environment variables. No hardcoded secrets."""
from __future__ import annotations

import os
from pathlib import Path


def _str(value: str | None, default: str = "") -> str:
    return (value or "").strip() or default


def _path(value: str | None, default: Path) -> Path:
    raw = _str(value)
    if not raw:
        return default
    p = Path(raw)
    p.mkdir(parents=True, exist_ok=True)
    return p


# OpenAI
OPENAI_API_KEY = _str(os.getenv("OPENAI_API_KEY"))
OPENAI_DEFAULT_MODEL = _str(os.getenv("OPENAI_DEFAULT_MODEL"), "gpt-4o-mini")
OPENAI_SMART_MODEL = _str(os.getenv("OPENAI_SMART_MODEL"), "gpt-4.1")

# Telegram
TELEGRAM_BOT_TOKEN = _str(os.getenv("TELEGRAM_BOT_TOKEN"))

# Agent
AGENT_NAME = _str(os.getenv("AGENT_NAME"), "DevAgent")

# Laptop listener (niesta-listener). Must be reachable from VPS: expose port 4000 via
# ngrok, Cloudflare Tunnel, or reverse SSH (e.g. ssh -R 4000:localhost:4000 user@vps).
LAPTOP_LISTENER_URL = os.getenv("LAPTOP_LISTENER_URL", "http://localhost:4000")

# Jira REST API (direct fallback when listener is offline)
JIRA_CLOUD_ID = _str(os.getenv("JIRA_CLOUD_ID"), "41afebc2-714c-4c61-92c7-09ed9fc48daf")
JIRA_ACCOUNT_ID = _str(os.getenv("JIRA_ACCOUNT_ID"), "712020:e2175c6b-ac7b-4ed7-a572-2b03304bd9a7")
JIRA_API_EMAIL = _str(os.getenv("JIRA_API_EMAIL"), "nabil@diesta.co.uk")
JIRA_API_TOKEN = _str(os.getenv("JIRA_API_TOKEN"), "")
JIRA_BASE_URL = f"https://api.atlassian.com/ex/jira/{JIRA_CLOUD_ID}/rest/api/3"

# Paths (defaults relative to project root)
_PROJECT_ROOT = Path(__file__).resolve().parent
CHROMA_PERSIST_PATH = _path(os.getenv("CHROMA_PERSIST_PATH"), _PROJECT_ROOT / "data" / "chroma")
_raw_sqlite = _str(os.getenv("SQLITE_PATH")) or str(_PROJECT_ROOT / "data" / "agent.db")
SQLITE_PATH = Path(_raw_sqlite)
SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
