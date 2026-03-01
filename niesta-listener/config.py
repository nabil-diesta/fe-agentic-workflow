"""Config and paths. Override via .env (e.g. WORK_REPO_PATH)."""
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()


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

# Jira REST API (direct)
JIRA_CLOUD_ID = _str(os.getenv("JIRA_CLOUD_ID"), "41afebc2-714c-4c61-92c7-09ed9fc48daf")
JIRA_ACCOUNT_ID = _str(os.getenv("JIRA_ACCOUNT_ID"), "712020:e2175c6b-ac7b-4ed7-a572-2b03304bd9a7")
JIRA_API_EMAIL = _str(os.getenv("JIRA_API_EMAIL"), "nabil@diesta.co.uk")
JIRA_API_TOKEN = _str(os.getenv("JIRA_API_TOKEN"), "")
JIRA_BASE_URL = f"https://api.atlassian.com/ex/jira/{JIRA_CLOUD_ID}/rest/api/3"
