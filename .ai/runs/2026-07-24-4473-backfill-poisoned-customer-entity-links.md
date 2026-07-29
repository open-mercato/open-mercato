# Backfill poisoned customer_users.customer_entity_id rows

## Overview

Goal: repair the `customer_users.customer_entity_id` rows that issue #4473 describes — portal users created before #4457 whose CRM company FK points at a person entity, or at an entity in another organization, and who therefore stay scoped to the wrong company and cannot be edited from the admin form.

Source issue: #4473 (follow-up to the code review of #4457).

## Scope

- Add one data-repair migration under `packages/core/src/modules/customer_accounts/migrations/`.
- Mirror the normalization semantics of the `autoLinkCrm` subscriber exactly, so the one-off repair and the ongoing guard cannot disagree.
- Decide the open question the issue deferred: whether the cross-module read needs a `to_regclass` guard, or whether the repair belongs in a CLI command instead.
- Cover the emitted SQL with unit tests, following the existing migration-test pattern in `packages/core/src/modules/workflows/migrations/__tests__/`.

## Non-goals

- No change to `autoLinkCrm`, the invite routes, or the ownership helpers — the prevention side is #4457's scope and is still open.
- No schema change: no new columns, indexes, or constraints, so `.snapshot-open-mercato.json` stays untouched.
- No UI change and no new API surface.

## Implementation Plan

### Phase 1: Establish the repair semantics

1. Extract the exact normalization rules from #4457's `autoLinkCrm` diff and the `customerEntityOwnership` helpers.
2. Determine whether the cross-module read needs a `to_regclass` guard by checking how `dbMigrate` orders modules.

### Phase 2: Implement and verify

1. Write the migration with the SQL exposed through an exported builder so it can be unit-tested.
2. Add unit tests covering the guard, the recovery branch, the clear branch, the optimistic-lock bump, and the forward-only `down()`.
3. Verify the emitted SQL against a real Postgres across every branch, plus idempotency and the tables-absent no-op.
4. Run the configured validation gate.

### Phase 3: Publish

1. Open the PR against `develop`, request the label set, and answer the issue's open question in the issue thread.
2. Run the authoritative code-review pass and post the run summary.

## Risks

- **Cross-module read from a `customer_accounts` migration.** `dbMigrate` sorts enabled modules with `localeCompare`, so `customer_accounts` runs *before* `customers` and the tables being read do not exist on a fresh database. Mitigated by the `to_regclass` guard; such a database has no poisoned rows either, so skipping is correct rather than a compromise.
- **Silently undoing the repair.** A client holding the pre-repair optimistic-lock version could resubmit the poisoned value. Mitigated by bumping `updated_at` on repaired rows so the stale client gets a 409 instead.
- **Recovery and clearing drifting apart.** Two separate statements could disagree about what counts as in-scope. Mitigated by making the recovery a scalar subquery that yields `NULL` in every unrecoverable case, so both branches are one statement.
- **Repairing rows that should not be touched.** A correct company link must survive untouched. Mitigated by gating the whole `UPDATE` on a `NOT EXISTS` probe for an in-org, non-deleted company, which also makes the migration idempotent.

## Progress

PR: #4494

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish the repair semantics

- [x] 1.1 Extract normalization rules from #4457 and the ownership helpers — 51c95219d
- [x] 1.2 Decide the `to_regclass` question from the `dbMigrate` module ordering — 51c95219d

### Phase 2: Implement and verify

- [x] 2.1 Write the migration with an exported SQL builder — 51c95219d
- [x] 2.2 Add unit tests for guard, recovery, clear, lock bump, forward-only down — 51c95219d
- [x] 2.3 Verify the emitted SQL on a real Postgres across all branches — 51c95219d
- [x] 2.4 Run the configured validation gate — 51c95219d

### Phase 3: Publish

- [x] 3.1 Open the PR and answer the issue's open question — 51c95219d
- [x] 3.2 Run the authoritative code-review pass and post the run summary — fa8afa0f2
