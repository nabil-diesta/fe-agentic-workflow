import { Component, inject, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, JiraTicket, CodexTask, Workdir } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { parseTicketKeyFromTask } from '../../core/utils/ticket-key';

const AUTO_REFRESH_MS = 5 * 60 * 1000;
const RUNNING_TASKS_POLL_MS = 15_000;

@Component({
  selector: 'app-sprint',
  standalone: true,
  imports: [],
  templateUrl: './sprint.component.html',
  styleUrl: './sprint.component.scss',
})
export class SprintComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly tickets = signal<JiraTicket[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly detailTicket = signal<JiraTicket | null>(null);
  readonly detailLoading = signal(false);
  readonly runningTasks = signal<CodexTask[]>([]);
  readonly showStartWorkModal = signal(false);
  readonly startWorkInstructions = signal('');
  readonly startWorkCwd = signal('');
  readonly startWorkSubmitting = signal(false);
  readonly workdirs = signal<Workdir[]>([]);

  readonly byStatus = computed(() => {
    const list = this.tickets();
    const map: Record<string, JiraTicket[]> = {};
    const order = ['To Do', 'In Progress', 'In Review', 'In QA', 'Done', 'Unknown'];
    for (const col of order) map[col] = [];
    for (const t of list) {
      let s = (t.status || 'Unknown').trim();
      if (s === 'To-Do') s = 'To Do';
      if (!map[s]) map[s] = [];
      map[s].push(t);
    }
    return map;
  });

  readonly columnOrder = ['To Do', 'In Progress', 'In Review', 'In QA', 'Done', 'Unknown'] as const;

  /** Set of ticket keys that have an active Codex task. */
  readonly ticketKeysWithCodex = computed(() => {
    const keys = new Set<string>();
    for (const t of this.runningTasks()) {
      if (t.ticket_key) keys.add(t.ticket_key);
      const k = parseTicketKeyFromTask(t.task);
      if (k) keys.add(k);
    }
    return keys;
  });

  constructor() {
    this.api.getWorkdirs().subscribe((dirs) => {
      if (dirs && dirs.length) {
        this.workdirs.set(dirs);
        this.startWorkCwd.set(dirs[0].path);
      }
    });
  }

  private refreshEffect = effect(() => {
    this.load();
    const id = setInterval(() => this.load(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  });

  private runningTasksEffect = effect(() => {
    const loadTasks = () => {
      this.api.getRunningTasks().subscribe((list) => {
        if (list) this.runningTasks.set(list);
      });
    };
    loadTasks();
    const id = setInterval(loadTasks, RUNNING_TASKS_POLL_MS);
    return () => clearInterval(id);
  });

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getSprintTickets().subscribe((res) => {
      this.loading.set(false);
      if (res) this.tickets.set(res.tickets ?? []);
      else this.error.set('Failed to load sprint.');
    });
  }

  openDetail(key: string): void {
    this.detailLoading.set(true);
    this.detailTicket.set(null);
    this.api.getTicketDetail(key).subscribe((t) => {
      this.detailLoading.set(false);
      this.detailTicket.set(t ?? null);
    });
  }

  closeDetail(): void {
    this.detailTicket.set(null);
    this.showStartWorkModal.set(false);
  }

  openStartWorkModal(): void {
    this.startWorkInstructions.set('');
    const dirs = this.workdirs();
    this.startWorkCwd.set(dirs.length ? dirs[0].path : '');
    this.showStartWorkModal.set(true);
  }

  closeStartWorkModal(): void {
    this.showStartWorkModal.set(false);
  }

  submitStartWork(): void {
    const t = this.detailTicket();
    if (!t) return;
    const instructions = this.startWorkInstructions().trim();
    const cwd = this.startWorkCwd().trim();
    if (!cwd) {
      this.toast.show('Please select a working directory.');
      return;
    }
    const taskBody = [
      `Implement ${t.key}: ${t.summary ?? ''}`,
      t.description ?? '',
      instructions,
    ]
      .filter(Boolean)
      .join('\n\n');
    this.startWorkSubmitting.set(true);
    this.api.startCodex(taskBody, cwd, t.key).subscribe((res) => {
      this.startWorkSubmitting.set(false);
      if (res) {
        this.toast.show(`Codex started on ${t.key}`);
        this.closeStartWorkModal();
        this.closeDetail();
        this.router.navigate(['/active']);
      } else {
        this.toast.show('Failed to start Codex.');
      }
    });
  }

  hasCodexWorking(key: string): boolean {
    return this.ticketKeysWithCodex().has(key);
  }

  priorityClass(p?: string): string {
    if (!p) return 'priority-other';
    const v = p.toLowerCase();
    if (v === 'critical') return 'priority-critical';
    if (v === 'high') return 'priority-high';
    if (v === 'medium') return 'priority-medium';
    if (v === 'low') return 'priority-low';
    return 'priority-other';
  }

  typeClass(t?: string): string {
    if (!t) return 'type-other';
    const v = (t || '').toLowerCase();
    if (v === 'bug') return 'type-bug';
    if (v === 'task') return 'type-task';
    if (v === 'story') return 'type-story';
    return 'type-other';
  }
}
