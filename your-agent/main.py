"""
FastAPI app entry point: REST API, web chat UI, and Telegram polling in background.
"""
import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from agent import process
from config import TELEGRAM_BOT_TOKEN
from memory import ChromaMemory, SQLiteMemory
from skills.registry import list_skills

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

START_TIME = time.time()


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"


class ChatResponse(BaseModel):
    response: str
    skills_used: list[str] = []


def _run_telegram_polling() -> None:
    """Run Telegram bot in polling mode (blocking). Intended for a background thread."""
    if not TELEGRAM_BOT_TOKEN:
        logger.info("TELEGRAM_BOT_TOKEN not set; Telegram bot disabled.")
        return
    try:
        from telegram import Update
        from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

        async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
            if not update.message or not update.message.text:
                return
            text = update.message.text.strip()
            session_id = f"telegram_{update.effective_user.id if update.effective_user else 'unknown'}"
            try:
                response, skills_used = await process(text, session_id=session_id, source="telegram")
                await update.message.reply_text(response[:4000])
            except Exception as e:
                logger.exception("Telegram handler error: %s", e)
                await update.message.reply_text("Something went wrong. Please try again.")

        async def post_init(app: Application) -> None:
            app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

        app = Application.builder().token(TELEGRAM_BOT_TOKEN).post_init(post_init).build()
        app.run_polling(allowed_updates=Update.ALL_TYPES)
    except ImportError:
        logger.warning("python-telegram-bot not installed; Telegram disabled.")
    except Exception as e:
        logger.exception("Telegram polling failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start Telegram polling in background thread."""
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _run_telegram_polling)
    yield
    # Shutdown: executor threads are daemon by default; no explicit stop needed for polling


app = FastAPI(title="DevAgent", lifespan=lifespan)


@app.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest) -> ChatResponse:
    """Process a chat message and return agent response."""
    try:
        response, skills_used = await process(
            body.message,
            session_id=body.session_id or "default",
            source="web",
        )
        return ChatResponse(response=response, skills_used=skills_used)
    except Exception as e:
        logger.exception("Chat error: %s", e)
        raise HTTPException(status_code=500, detail="Chat processing failed.")


@app.get("/status")
async def status() -> dict:
    """Agent status, memory stats, uptime."""
    try:
        chroma = ChromaMemory()
        sqlite = SQLiteMemory()
        return {
            "status": "ok",
            "uptime_seconds": round(time.time() - START_TIME, 1),
            "chroma_entries": chroma.count(),
            "skills": list_skills(),
        }
    except Exception as e:
        logger.exception("Status error: %s", e)
        return {"status": "error", "message": str(e)}


@app.get("/memories")
async def memories() -> dict:
    """Last 20 ChromaDB entries."""
    try:
        chroma = ChromaMemory()
        entries = chroma.get_last(20)
        return {"count": len(entries), "entries": entries}
    except Exception as e:
        logger.exception("Memories error: %s", e)
        return {"count": 0, "entries": [], "error": str(e)}


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


CHAT_HTML = """
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>DevAgent Chat</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 1rem; }
    #log { border: 1px solid #ccc; border-radius: 8px; height: 360px; overflow-y: auto; padding: 1rem; margin-bottom: 1rem; }
    .msg { margin: 0.5rem 0; }
    .user { color: #06c; }
    .assistant { color: #363; }
    form { display: flex; gap: 0.5rem; }
    input[type="text"] { flex: 1; padding: 0.5rem; border-radius: 6px; border: 1px solid #ccc; }
    button { padding: 0.5rem 1rem; border-radius: 6px; border: none; background: #06c; color: #fff; cursor: pointer; }
    button:hover { background: #05a; }
  </style>
</head>
<body>
  <h1>DevAgent</h1>
  <div id="log"></div>
  <form id="f">
    <input type="text" id="input" placeholder="Message..." autocomplete="off" />
    <button type="submit">Send</button>
  </form>
  <script>
    const log = document.getElementById('log');
    const input = document.getElementById('input');
    const sessionId = 'web-' + Math.random().toString(36).slice(2, 10);
    function add(msg, who) {
      const div = document.createElement('div');
      div.className = 'msg ' + who;
      div.textContent = (who === 'user' ? 'You: ' : 'Agent: ') + msg;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      add(text, 'user');
      try {
        const r = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, session_id: sessionId })
        });
        const d = await r.json();
        add(d.response || d.detail || 'No response', 'assistant');
      } catch (err) {
        add('Error: ' + err.message, 'assistant');
      }
    };
  </script>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    return HTMLResponse(CHAT_HTML)
