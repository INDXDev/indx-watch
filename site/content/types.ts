/**
 * The words of the landing page, one object per language. Inline `code` and **bold** are rendered by
 * components/rich.tsx; everything else is plain text. In muted body text, **bold** is the phrase shown in
 * full ink (site/DESIGN.md#copy).
 */
export type Locale = 'en' | 'ja';

/** Who is reading. The hero switch sets it; the hero, the demo, the roles section and the closing follow. */
export type Role = 'developer' | 'tester' | 'product';
export const ROLES: Role[] = ['developer', 'tester', 'product'];

export interface Link {
  label: string;
  href: string;
}

export interface Benefit {
  title: string;
  body: string;
}

/** One line of the agent terminal in the demo. */
export interface TermLine {
  kind: 'tool' | 'result' | 'text' | 'list' | 'note';
  text: string;
}

export interface DemoText {
  label: string;
  play: string;
  pause: string;
  chapters: { title: string; caption: string }[];
  /** The web app's own words in this language (packages/web/src/messages). */
  app: {
    nav: string[];
    allEnvironments: string;
    upload: string;
    pass: string;
    fail: string;
    notTested: string;
    draft: string;
    manual: string;
    justNow: string;
    hoursAgo: string;
  };
  /** 1 — design tests with the agent. */
  design: {
    welcome: string;
    cwd: string;
    ask: string;
    read: TermLine[];
    proposal: TermLine[];
    reply: string;
    write: TermLine[];
    done: string;
    shell: string;
    approved: string;
  };
  /** 2 — Playwright in CI and the pull request. */
  ci: {
    prTitle: string;
    prMeta: string;
    commentHead: string;
    verdict: string;
    checks: { label: string; now: string; needed: string; pass: boolean }[];
    suggested: string;
    suggestedItems: { key: string; title: string; why: string }[];
    checksTitle: string;
    checkRows: { name: string; detail: string; pass: boolean }[];
  };
  /** 3 — a manual run in the browser. */
  run: {
    title: string;
    purpose: string;
    criterion: string;
    eyebrow: string;
    reading: string;
    steps: { text: string; expected: string; check: string }[];
    expected: string;
    stepsTitle: string;
    what: string;
    verdicts: string[];
    allChecked: string;
    addShot: string;
    next: string;
    save: string;
    shotCaption: string;
    signIn: string;
    error: string;
    result: string;
    resultLine: string;
    resultBefore: string;
    featureLine: string;
    position: string;
    runManually: string;
    cancel: string;
    saved: string;
  };
  /** 4 — readiness and the report. */
  ship: {
    eyebrow: string;
    release: string;
    notReady: string;
    ready: string;
    progressBefore: string;
    progressAfter: string;
    start: string;
    share: string;
    cards: string[];
    activity: string;
    activityItems: { who: string; initials: string; did: string; key: string; title: string; ci?: boolean }[];
    ask: string;
    answer: string;
    reportTitle: string;
    reportMeta: string;
    reportVerdict: string;
    reportActions: string[];
    queue: string;
    seeFailure: string;
    queueEmpty: string;
    reportScreen: string;
    audience: string;
    customerHint: string;
    reportChecks: { label: string; now: string; needed: string }[];
  };
}

export interface Content {
  locale: Locale;
  path: '/' | '/ja/';
  meta: { title: string; description: string; ogAlt: string };
  nav: {
    product: string;
    roles: string;
    platform: string;
    compare: string;
    faq: string;
    docs: string;
    github: string;
    getStarted: string;
    setup: string;
    team: string;
    menu: string;
    otherLanguage: string;
    otherLanguageLabel: string;
    skip: string;
  };
  hero: {
    badge: string;
    badgeLink: string;
    title: string;
    roleLabel: string;
    roles: Record<Role, string>;
    lead: Record<Role, string>;
    primary: Record<Role, Link>;
    secondary: Record<Role, Link>;
    copy: string;
    copied: string;
    note: string;
  };
  demo: DemoText;
  worksWith: { label: string; items: string[] };
  features: {
    kicker: string;
    title: string;
    lead: string;
    items: { tag: string; title: string; body: string; points: string[] }[];
    visuals: {
      tree: { path: string; note?: string; status?: string }[];
      runs: { who: string; initials: string; kind: string; did: string; key: string; title: string; meta: string; tone: 'pass' | 'fail' | 'review' }[];
      gate: { label: string; now: string; needed: string; pass: boolean }[];
      gateVerdict: string;
      chat: { you: string; agent: string };
    };
  };
  roles: {
    kicker: string;
    title: string;
    lead: string;
    sayLabel: string;
    approveLabel: string;
    tabs: Record<
      Role,
      {
        title: string;
        lead: string;
        benefits: Benefit[];
        say: string[];
        approve: string;
        cta: Link;
        image: string;
        imageAlt: string;
      }
    >;
  };
  /** Two-tone statement (first sentence in ink, the rest muted), then before/after rows. */
  why: {
    kicker: string;
    strong: string;
    rest: string;
    before: string;
    after: string;
    rows: { before: string; after: string }[];
  };
  /** The dark band: agent conversations, the six skills and who may do what. */
  agents: {
    kicker: string;
    title: string;
    lead: string;
    you: string;
    agent: string;
    conversations: { title: string; lines: { who: 'you' | 'agent'; text: string }[] }[];
    skillsTitle: string;
    skills: { skill: string; job: string; say: string }[];
    agentDoes: string;
    agentItems: string[];
    personDoes: string;
    personItems: string[];
    guide: Link;
  };
  strengths: {
    kicker: string;
    title: string;
    lead: string;
    github: Benefit & { checks: { name: string; detail: string; pass: boolean }[]; link: Link };
    items: (Benefit & { icon: 'data' | 'sync' | 'people' | 'audit' | 'secret' })[];
  };
  /** The GitHub-to-Cloudflare flow, after Vercel's "Develop. Preview. Ship." row; the same seven steps as the guide's diagram. */
  selfHost: {
    kicker: string;
    title: string;
    lead: string;
    steps: { title: string; body: string }[];
    note: string;
    code: string;
    guide: Link;
  };
  /** Open source and self-hosting, after Supabase's "Open source from day one". */
  openSource: {
    kicker: string;
    title: string;
    body: string;
    github: string;
    hosts: { title: string; body: string; code: string }[];
  };
  compare: {
    kicker: string;
    title: string;
    lead: string;
    columns: string[];
    rows: { label: string; cells: string[] }[];
    yes: string;
    no: string;
    note: string;
  };
  start: {
    kicker: string;
    title: string;
    lead: string;
    steps: { title: string; body: string; code: string }[];
    sample: string;
    sampleCode: string;
    guide: Link;
  };
  faq: { kicker: string; title: string; items: { q: string; a: string }[] };
  cta: { title: string; lead: string; demo: string; github: string };
  footer: {
    tagline: string;
    columns: { title: string; links: Link[] }[];
    copyright: string;
  };
}

/** One block on the right of a setup step: a terminal, a file, an agent chat, a screenshot or a PR comment. */
export type SetupBlock =
  | { kind: 'terminal'; title?: string; code: string }
  | { kind: 'file'; file: string; code: string }
  | { kind: 'chat'; lines: { who: 'you' | 'agent'; text: string }[] }
  | { kind: 'shot'; image: string; alt: string }
  | { kind: 'pr'; title: string; lines: { tone: 'pass' | 'fail' | 'info'; text: string }[] };

export interface SetupStep {
  id: string;
  title: string;
  /** who does it and how often, e.g. "Developer · once" */
  who: string;
  body: string;
  /** what the reader sees when the step worked, so nobody moves on with a broken step */
  done: string;
  items?: string[];
  note?: string;
  link?: Link;
  blocks: SetupBlock[];
}

/** The labels a step and its blocks need, shared by the setup guide and the team guide. */
export interface StepLabels {
  copy: string;
  copied: string;
  you: string;
  agent: string;
  step: string;
  doneLabel: string;
}

/** A flow played like the demo: nodes joined by labelled arrows, one caption per node. */
export interface FlowContent {
  nodes: { title: string; caption: string; items: string[] }[];
  edges: string[];
  label: string;
  play: string;
  pause: string;
  captions: string[];
}

/** The words of the setup guide (/setup/, /ja/setup/), one object per language. */
export interface SetupContent {
  locale: Locale;
  path: '/setup/' | '/ja/setup/';
  meta: { title: string; description: string };
  hero: { kicker: string; title: string; lead: string; primary: Link; secondary: Link };
  toc: string;
  needs: { title: string; items: string[] };
  paths: { title: string; lead: string; items: { title: string; steps: string; body: string }[] };
  arch: {
    kicker: string;
    title: string;
    lead: string;
    nodes: { title: string; caption: string; items: string[] }[];
    edges: string[];
    stores: { what: string; where: string }[];
    storesTitle: string;
  };
  phases: { id: string; kicker: string; title: string; lead: string; steps: SetupStep[] }[];
  daily: { kicker: string; title: string; lead: string; steps: { title: string; body: string }[] };
  recipes: { kicker: string; title: string; lead: string; items: { title: string; body: string; code: string; link?: Link }[] };
  trouble: { kicker: string; title: string; head: [string, string]; rows: { symptom: string; fix: string }[] };
  closing: { title: string; lead: string; demo: string };
  copy: string;
  copied: string;
  you: string;
  agent: string;
  step: string;
  /** label of the success line under each step */
  doneLabel: string;
  /** the animated walk through the architecture: one caption per node */
  flow: { label: string; play: string; pause: string; captions: string[] };
}

/** The words of the team guide (/team/, /ja/team/): daily work by role, one object per language. */
export interface TeamContent {
  locale: Locale;
  path: '/team/' | '/ja/team/';
  meta: { title: string; description: string };
  hero: { kicker: string; title: string; lead: string; setup: Link };
  pick: { title: string; roles: { id: string; title: string; who: string; jobs: string[] }[] };
  cycle: { kicker: string; title: string; lead: string; flow: FlowContent };
  roles: { id: string; kicker: string; title: string; lead: string; steps: SetupStep[] }[];
  matrix: { kicker: string; title: string; lead: string; cols: string[]; rows: { task: string; cells: string[] }[]; yes: string };
  people: { kicker: string; title: string; lead: string; items: { title: string; body: string; code: string }[] };
  closing: { title: string; lead: string; demo: string; setup: string };
  labels: StepLabels;
}
