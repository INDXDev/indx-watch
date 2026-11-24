import { Landing } from '@/components/landing';
import { ja } from '@/content/ja';
import { pageMetadata } from '@/lib/metadata';

export const metadata = pageMetadata(ja);

export default function Page() {
  return <Landing t={ja} />;
}
