/** Version numbers `x.y.z[-pre]` (docs/spec/cli.md#iw-doctor): the one comparison of the server, `iw doctor` and `iw update`. */

const PARSE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Negative when `a` is older than `b`, positive when newer, 0 when equal; undefined when either is not a version. A pre-release is older than its release. */
export function compareVersions(a: string, b: string): number | undefined {
  const [x, y] = [PARSE.exec(a), PARSE.exec(b)];
  if (!x || !y) return undefined;
  for (const i of [1, 2, 3]) if (x[i] !== y[i]) return Number(x[i]) - Number(y[i]);
  if (x[4] === y[4]) return 0;
  return !x[4] ? 1 : !y[4] ? -1 : x[4] < y[4] ? -1 : 1;
}

/** Is `a` a version older than `b`? Anything that is not a version is never older. */
export const isOlderVersion = (a: string, b: string) => (compareVersions(a, b) ?? 0) < 0;
