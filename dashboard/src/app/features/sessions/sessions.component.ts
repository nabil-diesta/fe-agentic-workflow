import { Component, inject, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { NgClass } from '@angular/common';
import { ApiService, CodexSession } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [NgClass],
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

  readonly selected = signal<Set<string>>(new Set());
  readonly bulkDeleting = signal(false);

  readonly allSelected = computed(() => {
    const s = this.sessions();
    return s.length > 0 && this.selected().size === s.length;
  });

  readonly someSelected = computed(() => {
    const size = this.selected().size;
    return size > 0 && size < this.sessions().length;
  });

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
      if (list) {
        this.sessions.set(list);
        // Clear selection for sessions that no longer exist
        const ids = new Set(list.map((s) => s.session_id));
        this.selected.update((sel) => new Set([...sel].filter((id) => ids.has(id))));
      } else {
        this.error.set('Failed to load sessions.');
      }
    });
  }

  openThread(session: CodexSession): void {
    this.router.navigate(['/thread', session.session_id]);
  }

  toggleSelect(event: Event, id: string): void {
    event.stopPropagation();
    this.selected.update((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  toggleSelectAll(event: Event): void {
    event.stopPropagation();
    if (this.allSelected()) {
      this.selected.set(new Set());
    } else {
      this.selected.set(new Set(this.sessions().map((s) => s.session_id)));
    }
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  deleteSession(event: Event, session: CodexSession): void {
    event.stopPropagation();
    if (this.deletingId() === session.session_id) return;
    this.deletingId.set(session.session_id);
    this.api.deleteSession(session.session_id).subscribe((res) => {
      this.deletingId.set(null);
      if (res) {
        this.sessions.update((list) => list.filter((s) => s.session_id !== session.session_id));
        this.selected.update((sel) => { const n = new Set(sel); n.delete(session.session_id); return n; });
        this.toast.show('Session deleted.');
      } else {
        this.toast.show('Failed to delete session.');
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
      this.api.deleteSession(id).subscribe((res) => {
        if (!res) failed++;
        remaining--;
        if (remaining === 0) {
          this.bulkDeleting.set(false);
          this.sessions.update((list) => list.filter((s) => !ids.includes(s.session_id) || !res));
          // Reload to get accurate state
          this.load();
          this.selected.set(new Set());
          this.toast.show(failed ? `Deleted ${ids.length - failed}; ${failed} failed.` : `Deleted ${ids.length} session${ids.length > 1 ? 's' : ''}.`);
        }
      });
    }
  }

  projectName(cwd: string | undefined): string {
    if (!cwd) return '—';
    // Show last 2 path segments for context, e.g. "sites/my-project"
    const parts = cwd.replace(/\/$/, '').split('/').filter(Boolean);
    return parts.length > 1 ? parts.slice(-2).join('/') : parts[parts.length - 1] ?? '—';
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
