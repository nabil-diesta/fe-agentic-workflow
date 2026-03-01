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

CREATE TABLE IF NOT EXISTS rolling_summaries (
    session_id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);
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
        """Read summary from rolling_summaries table for this session."""
        try:
            with sqlite3.connect(self._path) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT summary FROM rolling_summaries WHERE session_id = ?",
                    (session_id,),
                ).fetchone()
                return row["summary"] if row else ""
        except Exception as e:
            logger.warning("Failed to load rolling summary: %s", e)
            return ""

    def set_rolling_summary(self, session_id: str, summary: str, message_count: int) -> None:
        """Upsert into rolling_summaries. Stores session_id, summary, message_count, updated_at (UTC ISO)."""
        import datetime
        now = datetime.datetime.utcnow().isoformat() + "Z"
        try:
            with sqlite3.connect(self._path) as conn:
                conn.execute(
                    """INSERT INTO rolling_summaries (session_id, summary, message_count, updated_at)
                       VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET
                       summary=?, message_count=?, updated_at=?""",
                    (session_id, summary, message_count, now, summary, message_count, now),
                )
        except Exception as e:
            logger.warning("Failed to set rolling summary: %s", e)

    def get_total_message_count(self, session_id: str) -> int:
        """Return COUNT(*) of conversations for this session_id. Returns 0 on failure."""
        try:
            with sqlite3.connect(self._path) as conn:
                row = conn.execute(
                    "SELECT COUNT(*) AS n FROM conversations WHERE session_id = ?",
                    (session_id,),
                ).fetchone()
                return row[0] if row else 0
        except Exception as e:
            logger.warning("Failed to get total message count: %s", e)
            return 0
