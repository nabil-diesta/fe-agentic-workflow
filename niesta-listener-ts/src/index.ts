import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { mkdirSync } from "fs";
import { join } from "path";
import os from "os";

import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { jiraRoutes } from "./routes/jira.js";
import { sessionRoutes } from "./routes/sessions.js";
import { codexRoutes } from "./routes/codex.js";
import { workdirRoutes } from "./routes/workdirs.js";
import { pipelineRoutes } from "./routes/pipeline.js";
import { initCodexService } from "./services/codex.service.js";
import { codexServer } from "./services/codex-server.service.js";
import { getSessions } from "./services/sessions.service.js";
import { getRunningTasks } from "./services/codex.service.js";

const START_TIME = Date.now();

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true, credentials: true });

await fastify.register(healthRoutes);
await fastify.register(jiraRoutes);
await fastify.register(sessionRoutes);
await fastify.register(codexRoutes);
await fastify.register(workdirRoutes);
await fastify.register(pipelineRoutes);

// Niesta chat proxy
fastify.post("/niesta/chat", async (req, reply) => {
  try {
    const res = await fetch(`${config.niestaApiUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      return reply.status(res.status).send(await res.text());
    }
    return res.json();
  } catch (e) {
    return reply.status(502).send({ detail: String(e) });
  }
});

// Status
fastify.get("/status", async (_req, reply) => {
  try {
    const sessions = getSessions();
    const running = getRunningTasks();
    return {
      uptime_seconds: ((Date.now() - START_TIME) / 1000).toFixed(1),
      session_count: sessions.length,
      running_tasks_count: running.length,
      running_tasks: running,
    };
  } catch (e) {
    return reply.status(500).send({ detail: String(e) });
  }
});

// Ensure task log directory exists
try {
  mkdirSync(join(os.homedir(), ".niesta", "task_logs"), { recursive: true });
} catch {
  // ignore
}

// Start Codex app-server (non-fatal if codex CLI isn't installed)
try {
  await initCodexService();
  console.log("Codex app-server initialized");
} catch (e) {
  console.error("Codex app-server failed to start (non-fatal):", e);
}

// Graceful shutdown
async function shutdown() {
  try {
    await codexServer.stop();
  } catch {
    // ignore
  }
  await fastify.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await fastify.listen({ port: config.port, host: "0.0.0.0" });
console.log(`niesta-listener-ts running on port ${config.port}`);
