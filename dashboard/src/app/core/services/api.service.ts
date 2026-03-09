import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of } from 'rxjs';
import { SettingsService } from './settings.service';

export interface JiraTicket {
  key: string;
  summary: string;
  status?: string;
  priority?: string;
  assignee?: string;
  type?: string;
  story_points?: number;
  description?: string;
  subtasks?: { key: string; summary: string }[];
  comments?: { author?: string; body: string }[];
}

export interface SprintStatus {
  to_do: number;
  in_progress: number;
  in_review: number;
  in_qa?: number;
  done: number;
  in_progress_keys?: string[];
}

export interface CodexSession {
  session_id: string;
  timestamp?: string;
  cwd?: string;
  model?: string;
  status?: string;
  last_activity?: string;
  /** Unix timestamp for relative time display */
  last_activity_ts?: number;
  path?: string;
}

export interface CodexTask {
  task_id: string;
  thread_id: string;
  turn_id: string;
  ticket_key: string | null;
  task: string;
  cwd: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  started_at: number;
  completed_at: number | null;
  output: string;
  error: string;
}

export interface Workdir {
  label: string;
  path: string;
}

/** @deprecated use CodexTask */
export type RunningTask = CodexTask;

/**
 * Central API service for listener and Niesta agent.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(SettingsService);

  private listener(): string {
    return this.settings.listenerUrl().replace(/\/$/, '');
  }
  private niesta(): string {
    return this.settings.niestaUrl().replace(/\/$/, '');
  }

  getSprintTickets(): Observable<{ tickets: JiraTicket[] } | null> {
    return this.http
      .get<{ tickets?: JiraTicket[]; data?: JiraTicket[] }>(`${this.listener()}/jira/my-sprint`)
      .pipe(
        map((r) => ({ tickets: r.tickets ?? r.data ?? [] })),
        catchError(() => of(null))
      );
  }

  getTicketDetail(key: string): Observable<JiraTicket | null> {
    return this.http
      .get<JiraTicket>(`${this.listener()}/jira/ticket/${key}`)
      .pipe(catchError(() => of(null)));
  }

  getSprintStatus(): Observable<SprintStatus | null> {
    return this.http
      .get<SprintStatus>(`${this.listener()}/jira/my-status`)
      .pipe(catchError(() => of(null)));
  }

  queryJira(jql: string, fields: string[] = ['key', 'summary', 'status', 'priority', 'assignee', 'issuetype'], maxResults = 50): Observable<{ tickets: JiraTicket[] } | null> {
    return this.http
      .post<{ tickets?: JiraTicket[]; data?: JiraTicket[] }>(`${this.listener()}/jira/query`, {
        jql,
        fields,
        max_results: maxResults,
      })
      .pipe(
        map((r) => ({ tickets: r.tickets ?? r.data ?? [] })),
        catchError(() => of(null))
      );
  }

  getSessions(): Observable<CodexSession[] | null> {
    return this.http
      .get<CodexSession[]>(`${this.listener()}/sessions`)
      .pipe(catchError(() => of(null)));
  }

  getActiveSessions(): Observable<CodexSession[] | null> {
    return this.http
      .get<CodexSession[]>(`${this.listener()}/sessions/active`)
      .pipe(catchError(() => of(null)));
  }

  getHealth(): Observable<{ status: string } | null> {
    return this.http
      .get<{ status: string }>(`${this.listener()}/health`)
      .pipe(catchError(() => of(null)));
  }

  chatWithNiesta(message: string): Observable<{ response?: string; skills_used?: string[] } | null> {
    return this.http
      .post<{ response?: string; skills_used?: string[] }>(`${this.niesta()}/chat`, {
        message,
        session_id: 'default',
      })
      .pipe(catchError(() => of(null)));
  }

  startCodex(task: string, cwd: string, ticketKey?: string): Observable<CodexTask | null> {
    return this.http
      .post<CodexTask>(`${this.listener()}/codex/start`, {
        task,
        cwd,
        ticket_key: ticketKey ?? null,
      })
      .pipe(catchError(() => of(null)));
  }

  getRunningTasks(): Observable<CodexTask[] | null> {
    return this.http
      .get<{ tasks: CodexTask[] }>(`${this.listener()}/codex/tasks/running`)
      .pipe(
        map((r) => r.tasks ?? []),
        catchError(() => of(null)),
      );
  }

  getAllTasks(): Observable<CodexTask[] | null> {
    return this.http
      .get<{ tasks: CodexTask[] }>(`${this.listener()}/codex/tasks`)
      .pipe(
        map((r) => r.tasks ?? []),
        catchError(() => of(null)),
      );
  }

  getWorkdirs(): Observable<Workdir[] | null> {
    return this.http
      .get<{ workdirs: Workdir[] }>(`${this.listener()}/workdirs`)
      .pipe(
        map((r) => r.workdirs ?? []),
        catchError(() => of(null)),
      );
  }

  addWorkdir(label: string, path: string): Observable<Workdir[] | null> {
    return this.http
      .post<{ workdirs: Workdir[] }>(`${this.listener()}/workdirs`, { label, path })
      .pipe(
        map((r) => r.workdirs ?? []),
        catchError(() => of(null)),
      );
  }

  removeWorkdir(path: string): Observable<Workdir[] | null> {
    return this.http
      .delete<{ workdirs: Workdir[] }>(`${this.listener()}/workdirs`, { body: { path } })
      .pipe(
        map((r) => r.workdirs ?? []),
        catchError(() => of(null)),
      );
  }

  resumeCodex(threadId: string, prompt: string): Observable<{ thread_id: string; turn_id: string } | null> {
    return this.http
      .post<{ thread_id: string; turn_id: string }>(`${this.listener()}/codex/resume`, {
        thread_id: threadId,
        prompt,
      })
      .pipe(catchError(() => of(null)));
  }

  interruptCodex(threadId: string, turnId: string): Observable<unknown | null> {
    return this.http
      .post(`${this.listener()}/codex/interrupt`, { thread_id: threadId, turn_id: turnId })
      .pipe(catchError(() => of(null)));
  }

  getTaskEvents(taskId: string): Observable<{ events: unknown[] } | null> {
    return this.http
      .get<{ events: unknown[] }>(`${this.listener()}/codex/tasks/${taskId}/events`)
      .pipe(catchError(() => of(null)));
  }

  getThread(threadId: string): Observable<{ thread: CodexThread } | null> {
    return this.http
      .get<{ thread: CodexThread }>(`${this.listener()}/codex/thread/${threadId}`)
      .pipe(catchError(() => of(null)));
  }

  deleteSession(sessionId: string): Observable<{ deleted: string } | null> {
    return this.http
      .delete<{ deleted: string }>(`${this.listener()}/sessions/${sessionId}`)
      .pipe(catchError(() => of(null)));
  }
}

export interface ThreadItem {
  type: 'userMessage' | 'reasoning' | 'agentMessage' | 'commandExecution' | string;
  id: string;
  // userMessage
  content?: { type: string; text: string }[];
  // reasoning
  summary?: string[];
  // agentMessage
  text?: string;
  phase?: string | null;
  // commandExecution
  command?: string[];
  output?: string;
  exitCode?: number;
}

export interface ThreadTurn {
  id: string;
  items: ThreadItem[];
  status: string;
  error: string | null;
}

export interface CodexThread {
  id: string;
  preview: string;
  cwd: string;
  status: { type: string };
  gitInfo?: { sha: string; branch: string; originUrl: string };
  name?: string | null;
  turns: ThreadTurn[];
  createdAt: number;
  updatedAt: number;
}
