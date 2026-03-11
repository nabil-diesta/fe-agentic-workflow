"""
Niesta listener: FastAPI server on port 4000.
Reads Codex sessions and runs Codex tasks from Niesta instructions.
"""
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import LISTENER_PORT
from executor import (
    init_executor,
    run_codex_task,
    get_all_tasks,
    get_running_tasks,
    get_task,
    get_task_events,
    resume_task,
    interrupt_task,
    get_thread_info,
    list_codex_threads,
    delete_task,
    delete_tasks_by_thread_id,
)
from jira import fetch_my_sprint, fetch_my_status, fetch_ticket, run_jql_query
from sessions import delete_session, get_active_sessions, get_session_by_id, get_sessions

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: ensure dirs, start Codex app-server, stop it on shutdown."""
    from codex_server import codex_server

    # Ensure task log directory exists on startup.
    (Path.home() / ".niesta" / "task_logs").mkdir(parents=True, exist_ok=True)

    # Initialize Codex executor / app-server with debug logging.
    import traceback

    try:
        print(">>> Starting init_executor...")
        await init_executor()
        print(">>> init_executor completed successfully")
    except Exception as e:
        print(f">>> init_executor FAILED: {e}")
        traceback.print_exc()

    try:
        yield
    finally:
        try:
            print(">>> Stopping Codex app-server...")
            await codex_server.stop()
            print(">>> Codex app-server stopped")
        except Exception as e:
            logger.warning("Failed to stop Codex app-server: %s", e)


app = FastAPI(title="niesta-listener", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class JiraQueryBody(BaseModel):
    jql: str
    fields: Optional[List[str]] = None
    max_results: int = 50


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "port": LISTENER_PORT}


@app.get("/sessions")
async def sessions() -> List[dict]:
    """List all parsed Codex sessions (cached 30s)."""
    try:
        return get_sessions()
    except Exception as e:
        logger.exception("GET /sessions: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/sessions/active")
async def sessions_active() -> List[dict]:
    """Only sessions with status 'active' (last activity < 24hrs)."""
    try:
        return get_active_sessions()
    except Exception as e:
        logger.exception("GET /sessions/active: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/sessions/{session_id}")
async def session_detail(session_id: str) -> dict:
    """Single session by session_id."""
    try:
        s = get_session_by_id(session_id)
        if s is None:
            raise HTTPException(status_code=404, detail="Session not found")
        return s
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("GET /sessions/%s: %s", session_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/sessions/{session_id}")
async def delete_session_endpoint(session_id: str) -> dict:
    """Delete a session's .jsonl file and any associated tasks from the DB."""
    try:
        deleted = delete_session(session_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Session not found")
        tasks_deleted = await delete_tasks_by_thread_id(session_id)
        return {"deleted": session_id, "tasks_deleted": tasks_deleted}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("DELETE /sessions/%s: %s", session_id, e)
        raise HTTPException(status_code=500, detail=str(e))


WORKDIRS_FILE = Path(__file__).parent / "workdirs.json"
DEFAULT_WORKDIRS = [
    {"label": "Portal 1", "path": str(Path.home() / "sites/container/portal")},
    {"label": "Portal 2", "path": str(Path.home() / "sites/container-bu/portal")},
    {"label": "Portal 3", "path": str(Path.home() / "sites/container-new/portal")},
    {"label": "Portal 4", "path": str(Path.home() / "sites/containerAgain/portal")},
]


def _load_workdirs():
    if WORKDIRS_FILE.exists():
        return json.loads(WORKDIRS_FILE.read_text())
    return DEFAULT_WORKDIRS


def _save_workdirs(workdirs):
    WORKDIRS_FILE.write_text(json.dumps(workdirs, indent=2))


@app.get("/workdirs")
def get_workdirs():
    return {"workdirs": _load_workdirs()}


@app.post("/workdirs")
def add_workdir(body: dict):
    workdirs = _load_workdirs()
    workdirs.append({"label": body["label"], "path": body["path"]})
    _save_workdirs(workdirs)
    return {"workdirs": workdirs}


@app.delete("/workdirs")
def remove_workdir(body: dict):
    workdirs = _load_workdirs()
    workdirs = [w for w in workdirs if w["path"] != body["path"]]
    _save_workdirs(workdirs)
    return {"workdirs": workdirs}


@app.post("/codex/start")
async def start_codex_task(body: dict):
    """Start a new Codex task. Body: { task, cwd, ticket_key? }"""
    task = body.get("task")
    cwd = body.get("cwd")
    ticket_key = body.get("ticket_key")
    if not task or not cwd:
        raise HTTPException(400, "task and cwd are required")
    result = await run_codex_task(task, cwd, ticket_key)
    return result


@app.post("/codex/resume")
async def resume_codex_task(body: dict):
    """Resume a Codex thread. Body: { thread_id, prompt }"""
    thread_id = body.get("thread_id")
    prompt = body.get("prompt")
    if not thread_id or not prompt:
        raise HTTPException(400, "thread_id and prompt are required")
    result = await resume_task(thread_id, prompt)
    return result


@app.post("/codex/interrupt")
async def interrupt_codex_task(body: dict):
    """Interrupt a running turn. Body: { thread_id, turn_id }"""
    thread_id = body.get("thread_id")
    turn_id = body.get("turn_id")
    if not thread_id or not turn_id:
        raise HTTPException(400, "thread_id and turn_id are required")
    result = await interrupt_task(thread_id, turn_id)
    return result


@app.get("/codex/tasks")
async def list_tasks():
    """List all tasks (from SQLite)."""
    return {"tasks": await get_all_tasks()}


@app.get("/codex/tasks/running")
async def list_running_tasks():
    """List currently running tasks."""
    return {"tasks": await get_running_tasks()}


@app.get("/codex/tasks/{task_id}")
async def get_task_detail(task_id: str):
    """Get a single task detail."""
    task = await get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@app.delete("/codex/tasks/{task_id}")
async def delete_task_endpoint(task_id: str):
    """Delete a single task from the DB. Running tasks should be interrupted first."""
    deleted = await delete_task(task_id)
    if not deleted:
        raise HTTPException(404, "Task not found")
    return {"deleted": task_id}


@app.get("/codex/tasks/{task_id}/events")
async def get_events(task_id: str):
    """Get streaming events for a task."""
    task = await get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    events = await get_task_events(task["thread_id"])
    return {"events": events}


@app.get("/codex/thread/{thread_id}")
async def get_thread(thread_id: str):
    """Read full thread info from Codex app-server."""
    info = await get_thread_info(thread_id)
    if not info:
        raise HTTPException(404, "Thread not found")
    return info


@app.get("/codex/threads")
async def list_threads(limit: int = 25):
    """List all Codex threads."""
    return await list_codex_threads(limit)


# Backwards compat: keep /running-tasks and /run-codex as aliases.
@app.get("/running-tasks")
async def running_tasks_compat():
    return await list_running_tasks()


@app.post("/run-codex")
async def run_codex_compat(body: dict):
    task = body.get("task")
    cwd = body.get("cwd", str(Path.home() / "sites/container/portal"))
    ticket_key = body.get("ticket_key")
    return await start_codex_task({"task": task, "cwd": cwd, "ticket_key": ticket_key})


@app.get("/jira/my-sprint")
async def jira_my_sprint() -> dict:
    """Tickets in current active sprint for project DD assigned to nabil@diesta.co.uk."""
    try:
        ok, data, err = await fetch_my_sprint()
        if not ok:
            raise HTTPException(status_code=502, detail=err or "Jira request failed")
        return {"tickets": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("GET /jira/my-sprint: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/jira/ticket/{ticket_key}")
async def jira_ticket(ticket_key: str) -> dict:
    """Full details for one ticket (e.g. DD-5771)."""
    try:
        ok, data, err = await fetch_ticket(ticket_key)
        if not ok:
            raise HTTPException(status_code=502, detail=err or "Jira request failed")
        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("GET /jira/ticket/%s: %s", ticket_key, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/jira/query")
async def jira_query(body: JiraQueryBody) -> dict:
    """Run a JQL query. Returns { \"tickets\": [...] } or error."""
    try:
        ok, data, err, status = await run_jql_query(body.jql, body.fields, body.max_results)
        if not ok:
            raise HTTPException(status_code=status, detail=err or "Jira query failed")
        return {"tickets": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("POST /jira/query: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/jira/my-status")
async def jira_my_status() -> dict:
    """Counts per status (To Do, In Progress, In Review, In QA, Done) + In Progress ticket keys."""
    try:
        ok, data, err = await fetch_my_status()
        if not ok:
            raise HTTPException(status_code=502, detail=err or "Jira request failed")
        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("GET /jira/my-status: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/status")
async def status() -> dict:
    """Uptime, session count, running tasks count."""
    try:
        sessions_list = get_sessions()
        running = await get_running_tasks()
        return {
            "uptime_seconds": round(time.time() - START_TIME, 1),
            "session_count": len(sessions_list),
            "running_tasks_count": len(running),
            "running_tasks": running,
        }
    except Exception as e:
        logger.exception("GET /status: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=LISTENER_PORT)
