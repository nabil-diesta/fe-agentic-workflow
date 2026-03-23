/**
 * Reads and parses Codex session .jsonl files.
 * Port of niesta-listener/sessions.py
 */
import { readFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, extname } from "path";
import { config } from "../config.js";
import type { Session } from "../types/index.js";

let cache: Session[] | null = null;
let cacheTime = 0;

type AnyObj = Record<string, unknown>;

function extractUserText(content: unknown[]): string | null {
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as AnyObj;
    if (b.type !== "input_text" && b.type !== "text") continue;
    const text = ((b.text as string) ?? "").trim();
    if (
      !text ||
      text.startsWith("# AGENTS.md") ||
      text.startsWith("<") ||
      text.startsWith("Warning:") ||
      text.startsWith("Error:")
    )
      continue;
    return text;
  }
  return null;
}

function parseSessionFile(filePath: string): Session | null {
  try {
    if (extname(filePath) !== ".jsonl") return null;

    const lines = readFileSync(filePath, "utf8").trim().split("\n");

    let sessionId: string | null = null;
    let timestamp: string | null = null;
    let cwd: string | null = null;
    let model: string | null = null;
    let cliVersion: string | null = null;
    let lastActivity: string | null = null;
    let lastTokenCount: AnyObj | null = null;
    const lastLimits: Record<string, number> = {};
    let firstMessage: string | null = null;
    let lastAgentMessage: string | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;
      let obj: AnyObj;
      try {
        obj = JSON.parse(line) as AnyObj;
      } catch {
        continue;
      }
      if (!obj || typeof obj !== "object") continue;

      const event = (((obj.event ?? obj.type) as string) ?? "").toString();
      const rawPayload = obj.payload ?? obj.data;
      const payload: AnyObj =
        rawPayload && typeof rawPayload === "object" ? (rawPayload as AnyObj) : {};

      if (event.includes("session_meta") || event === "session_meta") {
        sessionId = (payload.id as string) ?? sessionId;
        timestamp = (payload.timestamp as string) ?? timestamp;
        cwd = (payload.cwd as string) ?? cwd;
        model = (payload.model_provider as string) ?? model;
        cliVersion = (payload.cli_version as string) ?? cliVersion;
      }

      if (event.includes("token_count") || event === "token_count") {
        lastTokenCount = payload;
      }

      if (
        event.includes("rate_limit") ||
        JSON.stringify(payload).toLowerCase().includes("rate_limit")
      ) {
        const used = payload.used_percent;
        if (used !== undefined) {
          const key = (payload.limit_type as string) ?? "primary";
          lastLimits[key] = used as number;
        }
      }

      if (event === "response_item") {
        const role = payload.role as string;
        const content = (payload.content as unknown[]) ?? [];
        if (role === "user" && firstMessage === null) {
          firstMessage = extractUserText(content);
        } else if (role === "assistant") {
          for (const block of content) {
            const b = block as AnyObj;
            if (b.type === "output_text" || b.type === "text") {
              const text = ((b.text as string) ?? "").trim();
              if (text) {
                lastAgentMessage = text;
                break;
              }
            }
          }
        }
      }

      const ts = obj.timestamp ?? obj.ts;
      if (ts !== undefined && ts !== null) lastActivity = String(ts);
    }

    const tokenUsage: Session["token_usage"] = lastTokenCount
      ? {
          input: (lastTokenCount.input as number) ?? null,
          output: (lastTokenCount.output as number) ?? null,
          total: (lastTokenCount.total as number) ?? null,
        }
      : null;

    const rateLimits = Object.keys(lastLimits).length > 0 ? lastLimits : null;

    if (!lastActivity && timestamp) lastActivity = timestamp;
    if (!sessionId) {
      sessionId =
        filePath.split("/").pop()?.replace(".jsonl", "") ?? "unknown";
    }

    let lastTs = 0;
    if (lastActivity) {
      lastTs = parseFloat(lastActivity);
      // parseFloat on an ISO string ("2026-03-18T...") returns just the year (2026),
      // which as a Unix timestamp is ~1970. Detect this and use Date.parse instead.
      if (isNaN(lastTs) || lastTs < 1_000_000_000) {
        const ms = Date.parse(lastActivity);
        lastTs = isNaN(ms) ? 0 : ms / 1000;
      }
    }
    if (!lastTs) {
      try {
        lastTs = statSync(filePath).mtimeMs / 1000;
      } catch {
        lastTs = 0;
      }
    }

    const ageHours = lastTs ? (Date.now() / 1000 - lastTs) / 3600 : 999;
    const status: Session["status"] =
      ageHours < 24 ? "active" : ageHours < 72 ? "idle" : "forgotten";

    return {
      session_id: sessionId,
      timestamp,
      cwd,
      model,
      cli_version: cliVersion,
      last_activity: lastActivity,
      last_activity_ts: lastTs,
      token_usage: tokenUsage,
      rate_limits: rateLimits,
      status,
      path: filePath,
      first_message: firstMessage,
      last_agent_message: lastAgentMessage,
    };
  } catch {
    return null;
  }
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) results.push(...walkDir(full));
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) results.push(full);
    }
  } catch {
    // unreadable directory
  }
  return results;
}

export function getSessions(forceRefresh = false): Session[] {
  const now = Date.now();
  if (!forceRefresh && cache && now - cacheTime < config.sessionsCacheTtlMs) {
    return cache;
  }

  const files = walkDir(config.codexSessionsPath);
  const results: Session[] = [];
  for (const f of files) {
    const s = parseSessionFile(f);
    if (s) results.push(s);
  }
  results.sort((a, b) => (b.last_activity_ts ?? 0) - (a.last_activity_ts ?? 0));
  cache = results;
  cacheTime = now;
  return results;
}

export function getSessionById(sessionId: string): Session | null {
  return getSessions().find((s) => s.session_id === sessionId) ?? null;
}

export function getActiveSessions(): Session[] {
  return getSessions().filter((s) => s.status === "active");
}

export function deleteSession(sessionId: string): boolean {
  const sessions = getSessions(true);
  const found = sessions.find((s) => s.session_id === sessionId);
  if (!found) return false;
  try {
    unlinkSync(found.path);
  } catch {
    // already gone
  }
  cache = null;
  cacheTime = 0;
  return true;
}
