import { Component, OnInit, OnDestroy, signal, computed, ChangeDetectorRef, inject } from '@angular/core';

interface TocSection {
  id: string;
  label: string;
}

export type DiagramPhase = 'planning' | 'gate' | 'coding' | 'docs';

interface PhaseDetail {
  id: DiagramPhase;
  label: string;
  color: string;
  icon: string;
  steps: { num: string; name: string; desc: string }[];
  summary: string;
}

@Component({
  selector: 'app-guide',
  standalone: true,
  imports: [],
  templateUrl: './guide.component.html',
  styleUrl: './guide.component.scss',
})
export class GuideComponent implements OnInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);

  readonly activeSection = signal<string>('how-it-works');
  readonly underHoodOpen = signal(false);
  readonly selectedPhase = signal<DiagramPhase>('planning');

  readonly phases: PhaseDetail[] = [
    {
      id: 'planning',
      label: 'Planning',
      color: '#6366f1',
      icon: '🧠',
      summary: 'OpenAI analyses the Jira ticket and produces five structured planning documents. Each step feeds its output into the next. Takes ~25 seconds total.',
      steps: [
        { num: '1', name: 'Kickoff',     desc: 'Plain-English summary of what changes, why, and who is affected.' },
        { num: '2', name: 'Scope',       desc: 'In scope / out of scope / assumptions — the guardrails for the work.' },
        { num: '3', name: 'Impact Map',  desc: 'Every component, service, route and API contract affected.' },
        { num: '4', name: 'Risk Pass',   desc: 'Security, data, performance, compliance risks — each rated LOW/MEDIUM/HIGH.' },
        { num: '5', name: 'Test Plan',   desc: 'Jest unit tests, Playwright E2E tests, and regression targets.' },
      ],
    },
    {
      id: 'gate',
      label: 'Approval',
      color: '#f59e0b',
      icon: '✋',
      summary: 'The pipeline pauses here — indefinitely. Review every planning step, edit outputs if needed, then approve. No code is written until you click Approve.',
      steps: [
        { num: '—', name: 'Review',  desc: 'Read all five planning steps. Edit or rerun any step that missed the mark.' },
        { num: '—', name: 'Approve', desc: 'Click "Approve Plan & Start Coding". The pipeline immediately continues.' },
      ],
    },
    {
      id: 'coding',
      label: 'Coding',
      color: '#22c55e',
      icon: '⚡',
      summary: 'Codex CLI runs locally in your repo with the full context from planning. Step 6 implements; Step 7 validates by running your test suite.',
      steps: [
        { num: '6', name: 'Implement', desc: 'Codex reads your codebase and makes targeted changes within the agreed scope.' },
        { num: '7', name: 'Validate',  desc: 'Codex resumes the same thread, runs Jest and Playwright, reports results.' },
      ],
    },
    {
      id: 'docs',
      label: 'Docs & PR',
      color: '#a855f7',
      icon: '📄',
      summary: 'OpenAI generates all the written artefacts you need to close the ticket and raise the PR — nothing to write yourself.',
      steps: [
        { num: '8', name: 'Document', desc: 'Jira comment, follow-up ticket suggestions, and notes for reviewers.' },
        { num: '9', name: 'PR Prep',  desc: 'PR title, full markdown description, file change summary, rollback plan.' },
      ],
    },
  ];

  readonly activePhase = computed(() =>
    this.phases.find(p => p.id === this.selectedPhase())!
  );

  readonly sections: TocSection[] = [
    { id: 'how-it-works',    label: 'How It Works' },
    { id: 'the-9-steps',     label: 'The 9 Steps' },
    { id: 'starting',        label: 'Starting a Pipeline' },
    { id: 'approval-gate',   label: 'The Approval Gate' },
    { id: 'while-coding',    label: 'While Codex is Working' },
    { id: 'what-you-get',    label: 'What You Get' },
    { id: 'tips',            label: 'Tips' },
    { id: 'under-the-hood',  label: 'Under the Hood' },
    { id: 'setup',           label: 'Setup' },
  ];

  private observer: IntersectionObserver | null = null;

  ngOnInit(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.activeSection.set(entry.target.id);
            this.cdr.markForCheck();
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    );

    for (const s of this.sections) {
      const el = document.getElementById(s.id);
      if (el) this.observer.observe(el);
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  selectPhase(id: DiagramPhase): void {
    this.selectedPhase.set(id);
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  toggleUnderHood(): void {
    this.underHoodOpen.update(v => !v);
  }
}
