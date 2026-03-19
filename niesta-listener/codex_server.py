import asyncio
import json
import logging
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class CodexAppServer:
    """Manages a long-running codex app-server subprocess via JSONL over stdio."""

    def __init__(self):
        self._process: Optional[asyncio.subprocess.Process] = None
        self._request_id = 0
        self._pending: Dict[int, asyncio.Future] = {}
        self._event_listeners: List[Callable[[dict], Any]] = []
        self._reader_task: Optional[asyncio.Task] = None
        self._initialized = False
        self._start_lock = asyncio.Lock()  # prevents concurrent restarts

    async def start(self):
        """Spawn codex app-server and perform initialize handshake. Concurrent-safe."""
        # Fast path — already running, no lock needed
        if self._initialized and self._process and self._process.returncode is None:
            return

        async with self._start_lock:
            # Double-check after acquiring the lock (another coroutine may have started it)
            if self._initialized and self._process and self._process.returncode is None:
                return

            self._initialized = False

            self._process = await asyncio.create_subprocess_exec(
                "codex",
                "app-server",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            self._reader_task = asyncio.create_task(self._read_loop())

            # Send initialize directly — do NOT call _send_request here.
            # _send_request checks _initialized (False) and calls start(), which
            # would deadlock on _start_lock.
            self._request_id += 1
            rid = self._request_id
            loop = asyncio.get_running_loop()
            future: asyncio.Future = loop.create_future()
            self._pending[rid] = future
            await self._write(
                {
                    "method": "initialize",
                    "id": rid,
                    "params": {
                        "clientInfo": {
                            "name": "niesta_listener",
                            "title": "Niesta Listener",
                            "version": "0.1.0",
                        }
                    },
                }
            )
            try:
                await asyncio.wait_for(future, timeout=30)
            except asyncio.TimeoutError:
                self._pending.pop(rid, None)
                raise TimeoutError("Codex app-server initialize timed out")

            await self._send_notification("initialized", {})
            self._initialized = True
            logger.info("Codex app-server initialized")

    async def stop(self):
        """Shut down app-server process."""
        if self._process and self._process.returncode is None:
            self._process.terminate()
            await self._process.wait()
        if self._reader_task:
            self._reader_task.cancel()
        self._initialized = False

    async def _send_notification(self, method: str, params: dict):
        msg = {"method": method, "params": params}
        await self._write(msg)

    async def _send_request(self, method: str, params: dict, timeout: float = 60) -> Any:
        # Auto-restart if the subprocess has died
        if not self._initialized or (self._process and self._process.returncode is not None):
            logger.info("App-server not running, restarting before %s", method)
            await self.start()

        self._request_id += 1
        rid = self._request_id
        msg = {"method": method, "id": rid, "params": params}

        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        self._pending[rid] = future
        await self._write(msg)

        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(rid, None)
            raise TimeoutError(f"Request {method} (id={rid}) timed out after {timeout}s")

    async def _write(self, msg: dict):
        if not self._process or not self._process.stdin:
            raise RuntimeError("App server not running")
        line = json.dumps(msg) + "\n"
        self._process.stdin.write(line.encode())
        await self._process.stdin.drain()

    async def _read_loop(self):
        try:
            while True:
                if not self._process or not self._process.stdout:
                    break
                line = await self._process.stdout.readline()
                if not line:
                    break
                try:
                    msg = json.loads(line.decode().strip())
                except json.JSONDecodeError:
                    continue

                if "id" in msg and msg["id"] in self._pending:
                    future = self._pending.pop(msg["id"])
                    if "error" in msg:
                        future.set_exception(Exception(json.dumps(msg["error"])))
                    else:
                        future.set_result(msg.get("result"))
                elif "method" in msg:
                    for listener in list(self._event_listeners):
                        try:
                            listener(msg)
                        except Exception as e:
                            logger.warning("Event listener error: %s", e)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.exception("Read loop error: %s", e)
        finally:
            # Process exited — fail all waiting requests so they don't hang forever
            if self._pending:
                logger.warning(
                    "App-server exited with %d pending requests — failing them",
                    len(self._pending),
                )
                err = Exception("Codex app-server process exited unexpectedly")
                for future in self._pending.values():
                    if not future.done():
                        future.set_exception(err)
                self._pending.clear()
            self._initialized = False
            logger.info("Read loop exited; app-server marked as not initialized")

    def add_event_listener(self, callback: Callable[[dict], Any]):
        self._event_listeners.append(callback)

    def remove_event_listener(self, callback: Callable[[dict], Any]):
        if callback in self._event_listeners:
            self._event_listeners.remove(callback)

    async def start_thread(
        self,
        cwd: str,
        model: str = "gpt-5.1-codex",
        approval_policy: str = "never",
        sandbox: str = "workspace-write",
    ) -> dict:
        return await self._send_request(
            "thread/start",
            {
                "model": model,
                "cwd": cwd,
                "approvalPolicy": approval_policy,
                "sandbox": sandbox,
            },
            timeout=30,
        )

    async def start_turn(self, thread_id: str, prompt: str, cwd: Optional[str] = None) -> dict:
        params: Dict[str, Any] = {
            "threadId": thread_id,
            "input": [{"type": "text", "text": prompt}],
        }
        if cwd:
            params["cwd"] = cwd
        # Long timeout — AI processing can take several minutes
        return await self._send_request("turn/start", params, timeout=300)

    async def resume_thread(self, thread_id: str) -> dict:
        return await self._send_request("thread/resume", {"threadId": thread_id}, timeout=30)

    async def interrupt_turn(self, thread_id: str, turn_id: str) -> dict:
        return await self._send_request(
            "turn/interrupt",
            {"threadId": thread_id, "turnId": turn_id},
            timeout=30,
        )

    async def read_thread(self, thread_id: str, include_turns: bool = True) -> dict:
        return await self._send_request(
            "thread/read",
            {"threadId": thread_id, "includeTurns": include_turns},
            timeout=20,
        )

    async def list_threads(self, limit: int = 25, source_kinds: Optional[List[str]] = None) -> dict:
        params: Dict[str, Any] = {"limit": limit}
        if source_kinds:
            params["sourceKinds"] = source_kinds
        return await self._send_request("thread/list", params, timeout=20)

    async def list_loaded_threads(self) -> dict:
        return await self._send_request("thread/loaded/list", {}, timeout=20)


codex_server = CodexAppServer()
