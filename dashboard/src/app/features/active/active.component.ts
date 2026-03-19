import { Component, inject, signal, computed, effect } from '@angular/core';
import { JsonPipe, NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService, CodexTask } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { parseTicketKeyFromTask } from '../../core/utils/ticket-key';

const POLL_MS = 15_000;
const EVENT_POLL_MS = 3_000;
const TASK_TRUNCATE = 80;

@Component({
  selector: 'app-active',
  standalone: true,
  imports: [JsonPipe, NgClass],
  templateUrl: './active.component.html',
  styleUrl: './active.component.scss',
})
export class ActiveComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly tasks = signal<CodexTask[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly expandedTaskId = signal<string | null>(null);
  readonly resumeTaskId = signal<string | null>(null);
  readonly resumePrompt = signal('');
  readonly resumeSubmitting = signal(false);
  readonly taskEvents = signal<Map<string, unknown[]>>(new Map());

  readonly selected = signal<Set<string>>(new Set());
  readonly deletingId = signal<string | null>(null);
  readonly bulkDeleting = signal(false);
  readonly interruptingId = signal<string | null>(null);

  readonly allSelected = computed(() => {
    const t = this.tasks();
    return t.length > 0 && this.selected().size === t.length;
  });

  readonly someSelected = computed(() => {
    const size = this.selected().size;
    return size > 0 && size < this.tasks().length;
  });

  readonly runningTaskIds = computed(() =>
    this.tasks().filter(t => t.status === 'running').map(t => t.task_id)
  );

  constructor() {
    // Poll all tasks every 15s
    effect(() => {
      this.load();
      const id = setInterval(() => this.load(), POLL_MS);
      return () => clearInterval(id);
    });

    // Poll events for running tasks every 3s (reactive: restarts when running list changes)
    effect(() => {
      const ids = this.runningTaskIds();
      if (!ids.length) return;
      const poll = () => {
        for (const taskId of ids) {
          this.api.getTaskEvents(taskId).subscribe((res) => {
            if (!res) return;
            this.taskEvents.update((m) => {
              const next = new Map(m);
              next.set(taskId, res.events);
              return next;
            });
          });
        }
      };
      poll();
      const id = setInterval(poll, EVENT_POLL_MS);
      return () => clearInterval(id);
    });
  }

  load(): void {
    this.loading.set(true);
    this.api.getAllTasks().subscribe((list) => {
      this.loading.set(false);
      if (list !== null) this.tasks.set(list);
      else this.error.set('Failed to load tasks.');
    });
  }

  toggleExpand(taskId: string): void {
    this.expandedTaskId.update(id => id === taskId ? null : taskId);
  }

  isExpanded(taskId: string): boolean {
    return this.expandedTaskId() === taskId;
  }

  eventsFor(taskId: string): unknown[] {
    return this.taskEvents().get(taskId) ?? [];
  }

  openResume(task: CodexTask): void {
    this.resumeTaskId.set(task.task_id);
    this.resumePrompt.set('');
  }

  closeResume(): void {
    this.resumeTaskId.set(null);
    this.resumePrompt.set('');
  }

  submitResume(): void {
    const taskId = this.resumeTaskId();
    const prompt = this.resumePrompt().trim();
    if (!taskId || !prompt) return;
    const task = this.tasks().find(t => t.task_id === taskId);
    if (!task) return;
    this.resumeSubmitting.set(true);
    this.api.resumeCodex(task.thread_id, prompt).subscribe((res) => {
      this.resumeSubmitting.set(false);
      if (res) {
        this.toast.show('Task resumed.');
        this.closeResume();
        this.load();
      } else {
        this.toast.show('Failed to resume task.');
      }
    });
  }

  interrupt(task: CodexTask): void {
    if (this.interruptingId() === task.task_id) return;
    this.interruptingId.set(task.task_id);
    this.api.interruptCodex(task.thread_id, task.turn_id).subscribe((res) => {
      this.interruptingId.set(null);
      if (res !== null) {
        this.toast.show(`Interrupted ${task.ticket_key ?? task.task_id}`);
        this.load();
      } else {
        this.toast.show('Failed to interrupt task.');
      }
    });
  }

  statusClass(status: CodexTask['status']): string {
    const map: Record<string, string> = {
      running: 'status-running',
      completed: 'status-completed',
      failed: 'status-failed',
      interrupted: 'status-interrupted',
    };
    return map[status] ?? 'status-unknown';
  }

  statusLabel(status: CodexTask['status']): string {
    const map: Record<string, string> = {
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      interrupted: 'Interrupted',
    };
    return map[status] ?? status;
  }

  truncate(s: string | undefined, max: number = TASK_TRUNCATE): string {
    if (!s) return '—';
    return s.length <= max ? s : s.slice(0, max) + '…';
  }

  formatTime(ts: number | undefined): string {
    if (ts == null) return '—';
    const sec = Date.now() / 1000 - ts;
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
    return `${Math.floor(sec / 86400)} days ago`;
  }

  parseTicketKey = parseTicketKeyFromTask;

  checkIn(task: CodexTask): void {
    this.router.navigate(['/thread', task.thread_id]);
  }

  toggleSelect(taskId: string): void {
    this.selected.update((s) => {
      const next = new Set(s);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  }

  toggleSelectAll(): void {
    if (this.allSelected()) {
      this.selected.set(new Set());
    } else {
      this.selected.set(new Set(this.tasks().map((t) => t.task_id)));
    }
  }

  isSelected(taskId: string): boolean {
    return this.selected().has(taskId);
  }

  deleteTask(event: Event, task: CodexTask): void {
    event.stopPropagation();
    if (this.deletingId() === task.task_id) return;
    this.deletingId.set(task.task_id);
    this.api.deleteTask(task.task_id).subscribe((ok) => {
      this.deletingId.set(null);
      if (ok) {
        this.tasks.update((list) => list.filter((t) => t.task_id !== task.task_id));
        this.selected.update((s) => { const n = new Set(s); n.delete(task.task_id); return n; });
        this.toast.show('Task deleted.');
      } else {
        this.toast.show('Failed to delete task.');
      }
    });
  }

  deleteSelected(): void {
    const ids = [...this.selected()];
    if (!ids.length || this.bulkDeleting()) return;
    this.bulkDeleting.set(true);
    let remaining = ids.length;
    let failed = 0;
    for (const id of ids) {
      this.api.deleteTask(id).subscribe((ok) => {
        if (!ok) failed++;
        remaining--;
        if (remaining === 0) {
          this.bulkDeleting.set(false);
          this.load();
          this.selected.set(new Set());
          this.toast.show(failed
            ? `Deleted ${ids.length - failed}; ${failed} failed.`
            : `Deleted ${ids.length} task${ids.length > 1 ? 's' : ''}.`);
        }
      });
    }
  }
}
