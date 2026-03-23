import type { FastifyInstance } from "fastify";
import {
  fetchMySprint,
  fetchMyStatus,
  fetchTicket,
  runJqlQuery,
} from "../services/jira.service.js";

export async function jiraRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/jira/my-sprint", async (_req, reply) => {
    const { ok, data, err } = await fetchMySprint();
    if (!ok) return reply.status(502).send({ detail: err || "Jira request failed" });
    return { tickets: data };
  });

  fastify.get("/jira/my-status", async (_req, reply) => {
    const { ok, data, err } = await fetchMyStatus();
    if (!ok) return reply.status(502).send({ detail: err || "Jira request failed" });
    return data;
  });

  fastify.get<{ Params: { key: string } }>("/jira/ticket/:key", async (req, reply) => {
    const { ok, data, err } = await fetchTicket(req.params.key);
    if (!ok) return reply.status(502).send({ detail: err || "Jira request failed" });
    return data;
  });

  fastify.post("/jira/query", async (req, reply) => {
    const { jql, fields, max_results } = req.body as {
      jql?: string;
      fields?: string[];
      max_results?: number;
    };
    if (!jql) return reply.status(400).send({ detail: "jql is required" });
    const { ok, data, err, status } = await runJqlQuery(jql, fields, max_results ?? 50);
    if (!ok) return reply.status(status).send({ detail: err || "Jira query failed" });
    return { tickets: data };
  });
}
