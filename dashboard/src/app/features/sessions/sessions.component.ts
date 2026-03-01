import { Component, inject, signal, effect } from '@angular/core';
import { ApiService, CodexSession } from '../../core/services/api.service';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [],
  templateUrl: './sessions.component.html',
  styleUrl: './sessions.component.scss',
})
export class SessionsComponent {
  private readonly api = inject(ApiService);

  readonly sessions = signal<CodexSession[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

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
