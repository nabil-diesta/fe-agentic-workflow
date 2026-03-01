"""Fire Codex commands in the work repo. Tracks running tasks in memory."""
import asyncio
import logging
import time
from pathlib import Path
from typing import Dict, List, Optional, Union

from config import WORK_REPO_PATH

logger = logging.getLogger(__name__)

_running_tasks: Dict[str, dict] = {}


def _make_task_id() -> str:
    return f"codex_{int(time.time() * 1000)}"


async def run_codex_task(task: str, cwd: Optional[Union[str, Path]] = None) -> dict:
    """
    Run `codex "{task}"` in the given cwd. Returns task_id, pid, cwd, task, started_at.
    """
    work_dir = Path(cwd).expanduser() if cwd else WORK_REPO_PATH
    if not work_dir.exists():
        raise FileNotFoundError(f"Working directory does not exist: {work_dir}")
    task_id = _make_task_id()
    started_at = time.time()
    try:
        proc = await asyncio.create_subprocess_exec(
            "codex",
            task,
            cwd=str(work_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        pid = proc.pid
        _running_tasks[task_id] = {
            "task_id": task_id,
            "pid": pid,
            "cwd": str(work_dir),
            "task": task,
            "started_at": started_at,
            "process": proc,
        }
        # Don't await proc — let it run in background
        asyncio.create_task(_reap_task(task_id, proc))
        return {
            "task_id": task_id,
            "pid": pid,
            "cwd": str(work_dir),
            "task": task,
            "started_at": started_at,
        }
    except FileNotFoundError:
        logger.warning("codex CLI not found in PATH")
        raise
    except Exception as e:
        logger.exception("run_codex_task failed: %s", e)
        raise


async def _reap_task(task_id: str, proc: asyncio.subprocess.Process) -> None:
    """Wait for process to finish and remove from _running_tasks."""
    try:
        await proc.wait()
    except Exception as e:
        logger.warning("Reap task %s: %s", task_id, e)
    finally:
        _running_tasks.pop(task_id, None)


def get_running_tasks() -> List[dict]:
    """Return all currently running codex processes (task_id, pid, cwd, task, started_at)."""
    return [
        {
            "task_id": t["task_id"],
            "pid": t["pid"],
            "cwd": t["cwd"],
            "task": t["task"],
            "started_at": t["started_at"],
        }
        for t in list(_running_tasks.values())
        if "process" in t and t["process"].returncode is None
    ]
