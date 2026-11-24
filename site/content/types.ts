/**
 * The words of the landing page, one object per language. Inline `code` and **bold** are rendered by
 * components/rich.tsx; everything else is plain text.
 */
export type Locale = 'en' | 'ja';

export interface ChatLine {
  who: 'you' | 'agent';
  text: string;
}

export interface Conversation {
  title: string;
  lines: ChatLine[];
}

export interface Content {
  locale: Locale;
  path: '/' | '/ja/';
  meta: { title: string; description: string; ogAlt: string };
  nav: {
    how: string;
    roles: string;
    agents: string;
    compare: string;
    faq: string;
    docs: string;
    github: string;
    menu: string;
    otherLanguage: string;
    otherLanguageLabel: string;
    skip: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    copy: string;
    copied: string;
    demo: string;
    github: string;
    docs: string;
    note: string;
    imageAlt: string;
    chat: { you: string; agent: string };
  };
  problem: { kicker: string; title: string; lead: string; items: { title: string; body: string }[]; closing: string };
  how: {
    kicker: string;
    title: string;
    lead: string;
    steps: { title: string; body: string; code: string }[];
    split: {
      git: string;
      gitItems: string[];
      drive: string;
      driveItems: string[];
      gate: string;
      gateItems: { passed: boolean; text: string }[];
    };
  };
  roles: {
    kicker: string;
    title: string;
    lead: string;
    sayLabel: string;
    happensLabel: string;
    approveLabel: string;
    items: {
      role: string;
      who: string;
      say: string[];
      happens: string;
      approve: string;
      image?: string;
      imageAlt?: string;
    }[];
  };
  agents: {
    kicker: string;
    title: string;
    lead: string;
    you: string;
    agent: string;
    conversations: Conversation[];
    skillsTitle: string;
    skillHead: { job: string; claude: string; codex: string; say: string };
    skills: { job: string; skill: string; say: string }[];
    rulesTitle: string;
    agentDoes: string;
    agentItems: string[];
    personDoes: string;
    personItems: string[];
    guide: string;
  };
  dx: {
    kicker: string;
    title: string;
    lead: string;
    tomlCaption: string;
    pwCaption: string;
    jsonCaption: string;
    points: { title: string; body: string }[];
  };
  gallery: { kicker: string; title: string; lead: string; items: { image: string; alt: string; caption: string }[] };
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
  selfHost: {
    kicker: string;
    title: string;
    lead: string;
    items: { title: string; body: string; code: string }[];
    lockIn: { title: string; body: string }[];
  };
  faq: { kicker: string; title: string; items: { q: string; a: string }[] };
  cta: { title: string; lead: string };
  footer: { tagline: string; license: string; demo: string; docs: string; github: string; npm: string };
}
