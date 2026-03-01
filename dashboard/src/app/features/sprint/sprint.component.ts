import { Component, inject, signal, computed, effect } from '@angular/core';
import { ApiService, JiraTicket } from '../../core/services/api.service';

const AUTO_REFRESH_MS = 5 * 60 * 1000;

@Component({
  selector: 'app-sprint',
  standalone: true,
  imports: [],
  templateUrl: './sprint.component.html',
  styleUrl: './sprint.component.scss',
})
export class SprintComponent {
  private readonly api = inject(ApiService);

  readonly tickets = signal<JiraTicket[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly detailTicket = signal<JiraTicket | null>(null);
  readonly detailLoading = signal(false);

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

  private refreshEffect = effect(() => {
    this.load();
    const id = setInterval(() => this.load(), AUTO_REFRESH_MS);
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
