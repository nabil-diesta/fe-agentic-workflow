import type { FastifyInstance } from "fastify";
import {
  startPipeline,
  getPipeline,
  approveStep,
  editStep,
  skipStep,
  rerunStep,
  deletePipeline,
  getActivePipelines,
  getPipelineHistory,
} from "../services/pipeline.service.js";

export async function pipelineRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /pipeline/active — all in-progress pipelines
  fastify.get("/pipeline/active", async () => ({
    pipelines: getActivePipelines(),
  }));

  // GET /pipeline/history — completed pipelines (last 30 days)
  fastify.get("/pipeline/history", async () => ({
    pipelines: getPipelineHistory(),
  }));

  // POST /pipeline/start
  fastify.post("/pipeline/start", async (req, reply) => {
    const { ticket_key, cwd } = req.body as { ticket_key?: string; cwd?: string };
    if (!ticket_key || !cwd)
      return reply.status(400).send({ detail: "ticket_key and cwd are required" });
    try {
      const result = await startPipeline(ticket_key, cwd);
      return result;
    } catch (e) {
      return reply.status(500).send({ detail: String(e) });
    }
  });

  // GET /pipeline/:taskId
  fastify.get<{ Params: { taskId: string } }>("/pipeline/:taskId", async (req, reply) => {
    const pipeline = getPipeline(req.params.taskId);
    if (!pipeline) return reply.status(404).send({ detail: "Pipeline not found" });
    return pipeline;
  });

  // POST /pipeline/:taskId/approve — Body: { step_number }
  fastify.post<{ Params: { taskId: string } }>(
    "/pipeline/:taskId/approve",
    async (req, reply) => {
      const { step_number } = req.body as { step_number?: number };
      if (!step_number)
        return reply.status(400).send({ detail: "step_number is required" });
      approveStep(req.params.taskId, step_number);
      return { approved: step_number };
    }
  );

  // POST /pipeline/:taskId/edit — Body: { step_number, output }
  fastify.post<{ Params: { taskId: string } }>(
    "/pipeline/:taskId/edit",
    async (req, reply) => {
      const { step_number, output } = req.body as {
        step_number?: number;
        output?: string;
      };
      if (!step_number || output === undefined)
        return reply.status(400).send({ detail: "step_number and output are required" });
      editStep(req.params.taskId, step_number, output);
      return { edited: step_number };
    }
  );

  // POST /pipeline/:taskId/skip — Body: { step_number }
  fastify.post<{ Params: { taskId: string } }>(
    "/pipeline/:taskId/skip",
    async (req, reply) => {
      const { step_number } = req.body as { step_number?: number };
      if (!step_number)
        return reply.status(400).send({ detail: "step_number is required" });
      skipStep(req.params.taskId, step_number);
      return { skipped: step_number };
    }
  );

  // DELETE /pipeline/:taskId
  fastify.delete<{ Params: { taskId: string } }>("/pipeline/:taskId", async (req, reply) => {
    const deleted = deletePipeline(req.params.taskId);
    if (!deleted) return reply.status(404).send({ detail: "Pipeline not found" });
    return { deleted: req.params.taskId };
  });

  // POST /pipeline/:taskId/rerun — Body: { step_number }
  fastify.post<{ Params: { taskId: string } }>(
    "/pipeline/:taskId/rerun",
    async (req, reply) => {
      const { step_number } = req.body as { step_number?: number };
      if (!step_number)
        return reply.status(400).send({ detail: "step_number is required" });
      try {
        await rerunStep(req.params.taskId, step_number);
        return { rerun: step_number };
      } catch (e) {
        return reply.status(500).send({ detail: String(e) });
      }
    }
  );
}
