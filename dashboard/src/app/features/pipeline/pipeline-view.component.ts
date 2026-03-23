import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { MarkdownPipe } from '../../core/pipes/markdown.pipe';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, Pipeline, PipelineStep } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-pipeline-view',
  standalone: true,
  imports: [UpperCasePipe, MarkdownPipe],
  templateUrl: './pipeline-view.component.html',
  styleUrl: './pipeline-view.component.scss',
})
export class PipelineViewComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly taskId = signal('');
  readonly pipeline = signal<Pipeline | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // Editing state
  readonly editingStep = signal<number | null>(null);
  readonly editText = signal('');

  // Action states
  readonly approvingAll = signal(false);
  readonly rerunningStep = signal<number | null>(null);
  readonly skippingStep = signal<number | null>(null);

  private pollInterval: ReturnType<typeof setInterval> | null = null;

  readonly steps = computed(() => this.pipeline()?.steps ?? []);
  readonly isAwaitingApproval = computed(() => this.pipeline()?.task?.status === 'awaiting_approval');
  readonly isComplete = computed(() => this.pipeline()?.isComplete ?? false);
  readonly planningComplete = computed(() =>
    this.steps().filter((s) => s.step_number <= 5).every((s) =>
      s.status === 'completed' || s.status === 'approved' || s.status === 'skipped'
    )
  );

  readonly step9Output = computed(() =>
    this.steps().find((s) => s.step_number === 9)?.output ?? ''
  );

  ngOnInit(): void {
    this.taskId.set(this.route.snapshot.paramMap.get('taskId') ?? '');
    this.load();
    this.pollInterval = setInterval(() => this.load(), 3_000);
  }

  ngOnDestroy(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  load(): void {
    this.api.getPipeline(this.taskId()).subscribe((p) => {
      this.loading.set(false);
      if (p) {
        this.pipeline.set(p);
        if (p.isComplete && this.pollInterval) {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
        }
      } else if (this.loading()) {
        this.error.set('Failed to load pipeline.');
      }
    });
  }

  // ── Approval ──────────────────────────────────────────────────────────────

  approveAll(): void {
    this.approvingAll.set(true);
    this.api.approveStep(this.taskId(), 5).subscribe(() => {
      this.approvingAll.set(false);
      this.load();
    });
  }

  // ── Edit ──────────────────────────────────────────────────────────────────

  startEdit(step: PipelineStep): void {
    this.editingStep.set(step.step_number);
    this.editText.set(step.output);
  }

  cancelEdit(): void {
    this.editingStep.set(null);
    this.editText.set('');
  }

  saveEdit(stepNumber: number): void {
    this.api.editStep(this.taskId(), stepNumber, this.editText()).subscribe(() => {
      this.editingStep.set(null);
      this.editText.set('');
      this.load();
    });
  }

  // ── Rerun ─────────────────────────────────────────────────────────────────

  rerun(stepNumber: number): void {
    this.rerunningStep.set(stepNumber);
    this.api.rerunStep(this.taskId(), stepNumber).subscribe(() => {
      this.rerunningStep.set(null);
      this.load();
    });
  }

  // ── Skip ──────────────────────────────────────────────────────────────────

  skip(stepNumber: number): void {
    this.skippingStep.set(stepNumber);
    this.api.skipStep(this.taskId(), stepNumber).subscribe(() => {
      this.skippingStep.set(null);
      this.load();
    });
  }

  // ── Copy PR ───────────────────────────────────────────────────────────────

  copyPr(): void {
    const text = this.step9Output();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.toast.show('PR description copied to clipboard');
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  statusClass(status: string): string {
    const map: Record<string, string> = {
      pending: 'status-pending',
      running: 'status-running',
      completed: 'status-completed',
      approved: 'status-approved',
      failed: 'status-failed',
      skipped: 'status-skipped',
    };
    return map[status] ?? 'status-pending';
  }

  statusIcon(status: string): string {
    const map: Record<string, string> = {
      pending: '○',
      running: '◉',
      completed: '✓',
      approved: '✓',
      failed: '✗',
      skipped: '–',
    };
    return map[status] ?? '○';
  }

  taskStatusLabel(): string {
    const s = this.pipeline()?.task?.status ?? '';
    const map: Record<string, string> = {
      pipeline: 'Planning…',
      awaiting_approval: 'Awaiting Approval',
      running: 'Coding…',
      completed: 'Complete',
      failed: 'Failed',
    };
    return map[s] ?? s;
  }

  isEditable(step: PipelineStep): boolean {
    return step.status === 'completed' && this.editingStep() !== step.step_number;
  }

  isRerunnable(step: PipelineStep): boolean {
    return (
      (step.status === 'completed' || step.status === 'failed') &&
      step.step_number !== 6 &&
      step.step_number !== 7
    );
  }
}
