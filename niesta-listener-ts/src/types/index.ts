export interface Task {
  task_id: string;
  thread_id: string | null;
  turn_id: string | null;
  ticket_key: string | null;
  task: string;
  cwd: string;
  status: "running" | "completed" | "failed" | "interrupted" | "pipeline" | "awaiting_approval";
  started_at: number;
  completed_at: number | null;
  output: string;
  error: string;
}

export interface PipelineStepRow {
  id: number;
  task_id: string;
  step_number: number;
  step_name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "approved";
  output: string;
  context: string;
  started_at: number | null;
  completed_at: number | null;
  approved_by: string | null;
  approved_at: number | null;
}

export interface Pipeline {
  task: Task;
  steps: PipelineStepRow[];
  currentStep: number;
  isComplete: boolean;
}

export interface JiraTicket {
  key: string;
  summary: string;
  status: string | null;
  priority: string | null;
  assignee: string | null;
  storyPoints: number | null;
  type: string | null;
}

export interface JiraTicketDetail extends JiraTicket {
  description: string;
  subtasks: Array<{ key: string; summary: string }>;
  comments: Array<{ author: string | null; body: string }>;
}

export interface Session {
  session_id: string;
  timestamp: string | null;
  cwd: string | null;
  model: string | null;
  cli_version: string | null;
  last_activity: string | null;
  last_activity_ts: number;
  token_usage: {
    input: number | null;
    output: number | null;
    total: number | null;
  } | null;
  rate_limits: Record<string, number> | null;
  status: "active" | "idle" | "forgotten";
  path: string;
  first_message: string | null;
  last_agent_message: string | null;
}

export interface Workdir {
  label: string;
  path: string;
}
