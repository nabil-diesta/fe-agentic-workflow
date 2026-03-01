"""
Standalone Jira client: calls Jira REST API directly (no listener).
Used as fallback when the laptop listener is offline.
"""
from __future__ import annotations

import base64
import logging
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


def _auth_header() -> str:
    raw = f"{JIRA_API_EMAIL}:{JIRA_API_TOKEN}"
    return base64.b64encode(raw.encode()).decode()


def _check_token() -> Optional[str]:
    if not JIRA_API_TOKEN:
        return "JIRA_API_TOKEN is not set. Add it to .env (see .env.example)."
    return None


def _parse_issue(issue: Dict[str, Any]) -> dict:
    """Map Jira issue to flat ticket shape (search results)."""
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


async def direct_fetch_sprint() -> Tuple[bool, Optional[List[dict]], str]:
    """
    Fetch all tickets in current active sprint for DD assigned to JIRA_ACCOUNT_ID.
    Returns (success, list of flat tickets, error_message).
    """
    err = _check_token()
    if err:
        return False, None, err

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
    return True, out, ""


async def direct_fetch_ticket(key: str) -> Tuple[bool, Optional[dict], str]:
    """
    GET /issue/{key}. Returns (success, ticket_dict, error_message).
    Ticket shape: key, summary, description, status, priority, assignee, subtasks, comments.
    """
    err = _check_token()
    if err:
        return False, None, err

    ticket_key = (key or "").strip().upper()
    if not ticket_key:
        return False, None, "Ticket key is required."

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

    desc = fields_data.get("description")
    if isinstance(desc, dict):
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


async def direct_run_jql(
    jql: str,
    fields: Optional[List[str]] = None,
    max_results: int = 50,
) -> Tuple[bool, Optional[List[dict]], str]:
    """
    Run an arbitrary JQL query. Returns (success, list of flat tickets, error_message).
    """
    err = _check_token()
    if err:
        return False, None, err
    if not (jql or "").strip():
        return False, None, "JQL is required."
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
                    return False, None, msg or "Invalid JQL"
                except Exception:
                    return False, None, r.text or "Invalid JQL (400)"
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        msg = e.response.text if e.response else str(e)
        logger.warning("Jira JQL failed: %s", msg)
        return False, None, msg or f"HTTP {e.response.status_code}"
    except httpx.RequestError as e:
        logger.warning("Jira request error: %s", e)
        return False, None, str(e)
    except Exception as e:
        logger.exception("Jira direct_run_jql error: %s", e)
        return False, None, str(e)
    issues = data.get("issues") or []
    out = [_parse_issue(i) for i in issues]
    return True, out, ""
