# Migrate setup-node v7 update to develop

## Goal

Recreate the exact `actions/setup-node` v7 dependency update from PR #4885 on a branch based on `develop`, verify it under the repository's configured gate, and replace the incorrectly targeted `main` PR with a review-ready `develop` PR.

## Scope

- Preserve PR #4885's one-line `actions/setup-node@v6` to `actions/setup-node@v7` change in `.github/workflows/audit.yml`.
- Base the replacement branch and PR on `develop`, as required by the repository's branch policy and agentic configuration.
- Run the configured validation gate and authoritative automated review before marking the replacement ready.
- Cross-link and close PR #4885 only after the replacement PR is ready.

**Source PR:** `https://github.com/open-mercato/open-mercato/pull/4885`

**Non-goals:** No other workflow changes, package dependency updates, application behavior changes, or edits to Dependabot configuration. The original Dependabot commit is not rewritten or force-pushed.

## Implementation Plan

### Phase 1: Recreate the dependency update

- **1.1 Port the setup-node v7 change.** Apply PR #4885's exact workflow edit on top of `origin/develop` and confirm no unrelated content changed.

### Phase 2: Verify and hand off

- **2.1 Run validation and authoritative review.** Execute the configured validation gate in order, normalize the replacement PR's labels, and complete the `om-auto-review-pr` autofix pass.
- **2.2 Replace the original PR.** Mark the verified replacement PR ready, cross-link it from PR #4885, close the original, and release the migration claim.

## Risks

- **Action runtime compatibility:** `actions/setup-node@v7` changes the action runtime and dependencies; the repository uses GitHub-hosted runners, and the full validation plus PR CI provide the available project-level regression coverage.
- **Scope drift:** the source PR contains one workflow-line change, so the migrated diff is compared directly with PR #4885 and any unrelated edit is rejected.
- **Duplicate work:** the replacement is opened before the original is closed for watchable progress, but the two PRs are cross-linked and only the `develop` replacement remains open at completion.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Recreate the dependency update

- [ ] 1.1 Port the setup-node v7 change

### Phase 2: Verify and hand off

- [ ] 2.1 Run validation and authoritative review
- [ ] 2.2 Replace the original PR
