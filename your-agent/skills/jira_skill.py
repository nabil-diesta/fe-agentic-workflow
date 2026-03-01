"""
Jira skill: tries niesta-listener first (10s timeout), falls back to direct Jira API when listener is offline.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

import httpx
from openai import OpenAI

from config import LAPTOP_LISTENER_URL, OPENAI_API_KEY

from skills.jira_direct import (
    direct_fetch_sprint,
    direct_fetch_ticket,
    direct_run_jql,
)

logger = logging.getLogger(__name__)

LISTENER_TIMEOUT = 10.0
UNREACHABLE_MSG = "Laptop listener is offline — is your MacBook running?"

JQL_SYSTEM = """You are a JQL translator. Convert the user's natural language question into a valid Jira JQL query.

Context:
- Project key: DD
- User's email: nabil@diesta.co.uk
- User's account ID: 712020:e2175c6b-ac7b-4ed7-a572-2b03304bd9a7
- Common statuses: To-Do, In Progress, In Review, In QA, Done
- Issue types: Bug, Task, Story, Epic, Customer Feedback
- Sprint functions: openSprints(), closedSprints()
- The backlog is: items not in any open sprint, or with sprint IS EMPTY

Respond with ONLY the JQL string. No explanation, no markdown, no backticks. Just the JQL."""


def _format_query_results(tickets: List[dict]) -> str:
    """Format ticket list grouped by status (same style as sprint)."""
    if not tickets:
        return "No issues found."
    groups: Dict[str, list] = {}
    for t in tickets:
        status = t.get("status") or "Unknown"
        groups.setdefault(status, []).append(t)
    lines = [f"Results: {len(tickets)} tickets\n"]
    for status, items in groups.items():
        lines.append(f"\n{status} ({len(items)}):")
        for t in items:
            priority = t.get("priority", "")
            lines.append(f"  {t.get('key', '?')} — {t.get('summary', '')} [{priority}]")
    return "\n".join(lines)


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


def _status_from_sprint_tickets(tickets: List[dict]) -> dict:
    """Compute status buckets from sprint ticket list (for direct fallback)."""
    to_do = in_progress = in_review = in_qa = done = 0
    in_progress_keys: List[str] = []
    for t in tickets:
        name = (t.get("status") or "").strip()
        if not name:
            continue
        if name in ("To Do", "To-Do"):
            to_do += 1
        elif name == "In Progress":
            in_progress += 1
            if t.get("key"):
                in_progress_keys.append(t["key"])
        elif name == "In Review":
            in_review += 1
        elif name == "In QA":
            in_qa += 1
        elif name == "Done":
            done += 1
    return {
        "to_do": to_do,
        "in_progress": in_progress,
        "in_review": in_review,
        "in_qa": in_qa,
        "done": done,
        "in_progress_keys": in_progress_keys,
    }


async def run_sprint(**kwargs: Any) -> str:
    """[SKILL: jira_sprint] — Fetch my sprint tickets (listener first, then direct API)."""
    base = LAPTOP_LISTENER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=LISTENER_TIMEOUT) as client:
            r = await client.get(f"{base}/jira/my-sprint")
            r.raise_for_status()
            data = r.json()
    except Exception:
        ok, tickets, err = await direct_fetch_sprint()
        if not ok:
            return err or "Failed to fetch sprint."
        return _format_sprint(tickets or [])
    if "detail" in data and isinstance(data["detail"], str):
        return data["detail"]
    tickets = data.get("tickets") or data.get("data") or data
    if not isinstance(tickets, list):
        return "Unexpected response from listener."
    return _format_sprint(tickets)


async def run_ticket(key: Optional[str] = None, **kwargs: Any) -> str:
    """[SKILL: jira_ticket | key: DD-5771] — Fetch one ticket (listener first, then direct API)."""
    ticket_key = (key or kwargs.get("key") or "").strip().upper()
    if not ticket_key:
        return "Please specify a ticket key, e.g. [SKILL: jira_ticket | key: DD-5771]"
    base = LAPTOP_LISTENER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=LISTENER_TIMEOUT) as client:
            r = await client.get(f"{base}/jira/ticket/{ticket_key}")
            r.raise_for_status()
            data = r.json()
    except Exception:
        ok, data, err = await direct_fetch_ticket(ticket_key)
        if not ok:
            return err or "Failed to fetch ticket."
        return _format_ticket(data or {})
    if "detail" in data and isinstance(data["detail"], str):
        return data["detail"]
    return _format_ticket(data)


async def run_status(**kwargs: Any) -> str:
    """[SKILL: jira_status] — Sprint status summary (listener first, then direct API)."""
    base = LAPTOP_LISTENER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=LISTENER_TIMEOUT) as client:
            r = await client.get(f"{base}/jira/my-status")
            r.raise_for_status()
            data = r.json()
    except Exception:
        ok, tickets, err = await direct_fetch_sprint()
        if not ok:
            return err or "Failed to fetch sprint status."
        data = _status_from_sprint_tickets(tickets or [])
    if "detail" in data and isinstance(data["detail"], str):
        return data["detail"]
    return _format_status(data)


async def run_bugs(**kwargs: Any) -> str:
    """[SKILL: jira_bugs] — Fetch only bug tickets in current sprint (listener first, then direct API)."""
    base = LAPTOP_LISTENER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=LISTENER_TIMEOUT) as client:
            r = await client.get(f"{base}/jira/my-sprint")
            r.raise_for_status()
            data = r.json()
    except Exception:
        ok, tickets, err = await direct_fetch_sprint()
        if not ok:
            return err or "Failed to fetch sprint."
        data = {"tickets": tickets or []}
    if "detail" in data and isinstance(data["detail"], str):
        return data["detail"]
    tickets = data.get("tickets") or data.get("data") or data
    if not isinstance(tickets, list):
        return "Unexpected response from listener."
    bugs = [t for t in tickets if (t.get("type") or "").lower() == "bug"]
    if not bugs:
        return "No bugs assigned to you in the current sprint."
    groups: Dict[str, list] = {}
    for t in bugs:
        status = t.get("status") or "Unknown"
        groups.setdefault(status, []).append(t)
    lines = [f"Bugs: {len(bugs)} total\n"]
    for status, items in groups.items():
        lines.append(f"\n{status} ({len(items)}):")
        for t in items:
            lines.append(f"  {t.get('key', '?')} — {t.get('summary', '')} [{t.get('priority', '')}]")
    return "\n".join(lines)


async def run_query(question: Optional[str] = None, **kwargs: Any) -> str:
    """[SKILL: jira_query | question: ...] — Ask any Jira question; translate to JQL (listener first, then direct API)."""
    q = (question or kwargs.get("question") or "").strip()
    if not q:
        return "Please provide a question, e.g. [SKILL: jira_query | question: what bugs are in the backlog?]"
    if not OPENAI_API_KEY:
        return "OpenAI API key not set; cannot translate question to JQL."
    try:
        client = OpenAI(api_key=OPENAI_API_KEY)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": JQL_SYSTEM},
                {"role": "user", "content": q},
            ],
            temperature=0,
            max_tokens=200,
        )
        raw = (response.choices[0].message.content or "").strip()
        jql = re.sub(r"^```\w*\n?", "", raw)
        jql = re.sub(r"\n?```$", "", jql).strip()
        if not jql:
            return "Could not generate JQL from your question."
    except Exception as e:
        logger.warning("OpenAI JQL translation failed: %s", e)
        return f"JQL translation failed: {e}"
    base = LAPTOP_LISTENER_URL.rstrip("/")
    payload = {
        "jql": jql,
        "fields": ["key", "summary", "status", "priority", "assignee", "issuetype"],
        "max_results": 50,
    }
    try:
        async with httpx.AsyncClient(timeout=LISTENER_TIMEOUT) as client:
            r = await client.post(f"{base}/jira/query", json=payload)
            r.raise_for_status()
            data = r.json()
    except Exception:
        ok, tickets, err = await direct_run_jql(jql, payload["fields"], payload["max_results"])
        if not ok:
            return err or "JQL query failed."
        return _format_query_results(tickets or [])
    if "detail" in data and isinstance(data["detail"], str):
        return data["detail"]
    tickets = data.get("tickets") or data.get("data") or data
    if not isinstance(tickets, list):
        return "Unexpected response from listener."
    return _format_query_results(tickets)
