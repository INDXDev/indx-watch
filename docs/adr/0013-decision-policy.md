# 0013. One pure function turns judgements into a verdict

- Status: accepted
- Date: 2026-11-19

## Context

Runs can be judged by deterministic assertions, visual diffs, LLM judges and humans. Teams must be able to trust and audit how a final verdict was reached, and AI verdicts must not silently pass low-confidence results.

## Decision

`decide(judgements, policy, context)` in `packages/core` is the only place that computes a verdict, using the ordered rules in [concepts.md](../spec/concepts.md#decision-policy). Policies are data (`[decision_policy]` in `project.toml`, overridable per test case). Verdicts are never stored; corrections are appended judgements.

## Consequences

- Every verdict is explainable: `iw show RUN --json` returns the rule number that decided it.
- Changing a policy changes computed verdicts of past runs; reports record the policy used.
