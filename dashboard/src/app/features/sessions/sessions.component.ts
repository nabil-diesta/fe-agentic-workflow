import { Component, inject, signal, effect } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, CodexSession } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [],
  templateUrl: './sessions.component.html',
  styleUrl: './sessions.component.scss',
})
export class SessionsComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly sessions = signal<CodexSession[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.load();
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getSessions().subscribe((list) => {
      this.loading.set(false);
      if (list) this.sessions.set(list);
      else this.error.set('Failed to load sessions.');
    });
  }

  openThread(session: CodexSession): void {
    this.router.navigate(['/thread', session.session_id]);
  }

  deleteSession(event: Event, session: CodexSession): void {
    event.stopPropagation(); // don't trigger row click
    if (this.deletingId() === session.session_id) return;
    this.deletingId.set(session.session_id);
    this.api.deleteSession(session.session_id).subscribe((res) => {
      this.deletingId.set(null);
      if (res) {
        this.sessions.update((list) => list.filter((s) => s.session_id !== session.session_id));
        this.toast.show('Session deleted.');
      } else {
        this.toast.show('Failed to delete session.');
      }
    });
  }

  truncateId(id: string): string {
    if (!id) return '—';
    return id.length > 12 ? id.slice(0, 8) + '…' : id;
  }

  formatTime(ts: string | number | undefined): string {
    if (ts == null) return '—';
    const t = typeof ts === 'string' ? parseFloat(ts) : ts;
    if (Number.isNaN(t)) return String(ts);
    const sec = (Date.now() / 1000) - t;
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
    if (sec < 86400 * 7) return `${Math.floor(sec / 86400)} days ago`;
    return new Date(t * 1000).toLocaleDateString();
  }

  statusClass(s: string | undefined): string {
    if (!s) return 'status-other';
    if (s === 'active') return 'status-active';
    if (s === 'idle') return 'status-idle';
    return 'status-forgotten';
  }
}
