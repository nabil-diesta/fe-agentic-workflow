import { Injectable, signal, computed } from '@angular/core';
import { environment } from '../../../environments/environment';

const KEY_LISTENER = 'niesta_listener_url';
const KEY_NIESTA = 'niesta_api_url';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly listenerOverride = signal<string | null>(this.load(KEY_LISTENER));
  private readonly niestaOverride = signal<string | null>(this.load(KEY_NIESTA));

  readonly listenerUrl = computed(() => {
    const o = this.listenerOverride();
    return (o && o.trim()) || environment.listenerUrl;
  });
  readonly niestaUrl = computed(() => {
    const o = this.niestaOverride();
    return (o && o.trim()) || environment.niestaUrl;
  });

  private load(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setListenerUrl(url: string): void {
    this.listenerOverride.set(url || null);
    try {
      if (url) localStorage.setItem(KEY_LISTENER, url);
      else localStorage.removeItem(KEY_LISTENER);
    } catch {}
  }

  setNiestaUrl(url: string): void {
    this.niestaOverride.set(url || null);
    try {
      if (url) localStorage.setItem(KEY_NIESTA, url);
      else localStorage.removeItem(KEY_NIESTA);
    } catch {}
  }
}
