import '../globals.css';
import '../demo.css';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { ReactNode } from 'react';

export { viewport } from '@/lib/metadata';

/** Root layout of the English page. Japanese has its own root layout, so each page gets the right <html lang>. */
export default function EnglishLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
