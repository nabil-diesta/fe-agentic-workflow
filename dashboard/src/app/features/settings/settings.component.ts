import { Component, inject, signal, computed } from '@angular/core';
import { ThemeService } from '../../core/services/theme.service';
import { SettingsService } from '../../core/services/settings.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  readonly theme = inject(ThemeService);
  readonly settings = inject(SettingsService);

  listenerUrl = signal('');
  niestaUrl = signal('');

  readonly isDark = computed(() => this.theme.theme() === 'dark');

  constructor() {
    // Init from stored/env values
    this.listenerUrl.set(this.settings.listenerUrl());
    this.niestaUrl.set(this.settings.niestaUrl());
  }

  save(): void {
    this.settings.setListenerUrl(this.listenerUrl().trim());
    this.settings.setNiestaUrl(this.niestaUrl().trim());
  }

  setDark(value: boolean): void {
    this.theme.setTheme(value ? 'dark' : 'light');
  }
}
