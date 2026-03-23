import type { FastifyInstance } from "fastify";
import {
  getSessions,
  getSessionById,
  getActiveSessions,
  deleteSession,
} from "../services/sessions.service.js";
import { deleteTasksByThreadId } from "../services/codex.service.js";

export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/sessions", async () => getSessions());

  fastify.get("/sessions/active", async () => getActiveSessions());

  fastify.get<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId",
    async (req, reply) => {
      const s = getSessionById(req.params.sessionId);
      if (!s) return reply.status(404).send({ detail: "Session not found" });
      return s;
    }
  );

  fastify.delete<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId",
    async (req, reply) => {
      const deleted = deleteSession(req.params.sessionId);
      if (!deleted) return reply.status(404).send({ detail: "Session not found" });
      const tasksDeleted = deleteTasksByThreadId(req.params.sessionId);
      return { deleted: req.params.sessionId, tasks_deleted: tasksDeleted };
    }
  );
}
