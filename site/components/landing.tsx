/**
 * The landing page, in either language. Section order and the reference each section follows:
 * site/DESIGN.md. All words come from the Content object (content/en.ts, content/ja.ts).
 */
import type { Content } from '@/content/types';
import { SiteFooter, SiteHeader } from './landing/chrome';
import { Features } from './landing/features';
import { Hero } from './landing/hero';
import { Roles } from './landing/roles';
import { Agents, Closing, Compare, Faq, OpenSource, Start, Strengths, Why, WorksWith } from './landing/sections';
import { RoleProvider } from './role';

export function Landing({ t }: { t: Content }) {
  return (
    <RoleProvider>
      <SiteHeader t={t} />
      <main id="main">
        <Hero t={t} />
        <WorksWith t={t} />
        <Features t={t} />
        <Roles t={t} />
        <Why t={t} />
        <Agents t={t} />
        <Strengths t={t} />
        <OpenSource t={t} />
        <Compare t={t} />
        <Start t={t} />
        <Faq t={t} />
        <Closing t={t} />
      </main>
      <SiteFooter t={t} />
    </RoleProvider>
  );
}
