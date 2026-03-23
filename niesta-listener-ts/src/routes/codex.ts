import type { FastifyInstance } from "fastify";
import {
  runCodexTask,
  resumeTask,
  interruptTask,
  getAllTasks,
  getRunningTasks,
  getTask,
  getTaskEvents,
  deleteTask,
  getThreadInfo,
  listCodexThreads,
} from "../services/codex.service.js";
import { config } from "../config.js";

export async function codexRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/codex/start", async (req, reply) => {
    const { task, cwd, ticket_key } = req.body as {
      task?: string;
      cwd?: string;
      ticket_key?: string;
    };
    if (!task || !cwd)
      return reply.status(400).send({ detail: "task and cwd are required" });
    try {
      return await runCodexTask(task, cwd, ticket_key);
    } catch (e) {
      return reply.status(500).send({ detail: String(e) });
    }
  });

  fastify.post("/codex/resume", async (req, reply) => {
    const { thread_id, prompt } = req.body as {
      thread_id?: string;
      prompt?: string;
    };
    if (!thread_id || !prompt)
      return reply.status(400).send({ detail: "thread_id and prompt are required" });
    try {
      return await resumeTask(thread_id, prompt);
    } catch (e) {
      return reply.status(500).send({ detail: String(e) });
    }
  });

  fastify.post("/codex/interrupt", async (req, reply) => {
    const { thread_id, turn_id } = req.body as {
      thread_id?: string;
      turn_id?: string;
    };
    if (!thread_id || !turn_id)
      return reply.status(400).send({ detail: "thread_id and turn_id are required" });
    try {
      return await interruptTask(thread_id, turn_id);
    } catch (e) {
      return reply.status(500).send({ detail: String(e) });
    }
  });

  fastify.get("/codex/tasks", async () => ({ tasks: getAllTasks() }));

  // Must be registered before /codex/tasks/:taskId so "running" isn't treated as an id
  fastify.get("/codex/tasks/running", async () => ({ tasks: getRunningTasks() }));

  fastify.get<{ Params: { taskId: string } }>("/codex/tasks/:taskId", async (req, reply) => {
    const task = getTask(req.params.taskId);
    if (!task) return reply.status(404).send({ detail: "Task not found" });
    return task;
  });

  fastify.delete<{ Params: { taskId: string } }>(
    "/codex/tasks/:taskId",
    async (req, reply) => {
      const deleted = deleteTask(req.params.taskId);
      if (!deleted) return reply.status(404).send({ detail: "Task not found" });
      return { deleted: req.params.taskId };
    }
  );

  fastify.get<{ Params: { taskId: string } }>(
    "/codex/tasks/:taskId/events",
    async (req, reply) => {
      const task = getTask(req.params.taskId);
      if (!task) return reply.status(404).send({ detail: "Task not found" });
      const events = getTaskEvents(task.thread_id ?? "");
      return { events };
    }
  );

  fastify.get<{ Params: { threadId: string } }>(
    "/codex/thread/:threadId",
    async (req, reply) => {
      const info = await getThreadInfo(req.params.threadId);
      if (!info) return reply.status(404).send({ detail: "Thread not found" });
      return info;
    }
  );

  fastify.get<{ Querystring: { limit?: string } }>("/codex/threads", async (req) => {
    const limit = parseInt(req.query.limit ?? "25", 10);
    return listCodexThreads(isNaN(limit) ? 25 : limit);
  });

  // Backwards-compat aliases
  fastify.get("/running-tasks", async () => ({ tasks: getRunningTasks() }));

  fastify.post("/run-codex", async (req, reply) => {
    const { task, cwd, ticket_key } = req.body as {
      task?: string;
      cwd?: string;
      ticket_key?: string;
    };
    if (!task) return reply.status(400).send({ detail: "task is required" });
    const resolvedCwd =
      cwd ?? config.defaultWorkdirs[0]?.path ?? process.env.HOME ?? "/tmp";
    try {
      return await runCodexTask(task, resolvedCwd, ticket_key);
    } catch (e) {
      return reply.status(500).send({ detail: String(e) });
    }
  });
}
