# Execution plan — WMS Sites P1.2 review remediation (PR #5449)

> **Adopted plan.** PR #5449 was opened without a tracking plan. This file was reconstructed
> on 2026-08-23 by `om-auto-continue-pr` from the PR's review thread, its diff, and the
> maintainer decisions taken in the originating session. It documents the remediation pass
> only — it does not restate the roadmap work the PR already carried before this pass.

## Goal

Resolve the two High findings raised by the `om-auto-review-pr` code review on PR #5449, both
against `.ai/specs/2026-08-13-wms-sites-and-warehouse-roles.md` (the P1.2 WMS Sites design,
tracked by issue #5389), so P1.2 implementation is unblocked.

1. **Site create-undo was a no-op.** The spec required every site to be created inactive, then
   defined create-undo as "deactivate the site and never delete the stable identity". Undo
   therefore reversed nothing: the accidentally created row stayed visible, its unique code
   stayed reserved, and the audit log reported the creation as undone.
2. **Active-site warehouse exclusivity was unenforceable under concurrency.** The rule was
   backed only by the phrase "activation locks", with no lock key, acquisition order, or
   database invariant named. Two inactive sites sharing a warehouse could both observe no
   conflict and both activate, even inside separate `withAtomicFlush` transactions.

## Scope

`.ai/specs/2026-08-13-wms-sites-and-warehouse-roles.md` only, plus the decision brief that
records why each option was chosen.

### Maintainer decisions

- **Create-undo → soft-delete.** Undo sets `deleted_at`, emits the `deleted` CRUD side effect,
  and retains the site ID in the audit snapshot so redo restores the same identity. Chosen over
  declaring create non-undoable because it matches the platform's existing create-undo command
  contract (`packages/core/src/modules/resources/commands/resources.ts`) and returns the site
  code to the pool through the already-partial uniqueness index.
- **Exclusivity → materialized membership table *plus* advisory lock.** A new
  `wms_active_site_warehouses` relation carries unique `(tenant_id, organization_id, warehouse_id)`
  as the enforceable invariant; ordered `pg_advisory_xact_lock` acquisition makes concurrent
  activation deterministic. Chosen over an advisory lock alone because the maintainer preferred a
  guarantee that survives an application path forgetting the lock. The extra table and its four
  maintenance points are an accepted P1.2 cost.

### Non-goals

- No implementation, migration, entity, or command code — this is a specification change.
- No change to the manufacturing roadmap document or any other capability spec in the PR; the
  reviewer confirmed the roadmap decomposition is sound and needs no split.
- No relaxation of the exclusivity rule. Shared warehouses across active Sites stay deliberately
  outside the first core and will redesign this constraint as their own capability.
- No new `DELETE` route, OpenAPI operation, command, or UI action for a site.
- No revisiting of the default-promotion, readiness, or optimistic-locking rules the review did
  not challenge.

## Backward compatibility

Specification-only. No runtime contract surface from `BACKWARD_COMPATIBILITY.md` is modified:
the P1.2 entities, routes, events, ACL features, and DI names are all still unreleased proposals.
The one contract shape that changed within the proposal — the added `wms.site.deleted` event —
is additive and, being unreleased, requires no deprecation bridge.

## Implementation Plan

### Phase 1: Create-undo semantics

- 1.1 Rewrite the `deleted_at` ownership sentence so the `wms.sites.create` undo handler is its
  only writer, and state that undo soft-deletes while preserving the ID for redo.
- 1.2 Record that the existing partial uniqueness index releases the site code on undo, so no
  schema or command step is added.
- 1.3 Rewrite the audit/undo rule: soft-delete, custom-field clearing, `deleted` side effect,
  redo identity, and a `409` refusal once the site is active or carries live mappings.
- 1.4 Narrow the "out of scope" bullet so reversing an accidental creation is not confused with
  site deletion.

### Phase 2: Enforceable exclusivity

- 2.1 Add the `ActiveSiteWarehouse` / `wms_active_site_warehouses` data model: columns, the two
  unique constraints, the scoped cleanup index, its internal-only status, and the four
  transactional maintenance paths.
- 2.2 Rewrite invariant 5 so the unique constraint — not a preflight read — is the authority.
- 2.3 Add invariant 14: the `pg_advisory_xact_lock` key, ascending lexicographic acquisition
  order, and why the lock gives a deterministic `409` rather than a deadlock abort.

### Phase 3: Consistency fallout

- 3.1 Declare the `wms.site.deleted` event with its single-emitter constraint, so the query index
  and search are not left with a stale projection after an undo.
- 3.2 Update the migration steps (new table, no backfill, built-in lock functions) and renumber.
- 3.3 Update Phase 1 of the spec's own implementation phases to include membership maintenance
  and the two new command-layer tests.
- 3.4 Rewrite the test expectations: overlapping-transaction activation, single-row membership
  for a dual-role warehouse, soft-delete undo with redo identity, and the `409` refusal case.
- 3.5 Update the three affected risk-table rows and add the membership-drift risk.
- 3.6 Add the changelog entry and the `Review — 2026-08-23` record.

### Phase 4: Land the remediation

- 4.1 Run the docs validation gate and commit the spec, brief, and this plan.
- 4.2 Push to the fork head, link the plan from the PR body, and post the summary comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Create-undo semantics

- [x] 1.1 Rewrite `deleted_at` ownership and undo semantics
- [x] 1.2 Record code release through the partial uniqueness index
- [x] 1.3 Rewrite the create-undo audit rule
- [x] 1.4 Narrow the out-of-scope deletion bullet

### Phase 2: Enforceable exclusivity

- [x] 2.1 Add the `ActiveSiteWarehouse` data model and maintenance paths
- [x] 2.2 Rewrite invariant 5 around the unique constraint
- [x] 2.3 Add invariant 14 for advisory-lock acquisition

### Phase 3: Consistency fallout

- [x] 3.1 Declare the `wms.site.deleted` event
- [x] 3.2 Update and renumber the migration steps
- [x] 3.3 Update the spec's Phase 1 implementation steps
- [x] 3.4 Rewrite the affected test expectations
- [x] 3.5 Update the risk table
- [x] 3.6 Add the changelog and review record

### Phase 4: Land the remediation

- [x] 4.1 Run the docs validation gate and commit — 8e63ed411
- [ ] 4.2 Push, link the plan from the PR body, and post the summary comment

## External references

- PR: https://github.com/open-mercato/open-mercato/pull/5449
- Readiness issue: https://github.com/open-mercato/open-mercato/issues/5389
- Decision brief: `.ai/specs/briefs/2026-08-23-wms-sites-undo-and-warehouse-exclusivity.md`
- Spec under change: `.ai/specs/2026-08-13-wms-sites-and-warehouse-roles.md`

## Assumptions

- The reviewer's scope judgement holds: only the P1.2 spec needed correcting, and the umbrella
  roadmap needs no split.
- `pg_advisory_xact_lock` and `hashtext` remain available without an extension on the supported
  PostgreSQL deployment — consistent with their existing use in `attachments` and `notifications`.
- P1.2 has no released implementation yet, so every changed rule is a design change rather than a
  breaking runtime change.
