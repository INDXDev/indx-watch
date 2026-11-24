'use client';

/**
 * Who is reading: developer, tester or product manager. The hero switch and the tabs of the roles section
 * set it; the hero, the demo, the roles section and the closing call to action follow it. The choice is kept
 * in the URL (?for=tester), so a link can open the page for one role, and in localStorage for the next visit.
 * The static HTML renders the developer view; the reader's choice applies after hydration.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { ROLES, type Role } from '@/content/types';

const KEY = 'iw-site-role';

interface RoleState {
  role: Role;
  /** Bumped on every choice the reader makes, so the demo can jump to that role's chapter. */
  picked: number;
  setRole: (role: Role) => void;
}

const RoleContext = createContext<RoleState>({ role: 'developer', picked: 0, setRole: () => {} });

const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setState] = useState<Role>('developer');
  const [picked, setPicked] = useState(0);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('for');
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(KEY);
    } catch {}
    const initial = isRole(fromUrl) ? fromUrl : isRole(stored) ? stored : null;
    if (initial && initial !== 'developer') {
      setState(initial);
      setPicked((n) => n + 1);
    }
  }, []);

  const setRole = useCallback((next: Role) => {
    setState(next);
    setPicked((n) => n + 1);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {}
    const url = new URL(window.location.href);
    if (next === 'developer') url.searchParams.delete('for');
    else url.searchParams.set('for', next);
    window.history.replaceState(null, '', url);
  }, []);

  return <RoleContext.Provider value={{ role, picked, setRole }}>{children}</RoleContext.Provider>;
}

export const useRole = () => useContext(RoleContext);

/** A segmented control of the three roles (radio semantics: one is always chosen). */
export function RoleSwitch({
  label,
  names,
  className,
}: {
  label: string;
  names: Record<Role, string>;
  className?: string;
}) {
  const { role, setRole } = useRole();
  function onKey(e: React.KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = ROLES[(i + step + ROLES.length) % ROLES.length];
    setRole(next);
    const group = (e.currentTarget as HTMLElement).parentElement;
    group?.querySelector<HTMLButtonElement>(`[data-role="${next}"]`)?.focus();
  }
  return (
    <div className={`segmented ${className ?? ''}`} role="radiogroup" aria-label={label}>
      {ROLES.map((r, i) => (
        <button
          key={r}
          type="button"
          role="radio"
          data-role={r}
          aria-checked={role === r}
          tabIndex={role === r ? 0 : -1}
          onClick={() => setRole(r)}
          onKeyDown={(e) => onKey(e, i)}
        >
          <RoleIcon role={r} />
          {names[r]}
        </button>
      ))}
    </div>
  );
}

export function RoleIcon({ role }: { role: Role }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      {role === 'developer' && <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" />}
      {role === 'tester' && (
        <>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="m5.2 8.2 1.9 1.9 3.8-4.2" />
        </>
      )}
      {role === 'product' && <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />}
    </svg>
  );
}

/** The text for the reader's role (the developer's in the static HTML). */
export function RoleText({ text }: { text: Record<Role, string> }) {
  const { role } = useRole();
  return <>{text[role]}</>;
}

/** Children only for the listed roles. */
export function ForRoles({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role } = useRole();
  return roles.includes(role) ? <>{children}</> : null;
}

/** A panel shown for one role; the others stay in the HTML, hidden. */
export function RolePanel({ role, children, className }: { role: Role; children: ReactNode; className?: string }) {
  const current = useRole().role;
  return (
    <div className={className} hidden={current !== role} data-role-panel={role}>
      {children}
    </div>
  );
}

/** A link whose label and target follow the reader's role. */
export function RoleLink({ links, className }: { links: Record<Role, { label: string; href: string }>; className?: string }) {
  const { role } = useRole();
  const link = links[role];
  return (
    <a className={className} href={link.href}>
      {link.label}
    </a>
  );
}
