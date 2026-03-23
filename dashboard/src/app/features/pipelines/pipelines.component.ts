import { Component, inject, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, Pipeline } from '../../core/services/api.service';

const POLL_MS = 10_000;

@Component({
  selector: 'app-pipelines',
  standalone: true,
  imports: [],
  templateUrl: './pipelines.component.html',
  styleUrl: './pipelines.component.scss',
})
export class PipelinesComponent {
  private readonly api = inject(ApiService);
  readonly router = inject(Router);

  readonly active = signal<Pipeline[]>([]);
  readonly history = signal<Pipeline[]>([]);
  readonly loading = signal(true);
  readonly deletingId = signal<string | null>(null);

  private loadEffect = effect(() => {
    this.load();
    const id = setInterval(() => this.loadActive(), POLL_MS);
    return () => clearInterval(id);
  });

  load(): void {
    this.loading.set(true);
    this.loadActive();
    this.api.getPipelineHistory().subscribe((h) => {
      if (h) this.history.set(h);
      this.loading.set(false);
    });
  }

  loadActive(): void {
    this.api.getActivePipelines().subscribe((a) => {
      if (a) this.active.set(a);
    });
  }

  open(taskId: string): void {
    this.router.navigate(['/pipeline', taskId]);
  }

  delete(event: Event, taskId: string): void {
    event.stopPropagation();
    if (this.deletingId() === taskId) return;
    this.deletingId.set(taskId);
    this.api.deletePipeline(taskId).subscribe((res) => {
      this.deletingId.set(null);
      if (res) {
        this.active.update((list) => list.filter((p) => p.task.task_id !== taskId));
        this.history.update((list) => list.filter((p) => p.task.task_id !== taskId));
      }
    });
  }

  stepProgress(p: Pipeline): string {
    const done = p.steps.filter(
      (s) => s.status === 'completed' || s.status === 'approved' || s.status === 'skipped'
    ).length;
    return `${done}/9`;
  }

  progressPct(p: Pipeline): number {
    const done = p.steps.filter(
      (s) => s.status === 'completed' || s.status === 'approved' || s.status === 'skipped'
    ).length;
    return Math.round((done / 9) * 100);
  }

  currentStepName(p: Pipeline): string {
    const running = p.steps.find((s) => s.status === 'running');
    if (running) return running.step_name;
    if (p.isComplete) return 'Complete';
    if (p.task.status === 'awaiting_approval') return 'Awaiting Approval';
    const last = [...p.steps].reverse().find((s) => s.status === 'completed' || s.status === 'approved');
    return last ? `After ${last.step_name}` : 'Starting…';
  }

  statusLabel(p: Pipeline): string {
    const map: Record<string, string> = {
      pipeline: 'Planning',
      awaiting_approval: 'Awaiting Approval',
      running: 'Coding',
      completed: 'Complete',
      failed: 'Failed',
    };
    return map[p.task.status] ?? p.task.status;
  }

  statusClass(p: Pipeline): string {
    const map: Record<string, string> = {
      pipeline: 'badge-planning',
      awaiting_approval: 'badge-approval',
      running: 'badge-running',
      completed: 'badge-complete',
      failed: 'badge-failed',
    };
    return map[p.task.status] ?? '';
  }

  formatTime(ts: number | null): string {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  }
}
