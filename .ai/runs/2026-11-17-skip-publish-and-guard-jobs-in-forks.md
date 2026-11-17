# Skip the snapshot publish and enterprise guard jobs in forks

## Goal

Stop `Main Snapshot Release` and `Enterprise Contribution Guard` from running (and always failing) in GitHub forks of the repository, without changing their behavior upstream.

## Scope

- `.github/workflows/snapshot.yml` — gate the `snapshot` job with `if: ${{ !github.event.repository.fork }}`. The dependent `standalone-integration` job `needs: snapshot`, so it is skipped with it.
- `.github/workflows/enterprise-contribution-guard.yml` — gate the `guard` job with the same condition.
- `scripts/__tests__/fork-gated-workflows.test.mjs` — regression test asserting both jobs carry the fork gate.

Why `!github.event.repository.fork` rather than `github.repository == 'open-mercato/open-mercato'`: it does not hard-code the repository name, so a rename or org transfer cannot silently turn the jobs off. A skipped required check reports as passing, which would quietly disable the enterprise guard.

Why upstream enforcement is unchanged: `pull_request` workflows for fork → upstream PRs run in the base (upstream) repository, which is not a fork.

## Non-goals

- Other workflows (`release*.yml`, `qa-deploy.yml`, …) — they may deserve the same gate but are left for a separate change.
- Any change to the guard's allowlist or decision logic.

## Risks

- A mirror imported without GitHub's fork relationship still runs the jobs (same as today).
- `github.event.repository` is present on both `push` and `pull_request` payloads; if absent the expression evaluates `!null` → true and the job runs (fail-safe toward running).

## Implementation Plan

### Phase 1: Gate the jobs

1. Add the fork gate to both jobs.
2. Add the regression test.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Gate the jobs

- [ ] 1.1 Add the fork gate to both jobs
- [ ] 1.2 Add the regression test
