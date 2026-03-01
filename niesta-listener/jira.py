"""
Jira data via direct REST API. Async httpx with Basic auth; 60s cache for sprint.
"""
import base64
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from config import (
    JIRA_ACCOUNT_ID,
    JIRA_API_EMAIL,
    JIRA_API_TOKEN,
    JIRA_BASE_URL,
)

logger = logging.getLogger(__name__)

HTTP_TIMEOUT = 30.0
SPRINT_CACHE_TTL = 60
_sprint_cache: Optional[Tuple[float, List[dict]]] = None


def _auth_header() -> str:
    raw = f"{JIRA_API_EMAIL}:{JIRA_API_TOKEN}"
    return base64.b64encode(raw.encode()).decode()


def _check_token() -> Optional[str]:
    if not JIRA_API_TOKEN:
        return "JIRA_API_TOKEN is not set. Add it to .env (see .env.example)."
    return None


def _parse_issue(issue: Dict[str, Any]) -> dict:
    """Map Jira issue to our ticket shape."""
    fields = issue.get("fields") or {}
    status = fields.get("status")
    priority = fields.get("priority")
    assignee = fields.get("assignee")
    it = fields.get("issuetype")
    return {
        "key": issue.get("key"),
        "summary": (fields.get("summary") or "").strip(),
        "status": status.get("name") if isinstance(status, dict) else None,
        "priority": priority.get("name") if isinstance(priority, dict) else None,
        "assignee": assignee.get("displayName") if isinstance(assignee, dict) else None,
        "story_points": fields.get("customfield_10016"),
        "type": it.get("name") if isinstance(it, dict) else None,
    }


async def fetch_my_sprint() -> Tuple[bool, Optional[List[dict]], str]:
    """
    Fetch all tickets in current active sprint for DD assigned to JIRA_ACCOUNT_ID.
    Returns (success, list of tickets, error_message). Cached 60s.
    """
    err = _check_token()
    if err:
        return False, None, err

    global _sprint_cache
    now = time.time()
    if _sprint_cache is not None and (now - _sprint_cache[0]) < SPRINT_CACHE_TTL:
        return True, _sprint_cache[1], ""

    jql = f'project = DD AND assignee = "{JIRA_ACCOUNT_ID}" AND sprint in openSprints() ORDER BY Rank ASC'
    fields = "key,summary,status,priority,assignee,customfield_10016,issuetype"
    url = f"{JIRA_BASE_URL}/search/jql"
    params = {"jql": jql, "fields": fields, "maxResults": 100}

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            r = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Basic {_auth_header()}", "Accept": "application/json"},
            )
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        msg = e.response.text if e.response else str(e)
        logger.warning("Jira search failed: %s", msg)
        return False, None, msg or f"HTTP {e.response.status_code}"
    except httpx.RequestError as e:
        logger.warning("Jira request error: %s", e)
        return False, None, str(e)
    except Exception as e:
        logger.exception("Jira fetch error: %s", e)
        return False, None, str(e)

    issues = data.get("issues") or []
    out = [_parse_issue(i) for i in issues]
    _sprint_cache = (now, out)
    return True, out, ""


async def run_jql_query(
    jql: str,
    fields: Optional[List[str]] = None,
    max_results: int = 50,
) -> Tuple[bool, Optional[List[dict]], str, int]:
    """
    Run an arbitrary JQL query. Returns (success, list of tickets, error_message, http_status).
    Each ticket is a flat dict: key, summary, status, priority, assignee, type.
    """
    err = _check_token()
    if err:
        return False, None, err, 502
    if not (jql or "").strip():
        return False, None, "JQL is required.", 400
    fields_list = fields or ["key", "summary", "status", "priority", "assignee", "issuetype"]
    fields_str = ",".join(f.strip() for f in fields_list if f and isinstance(f, str))
    if not fields_str:
        fields_str = "key,summary,status,priority,assignee,issuetype"
    url = f"{JIRA_BASE_URL}/search/jql"
    params = {"jql": jql.strip(), "fields": fields_str, "maxResults": min(max(1, max_results), 100)}
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            r = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Basic {_auth_header()}", "Accept": "application/json"},
            )
            if r.status_code == 400:
                try:
                    body = r.json()
                    msg = body.get("errorMessages") or body.get("errors") or r.text
                    if isinstance(msg, list):
                        msg = "; ".join(str(m) for m in msg)
                    elif isinstance(msg, dict):
                        msg = "; ".join(f"{k}: {v}" for k, v in msg.items())
                    return False, None, msg or "Invalid JQL", 400
                except Exception:
                    return False, None, r.text or "Invalid JQL (400)", 400
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        msg = e.response.text if e.response else str(e)
        logger.warning("Jira JQL failed: %s", msg)
        return False, None, msg or f"HTTP {e.response.status_code}", 502
    except httpx.RequestError as e:
        logger.warning("Jira request error: %s", e)
        return False, None, str(e), 502
    except Exception as e:
        logger.exception("Jira run_jql_query error: %s", e)
        return False, None, str(e), 502
    issues = data.get("issues") or []
    out = [_parse_issue(i) for i in issues]
    return True, out, "", 200


async def fetch_ticket(ticket_key: str) -> Tuple[bool, Optional[dict], str]:
    """
    Fetch full details for one ticket. Returns (success, ticket_dict, error_message).
    Includes description, subtasks, last 5 comments.
    """
    err = _check_token()
    if err:
        return False, None, err

    fields = "key,summary,description,status,priority,assignee,subtasks,comment,customfield_10016,issuetype"
    url = f"{JIRA_BASE_URL}/issue/{ticket_key}"
    params = {"fields": fields}

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            r = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Basic {_auth_header()}", "Accept": "application/json"},
            )
            r.raise_for_status()
            issue = r.json()
    except httpx.HTTPStatusError as e:
        msg = e.response.text if e.response else str(e)
        logger.warning("Jira issue %s failed: %s", ticket_key, msg)
        return False, None, msg or f"HTTP {e.response.status_code}"
    except httpx.RequestError as e:
        logger.warning("Jira request error: %s", e)
        return False, None, str(e)
    except Exception as e:
        logger.exception("Jira fetch ticket error: %s", e)
        return False, None, str(e)

    fields_data = issue.get("fields") or {}
    status = fields_data.get("status")
    priority = fields_data.get("priority")
    assignee = fields_data.get("assignee")
    it = fields_data.get("issuetype")

    # Description may be ADF (Atlassian Document Format); use plain if present
    desc = fields_data.get("description")
    if isinstance(desc, dict):
        # ADF: try to get plain text from content
        plain_parts = []
        for block in desc.get("content") or []:
            if block.get("type") == "paragraph":
                for c in block.get("content") or []:
                    if c.get("type") == "text":
                        plain_parts.append(c.get("text") or "")
        desc = "\n".join(plain_parts) if plain_parts else ""
    elif desc is None:
        desc = ""

    subtasks_raw = fields_data.get("subtasks") or []
    subtasks = [{"key": s.get("key"), "summary": (s.get("fields") or {}).get("summary")} for s in subtasks_raw]

    def _comment_body(c: Dict[str, Any]) -> str:
        b = c.get("body")
        if isinstance(b, dict) and b.get("content"):
            parts = []
            for block in b.get("content") or []:
                if block.get("type") == "paragraph":
                    for x in block.get("content") or []:
                        if x.get("type") == "text":
                            parts.append(x.get("text") or "")
            return "\n".join(parts)
        return str(b) if b is not None else ""

    comments_raw = (fields_data.get("comment") or {}).get("comments") or []
    last_5 = comments_raw[-5:]
    comments = [
        {"author": (c.get("author") or {}).get("displayName"), "body": _comment_body(c)}
        for c in last_5
    ]

    out = {
        "key": issue.get("key"),
        "summary": (fields_data.get("summary") or "").strip(),
        "description": desc,
        "status": status.get("name") if isinstance(status, dict) else None,
        "priority": priority.get("name") if isinstance(priority, dict) else None,
        "story_points": fields_data.get("customfield_10016"),
        "assignee": assignee.get("displayName") if isinstance(assignee, dict) else None,
        "subtasks": subtasks,
        "comments": comments,
    }
    return True, out, ""


async def fetch_my_status() -> Tuple[bool, Optional[dict], str]:
    """
    Counts by status (To Do, In Progress, In Review, In QA, Done) + In Progress keys.
    Uses fetch_my_sprint() internally (cached).
    """
    ok, tickets, err = await fetch_my_sprint()
    if not ok or tickets is None:
        return False, None, err

    to_do = 0
    in_progress = 0
    in_review = 0
    in_qa = 0
    done = 0
    in_progress_keys: List[str] = []

    for t in tickets:
        name = (t.get("status") or "").strip()
        if not name:
            continue
        if name == "To Do" or name == "To-Do":
            to_do += 1
        elif name == "In Progress":
            in_progress += 1
            k = t.get("key")
            if k:
                in_progress_keys.append(k)
        elif name == "In Review":
            in_review += 1
        elif name == "In QA":
            in_qa += 1
        elif name == "Done":
            done += 1

    out = {
        "to_do": to_do,
        "in_progress": in_progress,
        "in_review": in_review,
        "in_qa": in_qa,
        "done": done,
        "in_progress_keys": in_progress_keys,
    }
    return True, out, ""
