# WAT Framework — Folder Structure

```
fe-agentic-workflow/
├── .env                    # API keys and env vars (gitignored; copy from .env.example)
├── .env.example            # Template for required env vars (WAT + DevAgent)
├── .gitignore
├── FOLDER_STRUCTURE.md     # This file
├── .tmp/                   # Temporary / intermediate files (disposable, regenerated as needed)
│   └── .gitkeep
├── skills/                 # Python scripts — deterministic execution (renamed from tools/)
│   └── example_tool.py
├── workflows/              # Markdown SOPs — what to do, which tools, inputs/outputs
│   └── example_workflow.md
└── your-agent/             # 24/7 Python AI agent (Docker Compose)
    ├── main.py             # FastAPI app entry point
    ├── agent.py            # Core agent loop and decision making
    ├── config.py           # Loads all env vars
    ├── SOUL.md             # Agent personality / system prompt
    ├── .env.example        # Agent env template
    ├── requirements.txt
    ├── Dockerfile
    ├── docker-compose.yml
    ├── README.md
    ├── memory/
    │   ├── __init__.py
    │   ├── chroma_memory.py   # Semantic search (ChromaDB)
    │   └── sqlite_memory.py   # Core memory + conversation history
    └── skills/
        ├── __init__.py
        ├── registry.py        # Maps skill names to async functions
        ├── daily_brief.py     # Placeholder skill
        ├── codex_monitor.py   # Placeholder skill
        └── example_tool.py    # WAT example_tool as async skill
```

## Purpose

| Path | Role |
|------|------|
| **workflows/** | Instructions for the agent: objectives, inputs, tools to call, outputs, edge cases. |
| **skills/** | Scripts that do the work (renamed from tools/). Call from workflows or from your-agent. |
| **your-agent/** | Docker-based AI agent: FastAPI, Telegram, OpenAI, ChromaDB, SQLite. |
| **.tmp/** | Scratch space for scraped data, exports, intermediates. Safe to delete; regenerate as needed. |
| **.env** | Secrets only. Never store credentials in code or commit `.env`. |

## Optional (gitignored when present)

- `credentials.json`, `token.json` — e.g. Google OAuth; keep local only.
- `your-agent/data/` — Agent ChromaDB and SQLite data (persisted via Docker volume).
