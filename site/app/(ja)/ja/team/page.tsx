import '../../../setup.css';
import { Team } from '@/components/team';
import { ja } from '@/content/ja';
import { teamJa } from '@/content/team-ja';
import { teamMetadata } from '@/lib/metadata';

export const metadata = teamMetadata(teamJa);

export default function Page() {
  return <Team t={ja} g={teamJa} />;
}
