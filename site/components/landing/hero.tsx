/**
 * The hero (Clerk, Linear): announcement chip, two-line headline, a lead and the buttons for the reader's
 * role, the role switch, then the product demo right below.
 */
import type { Content } from '@/content/types';
import { GITHUB_URL, INIT_COMMAND } from '@/lib/site';
import { CopyCommand } from '../copy-command';
import { Demo } from '../demo/player';
import { Rich } from '../rich';
import { ForRoles, RoleLink, RoleSwitch, RoleText } from '../role';

export function Hero({ t }: { t: Content }) {
  const h = t.hero;
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap">
        <a className="chip" href={GITHUB_URL}>
          <span className="chip-label">{h.badge}</span>
          {h.badgeLink}
          <span aria-hidden="true">→</span>
        </a>
        <h1 id="hero-title">{h.title}</h1>
        <p className="lead hero-lead" aria-live="polite">
          <RoleText text={h.lead} />
        </p>
        <div className="hero-row">
          <div className="hero-actions">
            <RoleLink className="btn btn-primary" links={h.primary} />
            <ForRoles roles={['developer']}>
              <CopyCommand command={INIT_COMMAND} copy={h.copy} copied={h.copied} />
            </ForRoles>
            <ForRoles roles={['tester', 'product']}>
              <RoleLink className="btn" links={h.secondary} />
            </ForRoles>
          </div>
          <div className="role-pick">
            <span id="role-label">{h.roleLabel}</span>
            <RoleSwitch label={h.roleLabel} names={h.roles} />
          </div>
        </div>
        <ForRoles roles={['developer']}>
          <p className="hero-note">
            <Rich text={h.note} />
          </p>
        </ForRoles>
        <Demo t={t.demo} />
      </div>
    </section>
  );
}
