# Auto Create PR Loop Plan — query-index-global-entity-scope

**Date:** 2026-07-18
**Slug:** `query-index-global-entity-scope`
**Branch:** `fix/query-index-global-entity-scope`
**Mode:** Spec-implementation run
**Source spec:** `.ai/specs/2026-07-18-query-index-global-entity-scope.md`

## Tasks

> Authoritative status table. `Status` is `todo` or `done`. A completed step records the commit that landed it; the first non-done step is the resume point.

| Phase | Step | Title | Status | Commit |
|---|---|---|---|---|
| 0 | 0.1 | Land source specification and pre-implementation analysis | done | 5df9fb7c4 |
| 1 | 1.1 | Make global feature-toggle index identifiers explicit | done | b57d4c804 |
| 2 | 2.1 | Resolve registered source metadata and strict scope state | done | b57d4c804 |
| 2 | 2.2 | Apply metadata-aware scope handling to upsert and delete coverage | done | b57d4c804 |
| 3 | 3.1 | Extend focused unit and feature-toggle integration coverage | done | b57d4c804 |
| 3 | 3.2 | Run the managed feature-toggle integration scenario | done | pending commit |
| 4 | 4.1 | Await required CI and maintainer review on the draft pull request | todo | — |
| 4 | 4.2 | Correct global list query scope and revalidate feature toggles | done | 9ca4d60cb |

## Goal

Correct query-index scope handling for registered global ORM entities without weakening tenant-scoped source-row authority.

## Scope

- Copy the supplied source spec and record its readiness analysis.
- Emit explicit null/null index scope for global feature-toggle commands.
- Resolve scope columns only from registered MikroORM metadata; fail closed for missing metadata.
- Avoid source scope reads for global entities and omit absent scope predicates from delete coverage.
- Cover global, tenant-only, mismatched, missing-source, and unknown-entity paths with focused tests; assert the feature-toggle API lifecycle persists a global projection.

## Scope correction

`markDeleted()` physically removes `entity_indexes` rows. The supplied spec's delete integration assertion is therefore corrected to require no remaining projection row, preserving established index deletion behavior rather than expanding this bug fix into a storage-semantics change.

## Non-goals

- No schema, migration, API, event-ID, ACL, UI, cache-policy, or reindex-contract changes.
- No fallback table guessing for unregistered entity IDs.
- No change to the all-tenant reindex opt-in contract.

## Validation plan

- Focused core Jest suites for query-index scope/subscribers and global feature-toggle commands.
- Managed ephemeral integration run filtered to `TC-FT-001`.
- Full configured validation gate using one selected runner, then `git diff --check` and template parity review.
- No DS review is needed because no UI file changes.

## Gate result

- The isolated managed `TC-FT-001` scenario passed after exercising create, update, and delete projection state.
- The repository-wide managed Playwright command remains blocked before execution by stale sibling `.worktrees` that its discovery does not ignore; those worktrees load incompatible `@playwright/test` copies and stale `dist/` imports. This is outside the feature diff and must be cleared or excluded before rerunning the full suite.
- The CI-reported `TC-FT-008` failure is fixed in `9ca4d60cb`: global-list reads retain required query context but opt out of automatic tenant/org and scope-bound search-token filtering. The focused shared regression, `yarn typecheck`, and all 22 feature-toggle integration tests pass against a fresh ephemeral app.
- Draft PR: https://github.com/open-mercato/open-mercato/pull/4285. Required upstream labels could not be applied because the GitHub API token has read-only upstream permission.

## File manifest

| File | Action | Purpose |
|---|---|---|
| `.ai/specs/2026-07-18-query-index-global-entity-scope.md` | Add/update | Versioned source specification and implementation status. |
| `.ai/specs/analysis/ANALYSIS-2026-07-18-query-index-global-entity-scope.md` | Add | Mandatory readiness and compatibility audit. |
| `packages/core/src/modules/query_index/lib/subscriber-scope.ts` | Modify | Strict metadata descriptor and scope-state resolver. |
| `packages/core/src/modules/query_index/subscribers/upsert_one.ts` | Modify | Resolve scope without swallowed metadata/SQL errors. |
| `packages/core/src/modules/query_index/subscribers/delete_one.ts` | Modify | Use conditional metadata-backed coverage predicates. |
| `packages/core/src/modules/query_index/__tests__/*scope*.test.ts` | Modify/add | Scope resolver and global-upsert regressions. |
| `packages/core/src/modules/query_index/__tests__/delete-one-coverage.test.ts` | Modify | Global delete coverage predicate regression. |
| `packages/core/src/modules/feature_toggles/commands/global.ts` | Modify | Constant global command identifiers. |
| `packages/core/src/modules/feature_toggles/commands/__tests__/global.test.ts` | Modify | Actor scope cannot leak into index identifiers. |
| `packages/core/src/modules/feature_toggles/__integration__/TC-FT-001.spec.ts` | Modify | API lifecycle projection-scope regression. |

## Backward compatibility

Existing event IDs and payload fields, APIs, entities, schema, DI keys, generated registries, and reindex contract remain unchanged. For valid tenant-scoped records, source-row scope remains authoritative; only the corrected feature-toggle values and strict handling of invalid/unregistered index inputs change.
