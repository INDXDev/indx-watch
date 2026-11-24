/**
 * Primitives of the landing page: section header, text link, logo and icons. Every section is built from
 * these and the classes in app/globals.css (§3); site/DESIGN.md says when to use which.
 */
import type { ReactNode } from 'react';
import { Rich } from './rich';

/** Kicker, heading and lead of a section: stacked (default), split (title left, lead right) or centered. */
export function SectionHead({
  id,
  kicker,
  title,
  lead,
  layout = 'stack',
  link,
}: {
  id: string;
  kicker?: string;
  title: string;
  lead?: string;
  layout?: 'stack' | 'split' | 'center';
  link?: { label: string; href: string };
}) {
  const heading = (
    <div>
      {kicker && <p className="kicker">{kicker}</p>}
      <h2 id={id} className="h2">
        {title}
      </h2>
    </div>
  );
  const body = (lead || link) && (
    <div>
      {lead && (
        <p className="lead">
          <Rich text={lead} />
        </p>
      )}
      {link && <TextLink href={link.href}>{link.label}</TextLink>}
    </div>
  );
  return (
    <header className={`section-head ${layout === 'stack' ? '' : `section-head-${layout}`}`}>
      {heading}
      {body}
    </header>
  );
}

/** "Learn more →" style link. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="text-link" href={href}>
      {children}
      <span className="arrow" aria-hidden="true">
        →
      </span>
    </a>
  );
}

/** The INDX Watch mark. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 16 16" aria-hidden="true">
      <rect width="16" height="16" rx="3.5" />
      <path d="M4 8.5l2.5 2.5L12 5" />
    </svg>
  );
}

export function GitHubIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" style={{ stroke: 'none' }}>
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

const PATHS: Record<string, ReactNode> = {
  define: (
    <>
      <path d="M4 1.8h5.2L12.5 5v9.2H4z" />
      <path d="M9 1.8V5h3.5M6.2 8.2h4M6.2 10.8h4" />
    </>
  ),
  run: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="2.2" />
      <path d="m5.2 8.2 1.9 1.9 3.7-4.1" />
    </>
  ),
  decide: <path d="M2.5 13.5h11M4.5 11V8.5M8 11V4.5M11.5 11V6.5" />,
  delegate: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="m4.8 6.3 2 1.7-2 1.7M8.5 10h2.7" />
    </>
  ),
  data: (
    <>
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </>
  ),
  sync: <path d="M13 6.5A5 5 0 0 0 3.6 5M3 9.5A5 5 0 0 0 12.4 11M3.4 2.5V5h2.5M12.6 13.5V11h-2.5" />,
  people: (
    <>
      <circle cx="6" cy="5.5" r="2.3" />
      <path d="M1.8 13.5c.4-2.4 2.1-3.8 4.2-3.8s3.8 1.4 4.2 3.8M10.6 3.4a2.3 2.3 0 0 1 0 4.3M12 9.9c1.2.5 2 1.7 2.2 3.6" />
    </>
  ),
  audit: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.3 1.6" />
    </>
  ),
  secret: (
    <>
      <rect x="3" y="7" width="10" height="7" rx="1.8" />
      <path d="M5.3 7V5a2.7 2.7 0 0 1 5.4 0v2" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="6.3" />
      <path d="M1.7 8h12.6M8 1.7c1.7 1.8 2.6 3.9 2.6 6.3S9.7 12.5 8 14.3M8 1.7C6.3 3.5 5.4 5.6 5.4 8s.9 4.5 2.6 6.3" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
