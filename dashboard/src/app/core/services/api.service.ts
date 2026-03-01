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
}

/**
 * Central API service for listener and Niesta agent.
 * Note: The VPS agent (niestaUrl) may need CORS enabled for browser requests (e.g. allow origin of the dashboard).
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
}
