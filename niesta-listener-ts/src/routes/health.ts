import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/health", async () => {
    return { status: "ok", port: config.port };
  });
}
