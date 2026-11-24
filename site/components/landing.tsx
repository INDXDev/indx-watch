/**
 * The landing page, in either language: site chrome around the sections in components/landing/. All words
 * come from the Content object (content/en.ts, content/ja.ts).
 */
import type { Content } from '@/content/types';
import { Agents, Roles } from './landing/agents';
import { SiteFooter, SiteHeader } from './landing/chrome';
import { Cta, Hero, Problem } from './landing/hero';
import { How } from './landing/how';
import { Compare, Dx, Faq, Gallery, SelfHost } from './landing/product';

/** The whole landing page for the language of `t`. */
export function Landing({ t }: { t: Content }) {
  return (
    <>
      <SiteHeader t={t} />

      <main id="main">
        <Hero t={t} />

        <Problem t={t} />

        <How t={t} />

        <Roles t={t} />

        <Agents t={t} />

        <Dx t={t} />

        <Gallery t={t} />

        <Compare t={t} />

        <SelfHost t={t} />

        <Faq t={t} />

        <Cta t={t} />
      </main>

      <SiteFooter t={t} />
    </>
  );
}
