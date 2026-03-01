"""
Niesta listener: FastAPI server on port 4000.
Reads Codex sessions and runs Codex tasks from Niesta instructions.
"""
import logging
import time
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import LISTENER_PORT
from executor import get_running_tasks, run_codex_task
from jira import fetch_my_sprint, fetch_my_status, fetch_ticket, run_jql_query
from sessions import get_active_sessions, get_session_by_id, get_sessions

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="niesta-listener", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunCodexBody(BaseModel):
    task: str
    cwd: Optional[str] = None


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


@app.post("/run-codex")
async def run_codex(body: RunCodexBody) -> dict:
    """Fire codex with given task and cwd. Returns task_id, pid, cwd, task, started_at."""
    try:
        result = await run_codex_task(body.task, body.cwd)
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"codex CLI not found: {e}")
    except Exception as e:
        logger.exception("POST /run-codex: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/running-tasks")
async def running_tasks() -> List[dict]:
    """All currently running codex processes."""
    try:
        return get_running_tasks()
    except Exception as e:
        logger.exception("GET /running-tasks: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


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
        running = get_running_tasks()
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
