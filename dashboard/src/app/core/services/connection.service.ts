import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { interval, catchError, switchMap, of } from 'rxjs';
import { SettingsService } from './settings.service';

const POLL_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class ConnectionService {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(SettingsService);

  readonly listenerOnline = signal<boolean>(false);

  constructor() {
    interval(POLL_MS)
      .pipe(
        switchMap(() =>
          this.http.get<{ status?: string }>(`${this.settings.listenerUrl()}/health`, {
            responseType: 'json',
          }).pipe(
            catchError(() => of(null))
          )
        )
      )
      .subscribe((res) => {
        this.listenerOnline.set(res?.status === 'ok');
      });
    // Initial check
    this.http
      .get<{ status?: string }>(`${this.settings.listenerUrl()}/health`, { responseType: 'json' })
      .pipe(catchError(() => of(null)))
      .subscribe((res) => this.listenerOnline.set(res?.status === 'ok'));
  }
}
