import '../../../setup.css';
import { Setup } from '@/components/setup';
import { ja } from '@/content/ja';
import { setupJa } from '@/content/setup-ja';
import { setupMetadata } from '@/lib/metadata';

export const metadata = setupMetadata(setupJa);

export default function Page() {
  return <Setup t={ja} s={setupJa} />;
}
