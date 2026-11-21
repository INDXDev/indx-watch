/** People (docs/spec/web.md#identity): avatars, names, verified marks, feed lines and relative times. */
import type { ReactNode } from 'react';
import { useI18n } from './i18n';

type Person = { kind: string; id: string; name?: string | undefined; via: string };
/** VERIFIED_VIA of @indx-watch/bundle (docs/spec/security.md#signed-records); the app does not import the bundle. */
const VERIFIED = new Set(['cloudflare-access', 'github-oidc', 'github', 'gitlab', 'circleci', 'buildkite']);
export const isVerified = (a: Person) => VERIFIED.has(a.via);
export const personName = (a: Person) => a.name ?? a.id;
/** Initials and a stable hue from the ID. Pure; tested. */
export function avatarOf(a: Person): { initials: string; hue: number } {
  const base = personName(a)
    .replace(/@.*/, '')
    .replace(/^[a-z]+:/i, '');
  const words = base.split(/[\s._-]+/).filter(Boolean);
  const initials = (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : base.slice(0, 2)).toUpperCase();
  let h = 0;
  for (const c of a.id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { initials: initials || '?', hue: h };
}
export function Avatar({ who, size }: { who: Person; size?: 'sm' | 'lg' }) {
  const { initials, hue } = avatarOf(who);
  const kind = who.kind === 'agent' ? ' avatar-agent' : who.kind === 'ci' ? ' avatar-ci' : '';
  return (
    <span
      className={`avatar${size ? ` avatar-${size}` : ''}${kind}`}
      style={{ '--hue': hue } as object}
      aria-hidden="true"
    >
      {who.kind === 'ci' ? '⚙' : who.kind === 'agent' ? '✦' : initials}
    </span>
  );
}
/** ✓ for a verified identity; "unverified" when a record claims one without a valid signature (docs/spec/web.md#identity). */
export function Mark({ who, unverified }: { who: Person; unverified?: boolean | undefined }) {
  const { t } = useI18n();
  if (!isVerified(who)) return null;
  return unverified ? (
    <span className="chip chip-warn" title={t('who.unsignedHint', { via: who.via })}>
      {t('who.unsigned')}
    </span>
  ) : (
    <span className="verified" title={t('who.verified', { via: who.via })}>
      ✓
    </span>
  );
}
type WhoProps = { who: Person; unverified?: boolean | undefined };
/** Avatar, name and a verified mark. */
export function Who({ who, unverified }: WhoProps) {
  return (
    <span className="who">
      <Avatar who={who} size="sm" />
      <span>{personName(who)}</span>
      <Mark who={who} unverified={unverified} />
    </span>
  );
}

/** One line of a feed: avatar, "<name> <verb> <link>", and when. */
export function FeedItem({ who, at, unverified, children }: WhoProps & { at: string; children: ReactNode }) {
  const ago = useAgo();
  return (
    <li className="feed-item">
      <Avatar who={who} />
      <div className="feed-main">
        <p>
          <strong>{personName(who)}</strong> <Mark who={who} unverified={unverified} /> {children}
        </p>
        <p className="muted small">{ago(at)}</p>
      </div>
    </li>
  );
}

const UNITS = [
  [86400, 'day'],
  [3600, 'hour'],
  [60, 'minute'],
  [1, 'second'],
] as const;
/** "5 min ago" in the UI locale; an absolute date beyond a week (or for future and invalid times). */
export function useAgo() {
  const { locale, date } = useI18n();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  return (iso: string) => {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!(s >= 0) || s > 7 * 86400) return date(iso);
    const [d, u] = UNITS.find(([n]) => s >= n) ?? UNITS[3];
    return rtf.format(-Math.floor(s / d), u);
  };
}
