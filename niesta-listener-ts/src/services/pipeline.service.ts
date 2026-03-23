/**
 * 9-Step Engineering Process Pipeline
 * Steps 1-5: Planning (OpenAI gpt-4o-mini)
 * Step 6: Implement (Codex app-server)
 * Step 7: Validate (Codex resume same thread)
 * Steps 8-9: Documentation / PR Prep (OpenAI gpt-4o-mini)
 */
import { fetchTicket } from "./jira.service.js";
import { runCodexTask, resumeTask } from "./codex.service.js";
import * as db from "./db.service.js";
import { config } from "../config.js";
import type { Pipeline, PipelineStepRow, Task } from "../types/index.js";

const STEP_NAMES = [
  "",           // 0 — unused
  "Kickoff",    // 1
  "Scope",      // 2
  "Impact Map", // 3
  "Risk Pass",  // 4
  "Test Plan",  // 5
  "Implement",  // 6
  "Validate",   // 7
  "Document",   // 8
  "PR Prep",    // 9
];

interface PipelineContext {
  taskId: string;
  ticketKey: string;
  ticketSummary: string;
  ticketDescription: string;
  ticketType: string | null;
  ticketPriority: string | null;
  cwd: string;
}

// Approval gates: taskId → resolve fn
const approvalGates = new Map<string, () => void>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOpenAI(system: string, user: string): Promise<string> {
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY not set in .env");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 1500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const choices = data.choices as Array<Record<string, unknown>>;
  const message = choices?.[0]?.message as Record<string, unknown>;
  return (message?.content as string) ?? "";
}

async function waitForCodexTask(taskId: string, timeoutMs = 600_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = db.getTask(taskId);
    if (task?.status === "completed") return task.output ?? "";
    if (task?.status === "failed") throw new Error(`Codex failed: ${task.error}`);
    if (task?.status === "interrupted") throw new Error("Codex was interrupted");
    await sleep(3_000);
  }
  throw new Error(`Codex task ${taskId} timed out`);
}

async function waitForCodexThread(threadId: string, timeoutMs = 600_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = db.getTaskByThreadId(threadId);
    if (task?.status === "completed") return task.output ?? "";
    if (task?.status === "failed") throw new Error(`Codex validation failed: ${task.error}`);
    if (task?.status === "interrupted") throw new Error("Codex validation was interrupted");
    await sleep(3_000);
  }
  throw new Error("Codex validation timed out");
}

function waitForApproval(taskId: string): Promise<void> {
  return new Promise((resolve) => {
    approvalGates.set(taskId, resolve);
  });
}

function getOutputs(taskId: string): Record<number, string> {
  const steps = db.getPipelineSteps(taskId);
  const out: Record<number, string> = {};
  for (const s of steps) out[s.step_number] = s.output ?? "";
  return out;
}

async function notifyNiesta(message: string): Promise<void> {
  try {
    await fetch(`${config.niestaApiUrl.replace(/\/$/, "")}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch {
    // ignore
  }
}

// ─── Step Execution ───────────────────────────────────────────────────────────

async function executeStep(ctx: PipelineContext, stepNumber: number): Promise<string> {
  const o = getOutputs(ctx.taskId);
  const { ticketKey: k, ticketSummary: s, ticketDescription: d, ticketType: type, ticketPriority: pri, cwd } = ctx;

  switch (stepNumber) {
    case 1:
      return callOpenAI(
        `You are an engineering assistant. Summarize this Jira ticket in plain English. Include: what needs to change, why, and who it affects. Keep it to 3-5 sentences that a non-technical stakeholder could understand.`,
        `Ticket: ${k}\nSummary: ${s}\nDescription: ${d}\nType: ${type}\nPriority: ${pri}`
      );

    case 2:
      return callOpenAI(
        `You are an engineering assistant defining scope for a development task.`,
        `Ticket: ${k}: ${s}\nDescription: ${d}\nKickoff Summary: ${o[1]}\n\nRespond with three sections:\nIN SCOPE: (bullet list of what this ticket covers)\nOUT OF SCOPE: (what should NOT be touched, even if related)\nASSUMPTIONS: (things we're assuming to be true)`
      );

    case 3:
      return callOpenAI(
        `You are an engineering assistant creating an impact map for a frontend change in an Angular 20 application.`,
        `Ticket: ${k}: ${s}\nDescription: ${d}\nScope: ${o[2]}\nCodebase: Angular 20 frontend, project at ${cwd}\n\nList all affected:\n- Angular components/modules\n- Services/endpoints called\n- Shared utilities/pipes\n- Routes affected\n- Third-party integrations\n- Database/API contracts (if applicable)`
      );

    case 4:
      return callOpenAI(
        `You are a senior engineer performing a risk assessment for a code change.`,
        `Ticket: ${k}: ${s}\nImpact Map: ${o[3]}\n\nAssess risks in these categories:\nSECURITY: (auth, injection, data exposure, OWASP concerns)\nDATA INTEGRITY: (state management, race conditions, data loss)\nPERFORMANCE: (bundle size, render cycles, API calls, lazy loading)\nCOMPLIANCE: (accessibility, GDPR, audit logging)\nREGRESSION: (what existing behavior could break)\n\nRate each: LOW / MEDIUM / HIGH with a one-line explanation.`
      );

    case 5:
      return callOpenAI(
        `You are a test engineer creating a test plan for an Angular application. The project uses Jest for unit tests and Playwright for E2E/integration tests. Do NOT reference Karma, Jasmine, or Cypress.`,
        `Ticket: ${k}: ${s}\nImpact Map: ${o[3]}\nRisks: ${o[4]}\nWorking directory: ${cwd}\n\nDefine:\nUNIT TESTS: (Jest test cases using describe/it/expect — include file paths relative to the project root)\nINTEGRATION TESTS: (Playwright tests — check for existing playwright.config.ts and e2e/ or playwright/ directories; reference or extend existing test patterns)\nREGRESSION TARGETS: (existing Jest/Playwright tests that must still pass after this change)`
      );

    case 6: {
      const prompt = [
        `Implement ${k}: ${s}`,
        `## Context\n${o[1]}`,
        `## Scope\n${o[2]}`,
        `## Impact Map\n${o[3]}`,
        `## Risks to Watch\n${o[4]}`,
        `## Test Plan\n${o[5]}`,
        `## Working Directory\n${cwd}`,
        `## Test Stack\nUnit tests: Jest (run with \`npx jest\` or \`npm test\` — check package.json scripts first, do NOT use \`ng test\`)\nE2E/Integration tests: Playwright (check for playwright.config.ts, e2e/ or playwright/ directories)\n\n## Instructions\n1. Read the affected files listed in the impact map\n2. Implement the changes as scoped — one behavior change at a time\n3. Do NOT touch anything listed as out of scope\n4. Add or update Jest unit tests per the test plan\n5. Run the unit test suite with the correct command from package.json (Jest, not Karma)\n6. If tests fail, fix them before finishing\n7. Summarize what you changed and why`,
      ].join("\n\n");

      const result = await runCodexTask(prompt, cwd, k);
      const codexTaskId = result.task_id as string;
      const codexThreadId = result.thread_id as string;

      // Store IDs so step 7 can resume the same thread
      db.updatePipelineStepContext(ctx.taskId, 6, JSON.stringify({ codex_task_id: codexTaskId, codex_thread_id: codexThreadId }));
      db.updatePipelineStepContext(ctx.taskId, 7, JSON.stringify({ codex_thread_id: codexThreadId }));

      return waitForCodexTask(codexTaskId);
    }

    case 7: {
      const step6 = db.getPipelineStep(ctx.taskId, 6);
      const step6Ctx = JSON.parse(step6?.context ?? "{}") as { codex_thread_id?: string };
      const threadId = step6Ctx.codex_thread_id;
      if (!threadId) throw new Error("No Codex thread from step 6 — step 6 must complete first");

      const validatePrompt = [
        `Now validate the changes:`,
        `1. Run the Jest unit test suite — check package.json for the correct script (likely \`npm test\` or \`npx jest\`). Do NOT run \`ng test\`.`,
        `2. If Playwright tests exist (playwright.config.ts or e2e/ directory), run \`npx playwright test\` and report results`,
        `3. Run linting if configured (check package.json for a lint script)`,
        `4. List all files you modified`,
        `5. Confirm each test case from the test plan either passes or explain why it was skipped`,
      ].join("\n");

      await resumeTask(threadId, validatePrompt);
      return waitForCodexThread(threadId);
    }

    case 8:
      return callOpenAI(
        `You are an engineering assistant generating documentation for completed work.`,
        `Ticket: ${k}: ${s}\nChanges made: ${o[6]}\nValidation results: ${o[7]}\n\nProduce:\nJIRA UPDATE: (a comment to post on the Jira ticket summarizing the work)\nFOLLOW-UP TICKETS: (deferred items that need separate tickets, with suggested titles and descriptions)\nNOTES: (anything the reviewer should know)`
      );

    case 9:
      return callOpenAI(
        `You are an engineering assistant preparing a pull request.`,
        `Ticket: ${k}: ${s}\nScope: ${o[2]}\nChanges made: ${o[6]}\nValidation results: ${o[7]}\n\nProduce:\nPR TITLE: feat(${k}): {concise description}\nPR DESCRIPTION: (structured markdown with: What, Why, How, Testing, Risks, Rollback plan)\nCHANGE SUMMARY: (bullet list of files changed and why)\nEVIDENCE: (test results, manual verification steps)\nROLLBACK NOTES: (how to revert if something goes wrong)`
      );

    default:
      throw new Error(`Unknown step number: ${stepNumber}`);
  }
}

// ─── Background Orchestration ─────────────────────────────────────────────────

async function runPipelineBackground(taskId: string, ctx: PipelineContext): Promise<void> {
  const fail = (step: number, err: unknown) => {
    const msg = String(err);
    db.updatePipelineStep(taskId, step, { status: "failed", output: `ERROR: ${msg}`, completed_at: Date.now() / 1000 });
    db.updateTask(taskId, { status: "failed", error: `Step ${step} failed: ${msg}`, completed_at: Date.now() / 1000 });
  };

  try {
    // ── Planning phase: steps 1-5 ──────────────────────────────────────────
    for (let step = 1; step <= 5; step++) {
      const row = db.getPipelineStep(taskId, step);
      if (row?.status === "skipped" || row?.status === "approved") continue;

      db.updatePipelineStep(taskId, step, { status: "running", started_at: Date.now() / 1000, output: "" });
      try {
        const output = await executeStep(ctx, step);
        db.updatePipelineStep(taskId, step, { status: "completed", output, completed_at: Date.now() / 1000 });
      } catch (e) {
        fail(step, e);
        return;
      }
    }

    // ── Approval gate ──────────────────────────────────────────────────────
    db.updateTask(taskId, { status: "awaiting_approval" as Task["status"] });
    await waitForApproval(taskId);

    // ── Implement: step 6 ─────────────────────────────────────────────────
    {
      const row = db.getPipelineStep(taskId, 6);
      if (row?.status !== "skipped") {
        db.updatePipelineStep(taskId, 6, { status: "running", started_at: Date.now() / 1000, output: "" });
        db.updateTask(taskId, { status: "running" });
        try {
          const output = await executeStep(ctx, 6);
          db.updatePipelineStep(taskId, 6, { status: "completed", output, completed_at: Date.now() / 1000 });
        } catch (e) {
          fail(6, e);
          return;
        }
      }
    }

    // ── Validate: step 7 ──────────────────────────────────────────────────
    {
      const row = db.getPipelineStep(taskId, 7);
      if (row?.status !== "skipped") {
        db.updatePipelineStep(taskId, 7, { status: "running", started_at: Date.now() / 1000, output: "" });
        try {
          const output = await executeStep(ctx, 7);
          db.updatePipelineStep(taskId, 7, { status: "completed", output, completed_at: Date.now() / 1000 });
        } catch (e) {
          // Validation failure doesn't abort — continue to doc/PR
          db.updatePipelineStep(taskId, 7, { status: "failed", output: `ERROR: ${String(e)}`, completed_at: Date.now() / 1000 });
        }
      }
    }

    // ── Document + PR Prep: steps 8-9 ─────────────────────────────────────
    for (const step of [8, 9] as const) {
      const row = db.getPipelineStep(taskId, step);
      if (row?.status === "skipped") continue;

      db.updatePipelineStep(taskId, step, { status: "running", started_at: Date.now() / 1000, output: "" });
      try {
        const output = await executeStep(ctx, step);
        db.updatePipelineStep(taskId, step, { status: "completed", output, completed_at: Date.now() / 1000 });
      } catch (e) {
        db.updatePipelineStep(taskId, step, { status: "failed", output: `ERROR: ${String(e)}`, completed_at: Date.now() / 1000 });
      }
    }

    db.updateTask(taskId, { status: "completed", completed_at: Date.now() / 1000 });
    await notifyNiesta(`Pipeline complete for ${ctx.ticketKey}: ${ctx.ticketSummary}`);
  } catch (e) {
    db.updateTask(taskId, { status: "failed", error: String(e), completed_at: Date.now() / 1000 });
    await notifyNiesta(`Pipeline failed for ${ctx.ticketKey}: ${String(e).slice(0, 200)}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function startPipeline(ticketKey: string, cwd: string): Promise<{ taskId: string }> {
  const { ok, data: ticket, err } = await fetchTicket(ticketKey);
  if (!ok || !ticket) throw new Error(err || `Could not fetch ticket ${ticketKey}`);

  const taskId = `pipeline_${Date.now()}`;
  const startedAt = Date.now() / 1000;

  db.insertTask({
    task_id: taskId,
    thread_id: null,
    turn_id: null,
    ticket_key: ticketKey,
    task: `Pipeline: ${ticketKey} — ${ticket.summary}`,
    cwd,
    status: "pipeline" as Task["status"],
    started_at: startedAt,
  });

  for (let i = 1; i <= 9; i++) {
    db.insertPipelineStep({ task_id: taskId, step_number: i, step_name: STEP_NAMES[i] });
  }

  const ctx: PipelineContext = {
    taskId,
    ticketKey,
    ticketSummary: ticket.summary ?? "",
    ticketDescription: ticket.description ?? "",
    ticketType: ticket.type,
    ticketPriority: ticket.priority,
    cwd,
  };

  // Fire and forget
  void runPipelineBackground(taskId, ctx);

  return { taskId };
}

export function getPipeline(taskId: string): Pipeline | null {
  const task = db.getTask(taskId);
  if (!task) return null;

  const steps = db.getPipelineSteps(taskId);

  const running = steps.find((s) => s.status === "running");
  const lastCompleted = [...steps].reverse().find((s) =>
    s.status === "completed" || s.status === "approved"
  );
  const currentStep = running?.step_number ?? (lastCompleted ? lastCompleted.step_number + 1 : 1);

  const isComplete =
    task.status === "completed" ||
    (steps.length === 9 && steps.every((s) => s.status === "completed" || s.status === "approved" || s.status === "skipped"));

  return { task, steps, currentStep: Math.min(currentStep, 9), isComplete };
}

export function approveStep(taskId: string, stepNumber: number): void {
  db.updatePipelineStep(taskId, stepNumber, {
    status: "approved",
    approved_by: "user",
    approved_at: Date.now() / 1000,
  });

  // Step 5 approval resolves the gate and starts coding
  if (stepNumber === 5) {
    const resolve = approvalGates.get(taskId);
    if (resolve) {
      approvalGates.delete(taskId);
      resolve();
    }
  }
}

export function editStep(taskId: string, stepNumber: number, output: string): void {
  db.updatePipelineStep(taskId, stepNumber, { output });
}

export function skipStep(taskId: string, stepNumber: number): void {
  db.updatePipelineStep(taskId, stepNumber, { status: "skipped", completed_at: Date.now() / 1000 });
}

export async function rerunStep(taskId: string, stepNumber: number): Promise<void> {
  const task = db.getTask(taskId);
  if (!task) throw new Error("Pipeline task not found");

  // Rebuild context from Jira
  const ticketKey = task.ticket_key ?? "";
  const { ok, data: ticket, err } = await fetchTicket(ticketKey);
  if (!ok || !ticket) throw new Error(err || `Could not fetch ticket ${ticketKey}`);

  const ctx: PipelineContext = {
    taskId,
    ticketKey,
    ticketSummary: ticket.summary ?? "",
    ticketDescription: ticket.description ?? "",
    ticketType: ticket.type,
    ticketPriority: ticket.priority,
    cwd: task.cwd,
  };

  db.updatePipelineStep(taskId, stepNumber, { status: "running", started_at: Date.now() / 1000, output: "" });
  try {
    const output = await executeStep(ctx, stepNumber);
    db.updatePipelineStep(taskId, stepNumber, { status: "completed", output, completed_at: Date.now() / 1000 });
  } catch (e) {
    db.updatePipelineStep(taskId, stepNumber, {
      status: "failed",
      output: `ERROR: ${String(e)}`,
      completed_at: Date.now() / 1000,
    });
    throw e;
  }
}

export function getActivePipelines(): Pipeline[] {
  const tasks = db.getPipelineTasks(50);
  const active = tasks.filter((t) =>
    ["pipeline", "awaiting_approval", "running"].includes(t.status)
  );
  return active.map((t) => getPipeline(t.task_id)).filter(Boolean) as Pipeline[];
}

export function deletePipeline(taskId: string): boolean {
  // Also cancel any pending approval gate so the background task doesn't hang
  const resolve = approvalGates.get(taskId);
  if (resolve) {
    approvalGates.delete(taskId);
  }
  return db.deletePipeline(taskId);
}

export function getPipelineHistory(): Pipeline[] {
  const cutoff = Date.now() / 1000 - 30 * 24 * 3600; // 30 days
  const tasks = db.getPipelineTasks(100);
  const done = tasks.filter(
    (t) =>
      (t.status === "completed" || t.status === "failed") &&
      (t.started_at ?? 0) > cutoff
  );
  return done.map((t) => getPipeline(t.task_id)).filter(Boolean) as Pipeline[];
}
