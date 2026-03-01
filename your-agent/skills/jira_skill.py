"""
Jira skill: calls niesta-listener Jira endpoints and returns formatted summaries for the agent.
Requires LAPTOP_LISTENER_URL reachable from VPS (e.g. ngrok or reverse SSH tunnel).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

from config import LAPTOP_LISTENER_URL

logger = logging.getLogger(__name__)

LISTENER_TIMEOUT = 35.0
UNREACHABLE_MSG = "Laptop listener is offline — is your MacBook running?"


async def _get(url: str) -> Optional[Dict[str, Any]]:
    """GET JSON from listener; None if unreachable or error."""
    try:
        async with httpx.AsyncClient(timeout=LISTENER_TIMEOUT) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.json()
    except httpx.ConnectError:
        logger.warning("Listener unreachable: %s", url)
        return None
    except httpx.TimeoutException:
        logger.warning("Listener timeout: %s", url)
        return None
    except httpx.HTTPStatusError as e:
        try:
            body = e.response.json()
            if isinstance(body.get("detail"), str):
                return {"detail": body["detail"]}
        except Exception:
            pass
        return None
    except Exception as e:
        logger.warning("Listener request failed: %s", e)
        return None


def _format_sprint(tickets: List[dict]) -> str:
    lines = ["**My sprint tickets**", ""]
    for t in tickets:
        key = t.get("key", "?")
        summary = (t.get("summary") or "")[:60]
        status = t.get("status", "?")
        points = t.get("story_points")
        sp = f" {points} SP" if points is not None else ""
        lines.append(f"• {key}: {summary} — {status}{sp}")
    return "\n".join(lines) if len(lines) > 2 else "No tickets in current sprint."


def _format_ticket(data: dict) -> str:
    lines = [
        f"**{data.get('key', '?')}** — {data.get('summary', '')}",
        f"Status: {data.get('status', '?')} | Priority: {data.get('priority', '?')} | Assignee: {data.get('assignee', '?')}",
        "",
    ]
    desc = data.get("description") or ""
    if desc:
        lines.append("Description:")
        lines.append(desc[:500] + ("..." if len(desc) > 500 else ""))
        lines.append("")
    subtasks = data.get("subtasks") or []
    if subtasks:
        lines.append("Subtasks:")
        for s in subtasks[:10]:
            lines.append(f"  • {s.get('key', '?')}: {s.get('summary', '')}")
        lines.append("")
    comments = data.get("comments") or []
    if comments:
        lines.append("Recent comments:")
        for c in comments[:5]:
            lines.append(f"  {c.get('author', '?')}: {(c.get('body') or '')[:100]}")
    return "\n".join(lines)


def _format_status(data: dict) -> str:
    to_do = data.get("to_do", 0)
    in_progress = data.get("in_progress", 0)
    in_review = data.get("in_review", 0)
    done = data.get("done", 0)
    keys = data.get("in_progress_keys") or []
    lines = [
        "**Sprint status**",
        f"To Do: {to_do} | In Progress: {in_progress} | In Review: {in_review} | Done: {done}",
        "",
    ]
    if keys:
        lines.append("In Progress: " + ", ".join(keys))
    return "\n".join(lines)


async def run_sprint(**kwargs: Any) -> str:
    """[SKILL: jira_sprint] — Fetch my sprint tickets from listener."""
    base = LAPTOP_LISTENER_URL.rstrip("/")
    data = await _get(f"{base}/jira/my-sprint")
    if data is None:
        return UNREACHABLE_MSG
    if "detail" in data and isinstance(data["detail"], str):
        return data["detail"]
    tickets = data.get("tickets") or data.get("data") or data
    if not isinstance(tickets, list):
        return "Unexpected response from listener."
    return _format_sprint(tickets)


async def run_ticket(key: Optional[str] = None, **kwargs: Any) -> str:
    """[SKILL: jira_ticket | key: DD-5771] — Fetch one ticket from listener."""
    ticket_key = (key or kwargs.get("key") or "").strip().upper()
    if not ticket_key:
        return "Please specify a ticket key, e.g. [SKILL: jira_ticket | key: DD-5771]"
    base = LAPTOP_LISTENER_URL.rstrip("/")
    data = await _get(f"{base}/jira/ticket/{ticket_key}")
    if data is None:
        return UNREACHABLE_MSG
    if "detail" in data and isinstance(data["detail"], str):
        return data["detail"]
    return _format_ticket(data)


async def run_status(**kwargs: Any) -> str:
    """[SKILL: jira_status] — Sprint status summary from listener."""
    base = LAPTOP_LISTENER_URL.rstrip("/")
    data = await _get(f"{base}/jira/my-status")
    if data is None:
        return UNREACHABLE_MSG
    if "detail" in data and isinstance(data["detail"], str):
        return data["detail"]
    return _format_status(data)
