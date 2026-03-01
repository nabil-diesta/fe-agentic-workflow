import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

@Pipe({ name: 'markdown', standalone: true })
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(value: string): SafeHtml {
    if (!value) return '';
    const html = (marked.parse as (src: string, opts?: { async: false }) => string)(value, { async: false });
    return this.sanitizer.bypassSecurityTrustHtml(html ?? '');
  }
}
