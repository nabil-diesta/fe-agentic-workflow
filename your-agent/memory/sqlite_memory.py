"""Core memory and conversation history in SQLite."""
from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Any

from config import SQLITE_PATH

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS core_memory (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
"""


class SQLiteMemory:
    def __init__(self, db_path: Path | str | None = None):
        self._path = Path(db_path or SQLITE_PATH)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self._path) as conn:
            conn.executescript(_SCHEMA)

    def get_core_memory(self) -> dict[str, Any]:
        """Load core memory (name, preferences, projects) as a dict."""
        try:
            with sqlite3.connect(self._path) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT key, value FROM core_memory").fetchall()
                return {row["key"]: json.loads(row["value"]) for row in rows}
        except Exception as e:
            logger.warning("Failed to load core memory: %s", e)
            return {}

    def set_core_memory(self, key: str, value: Any) -> None:
        import datetime
        now = datetime.datetime.utcnow().isoformat() + "Z"
        with sqlite3.connect(self._path) as conn:
            conn.execute(
                "INSERT INTO core_memory (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=?, updated_at=?",
                (key, json.dumps(value), now, json.dumps(value), now),
            )

    def get_conversation_history(self, session_id: str, limit: int = 20) -> list[dict[str, str]]:
        """Last N messages for context. Oldest first."""
        try:
            with sqlite3.connect(self._path) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT role, content, source FROM conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
                    (session_id, limit),
                ).fetchall()
                out = [{"role": r["role"], "content": r["content"], "source": r["source"] or ""} for r in reversed(rows)]
                return out
        except Exception as e:
            logger.warning("Failed to load conversation history: %s", e)
            return []

    def append_exchange(self, session_id: str, role: str, content: str, source: str = "") -> None:
        import datetime
        now = datetime.datetime.utcnow().isoformat() + "Z"
        try:
            with sqlite3.connect(self._path) as conn:
                conn.execute(
                    "INSERT INTO conversations (session_id, role, content, source, created_at) VALUES (?, ?, ?, ?, ?)",
                    (session_id, role, content, source, now),
                )
        except Exception as e:
            logger.warning("Failed to append conversation: %s", e)

    def get_rolling_summary(self, session_id: str) -> str:
        """Placeholder: return empty. Can be extended to store/retrieve a rolling summary."""
        return ""
