import '../../globals.css';
import '../../demo.css';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { ReactNode } from 'react';

export { viewport } from '@/lib/metadata';

export default function JapaneseLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
