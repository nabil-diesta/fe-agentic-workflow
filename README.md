# Niesta — AI-Assisted Engineering Workflow

An AI-powered development workflow tool that takes Jira tickets through a structured 9-step engineering pipeline — from planning to PR-ready code.

## What it does

- Connects to your Jira board and shows a kanban sprint view
- Runs a 9-step AI pipeline on any ticket: kickoff → scope → impact → risks → test plan → implement → validate → document → PR prep
- Uses OpenAI (gpt-4o-mini) for planning steps and Codex CLI for implementation
- Human approval gate between planning and coding — you review the AI plan before any code is written
- Generates PR descriptions, test plans, and Jira updates automatically

---

## Quick Start

### Prerequisites

- Node.js 18+ (recommend [nvm](https://github.com/nvm-sh/nvm))
- npm 9+
- Angular CLI 20 — `npm i -g @angular/cli`
- Codex CLI — `npm i -g @openai/codex`
- A Jira Cloud account with API access
- An OpenAI API key

---

### 1. Clone the repo

```bash
git clone <repo-url>
cd fe-agentic-workflow
```

---

### 2. Set up the listener (backend)

```bash
cd niesta-listener-ts
npm install
cp .env.example .env
```

Edit `.env` with your credentials:

```env
JIRA_API_TOKEN=        # Create at https://id.atlassian.com/manage-profile/security/api-tokens
JIRA_API_EMAIL=        # Your Atlassian account email
JIRA_CLOUD_ID=         # Your Jira Cloud instance ID (see below)
JIRA_ACCOUNT_ID=       # Your Jira account ID (see below)
OPENAI_API_KEY=        # Your OpenAI API key
```

**Finding your Jira Cloud ID:**

```bash
curl -u "your-email@company.com:your-api-token" \
  "https://api.atlassian.com/oauth/token/accessible-resources"
```

The `id` field in the response is your Cloud ID.

**Finding your Jira Account ID:**

```bash
curl -u "your-email@company.com:your-api-token" \
  "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/myself"
```

Look for the `accountId` field in the response.

**Start the listener:**

```bash
npm run dev
```

**Verify it's working:**

```bash
curl http://localhost:4000/health
# → {"status":"ok","port":4000}

curl http://localhost:4000/jira/my-sprint
# → your current sprint tickets
```

---

### 3. Set up the dashboard (frontend)

```bash
cd ../dashboard
npm install
ng serve
```

Open [http://localhost:4200](http://localhost:4200) in your browser.

> The dashboard defaults to connecting to the listener at `http://localhost:4000`. This can be changed in Settings.

---

### 4. Configure your work directories

The pipeline needs to know where your code repositories live. Go to **Settings** in the dashboard and add a work directory, or call the API directly:

```bash
curl -X POST http://localhost:4000/workdirs \
  -H "Content-Type: application/json" \
  -d '{"label": "My Project", "path": "/Users/you/sites/your-project"}'
```

---

### 5. Start a pipeline

1. Go to **Sprint Board**
2. Click any ticket card
3. Click **"Start Pipeline"** in the detail panel
4. Select a working directory
5. Click **Start**
6. Watch steps 1–5 run automatically (~25 seconds)
7. Review the plan, edit any step if needed, then click **"Approve Plan & Start Coding"**
8. Codex implements the changes, runs tests, and generates your PR description

---

## Project Structure

```
fe-agentic-workflow/
├── niesta-listener-ts/   ← TypeScript backend (Fastify 5, port 4000)
├── dashboard/            ← Angular 20 frontend (port 4200)
├── your-agent/           ← Python VPS agent + Telegram bot (optional)
└── niesta-listener/      ← Legacy Python listener (deprecated, kept for reference)
```

---

## Configuration Reference

All configuration lives in `niesta-listener-ts/.env`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LISTENER_PORT` | No | `4000` | HTTP port for the listener |
| `JIRA_API_TOKEN` | Yes | — | Atlassian API token |
| `JIRA_API_EMAIL` | Yes | — | Your Atlassian account email |
| `JIRA_CLOUD_ID` | Yes | — | Jira Cloud instance UUID |
| `JIRA_ACCOUNT_ID` | Yes | — | Your Jira user account ID |
| `OPENAI_API_KEY` | Yes | — | OpenAI API key (used for planning steps) |
| `CODEX_SESSIONS_PATH` | No | `~/.codex/sessions` | Where Codex stores session JSONL files |
| `NIESTA_API_URL` | No | — | VPS agent URL (for Telegram integration only) |

---

## The 9-Step Pipeline

| Step | Name | Runs On | What happens |
|------|------|---------|--------------|
| 1 | Kickoff | gpt-4o-mini | Plain-English summary — what changes, why, who's affected |
| 2 | Scope | gpt-4o-mini | In scope / out of scope / assumptions |
| 3 | Impact Map | gpt-4o-mini | Affected components, services, routes, API contracts |
| 4 | Risk Pass | gpt-4o-mini | Security, data, performance, compliance risks rated LOW/MEDIUM/HIGH |
| 5 | Test Plan | gpt-4o-mini | Jest unit tests, Playwright E2E tests, regression targets |
| — | **Approval Gate** | **Human** | **Review the plan — nothing is coded until you approve** |
| 6 | Implement | Codex CLI | Makes code changes using full context from steps 1–5 |
| 7 | Validate | Codex CLI | Runs tests, linting, reports results |
| 8 | Document | gpt-4o-mini | Jira comment, follow-up ticket suggestions, reviewer notes |
| 9 | PR Prep | gpt-4o-mini | PR title, full markdown description, file summary, rollback plan |

> **Cost:** Approximately $0.01–0.02 per pipeline (planning + doc steps via gpt-4o-mini).

---

## API Reference

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |

### Jira
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/jira/my-sprint` | Current sprint tickets |
| GET | `/jira/ticket/:key` | Full ticket detail |
| POST | `/jira/query` | JQL or natural language query |

### Pipeline
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/pipeline/start` | `{ ticket_key, cwd }` | Start a new pipeline |
| GET | `/pipeline/active` | — | All in-progress pipelines |
| GET | `/pipeline/history` | — | Completed pipelines (last 30 days) |
| GET | `/pipeline/:taskId` | — | Full pipeline state + all steps |
| POST | `/pipeline/:taskId/approve` | `{ step_number: 5 }` | Approve planning, start coding |
| POST | `/pipeline/:taskId/edit` | `{ step_number, output }` | Overwrite a step's output |
| POST | `/pipeline/:taskId/rerun` | `{ step_number }` | Regenerate a step |
| POST | `/pipeline/:taskId/skip` | `{ step_number }` | Skip a step |
| DELETE | `/pipeline/:taskId` | — | Delete pipeline and all steps |

### Codex Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/codex/start` | Start a Codex task directly |
| POST | `/codex/resume` | Resume an existing thread |
| POST | `/codex/interrupt` | Interrupt a running turn |
| GET | `/codex/tasks` | All tasks |
| GET | `/codex/tasks/running` | Running tasks only |
| GET | `/codex/tasks/:taskId` | Single task |
| GET | `/codex/threads` | All Codex threads |
| GET | `/codex/thread/:threadId` | Thread detail with turns |

### Sessions & Config
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/sessions` | Codex session files |
| DELETE | `/sessions/:sessionId` | Delete a session |
| GET | `/workdirs` | Configured work directories |
| POST | `/workdirs` | Add a work directory |

---

## Optional: VPS Agent + Telegram

The `your-agent/` directory contains a Python agent that runs on a VPS and provides Telegram access to Jira queries and notifications. This is entirely optional — the pipeline works without it.

If you want Telegram integration, set `NIESTA_API_URL` in your `.env` to point to your VPS agent. Pipeline completion and failures will be sent as Telegram messages.

---

## License

Private — internal use only.
