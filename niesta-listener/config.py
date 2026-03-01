"""Config and paths. Override via .env (e.g. WORK_REPO_PATH)."""
import os
from pathlib import Path
from typing import Optional


def _str(value: Optional[str], default: str = "") -> str:
    return (value or "").strip() or default


def _path(value: Optional[str], default: Path) -> Path:
    raw = _str(value)
    if not raw:
        return default
    p = Path(raw).expanduser()
    return p


_home = Path.home()

CODEX_SESSIONS_PATH = _path(os.getenv("CODEX_SESSIONS_PATH"), _home / ".codex" / "sessions")
WORK_REPO_PATH = _path(os.getenv("WORK_REPO_PATH"), _home / "sites" / "diesta-agent")
NIESTA_API_URL = _str(os.getenv("NIESTA_API_URL"), "http://72.62.7.232:8000")
LISTENER_PORT = int(os.getenv("LISTENER_PORT", "4000"))

SESSIONS_CACHE_TTL_SECONDS = 30
