import '../../globals.css';
import type { ReactNode } from 'react';

export { viewport } from '@/lib/metadata';

export default function JapaneseLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
