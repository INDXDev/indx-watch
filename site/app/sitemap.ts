import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const languages = { en: `${SITE_URL}/`, ja: `${SITE_URL}/ja/` };
  const setup = { en: `${SITE_URL}/setup/`, ja: `${SITE_URL}/ja/setup/` };
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1, alternates: { languages } },
    { url: `${SITE_URL}/ja/`, changeFrequency: 'weekly', priority: 0.9, alternates: { languages } },
    { url: `${SITE_URL}/setup/`, changeFrequency: 'weekly', priority: 0.8, alternates: { languages: setup } },
    { url: `${SITE_URL}/ja/setup/`, changeFrequency: 'weekly', priority: 0.7, alternates: { languages: setup } },
  ];
}
