"""
Core agent loop: receive message, retrieve context, call OpenAI, parse skills, persist.
"""
import logging
from pathlib import Path

from openai import OpenAI

from config import OPENAI_API_KEY, OPENAI_DEFAULT_MODEL, AGENT_NAME
from memory import ChromaMemory, SQLiteMemory
from skills.registry import run_skill, parse_skill_invocations

logger = logging.getLogger(__name__)

SOUL_PATH = Path(__file__).resolve().parent / "SOUL.md"
CONTEXT_MESSAGES = 20


def _load_soul() -> str:
    try:
        return SOUL_PATH.read_text(encoding="utf-8").strip()
    except Exception as e:
        logger.warning("Could not load SOUL.md: %s", e)
        return f"You are {AGENT_NAME}, a helpful AI assistant. When you invoke a skill, use: [SKILL: skill_name | param: value]"


def _build_messages(
    soul: str,
    core_memory: dict,
    history: list[dict],
    semantic_context: list[str],
    user_message: str,
) -> list[dict]:
    system_parts = [soul]
    if core_memory:
        system_parts.append("\nCore memory (facts about the user):")
        for k, v in core_memory.items():
            system_parts.append(f"  - {k}: {v}")
    if semantic_context:
        system_parts.append("\nRelevant past context:")
        for c in semantic_context[:5]:
            system_parts.append(f"  - {c[:500]}")
    system_content = "\n".join(system_parts)

    messages = [{"role": "system", "content": system_content}]
    for h in history:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": user_message})
    return messages


async def process(
    message: str,
    session_id: str,
    source: str = "web",
) -> tuple[str, list[str]]:
    """
    Process one user message. Returns (response_text, list of skills_used).
    Never raises; errors are logged and returned as safe response.
    """
    if not message or not isinstance(message, str):
        return "Please send a non-empty message.", []

    message = message.strip()
    soul = _load_soul()
    sqlite = SQLiteMemory()
    chroma = ChromaMemory()

    core_memory = sqlite.get_core_memory()
    history = sqlite.get_conversation_history(session_id, limit=CONTEXT_MESSAGES)
    summary = sqlite.get_rolling_summary(session_id)
    if summary:
        history = [{"role": "system", "content": f"Earlier conversation summary: {summary}"}] + history

    semantic_context = chroma.search(message, n_results=5) if message else []

    try:
        client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
    except Exception as e:
        logger.warning("OpenAI client init: %s", e)
        client = None

    if not client or not OPENAI_API_KEY:
        sqlite.append_exchange(session_id, "user", message, source)
        sqlite.append_exchange(session_id, "assistant", "OpenAI API key not configured.", source)
        return "OpenAI API key not configured. Set OPENAI_API_KEY in .env.", []

    messages = _build_messages(soul, core_memory, history, semantic_context, message)

    try:
        response = client.chat.completions.create(
            model=OPENAI_DEFAULT_MODEL,
            messages=messages,
            temperature=0.7,
        )
        content = (response.choices[0].message.content or "").strip()
    except Exception as e:
        logger.exception("OpenAI call failed: %s", e)
        sqlite.append_exchange(session_id, "user", message, source)
        sqlite.append_exchange(session_id, "assistant", "Sorry, the model request failed.", source)
        return "Sorry, the model request failed. Please try again.", []

    skills_used: list[str] = []
    invocations = parse_skill_invocations(content)
    for skill_name, params in invocations:
        result = await run_skill(skill_name, params)
        skills_used.append(skill_name)
        content += f"\n[Skill {skill_name} result]: {result}"

    sqlite.append_exchange(session_id, "user", message, source)
    sqlite.append_exchange(session_id, "assistant", content, source)

    exchange_text = f"User: {message}\nAssistant: {content}"
    chroma.add(exchange_text, metadata={"session_id": session_id, "source": source})

    return content, skills_used
