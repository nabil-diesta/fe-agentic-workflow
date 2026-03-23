import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked, type Renderer } from 'marked';
import hljs from 'highlight.js';

// Configure marked once with highlight.js for code blocks
const renderer: Partial<Renderer> = {
  code({ text, lang }: { text: string; lang?: string }): string {
    const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
    const highlighted = hljs.highlight(text, { language }).value;
    return `<pre class="hljs-pre"><code class="hljs language-${language}">${highlighted}</code></pre>`;
  },
};

marked.use({ renderer });

@Pipe({ name: 'markdown', standalone: true })
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(value: string): SafeHtml {
    if (!value) return '';
    const html = (marked.parse as (src: string, opts?: { async: false }) => string)(value, { async: false });
    return this.sanitizer.bypassSecurityTrustHtml(html ?? '');
  }
}
