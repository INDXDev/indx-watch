/** GitHub OIDC signing on the hosted server (docs/spec/security.md#github-oidc): the job's token in, our signature out. */
import { type AnyRecord, recordSigner } from '@indx-watch/bundle';
import { type GithubOidcClaims, type OidcVerifier, oidcAudience } from '@indx-watch/store';
import { HttpError } from './http.js';

/** Why the token's claims do not cover this record, if they do not. Pure; tested. */
export function claimsMismatch(r: AnyRecord, c: GithubOidcClaims, project: string): string | undefined {
  const { actor } = r;
  if (r.project !== project) return `${r.id} belongs to another project`;
  if (actor.via !== 'github-oidc' || actor.id !== `github:${c.actor}` || actor.kind === 'human')
    return `${r.id}: the actor is not github:${c.actor} via github-oidc`;
  const ci = r.kind === 'run' ? r.ci : undefined;
  if (ci && (ci.repository?.toLowerCase() !== c.repository.toLowerCase() || ci.run_id !== c.run_id))
    return `${r.id}: ci does not match the token's repository and run`;
}

/** The pinned repositories from the deploy's OIDC_REPOSITORIES (a JSON array); anything else pins none. */
export function pinnedRepositories(json: string | undefined): string[] {
  try {
    const v: unknown = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s) : [];
  } catch {
    return [];
  }
}

/** ServerDeps.signForGithub, or undefined (404) without a signing key or pinned repositories. */
export function githubOidcSigning(o: {
  verifier: OidcVerifier;
  repositories: readonly string[];
  secret?: string;
}) {
  if (!o.secret || !o.repositories.length) return undefined;
  return async (token: string, records: AnyRecord[], project: string) => {
    const c = await o.verifier.verify(token, oidcAudience(project));
    const pinned = (p: string) => p === c.repository_id || p.toLowerCase() === c.repository.toLowerCase();
    if (!o.repositories.some(pinned)) throw new HttpError(403, 'forbidden', `${c.repository} is not pinned`);
    for (const r of records) {
      const why = claimsMismatch(r, c, project);
      if (why) throw new HttpError(403, 'forbidden', why);
    }
    const sign = recordSigner(o.secret); // a malformed key fails this request, not the Worker
    return Promise.all(records.map((r) => sign(r)));
  };
}
