/**
 * Codex task orchestration — fire tasks via app-server, persist to SQLite.
 * Port of niesta-listener/executor.py
 */
import { codexServer } from "./codex-server.service.js";
import * as db from "./db.service.js";
import { config } from "../config.js";
import type { Task } from "../types/index.js";

type AnyObj = Record<string, unknown>;

// In-memory event buffer per thread (for streaming to dashboard)
const threadEvents = new Map<string, AnyObj[]>();

function extractTicketKey(task: string): string | null {
  const m = task.match(/(DD-\d+)/);
  return m ? m[1] : null;
}

function makeTaskId(): string {
  return `codex_${Date.now()}`;
}

async function notifyNiesta(message: string): Promise<void> {
  try {
    await fetch(`${config.niestaApiUrl.replace(/\/$/, "")}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch (e) {
    console.warn("[codex] Failed to notify Niesta:", e);
  }
}

function handleEvent(msg: AnyObj): void {
  const method = (msg.method as string) ?? "";
  const params = (msg.params as AnyObj) ?? {};

  // Extract thread_id from various event shapes (matches Python logic)
  let threadId: string | null = null;
  if (typeof params.threadId === "string") {
    threadId = params.threadId;
  } else if (
    params.thread &&
    typeof (params.thread as AnyObj).id === "string"
  ) {
    threadId = (params.thread as AnyObj).id as string;
  } else if (
    params.turn &&
    typeof (params.turn as AnyObj).threadId === "string"
  ) {
    threadId = (params.turn as AnyObj).threadId as string;
  }

  if (threadId) {
    if (!threadEvents.has(threadId)) threadEvents.set(threadId, []);
    const events = threadEvents.get(threadId)!;
    events.push({ method, params, timestamp: Date.now() / 1000 });
    if (events.length > 200) events.splice(0, events.length - 200);
  }

  if (method === "turn/completed") {
    void onTurnCompleted(params);
  }
}

async function onTurnCompleted(params: AnyObj): Promise<void> {
  const turn = (params.turn as AnyObj) ?? {};
  const turnId = turn.id as string | undefined;
  if (!turnId) return;

  const turnStatus = (turn.status as string) ?? "completed";

  let output = "";
  for (const item of ((turn.items as unknown[]) ?? [])) {
    const it = item as AnyObj;
    if (it.type === "agentMessage") output = (it.text as string) ?? "";
  }

  let error = "";
  let mappedStatus: Task["status"] = "completed";
  if (turn.error) {
    error = String(turn.error);
    mappedStatus = "failed";
  } else if (turnStatus !== "completed") {
    mappedStatus = "failed";
  }

  const task = db.updateTaskByTurnId(turnId, {
    status: mappedStatus,
    completed_at: Date.now() / 1000,
    output,
    error,
  });

  const key =
    task?.ticket_key ?? extractTicketKey(task?.task ?? "") ?? "unknown";
  let message = `Codex ${mappedStatus} on ${key}.`;
  if (output) message += " " + output.slice(0, 500);
  else if (error) message += " " + error.slice(0, 500);

  await notifyNiesta(message);
}

export async function initCodexService(): Promise<void> {
  await codexServer.start();
  codexServer.addEventListenerFn(handleEvent);
}

export async function runCodexTask(
  task: string,
  cwd: string,
  ticketKey?: string | null
): Promise<AnyObj> {
  const resolvedKey = ticketKey ?? extractTicketKey(task);
  const taskId = makeTaskId();
  const startedAt = Date.now() / 1000;

  const threadResult = await codexServer.startThread(cwd);
  const thread = (threadResult.thread as AnyObj) ?? {};
  const threadId = thread.id as string;

  const turnResult = await codexServer.startTurn(threadId, task, cwd);
  const turn = (turnResult.turn as AnyObj) ?? {};
  const turnId = turn.id as string;

  db.insertTask({
    task_id: taskId,
    thread_id: threadId,
    turn_id: turnId,
    ticket_key: resolvedKey ?? null,
    task,
    cwd,
    status: "running",
    started_at: startedAt,
  });

  return {
    task_id: taskId,
    thread_id: threadId,
    turn_id: turnId,
    ticket_key: resolvedKey,
    cwd,
    task,
    started_at: startedAt,
  };
}

export async function resumeTask(threadId: string, prompt: string): Promise<AnyObj> {
  await codexServer.resumeThread(threadId);
  const turnResult = await codexServer.startTurn(threadId, prompt);
  const turn = (turnResult.turn as AnyObj) ?? {};
  const turnId = turn.id as string;

  db.resumeTasksByThreadId(threadId);
  // Update turn_id so onTurnCompleted can find this task when the new turn fires
  if (turnId) db.updateTurnIdByThreadId(threadId, turnId);

  return { thread_id: threadId, turn_id: turnId };
}

export async function interruptTask(threadId: string, turnId: string): Promise<AnyObj> {
  let result: AnyObj = {};
  try {
    result = await codexServer.interruptTurn(threadId, turnId);
  } catch (e) {
    console.warn(
      `[codex] interrupt_turn ${threadId}/${turnId}: ${e} (marking interrupted anyway)`
    );
  }

  db.updateTasksByThreadId(threadId, {
    status: "interrupted",
    completed_at: Date.now() / 1000,
  });

  return result.interrupted !== undefined ? result : { interrupted: true };
}

export function getTaskEvents(threadId: string): AnyObj[] {
  return threadEvents.get(threadId) ?? [];
}

export function getAllTasks(): Task[] {
  return db.getAllTasks();
}

export function getRunningTasks(): Task[] {
  return db.getRunningTasks();
}

export function getTask(taskId: string): Task | undefined {
  return db.getTask(taskId);
}

export function deleteTask(taskId: string): boolean {
  return db.deleteTask(taskId);
}

export function deleteTasksByThreadId(threadId: string): number {
  return db.deleteTasksByThreadId(threadId);
}

export async function getThreadInfo(threadId: string): Promise<AnyObj | null> {
  try {
    return await codexServer.readThread(threadId);
  } catch (e) {
    console.warn(`[codex] Failed to read thread ${threadId}: ${e}`);
    return null;
  }
}

export async function listCodexThreads(limit = 25): Promise<AnyObj> {
  return codexServer.listThreads(limit);
}
