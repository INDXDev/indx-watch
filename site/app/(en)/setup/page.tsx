import '../../setup.css';
import { Setup } from '@/components/setup';
import { en } from '@/content/en';
import { setupEn } from '@/content/setup-en';
import { setupMetadata } from '@/lib/metadata';

export const metadata = setupMetadata(setupEn);

export default function Page() {
  return <Setup t={en} s={setupEn} />;
}
