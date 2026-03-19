import { Component, inject, signal, computed, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NgClass } from '@angular/common';
import { ApiService, CodexThread, ThreadItem } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { MarkdownPipe } from '../../core/pipes/markdown.pipe';

const POLL_MS = 3_000;
const BG_POLL_MS = 5_000;
const THINKING_TIMEOUT_MS = 5 * 60 * 1000;

@Component({
  selector: 'app-thread',
  standalone: true,
  imports: [NgClass, MarkdownPipe],
  templateUrl: './thread.component.html',
  styleUrl: './thread.component.scss',
})
export class ThreadComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
private readonly toast = inject(ToastService);

  readonly thread = signal<CodexThread | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly prompt = signal('');
  readonly sending = signal(false);
  readonly thinking = signal(false);
  readonly copied = signal(false);
  readonly expandedReasoning = signal<Set<string>>(new Set());

  readonly threadId = this.route.snapshot.paramMap.get('threadId') ?? '';

  readonly isRunning = computed(() => {
    const t = this.thread();
    return t?.status?.type === 'running' || t?.status?.type === 'streaming';
  });

  private _thinkingInterval: ReturnType<typeof setInterval> | null = null;
  private _thinkingTimeout: ReturnType<typeof setTimeout> | null = null;
  private _bgPollInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (this.threadId) {
      this.load();
      this._bgPollInterval = setInterval(() => this._bgPoll(), BG_POLL_MS);
    }
  }

  ngOnDestroy(): void {
    this._stopThinkingPoll();
    if (this._bgPollInterval) { clearInterval(this._bgPollInterval); this._bgPollInterval = null; }
  }

  load(): void {
    if (!this.threadId) return;
    this.api.getThread(this.threadId).subscribe((res) => {
      this.loading.set(false);
      if (res?.thread) this.thread.set(res.thread);
      else if (!this.thread()) this.error.set('Thread not found.');
    });
  }

  sendPrompt(): void {
    const text = this.prompt().trim();
    if (!this.threadId || !text || this.sending() || this.thinking()) return;

    const turnsBefore = this.thread()?.turns?.length ?? 0;

    this.sending.set(true);
    this.api.resumeCodex(this.threadId, text).subscribe((res) => {
      this.sending.set(false);
      if (res) {
        this.prompt.set('');
        this.thinking.set(true);
        this._startThinkingPoll(turnsBefore);
      } else {
        this.toast.show('Failed to send prompt.');
      }
    });
  }

  private _startThinkingPoll(turnsBefore: number): void {
    this._stopThinkingPoll();

    const check = () => {
      this.api.getThread(this.threadId).subscribe((res) => {
        if (!res?.thread) return;
        this.thread.set(res.thread);

        const turns = res.thread.turns ?? [];
        const lastTurn = turns[turns.length - 1];
        const hasNewAgentMsg =
          turns.length > turnsBefore &&
          lastTurn?.items?.some((i) => i.type === 'agentMessage');

        if (hasNewAgentMsg) {
          this.thinking.set(false);
          this._stopThinkingPoll();
        }
      });
    };

    // Immediate check, then poll
    check();
    this._thinkingInterval = setInterval(check, POLL_MS);

    // Safety timeout
    this._thinkingTimeout = setTimeout(() => {
      this.thinking.set(false);
      this._stopThinkingPoll();
    }, THINKING_TIMEOUT_MS);
  }

  private _bgPoll(): void {
    // Skip if the thinking poll is already running — it's faster and handles updates
    if (this._thinkingInterval) return;
    this.api.getThread(this.threadId).subscribe((res) => {
      if (res?.thread) this.thread.set(res.thread);
    });
  }

  private _stopThinkingPoll(): void {
    if (this._thinkingInterval) { clearInterval(this._thinkingInterval); this._thinkingInterval = null; }
    if (this._thinkingTimeout) { clearTimeout(this._thinkingTimeout); this._thinkingTimeout = null; }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      this.sendPrompt();
    }
  }

  toggleReasoning(itemId: string): void {
    this.expandedReasoning.update((s) => {
      const next = new Set(s);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }

  isReasoningExpanded(itemId: string): boolean {
    return this.expandedReasoning().has(itemId);
  }

  userText(item: ThreadItem): string {
    return item.content?.map((c) => c.text).join('') ?? '';
  }

  commandStr(item: ThreadItem): string {
    return Array.isArray(item.command) ? item.command.join(' ') : String(item.command ?? '');
  }

  copyId(): void {
    navigator.clipboard.writeText(`codex resume ${this.threadId}`).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  goBack(): void {
    window.history.back();
  }
}
