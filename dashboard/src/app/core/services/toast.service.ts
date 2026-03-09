import { Injectable, signal } from '@angular/core';

const TOAST_DURATION_MS = 3000;

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal<string | null>(null);
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  show(msg: string): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.message.set(msg);
    this.timeoutId = setTimeout(() => {
      this.message.set(null);
      this.timeoutId = null;
    }, TOAST_DURATION_MS);
  }
}
