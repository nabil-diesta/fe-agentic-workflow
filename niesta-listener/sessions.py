"""Read and parse Codex session files. Cached for 30 seconds."""
import json
import logging
import time
from pathlib import Path
from typing import List, Optional

from config import CODEX_SESSIONS_PATH, SESSIONS_CACHE_TTL_SECONDS

logger = logging.getLogger(__name__)

_cache: Optional[List[dict]] = None
_cache_time: float = 0


def _parse_session_file(path: Path) -> Optional[dict]:
    """Parse a single .jsonl session file. Returns None on any error."""
    try:
        if not path.is_file() or path.suffix != ".jsonl":
            return None
        session_id = None
        timestamp = None
        cwd = None
        model = None
        cli_version = None
        last_activity = None
        token_usage = None
        rate_limits = None
        last_token_count = None
        last_limits = {}
        for line in path.read_text(encoding="utf-8", errors="replace").strip().splitlines():
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(obj, dict):
                continue
            event = obj.get("event") or obj.get("type") or ""
            payload = obj.get("payload") or obj.get("data") or {}
            if not isinstance(payload, dict):
                payload = {}
            if "session_meta" in event or event == "session_meta":
                meta = payload if isinstance(payload, dict) else {}
                session_id = meta.get("id") or session_id
                timestamp = meta.get("timestamp") or timestamp
                cwd = meta.get("cwd") or cwd
                model = meta.get("model_provider") or model
                cli_version = meta.get("cli_version") or cli_version
            if "token_count" in event or event == "token_count":
                last_token_count = payload if isinstance(payload, dict) else last_token_count
            if "rate_limit" in event or "rate_limit" in str(payload).lower():
                limits = payload if isinstance(payload, dict) else {}
                used = limits.get("used_percent")
                if used is not None:
                    key = limits.get("limit_type") or "primary"
                    last_limits[key] = used
            last_activity = obj.get("timestamp") or obj.get("ts") or last_activity
        if last_token_count:
            token_usage = {
                "input": last_token_count.get("input"),
                "output": last_token_count.get("output"),
                "total": last_token_count.get("total"),
            }
        if last_limits:
            rate_limits = last_limits
        if last_activity is None and timestamp:
            last_activity = timestamp
        if session_id is None:
            session_id = path.stem
        try:
            last_ts = float(last_activity) if last_activity is not None else 0
        except (TypeError, ValueError):
            last_ts = path.stat().st_mtime if path.exists() else 0
        now = time.time()
        age_hours = (now - last_ts) / 3600.0 if last_ts else 999
        if age_hours < 24:
            status = "active"
        elif age_hours < 72:
            status = "idle"
        else:
            status = "forgotten"
        return {
            "session_id": session_id,
            "timestamp": timestamp,
            "cwd": cwd,
            "model": model,
            "cli_version": cli_version,
            "last_activity": last_activity,
            "last_activity_ts": last_ts,
            "token_usage": token_usage,
            "rate_limits": rate_limits,
            "status": status,
            "path": str(path),
        }
    except Exception as e:
        logger.warning("Failed to parse session file %s: %s", path, e)
        return None


def get_sessions(force_refresh: bool = False) -> List[dict]:
    """Return all parsed sessions, sorted by last_activity descending. Cached 30s."""
    global _cache, _cache_time
    now = time.time()
    if not force_refresh and _cache is not None and (now - _cache_time) < SESSIONS_CACHE_TTL_SECONDS:
        return _cache
    sessions_path = CODEX_SESSIONS_PATH
    if not sessions_path.exists():
        logger.debug("Sessions path does not exist: %s", sessions_path)
        _cache = []
        _cache_time = now
        return _cache
    results = []
    try:
        for path in sessions_path.rglob("*.jsonl"):
            s = _parse_session_file(path)
            if s:
                results.append(s)
    except Exception as e:
        logger.warning("Error walking sessions: %s", e)
    results.sort(key=lambda s: s.get("last_activity_ts") or 0, reverse=True)
    _cache = results
    _cache_time = now
    return results


def get_session_by_id(session_id: str) -> Optional[dict]:
    """Return a single session by session_id or None."""
    for s in get_sessions():
        if s.get("session_id") == session_id:
            return s
    return None


def get_active_sessions() -> List[dict]:
    """Return only sessions with status 'active' (< 24hrs)."""
    return [s for s in get_sessions() if s.get("status") == "active"]
