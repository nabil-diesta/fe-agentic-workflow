/**
 * CodexAppServer — manages a long-running `codex app-server` subprocess
 * via JSONL over stdio. TypeScript port of niesta-listener/codex_server.py
 */
import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import { EventEmitter } from "events";

type AnyObj = Record<string, unknown>;
type RequestId = number;
type EventListenerFn = (msg: AnyObj) => void;

interface PendingEntry {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CodexAppServer extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<RequestId, PendingEntry>();
  private eventListeners: EventListenerFn[] = [];
  private initialized = false;
  private starting = false;

  async start(): Promise<void> {
    if (this.initialized && this.process && this.process.exitCode === null) return;

    // If already starting, wait for it to finish
    if (this.starting) {
      await new Promise<void>((resolve) => this.once("_started", resolve));
      return;
    }

    this.starting = true;
    this.initialized = false;

    try {
      this.process = spawn("codex", ["app-server"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.process.on("exit", () => {
        this.initialized = false;
        const err = new Error("Codex app-server process exited unexpectedly");
        for (const entry of this.pending.values()) {
          clearTimeout(entry.timer);
          entry.reject(err);
        }
        this.pending.clear();
        console.log("[codex-server] process exited");
      });

      if (this.process.stderr) {
        this.process.stderr.on("data", (data: Buffer) => {
          console.error("[codex-server stderr]", data.toString().trim());
        });
      }

      if (this.process.stdout) {
        const rl = createInterface({ input: this.process.stdout, crlfDelay: Infinity });
        rl.on("line", (line) => this.handleLine(line));
      }

      // Send initialize directly — cannot use sendRequest (initialized is false, would deadlock)
      await this.sendRaw(
        "initialize",
        {
          clientInfo: {
            name: "niesta_listener",
            title: "Niesta Listener",
            version: "0.1.0",
          },
        },
        30_000
      );

      this.writeMsg({ method: "initialized", params: {} });
      this.initialized = true;
      console.log("[codex-server] initialized");
    } finally {
      this.starting = false;
      this.emit("_started");
    }
  }

  async stop(): Promise<void> {
    if (this.process && this.process.exitCode === null) {
      this.process.kill("SIGTERM");
    }
    this.initialized = false;
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let msg: AnyObj;
    try {
      msg = JSON.parse(line) as AnyObj;
    } catch {
      return;
    }

    const id = msg.id as RequestId | undefined;
    if (id !== undefined && this.pending.has(id)) {
      const entry = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (msg.error) {
        entry.reject(new Error(JSON.stringify(msg.error)));
      } else {
        entry.resolve(msg.result);
      }
    } else if (msg.method) {
      for (const listener of [...this.eventListeners]) {
        try {
          listener(msg);
        } catch {
          // ignore listener errors
        }
      }
    }
  }

  private writeMsg(msg: AnyObj): void {
    if (!this.process?.stdin) throw new Error("App-server not running");
    this.process.stdin.write(JSON.stringify(msg) + "\n");
  }

  private sendRaw(
    method: string,
    params: AnyObj,
    timeoutMs: number
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.requestId += 1;
      const id = this.requestId;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} (id=${id}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.writeMsg({ method, id, params });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e as Error);
      }
    });
  }

  private async sendRequest(
    method: string,
    params: AnyObj,
    timeoutMs: number
  ): Promise<unknown> {
    if (!this.initialized || this.process?.exitCode !== null) {
      console.log(`[codex-server] not running, restarting before ${method}`);
      await this.start();
    }
    return this.sendRaw(method, params, timeoutMs);
  }

  addEventListenerFn(cb: EventListenerFn): void {
    this.eventListeners.push(cb);
  }

  removeEventListenerFn(cb: EventListenerFn): void {
    this.eventListeners = this.eventListeners.filter((l) => l !== cb);
  }

  async startThread(
    cwd: string,
    model = "gpt-5.1-codex",
    approvalPolicy = "never",
    sandbox = "workspace-write"
  ): Promise<AnyObj> {
    return (await this.sendRequest(
      "thread/start",
      { model, cwd, approvalPolicy, sandbox },
      30_000
    )) as AnyObj;
  }

  async startTurn(threadId: string, prompt: string, cwd?: string): Promise<AnyObj> {
    const params: AnyObj = {
      threadId,
      input: [{ type: "text", text: prompt }],
    };
    if (cwd) params.cwd = cwd;
    // Long timeout — AI processing can take minutes
    return (await this.sendRequest("turn/start", params, 300_000)) as AnyObj;
  }

  async resumeThread(threadId: string): Promise<AnyObj> {
    return (await this.sendRequest(
      "thread/resume",
      { threadId },
      30_000
    )) as AnyObj;
  }

  async interruptTurn(threadId: string, turnId: string): Promise<AnyObj> {
    return (await this.sendRequest(
      "turn/interrupt",
      { threadId, turnId },
      30_000
    )) as AnyObj;
  }

  async readThread(threadId: string, includeTurns = true): Promise<AnyObj> {
    return (await this.sendRequest(
      "thread/read",
      { threadId, includeTurns },
      20_000
    )) as AnyObj;
  }

  async listThreads(limit = 25, sourceKinds?: string[]): Promise<AnyObj> {
    const params: AnyObj = { limit };
    if (sourceKinds) params.sourceKinds = sourceKinds;
    return (await this.sendRequest("thread/list", params, 20_000)) as AnyObj;
  }
}

export const codexServer = new CodexAppServer();
