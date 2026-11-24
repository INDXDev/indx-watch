// Turns CHANGELOG.md into the releases.json that ships in the package (read by `iw doctor` and `iw update`;
// docs/spec/cli.md#iw-doctor). Newest first; the Unreleased section is left out.
//   breaking        a "### Breaking" or "### Removed" section, or a bullet that starts with **Breaking
//   schema_version  <!-- iw-release: schema_version=2 migrate --> in the section, else the older release's, else 1
//   migrate         the same marker's word `migrate`
//   notes           the section as Markdown, cut at a line boundary below 3,000 characters
const MAX_NOTES = 3000;

export function releasesFromChangelog(text) {
  const sections = [
    ...text.matchAll(
      /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\](?: - (\d{4}-\d{2}-\d{2}))?[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/gm,
    ),
  ];
  const releases = sections.map(([, version, date, body]) => {
    const marker = /<!--\s*iw-release:([^>]*?)-->/.exec(body)?.[1] ?? '';
    const notes = cut(body.replace(/<!--[\s\S]*?-->/g, '').trim());
    return {
      version,
      ...(date && { date }),
      breaking: /^### (Breaking|Removed)\b/m.test(body) || /^\s*- \*\*Breaking/m.test(body),
      schema_version: Number(/schema_version=(\d+)/.exec(marker)?.[1] ?? 0),
      migrate: /\bmigrate\b/.test(marker),
      notes,
    };
  });
  // a release without a marker keeps the schema_version of the next older one
  for (let i = releases.length - 1, last = 1; i >= 0; i--) {
    if (releases[i].schema_version === 0) releases[i].schema_version = last;
    last = releases[i].schema_version;
  }
  return { releases };
}

function cut(notes) {
  if (notes.length <= MAX_NOTES) return notes;
  const head = notes.slice(0, MAX_NOTES);
  return `${head.slice(0, head.lastIndexOf('\n'))}\n- …`;
}
