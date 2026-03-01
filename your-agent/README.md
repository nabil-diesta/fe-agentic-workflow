# DevAgent — 24/7 Python AI Agent

Runs on Ubuntu VPS with Docker Compose. FastAPI (REST + web chat), Telegram polling, OpenAI, ChromaDB (semantic memory), SQLite (core memory + conversation history).

## Setup

1. **Clone and enter the agent directory**
   ```bash
   cd your-agent
   ```

2. **Environment**
   ```bash
   cp .env.example .env
   # Edit .env: set OPENAI_API_KEY and optionally TELEGRAM_BOT_TOKEN
   ```

3. **Run with Docker Compose**
   ```bash
   docker compose up -d
   ```
   - API: http://localhost:8000  
   - Web chat: http://localhost:8000/  
   - Health: http://localhost:8000/health  

4. **Run locally (no Docker)**
   ```bash
   pip install -r requirements.txt
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
   Data is stored under `./data/` (chroma + SQLite).

## API

| Method | Path     | Description |
|--------|----------|-------------|
| POST   | /chat    | `{"message": "...", "session_id": "..."}` → `{"response": "...", "skills_used": []}` |
| GET    | /status  | Agent status, memory stats, uptime |
| GET    | /memories| Last 20 ChromaDB entries |
| GET    | /health  | `{"status": "ok"}` |

## Adding a new skill

1. **Create the skill module** in `skills/`, e.g. `skills/my_skill.py`:
   ```python
   import logging
   logger = logging.getLogger(__name__)

   async def run(**kwargs) -> str:
       # kwargs can contain param: value from [SKILL: my_skill | param: value]
       name = kwargs.get("param", "default")
       return f"Result for {name}"
   ```

2. **Register it** in `skills/registry.py`:
   - `from . import my_skill`
   - Add `"my_skill": my_skill.run` to `_REGISTRY`.

3. The agent will then recognise `[SKILL: my_skill | param: value]` in model output and call your skill. Unknown skills return a graceful "Skill not yet implemented" message.

## Behaviour

- **SOUL.md** is loaded as the system prompt on startup.
- Core memory (SQLite) stores name, preferences, projects.
- Last 20 messages kept in context; older context can be compressed into a rolling summary (placeholder).
- Every exchange is embedded and stored in ChromaDB for semantic retrieval.
- Skills are invoked via the format: `[SKILL: skill_name | param: value]`.

## WAT integration

This agent lives inside the WAT repo. Workflows in `../workflows/` define SOPs; skills in `skills/` include both agent skills and preserved scripts from the former `tools/` directory (e.g. `example_tool`).
