import '../../setup.css';
import { Team } from '@/components/team';
import { en } from '@/content/en';
import { teamEn } from '@/content/team-en';
import { teamMetadata } from '@/lib/metadata';

export const metadata = teamMetadata(teamEn);

export default function Page() {
  return <Team t={en} g={teamEn} />;
}
