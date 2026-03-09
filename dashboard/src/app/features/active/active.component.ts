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
    this.api.interruptCodex(task.thread_id, task.turn_id).subscribe((res) => {
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
}
