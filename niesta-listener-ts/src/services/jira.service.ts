import { config } from "../config.js";
import type { JiraTicket, JiraTicketDetail } from "../types/index.js";

function authHeader(): string {
  const raw = `${config.jiraApiEmail}:${config.jiraApiToken}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

function checkToken(): string | null {
  if (!config.jiraApiToken) {
    return "JIRA_API_TOKEN is not set. Add it to .env (see .env.example).";
  }
  return null;
}

type AnyObj = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function parseIssue(issue: AnyObj): JiraTicket {
  const f = (issue.fields as AnyObj) ?? {};
  const status = f.status as AnyObj | null;
  const priority = f.priority as AnyObj | null;
  const assignee = f.assignee as AnyObj | null;
  const it = f.issuetype as AnyObj | null;
  return {
    key: issue.key as string,
    summary: ((f.summary as string) ?? "").trim(),
    status: str(status?.name),
    priority: str(priority?.name),
    assignee: str(assignee?.displayName),
    storyPoints: (f.customfield_10016 as number | null) ?? null,
    type: str(it?.name),
  };
}

function extractAdfText(node: AnyObj): string {
  const parts: string[] = [];
  for (const block of ((node.content as unknown[]) ?? [])) {
    const b = block as AnyObj;
    if (b.type === "paragraph") {
      for (const c of ((b.content as unknown[]) ?? [])) {
        const cc = c as AnyObj;
        if (cc.type === "text") parts.push((cc.text as string) ?? "");
      }
    }
  }
  return parts.join("\n");
}

// Sprint cache
let sprintCache: { ts: number; data: JiraTicket[] } | null = null;

export async function fetchMySprint(): Promise<{
  ok: boolean;
  data: JiraTicket[] | null;
  err: string;
}> {
  const err = checkToken();
  if (err) return { ok: false, data: null, err };

  const now = Date.now();
  if (sprintCache && now - sprintCache.ts < config.sprintCacheTtlMs) {
    return { ok: true, data: sprintCache.data, err: "" };
  }

  const jql = `project = DD AND assignee = "${config.jiraAccountId}" AND sprint in openSprints() ORDER BY Rank ASC`;
  const url = new URL(`${config.jiraBaseUrl}/search/jql`);
  url.searchParams.set("jql", jql);
  url.searchParams.set("fields", "key,summary,status,priority,assignee,customfield_10016,issuetype");
  url.searchParams.set("maxResults", "100");

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: authHeader(), Accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false, data: null, err: (await res.text()) || `HTTP ${res.status}` };
    }
    const body = (await res.json()) as AnyObj;
    const data = ((body.issues as unknown[]) ?? []).map((i) => parseIssue(i as AnyObj));
    sprintCache = { ts: now, data };
    return { ok: true, data, err: "" };
  } catch (e) {
    return { ok: false, data: null, err: String(e) };
  }
}

export async function fetchMyStatus(): Promise<{
  ok: boolean;
  data: AnyObj | null;
  err: string;
}> {
  const { ok, data, err } = await fetchMySprint();
  if (!ok || !data) return { ok: false, data: null, err };

  const byStatus: Record<string, number> = {};
  const inProgressKeys: string[] = [];

  for (const t of data) {
    const s = (t.status ?? "").toString().trim();
    if (!s) continue;
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    if (s === "In Progress" && t.key) inProgressKeys.push(t.key);
  }

  return {
    ok: true,
    data: {
      to_do: (byStatus["To Do"] ?? byStatus["To-Do"]) ?? 0,
      in_progress: byStatus["In Progress"] ?? 0,
      in_review: byStatus["In Review"] ?? 0,
      in_qa: byStatus["In QA"] ?? 0,
      done: byStatus["Done"] ?? 0,
      in_progress_keys: inProgressKeys,
    },
    err: "",
  };
}

export async function fetchTicket(key: string): Promise<{
  ok: boolean;
  data: JiraTicketDetail | null;
  err: string;
}> {
  const err = checkToken();
  if (err) return { ok: false, data: null, err };

  const url = new URL(`${config.jiraBaseUrl}/issue/${key}`);
  url.searchParams.set(
    "fields",
    "key,summary,description,status,priority,assignee,subtasks,comment,customfield_10016,issuetype"
  );

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: authHeader(), Accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false, data: null, err: (await res.text()) || `HTTP ${res.status}` };
    }
    const issue = (await res.json()) as AnyObj;
    const f = (issue.fields as AnyObj) ?? {};

    let description = "";
    if (f.description && typeof f.description === "object") {
      description = extractAdfText(f.description as AnyObj);
    } else if (typeof f.description === "string") {
      description = f.description;
    }

    const subtasks = ((f.subtasks as unknown[]) ?? []).map((s) => {
      const st = s as AnyObj;
      return {
        key: st.key as string,
        summary: str((st.fields as AnyObj)?.summary) ?? "",
      };
    });

    const commentsRaw = (((f.comment as AnyObj)?.comments) as unknown[]) ?? [];
    const comments = commentsRaw.slice(-5).map((c) => {
      const cc = c as AnyObj;
      const author = str((cc.author as AnyObj)?.displayName);
      let body = "";
      if (cc.body && typeof cc.body === "object") {
        body = extractAdfText(cc.body as AnyObj);
      } else if (typeof cc.body === "string") {
        body = cc.body;
      }
      return { author, body };
    });

    const status = f.status as AnyObj | null;
    const priority = f.priority as AnyObj | null;
    const assignee = f.assignee as AnyObj | null;

    return {
      ok: true,
      data: {
        key: issue.key as string,
        summary: ((f.summary as string) ?? "").trim(),
        description,
        status: str(status?.name),
        priority: str(priority?.name),
        assignee: str(assignee?.displayName),
        storyPoints: (f.customfield_10016 as number | null) ?? null,
        type: null,
        subtasks,
        comments,
      },
      err: "",
    };
  } catch (e) {
    return { ok: false, data: null, err: String(e) };
  }
}

export async function runJqlQuery(
  jql: string,
  fields?: string[],
  maxResults = 50
): Promise<{ ok: boolean; data: JiraTicket[] | null; err: string; status: number }> {
  const tokenErr = checkToken();
  if (tokenErr) return { ok: false, data: null, err: tokenErr, status: 400 };
  if (!jql.trim()) return { ok: false, data: null, err: "JQL is required.", status: 400 };

  const fieldsStr =
    fields?.filter(Boolean).join(",") || "key,summary,status,priority,assignee,issuetype";

  const url = new URL(`${config.jiraBaseUrl}/search/jql`);
  url.searchParams.set("jql", jql.trim());
  url.searchParams.set("fields", fieldsStr);
  url.searchParams.set("maxResults", String(Math.min(Math.max(1, maxResults), 100)));

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: authHeader(), Accept: "application/json" },
    });

    if (res.status === 400) {
      try {
        const body = (await res.json()) as AnyObj;
        const msgs = body.errorMessages as string[] | undefined;
        const errs = body.errors as Record<string, string> | undefined;
        let msg = "";
        if (msgs?.length) msg = msgs.join("; ");
        else if (errs) msg = Object.entries(errs).map(([k, v]) => `${k}: ${v}`).join("; ");
        return { ok: false, data: null, err: msg || "Invalid JQL", status: 400 };
      } catch {
        return { ok: false, data: null, err: "Invalid JQL (400)", status: 400 };
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        data: null,
        err: (await res.text()) || `HTTP ${res.status}`,
        status: 502,
      };
    }

    const body = (await res.json()) as AnyObj;
    const data = ((body.issues as unknown[]) ?? []).map((i) => parseIssue(i as AnyObj));
    return { ok: true, data, err: "", status: 200 };
  } catch (e) {
    return { ok: false, data: null, err: String(e), status: 502 };
  }
}
