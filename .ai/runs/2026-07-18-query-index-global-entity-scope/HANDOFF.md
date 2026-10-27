# Handoff — query-index-global-entity-scope

## Current state

- Branch: `fix/query-index-global-entity-scope` from `origin/develop`.
- Draft PR: https://github.com/open-mercato/open-mercato/pull/4285.
- Latest pushed fix: `9ca4d60cb fix(feature-toggles): list global indexes`.
- Resume at: inspect the required CI checks for the latest commit. Keep the PR as a draft until `ephemeral-integration` passes and a maintainer can review it.
- Unrelated working-tree file preserved: `.ai/reports/ds-health-2026-07-02.txt`.

## Decisions already made

- The supplied core-spec invocation is treated as explicit authorization for the specified core fix.
- The global projection delete assertion will follow existing `markDeleted()` semantics: the projection is physically removed, not soft-deleted.
- No UI is touched, so the design-system pass is not applicable.
- MikroORM v7 returns `em.getMetadata().getAll()` as a `Map`; the strict metadata resolver now supports it, covered by a regression test.

## Validation

- Passed: focused core Jest suites (36 tests), full `yarn build:packages`, `yarn generate`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`, and `git diff --check` (Runner: local).
- Passed: isolated `TC-FT-001` against a managed ephemeral app and database; it verified the global null/null projection after create/update and physical removal after delete.
- Passed after the CI failure investigation: shared query-engine regression (`20` tests), root `yarn typecheck`, and all `22` managed feature-toggle integration tests, including `TC-FT-008` filtering/pagination and `TC-FT-001` projection lifecycle.
- Local test-note: the managed feature-toggle run used temporary `.worktrees` discovery ignores because sibling worktrees otherwise load a second Playwright copy; those local-only edits were reverted and are not part of the PR.
- Review: independent final review found no actionable findings.
- Blocked external gate: `yarn test:integration:ephemeral` fails during global discovery because stale `.worktrees` are not excluded. It errors before feature tests run with missing stale `dist` imports and duplicate `@playwright/test` loads.
- Template parity: `yarn template:sync` reports 25 pre-existing unrelated template drifts; no template surface was changed in this work.
- GitHub handoff: the branch is in the configured writable fork and the draft PR is open. The upstream API token can create/comment but cannot assign or mutate labels, so a maintainer must apply the intended `bug`, `priority-high`, `risk-high`, and `blocked` labels (and release any claim state once the integration gate is resolved).
