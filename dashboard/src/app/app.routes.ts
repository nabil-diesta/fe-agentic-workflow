import { Routes } from '@angular/router';
import { ShellComponent } from './layout/shell/shell.component';

export const routes: Routes = [
  { path: '', redirectTo: 'sprint', pathMatch: 'full' },
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: 'sprint', loadComponent: () => import('./features/sprint/sprint.component').then((m) => m.SprintComponent) },
      { path: 'active', loadComponent: () => import('./features/active/active.component').then((m) => m.ActiveComponent) },
      { path: 'chat', loadComponent: () => import('./features/chat/chat.component').then((m) => m.ChatComponent) },
      { path: 'sessions', loadComponent: () => import('./features/sessions/sessions.component').then((m) => m.SessionsComponent) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent) },
      { path: 'thread/:threadId', loadComponent: () => import('./features/thread/thread.component').then((m) => m.ThreadComponent) },
    ],
  },
  { path: '**', redirectTo: 'sprint' },
];
