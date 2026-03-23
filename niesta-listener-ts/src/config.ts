import "dotenv/config";

const home = process.env.HOME ?? "/tmp";

export const config = {
  port: Number(process.env.LISTENER_PORT ?? 4000),
  niestaApiUrl: process.env.NIESTA_API_URL ?? "http://72.62.7.232:8000",

  // Jira
  jiraCloudId: process.env.JIRA_CLOUD_ID ?? "41afebc2-714c-4c61-92c7-09ed9fc48daf",
  jiraAccountId:
    process.env.JIRA_ACCOUNT_ID ?? "712020:e2175c6b-ac7b-4ed7-a572-2b03304bd9a7",
  jiraApiEmail: process.env.JIRA_API_EMAIL ?? "nabil@diesta.co.uk",
  jiraApiToken: process.env.JIRA_API_TOKEN ?? "",
  get jiraBaseUrl() {
    return `https://api.atlassian.com/ex/jira/${this.jiraCloudId}/rest/api/3`;
  },

  // Codex sessions
  codexSessionsPath:
    (process.env.CODEX_SESSIONS_PATH ?? `${home}/.codex/sessions`).replace(/^~/, home),

  // Default work directories
  defaultWorkdirs: [
    { label: "Portal 1", path: `${home}/sites/container/portal` },
    { label: "Portal 2", path: `${home}/sites/container-bu/portal` },
    { label: "Portal 3", path: `${home}/sites/container-new/portal` },
    { label: "Portal 4", path: `${home}/sites/containerAgain/portal` },
  ],

  sessionsCacheTtlMs: 30_000,
  sprintCacheTtlMs: 60_000,

  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
};
