/** Environment variables of CI providers other than GitHub Actions, and the identity and context read from them. */

/** The commit every provider below reports (identity.test.ts also uses it as a pull request head). */
export const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

/** GitLab CI on a merge request pipeline. */
export const GITLAB = {
  env: {
    GITLAB_CI: 'true',
    CI_COMMIT_SHA: SHA,
    CI_COMMIT_REF_NAME: 'coupon-fix',
    GITLAB_USER_LOGIN: 'alex',
    CI_MERGE_REQUEST_IID: '12',
    CI_JOB_URL: 'https://gitlab.com/shop/web/-/jobs/7',
    CI_PIPELINE_ID: '1001',
    CI_JOB_NAME: 'e2e',
    CI_PIPELINE_SOURCE: 'merge_request_event',
    CI_PROJECT_PATH: 'shop/web',
    GITLAB_USER_NAME: 'Alex Kim',
    CI_JOB_RETRY_COUNT: '0',
  },
  ref: 'refs/heads/coupon-fix',
  actor: { kind: 'ci', id: 'gitlab:alex', name: 'Alex Kim', via: 'gitlab' },
  ci: {
    provider: 'gitlab',
    url: 'https://gitlab.com/shop/web/-/jobs/7',
    run_id: '1001',
    run_attempt: 1,
    job: 'e2e',
    event: 'merge_request_event',
    repository: 'shop/web',
    pr: 12,
  },
};

/** CircleCI on a tag build of a GitHub pull request. */
export const CIRCLECI = {
  env: {
    CIRCLECI: 'true',
    CIRCLE_SHA1: SHA,
    CIRCLE_BRANCH: 'main',
    CIRCLE_TAG: 'v1.4.0',
    CIRCLE_USERNAME: 'sam',
    CIRCLE_PULL_REQUEST: 'https://github.com/shop/web/pull/34',
    CIRCLE_BUILD_URL: 'https://circleci.com/gh/shop/web/88',
    CIRCLE_WORKFLOW_ID: 'wf-1',
    CIRCLE_JOB: 'e2e',
  },
  ref: 'refs/tags/v1.4.0',
  actor: { kind: 'ci', id: 'circleci:sam', name: 'sam', via: 'circleci' },
  ci: {
    provider: 'circleci',
    url: 'https://circleci.com/gh/shop/web/88',
    run_id: 'wf-1',
    job: 'e2e',
    pr: 34,
  },
};

/** Buildkite on a retried build whose BUILDKITE_COMMIT is not a SHA. */
export const BUILDKITE = {
  env: {
    BUILDKITE: 'true',
    BUILDKITE_COMMIT: 'HEAD', // not a SHA: IW_COMMIT, else the checkout
    IW_COMMIT: SHA,
    BUILDKITE_BRANCH: 'main',
    BUILDKITE_BUILD_CREATOR: 'Kim Lee',
    BUILDKITE_BUILD_CREATOR_EMAIL: 'kim@shop.test',
    BUILDKITE_RETRY_COUNT: '2',
    BUILDKITE_PULL_REQUEST: 'false',
    BUILDKITE_BUILD_URL: 'https://buildkite.com/shop/web/builds/5',
    BUILDKITE_BUILD_ID: 'b-5',
    BUILDKITE_LABEL: ':playwright: e2e',
    BUILDKITE_PIPELINE_SLUG: 'web',
    BUILDKITE_SOURCE: 'webhook',
  },
  ref: 'refs/heads/main',
  actor: { kind: 'ci', id: 'buildkite:kim@shop.test', name: 'Kim Lee', via: 'buildkite' },
  ci: {
    provider: 'buildkite',
    url: 'https://buildkite.com/shop/web/builds/5',
    run_id: 'b-5',
    run_attempt: 3,
    job: ':playwright: e2e',
    workflow: 'web',
    event: 'webhook',
  },
};
