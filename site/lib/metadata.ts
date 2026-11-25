import type { Metadata, Viewport } from 'next';
import type { Content, SetupContent } from '@/content/types';
import { SITE_URL } from './site';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#111418' },
  ],
};

/** What a page's metadata needs: its language, path and words. */
type PageInfo = Pick<Content, 'locale' | 'meta'> & { path: string };

export function pageMetadata(t: PageInfo): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    title: t.meta.title,
    description: t.meta.description,
    applicationName: 'INDX Watch',
    alternates: {
      canonical: t.path,
      languages: { en: '/', ja: '/ja/', 'x-default': '/' },
    },
    icons: { icon: { url: '/icon.svg', type: 'image/svg+xml' } },
    openGraph: {
      type: 'website',
      siteName: 'INDX Watch',
      url: t.path,
      title: t.meta.title,
      description: t.meta.description,
      locale: t.locale === 'ja' ? 'ja_JP' : 'en_US',
      alternateLocale: t.locale === 'ja' ? ['en_US'] : ['ja_JP'],
      images: [{ url: '/og.png', width: 1200, height: 630, alt: t.meta.ogAlt }],
    },
    twitter: {
      card: 'summary_large_image',
      title: t.meta.title,
      description: t.meta.description,
      images: ['/og.png'],
    },
  };
}

/** The setup guide's metadata: its own title, description and language alternates. */
export function setupMetadata(s: SetupContent): Metadata {
  const base = pageMetadata({ locale: s.locale, path: s.path, meta: { ...s.meta, ogAlt: s.meta.title } });
  return {
    ...base,
    alternates: { canonical: s.path, languages: { en: '/setup/', ja: '/ja/setup/', 'x-default': '/setup/' } },
  };
}
