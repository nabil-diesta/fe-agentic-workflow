import { Component, inject, signal, computed } from '@angular/core';
import { ThemeService } from '../../core/services/theme.service';
import { SettingsService } from '../../core/services/settings.service';
import { ApiService, Workdir } from '../../core/services/api.service';

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
  private readonly api = inject(ApiService);

  listenerUrl = signal('');
  niestaUrl = signal('');

  readonly isDark = computed(() => this.theme.theme() === 'dark');

  readonly workdirs = signal<Workdir[]>([]);
  readonly workdirsLoading = signal(false);
  readonly newWorkdirLabel = signal('');
  readonly newWorkdirPath = signal('');

  constructor() {
    this.listenerUrl.set(this.settings.listenerUrl());
    this.niestaUrl.set(this.settings.niestaUrl());
    this.loadWorkdirs();
  }

  save(): void {
    this.settings.setListenerUrl(this.listenerUrl().trim());
    this.settings.setNiestaUrl(this.niestaUrl().trim());
  }

  setDark(value: boolean): void {
    this.theme.setTheme(value ? 'dark' : 'light');
  }

  loadWorkdirs(): void {
    this.workdirsLoading.set(true);
    this.api.getWorkdirs().subscribe((dirs) => {
      this.workdirsLoading.set(false);
      if (dirs) this.workdirs.set(dirs);
    });
  }

  addWorkdir(): void {
    const label = this.newWorkdirLabel().trim();
    const path = this.newWorkdirPath().trim();
    if (!label || !path) return;
    this.api.addWorkdir(label, path).subscribe((dirs) => {
      if (dirs) {
        this.workdirs.set(dirs);
        this.newWorkdirLabel.set('');
        this.newWorkdirPath.set('');
      }
    });
  }

  removeWorkdir(path: string): void {
    this.api.removeWorkdir(path).subscribe((dirs) => {
      if (dirs) this.workdirs.set(dirs);
    });
  }
}
