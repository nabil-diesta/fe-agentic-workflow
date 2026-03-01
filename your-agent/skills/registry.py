"""Maps skill names to async functions. Unknown skills are handled gracefully."""
from __future__ import annotations

import logging
import re
from typing import Any, Callable, Awaitable

from . import codex_monitor
from . import daily_brief
from . import example_tool as example_tool_skill
from . import jira_skill

logger = logging.getLogger(__name__)

SkillFn = Callable[..., Awaitable[str]]

_REGISTRY: dict[str, SkillFn] = {
    "daily_brief": daily_brief.run,
    "codex_monitor": codex_monitor.run,
    "example_tool": example_tool_skill.run,
    "jira_sprint": jira_skill.run_sprint,
    "jira_ticket": jira_skill.run_ticket,
    "jira_status": jira_skill.run_status,
    "jira_bugs": jira_skill.run_bugs,
}


def list_skills() -> list[str]:
    return list(_REGISTRY.keys())


def get_skill(name: str) -> SkillFn | None:
    return _REGISTRY.get(name.strip().lower())


async def run_skill(name: str, params: dict[str, Any]) -> str:
    skill = get_skill(name)
    if skill is None:
        return f"Skill not yet implemented: {name}"
    try:
        return await skill(**params)
    except Exception as e:
        logger.exception("Skill %s failed: %s", name, e)
        return f"Skill error: {name} — {str(e)}"


# Format: [SKILL: skill_name | param: value]
SKILL_PATTERN = re.compile(
    r"\[SKILL:\s*([^\s|\]]+)\s*(?:\|\s*([^\]]*))?\]",
    re.IGNORECASE,
)


def _parse_params(param_str: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if not param_str or not param_str.strip():
        return out
    for part in param_str.split("|"):
        part = part.strip()
        if ":" in part:
            k, _, v = part.partition(":")
            out[k.strip().lower().replace(" ", "_")] = v.strip()
    return out


def parse_skill_invocations(text: str) -> list[tuple[str, dict[str, Any]]]:
    """Extract [SKILL: name | param: value] from model output."""
    invocations = []
    for m in SKILL_PATTERN.finditer(text):
        name = m.group(1).strip()
        param_str = (m.group(2) or "").strip()
        params = _parse_params(param_str)
        invocations.append((name, params))
    return invocations
