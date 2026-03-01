"""
Jira data via Codex CLI + Atlassian MCP. Subprocess with 30s timeout; parse stdout for JSON.
"""
import json
import logging
import re
import subprocess
from typing import Any, List, Optional, Tuple

from config import JIRA_PROJECT_KEY, JIRA_USER_EMAIL, WORK_REPO_PATH

logger = logging.getLogger(__name__)

CODEX_TIMEOUT_SECONDS = 30


def _run_codex(prompt: str) -> Tuple[bool, Any, str]:
    """
    Run codex with the given prompt. Returns (success, parsed_data_or_none, error_message).
    Never raises; logs and returns error tuple on failure or timeout.
    """
    cmd = ["codex", "exec", prompt]
    cwd = str(WORK_REPO_PATH)
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=CODEX_TIMEOUT_SECONDS,
            stdin=subprocess.DEVNULL
        )
        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()
        if result.returncode != 0:
            msg = stderr or stdout or f"Codex exited with {result.returncode}"
            logger.warning("Codex failed: %s", msg)
            return False, None, msg
        data = _extract_json(stdout)
        if data is None:
            return False, None, "Could not parse JSON from Codex output. MCP may not be connected or response format changed."
        return True, data, ""
    except subprocess.TimeoutExpired:
        logger.warning("Codex timed out after %ss", CODEX_TIMEOUT_SECONDS)
        return False, None, f"Codex timed out after {CODEX_TIMEOUT_SECONDS}s. Try again or check MCP connection."
    except FileNotFoundError:
        logger.warning("codex CLI not found")
        return False, None, "Codex CLI not found. Is Codex installed and on PATH?"
    except Exception as e:
        logger.exception("Codex run error: %s", e)
        return False, None, str(e)


def _extract_json(text: str) -> Optional[Any]:
    """Try to extract JSON object or array from stdout (handles markdown code blocks)."""
    if not text:
        return None
    # Try markdown code block first
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass
    # Try first [ or { to last ] or }
    for start_char, end_char in [("[", "]"), ("{", "}")]:
        start = text.find(start_char)
        if start == -1:
            continue
        depth = 0
        for i in range(start, len(text)):
            if text[i] == start_char:
                depth += 1
            elif text[i] == end_char:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
        if depth != 0:
            continue
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        return None


def fetch_my_sprint() -> Tuple[bool, Optional[List[dict]], str]:
    """
    Fetch all tickets in current active sprint for project DD assigned to JIRA_USER_EMAIL.
    Returns (success, list of {key, summary, status, priority, story_points, assignee}, error_message).
    """
    prompt = (
        f'Use the Atlassian MCP to fetch all issues in the current active sprint for project {JIRA_PROJECT_KEY} '
        f'assigned to {JIRA_USER_EMAIL}. Return only a valid JSON array of objects, each with keys: '
        'key, summary, status, priority, story_points, assignee. No other text.'
    )
    ok, data, err = _run_codex(prompt)
    if not ok:
        return False, None, err
    if not isinstance(data, list):
        return False, None, "Expected JSON array of tickets."
    # Normalize keys
    out = []
    for t in data:
        if not isinstance(t, dict):
            continue
        out.append({
            "key": t.get("key"),
            "summary": t.get("summary"),
            "status": t.get("status"),
            "priority": t.get("priority"),
            "story_points": t.get("story_points"),
            "assignee": t.get("assignee"),
        })
    return True, out, ""


def fetch_ticket(ticket_key: str) -> Tuple[bool, Optional[dict], str]:
    """
    Fetch full details for one ticket. Returns (success, ticket_dict, error_message).
    Ticket dict: key, summary, description, status, priority, story_points, assignee, subtasks, comments (last 5).
    """
    prompt = (
        f'Use the Atlassian MCP to fetch full details for Jira ticket {ticket_key}. '
        'Return only a valid JSON object with keys: key, summary, description, status, priority, '
        'story_points, assignee, subtasks (array of objects with key and summary), '
        'comments (array of last 5, each with author and body). No other text.'
    )
    ok, data, err = _run_codex(prompt)
    if not ok:
        return False, None, err
    if not isinstance(data, dict):
        return False, None, "Expected JSON object for ticket."
    out = {
        "key": data.get("key"),
        "summary": data.get("summary"),
        "description": data.get("description"),
        "status": data.get("status"),
        "priority": data.get("priority"),
        "story_points": data.get("story_points"),
        "assignee": data.get("assignee"),
        "subtasks": data.get("subtasks") if isinstance(data.get("subtasks"), list) else [],
        "comments": data.get("comments") if isinstance(data.get("comments"), list) else [],
    }
    return True, out, ""


def fetch_my_status() -> Tuple[bool, Optional[dict], str]:
    """
    Quick summary: counts per status (To Do, In Progress, In Review, Done) + In Progress ticket keys.
    Returns (success, {to_do, in_progress, in_review, done, in_progress_keys}, error_message).
    """
    prompt = (
        f'Use the Atlassian MCP to count issues in the current active sprint for project {JIRA_PROJECT_KEY} '
        f'assigned to {JIRA_USER_EMAIL} by status. Return only a valid JSON object with keys: '
        'to_do (number), in_progress (number), in_review (number), done (number), '
        'in_progress_keys (array of ticket keys, e.g. ["DD-123", "DD-456"]). No other text.'
    )
    ok, data, err = _run_codex(prompt)
    if not ok:
        return False, None, err
    if not isinstance(data, dict):
        return False, None, "Expected JSON object for status."
    out = {
        "to_do": data.get("to_do", 0),
        "in_progress": data.get("in_progress", 0),
        "in_review": data.get("in_review", 0),
        "done": data.get("done", 0),
        "in_progress_keys": data.get("in_progress_keys") if isinstance(data.get("in_progress_keys"), list) else [],
    }
    return True, out, ""
