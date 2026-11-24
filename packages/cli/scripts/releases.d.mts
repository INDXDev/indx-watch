export interface ReleaseEntry {
  version: string;
  date?: string;
  breaking: boolean;
  schema_version: number;
  migrate: boolean;
  notes: string;
}
export function releasesFromChangelog(text: string): { releases: ReleaseEntry[] };
