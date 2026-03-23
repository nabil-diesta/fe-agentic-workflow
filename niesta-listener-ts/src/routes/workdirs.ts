import type { FastifyInstance } from "fastify";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import type { Workdir } from "../types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Stored next to tasks.db in the project root
const WORKDIRS_FILE = join(__dirname, "..", "..", "workdirs.json");

function loadWorkdirs(): Workdir[] {
  if (existsSync(WORKDIRS_FILE)) {
    try {
      return JSON.parse(readFileSync(WORKDIRS_FILE, "utf8")) as Workdir[];
    } catch {
      // fall through to defaults
    }
  }
  return config.defaultWorkdirs;
}

function saveWorkdirs(workdirs: Workdir[]): void {
  writeFileSync(WORKDIRS_FILE, JSON.stringify(workdirs, null, 2));
}

export async function workdirRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/workdirs", async () => ({ workdirs: loadWorkdirs() }));

  fastify.post("/workdirs", async (req) => {
    const { label, path } = req.body as { label: string; path: string };
    const workdirs = loadWorkdirs();
    workdirs.push({ label, path });
    saveWorkdirs(workdirs);
    return { workdirs };
  });

  fastify.delete("/workdirs", async (req) => {
    const { path } = req.body as { path: string };
    const workdirs = loadWorkdirs().filter((w) => w.path !== path);
    saveWorkdirs(workdirs);
    return { workdirs };
  });
}
