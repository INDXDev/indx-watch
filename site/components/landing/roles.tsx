/**
 * For teams (Clerk's tabbed sections): one tab per role, kept in step with the hero switch. Every panel is
 * in the HTML; the reader's role decides which one shows.
 */
import { PW_PATH, PW_TC3, TOML_PATH, TOML_TC3 } from '@/content/code';
import { type Content, ROLES } from '@/content/types';
import { CodePanel } from '../code';
import { Rich } from '../rich';
import { RolePanel, RoleSwitch } from '../role';
import { Screenshot } from '../screenshot';
import { SectionHead, TextLink } from '../ui';

/** The first lines of TC-3, enough to show the shape of a test case. */
const TOML_SHORT = TOML_TC3.split('\n[steps.i18n.ja]')[0].replace(/^#:schema.*\n\n/, '');

export function Roles({ t }: { t: Content }) {
  const r = t.roles;
  return (
    <section className="section section-subtle" aria-labelledby="roles">
      <div className="wrap">
        <SectionHead id="roles" kicker={r.kicker} title={r.title} lead={r.lead} />
        <RoleSwitch className="roles-tabs" label={r.kicker} names={t.hero.roles} />
        {ROLES.map((role) => {
          const tab = r.tabs[role];
          return (
            <RolePanel key={role} role={role} className="role-panel">
              <div>
                <h3>{tab.title}</h3>
                <p className="lead">
                  <Rich text={tab.lead} />
                </p>
                <ul className="benefits">
                  {tab.benefits.map((b) => (
                    <li key={b.title}>
                      <h4>{b.title}</h4>
                      <p>
                        <Rich text={b.body} />
                      </p>
                    </li>
                  ))}
                </ul>
                <dl className="role-meta">
                  <div>
                    <dt className="caption">{r.sayLabel}</dt>
                    <dd className="say">
                      {tab.say.map((s) => (
                        <q key={s}>{s}</q>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt className="caption">{r.approveLabel}</dt>
                    <dd>
                      <Rich text={tab.approve} />
                    </dd>
                  </div>
                </dl>
                <TextLink href={tab.cta.href}>{tab.cta.label}</TextLink>
              </div>
              <div className="role-visual">
                {role === 'developer' ? (
                  <>
                    <CodePanel file={TOML_PATH} code={TOML_SHORT} />
                    <CodePanel file={PW_PATH} code={PW_TC3} />
                  </>
                ) : (
                  <Screenshot name={tab.image} alt={tab.imageAlt} />
                )}
              </div>
            </RolePanel>
          );
        })}
      </div>
    </section>
  );
}
