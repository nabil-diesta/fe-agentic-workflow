import { Component, inject, signal, viewChild, ElementRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { MarkdownPipe } from '../../core/pipes/markdown.pipe';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [MarkdownPipe],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly messages = signal<ChatMessage[]>([]);
  readonly loading = signal(false);
  readonly inputValue = signal('');
  inputEl = viewChild<ElementRef<HTMLTextAreaElement>>('inputEl');

  constructor() {
    const q = this.route.snapshot.queryParamMap.get('message');
    if (q) this.inputValue.set(q);
  }

  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  send(): void {
    const text = this.inputValue().trim();
    if (!text || this.loading()) return;
    this.messages.update((m) => [...m, { role: 'user', content: text }]);
    this.inputValue.set('');
    this.loading.set(true);
    this.api.chatWithNiesta(text).subscribe((res) => {
      this.loading.set(false);
      const reply = res?.response ?? 'No response from Niesta.';
      this.messages.update((m) => [...m, { role: 'assistant', content: reply }]);
      this.scrollToBottom();
    });
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const container = document.querySelector('.chat-messages');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 0);
  }
}
