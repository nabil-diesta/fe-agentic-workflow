import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { Task, PipelineStepRow } from "../types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, "..", "..", "tasks.db");

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    task_id      TEXT PRIMARY KEY,
    thread_id    TEXT,
    turn_id      TEXT,
    ticket_key   TEXT,
    task         TEXT,
    cwd          TEXT,
    status       TEXT DEFAULT 'running',
    started_at   REAL,
    completed_at REAL,
    output       TEXT DEFAULT '',
    error        TEXT DEFAULT ''
  )
`);

// Migrate: add columns missing from old schema
const existingCols = new Set(
  (db.pragma("table_info(tasks)") as Array<{ name: string }>).map((r) => r.name)
);
for (const [col, def] of [
  ["thread_id", "TEXT"],
  ["turn_id", "TEXT"],
  ["ticket_key", "TEXT"],
  ["output", "TEXT DEFAULT ''"],
  ["error", "TEXT DEFAULT ''"],
] as [string, string][]) {
  if (!existingCols.has(col)) {
    try {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${col} ${def}`);
    } catch {
      // column already exists or other benign error
    }
  }
}

export function insertTask(
  t: Pick<Task, "task_id" | "thread_id" | "turn_id" | "ticket_key" | "task" | "cwd" | "status" | "started_at">
): void {
  db.prepare(
    `INSERT INTO tasks (task_id, thread_id, turn_id, ticket_key, task, cwd, status, started_at)
     VALUES (@task_id, @thread_id, @turn_id, @ticket_key, @task, @cwd, @status, @started_at)`
  ).run(t);
}

export function updateTask(
  taskId: string,
  fields: Partial<Pick<Task, "status" | "completed_at" | "output" | "error">>
): void {
  const sets = Object.keys(fields)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(`UPDATE tasks SET ${sets} WHERE task_id = @task_id`).run({
    ...fields,
    task_id: taskId,
  });
}

export function updateTaskByTurnId(
  turnId: string,
  fields: Partial<Pick<Task, "status" | "completed_at" | "output" | "error">>
): Task | undefined {
  const sets = Object.keys(fields)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(`UPDATE tasks SET ${sets} WHERE turn_id = @turn_id`).run({
    ...fields,
    turn_id: turnId,
  });
  return db.prepare("SELECT * FROM tasks WHERE turn_id = ?").get(turnId) as Task | undefined;
}

export function resumeTasksByThreadId(threadId: string): void {
  db.prepare(
    "UPDATE tasks SET status = 'running', completed_at = NULL WHERE thread_id = ?"
  ).run(threadId);
}

export function updateTasksByThreadId(
  threadId: string,
  fields: Partial<Pick<Task, "status" | "completed_at">>
): void {
  const sets = Object.keys(fields)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(`UPDATE tasks SET ${sets} WHERE thread_id = @thread_id`).run({
    ...fields,
    thread_id: threadId,
  });
}

export function getAllTasks(): Task[] {
  return db
    .prepare("SELECT * FROM tasks WHERE task_id NOT LIKE 'pipeline_%' ORDER BY started_at DESC LIMIT 50")
    .all() as Task[];
}

export function getRunningTasks(): Task[] {
  return db
    .prepare("SELECT * FROM tasks WHERE status = 'running' ORDER BY started_at DESC")
    .all() as Task[];
}

export function getTask(taskId: string): Task | undefined {
  return db
    .prepare("SELECT * FROM tasks WHERE task_id = ?")
    .get(taskId) as Task | undefined;
}

export function deleteTask(taskId: string): boolean {
  const result = db.prepare("DELETE FROM tasks WHERE task_id = ?").run(taskId);
  return result.changes > 0;
}

export function deletePipeline(taskId: string): boolean {
  db.prepare("DELETE FROM pipeline_steps WHERE task_id = ?").run(taskId);
  const result = db.prepare("DELETE FROM tasks WHERE task_id = ?").run(taskId);
  return result.changes > 0;
}

export function deleteTasksByThreadId(threadId: string): number {
  const result = db.prepare("DELETE FROM tasks WHERE thread_id = ?").run(threadId);
  return result.changes;
}

export function getTaskByThreadId(threadId: string): Task | undefined {
  return db
    .prepare("SELECT * FROM tasks WHERE thread_id = ? ORDER BY started_at DESC LIMIT 1")
    .get(threadId) as Task | undefined;
}

export function updateTurnIdByThreadId(threadId: string, turnId: string): void {
  db.prepare("UPDATE tasks SET turn_id = ? WHERE thread_id = ?").run(turnId, threadId);
}

export function getPipelineTasks(limit = 50): Task[] {
  return db
    .prepare("SELECT * FROM tasks WHERE task_id LIKE 'pipeline_%' ORDER BY started_at DESC LIMIT ?")
    .all(limit) as Task[];
}

// ─── Pipeline Steps ───────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS pipeline_steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    step_name   TEXT NOT NULL,
    status      TEXT DEFAULT 'pending',
    output      TEXT DEFAULT '',
    context     TEXT DEFAULT '',
    started_at  REAL,
    completed_at REAL,
    approved_by TEXT,
    approved_at REAL,
    FOREIGN KEY (task_id) REFERENCES tasks(task_id)
  )
`);

export function insertPipelineStep(step: {
  task_id: string;
  step_number: number;
  step_name: string;
  status?: string;
}): void {
  db.prepare(
    `INSERT INTO pipeline_steps (task_id, step_number, step_name, status)
     VALUES (@task_id, @step_number, @step_name, @status)`
  ).run({ status: "pending", ...step });
}

export function updatePipelineStep(
  taskId: string,
  stepNumber: number,
  fields: Partial<{
    status: string;
    output: string;
    started_at: number;
    completed_at: number;
    approved_by: string;
    approved_at: number;
  }>
): void {
  if (Object.keys(fields).length === 0) return;
  const sets = Object.keys(fields)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(
    `UPDATE pipeline_steps SET ${sets} WHERE task_id = @task_id AND step_number = @step_number`
  ).run({ ...fields, task_id: taskId, step_number: stepNumber });
}

export function updatePipelineStepContext(
  taskId: string,
  stepNumber: number,
  context: string
): void {
  db.prepare(
    "UPDATE pipeline_steps SET context = ? WHERE task_id = ? AND step_number = ?"
  ).run(context, taskId, stepNumber);
}

export function getPipelineSteps(taskId: string): PipelineStepRow[] {
  return db
    .prepare("SELECT * FROM pipeline_steps WHERE task_id = ? ORDER BY step_number")
    .all(taskId) as PipelineStepRow[];
}

export function getPipelineStep(
  taskId: string,
  stepNumber: number
): PipelineStepRow | undefined {
  return db
    .prepare("SELECT * FROM pipeline_steps WHERE task_id = ? AND step_number = ?")
    .get(taskId, stepNumber) as PipelineStepRow | undefined;
}
