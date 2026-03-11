"""Fire Codex tasks via the app-server protocol. Persists to SQLite."""
from __future__ import annotations

import asyncio
import logging
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import aiosqlite
import httpx

from codex_server import codex_server
from config import NIESTA_API_URL

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent / "tasks.db"


def _required_columns() -> List[Tuple[str, str]]:
    """(column_name, sql_type) for app-server schema."""
    return [
        ("task_id", "TEXT PRIMARY KEY"),
        ("thread_id", "TEXT"),
        ("turn_id", "TEXT"),
        ("ticket_key", "TEXT"),
        ("task", "TEXT"),
        ("cwd", "TEXT"),
        ("status", "TEXT DEFAULT 'running'"),
        ("started_at", "REAL"),
        ("completed_at", "REAL"),
        ("output", "TEXT DEFAULT ''"),
        ("error", "TEXT DEFAULT ''"),
    ]


async def init_db() -> None:
    """Create tasks table if not exists; migrate existing table if it has old schema."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                thread_id TEXT,
                turn_id TEXT,
                ticket_key TEXT,
                task TEXT,
                cwd TEXT,
                status TEXT DEFAULT 'running',
                started_at REAL,
                completed_at REAL,
                output TEXT DEFAULT '',
                error TEXT DEFAULT ''
            )
            """
        )
        await db.commit()

        # Migrate old schema: add app-server columns if missing (e.g. thread_id, turn_id, output, error)
        cursor = await db.execute("PRAGMA table_info(tasks)")
        rows = await cursor.fetchall()
        existing = {row[1] for row in rows}
        for name, sql_type in _required_columns():
            if name == "task_id":
                continue
            if name not in existing:
                try:
                    col_type = sql_type.replace(" PRIMARY KEY", "") if "PRIMARY KEY" in sql_type else sql_type
                    await db.execute(f"ALTER TABLE tasks ADD COLUMN {name} {col_type}")
                except Exception as e:
                    logger.warning("Migration add column %s: %s", name, e)
        await db.commit()


async def init_executor() -> None:
    """Initialize the database and start the codex app-server."""
    await init_db()
    await codex_server.start()
    codex_server.add_event_listener(_handle_event)


def _extract_ticket_key(task: str) -> Optional[str]:
    """Extract DD-XXXX from task string."""
    match = re.search(r"(DD-\d+)", task)
    return match.group(1) if match else None


def _make_task_id() -> str:
    return f"codex_{int(time.time() * 1000)}"


# Buffer events per thread for streaming to dashboard
_thread_events: Dict[str, List[dict]] = {}


def _handle_event(msg: dict) -> None:
    """Handle server-initiated events from codex app-server."""
    method = msg.get("method", "")
    params = msg.get("params", {})

    # Extract thread_id from various event shapes
    thread_id = None
    if "threadId" in params:
        thread_id = params["threadId"]
    elif "thread" in params and isinstance(params["thread"], dict) and "id" in params["thread"]:
        thread_id = params["thread"]["id"]
    elif "turn" in params and isinstance(params.get("turn"), dict) and "threadId" in params["turn"]:
        thread_id = params["turn"]["threadId"]

    if thread_id:
        if thread_id not in _thread_events:
            _thread_events[thread_id] = []
        _thread_events[thread_id].append(
            {"method": method, "params": params, "timestamp": time.time()}
        )
        # Keep only last 200 events per thread
        if len(_thread_events[thread_id]) > 200:
            _thread_events[thread_id] = _thread_events[thread_id][-200:]

    # Handle turn completion
    if method == "turn/completed":
        asyncio.create_task(_on_turn_completed(params))


async def _on_turn_completed(params: dict) -> None:
    """Update task status when a turn completes."""
    turn = params.get("turn", {}) or {}
    turn_id = turn.get("id")
    status = turn.get("status", "completed")

    # Extract final agent message from items
    output = ""
    for item in turn.get("items") or []:
        if item.get("type") == "agentMessage":
            output = item.get("text", "") or ""

    error = ""
    if turn.get("error"):
        error = str(turn["error"])
        status = "failed"

    mapped_status = "completed" if status == "completed" else "failed"

    ticket_key = None
    task_text = None

    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """
            UPDATE tasks
               SET status = ?,
                   completed_at = ?,
                   output = ?,
                   error = ?
             WHERE turn_id = ?
            """,
            (mapped_status, time.time(), output, error, turn_id),
        )
        await db.commit()

        cursor = await db.execute(
            "SELECT ticket_key, task FROM tasks WHERE turn_id = ?", (turn_id,)
        )
        row = await cursor.fetchone()
        if row:
            ticket_key, task_text = row[0], row[1]

    # Notify Niesta
    key = ticket_key or _extract_ticket_key(task_text or "") or "unknown"
    message = f"Codex {mapped_status} on {key}."
    if output:
        message += " " + output[:500]
    elif error:
        message += " " + error[:500]

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                NIESTA_API_URL.rstrip("/") + "/notify",
                json={"message": message},
            )
    except Exception as e:
        logger.warning("Failed to notify Niesta: %s", e)


async def run_codex_task(task: str, cwd: str, ticket_key: Optional[str] = None) -> dict:
    """Start a new Codex task via app-server. Returns task info."""
    if not ticket_key:
        ticket_key = _extract_ticket_key(task)

    task_id = _make_task_id()
    started_at = time.time()

    # Start a new thread
    thread_result = await codex_server.start_thread(cwd=cwd)
    thread = thread_result.get("thread") or {}
    thread_id = thread.get("id")

    # Start the turn with the task prompt
    turn_result = await codex_server.start_turn(thread_id, task, cwd=cwd)
    turn = turn_result.get("turn") or {}
    turn_id = turn.get("id")

    # Persist to SQLite
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """
            INSERT INTO tasks (
                task_id, thread_id, turn_id, ticket_key, task, cwd, status, started_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
            """,
            (task_id, thread_id, turn_id, ticket_key, task, cwd, started_at),
        )
        await db.commit()

    return {
        "task_id": task_id,
        "thread_id": thread_id,
        "turn_id": turn_id,
        "ticket_key": ticket_key,
        "cwd": cwd,
        "task": task,
        "started_at": started_at,
    }


async def resume_task(thread_id: str, prompt: str) -> dict:
    """Resume an existing thread with a new prompt."""
    await codex_server.resume_thread(thread_id)
    turn_result = await codex_server.start_turn(thread_id, prompt)
    turn = turn_result.get("turn") or {}
    turn_id = turn.get("id")

    # Update task in DB (keep previous row, just bump status)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """
            UPDATE tasks
               SET status = 'running',
                   completed_at = NULL
             WHERE thread_id = ?
            """,
            (thread_id,),
        )
        await db.commit()

    return {"thread_id": thread_id, "turn_id": turn_id}


async def interrupt_task(thread_id: str, turn_id: str) -> dict:
    """Interrupt a running turn."""
    result = await codex_server.interrupt_turn(thread_id, turn_id)

    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """
            UPDATE tasks
               SET status = 'interrupted',
                   completed_at = ?
             WHERE thread_id = ?
            """,
            (time.time(), thread_id),
        )
        await db.commit()

    return result


async def get_task_events(thread_id: str) -> List[dict]:
    """Get buffered events for a thread (for streaming to dashboard)."""
    return _thread_events.get(thread_id, [])


async def get_all_tasks() -> List[dict]:
    """Return all tasks from SQLite, most recent first."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM tasks ORDER BY started_at DESC LIMIT 50"
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_running_tasks() -> List[dict]:
    """Return currently running tasks."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM tasks WHERE status = 'running' ORDER BY started_at DESC"
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_task(task_id: str) -> Optional[dict]:
    """Get a single task by task_id."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM tasks WHERE task_id = ?",
            (task_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_thread_info(thread_id: str) -> Optional[dict]:
    """Read full thread info from codex app-server."""
    try:
        return await codex_server.read_thread(thread_id)
    except Exception as e:
        logger.warning("Failed to read thread %s: %s", thread_id, e)
        return None


async def delete_task(task_id: str) -> bool:
    """Delete a single task by task_id. Returns True if deleted."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "DELETE FROM tasks WHERE task_id = ?", (task_id,)
        )
        await db.commit()
        return cursor.rowcount > 0


async def delete_tasks_by_thread_id(thread_id: str) -> int:
    """Delete all tasks for a given thread_id. Returns number of rows deleted."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "DELETE FROM tasks WHERE thread_id = ?", (thread_id,)
        )
        await db.commit()
        return cursor.rowcount


async def list_codex_threads(limit: int = 25) -> dict:
    """List all Codex threads from app-server."""
    return await codex_server.list_threads(limit=limit)

