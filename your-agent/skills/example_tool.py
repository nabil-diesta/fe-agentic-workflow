"""
WAT example_tool as an async skill. Preserves original behavior (message, optional out path).
"""
from __future__ import annotations

import asyncio
from pathlib import Path


def _run_sync(message: str = "Hello from WAT", out: str | None = None) -> str:
    if out:
        path = Path(out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(message + "\n", encoding="utf-8")
        return f"Echo: {message}. Wrote to {path}"
    return f"Echo: {message}"


async def run(message: str = "", out: str | None = None, **kwargs) -> str:
    msg = (message or kwargs.get("msg") or "Hello from WAT").strip()
    out_path = out or kwargs.get("out")
    return await asyncio.to_thread(_run_sync, msg, out_path)
