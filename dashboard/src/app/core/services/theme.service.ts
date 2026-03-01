import { Injectable, signal, computed } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'niesta_theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly stored = signal<Theme | null>(this.loadStored());
  readonly theme = computed(() => this.stored() ?? 'light');

  private loadStored(): Theme | null {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light') return v;
    return null;
  }

  setTheme(value: Theme): void {
    this.stored.set(value);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', value);
    }
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {}
  }

  toggle(): void {
    this.setTheme(this.theme() === 'dark' ? 'light' : 'dark');
  }

  init(): void {
    document.documentElement.setAttribute('data-theme', this.theme());
  }
}
