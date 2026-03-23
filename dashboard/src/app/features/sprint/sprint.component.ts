import { Component, inject, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, JiraTicket, CodexTask, Workdir, Pipeline } from '../../core/services/api.service';
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

  // Pipeline modal
  readonly showStartPipelineModal = signal(false);
  readonly startPipelineCwd = signal('');
  readonly startPipelineSubmitting = signal(false);

  // Active pipelines keyed by ticket_key
  readonly activePipelines = signal<Map<string, Pipeline>>(new Map());

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
        this.startPipelineCwd.set(dirs[0].path);
      }
    });
    this.loadActivePipelines();
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
    this.showStartPipelineModal.set(false);
  }

  loadActivePipelines(): void {
    this.api.getActivePipelines().subscribe((list) => {
      if (!list) return;
      const map = new Map<string, Pipeline>();
      for (const p of list) {
        if (p.task.ticket_key) map.set(p.task.ticket_key, p);
      }
      this.activePipelines.set(map);
    });
  }

  pipelineForTicket(key: string): Pipeline | undefined {
    return this.activePipelines().get(key);
  }

  openStartPipelineModal(): void {
    const dirs = this.workdirs();
    this.startPipelineCwd.set(dirs.length ? dirs[0].path : '');
    this.showStartPipelineModal.set(true);
  }

  closeStartPipelineModal(): void {
    this.showStartPipelineModal.set(false);
  }

  submitStartPipeline(): void {
    const t = this.detailTicket();
    if (!t) return;
    const cwd = this.startPipelineCwd().trim();
    if (!cwd) {
      this.toast.show('Please select a working directory.');
      return;
    }
    this.startPipelineSubmitting.set(true);
    this.api.startPipeline(t.key, cwd).subscribe((res) => {
      this.startPipelineSubmitting.set(false);
      if (res) {
        this.toast.show(`Pipeline started for ${t.key}`);
        this.closeStartPipelineModal();
        this.closeDetail();
        this.router.navigate(['/pipeline', res.taskId]);
      } else {
        this.toast.show('Failed to start pipeline.');
      }
    });
  }

  pipelineProgressPct(p: Pipeline): number {
    const done = p.steps.filter(
      (s) => s.status === 'completed' || s.status === 'approved' || s.status === 'skipped'
    ).length;
    return Math.round((done / 9) * 100);
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
