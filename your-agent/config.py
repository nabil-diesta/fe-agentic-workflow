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

# Paths (defaults relative to project root)
_PROJECT_ROOT = Path(__file__).resolve().parent
CHROMA_PERSIST_PATH = _path(os.getenv("CHROMA_PERSIST_PATH"), _PROJECT_ROOT / "data" / "chroma")
_raw_sqlite = _str(os.getenv("SQLITE_PATH")) or str(_PROJECT_ROOT / "data" / "agent.db")
SQLITE_PATH = Path(_raw_sqlite)
SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
