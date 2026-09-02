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

`.ai/specs/2026-08-13-wms-sites-and-warehouse-roles.md`, the decision brief that records why
each option was chosen, and this execution record when a later review supersedes an earlier step.

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

- 2.1 Add the `ActiveSiteWarehouse` / `wms_active_site_warehouses` data model: columns, the
  warehouse-exclusivity unique constraint, the scoped cleanup index, its internal-only status, and the four
  transactional maintenance paths.
- 2.2 Rewrite invariant 5 so the unique constraint — not a preflight read — is the authority.
- 2.3 Add invariant 14: transaction-scoped Site and warehouse advisory keys, their acquisition
  order, and why the lock gives a deterministic `409` rather than a deadlock abort. The final
  form uses reserved family IDs and sorts deduplicated physical warehouse hashes; see Phase 7.

### Phase 3: Consistency fallout

- 3.1 Declare the `wms.site.deleted` event with its single-emitter constraint, so the query index
  and search are not left with a stale projection after an undo.
- 3.2 Update the migration steps (new table, no backfill, built-in lock functions) and renumber.
- 3.3 Update Phase 1 of the spec's own implementation phases to include membership maintenance
  and the new command-layer concurrency tests.
- 3.4 Rewrite the test expectations: overlapping-transaction activation, single-row membership
  for a dual-role warehouse, soft-delete undo with redo identity, and the `409` refusal case.
- 3.5 Update the three affected risk-table rows and add the membership-drift risk.
- 3.6 Add the changelog entry and the `Review — 2026-08-23` record.

### Phase 4: Land the remediation

- 4.1 Run the docs validation gate and commit the spec, brief, and this plan.
- 4.2 Push to the fork head, link the plan from the PR body, and post the summary comment.

### Phase 5: Re-review remediation (2026-08-24)

- 5.1 Add the site-scoped serialization point (invariant 14) so `is_active` — the state that
  decides membership — is covered by a lock, and state the site-key-before-warehouse-keys
  acquisition order.
- 5.2 State membership behavior for the warehouse-deactivation path and record the then-current
  `hashtext` collision assumption; Phase 7 supersedes that assumption with physically ordered,
  family-separated lock keys.
- 5.3 Add the activate-vs-add-mapping and deactivate-vs-add-mapping overlapping-transaction
  test cases.
- 5.4 Name the two same-site interleavings in the membership-drift risk row.
- 5.5 Add the create-undo refusal `409` row to the error contract table.
- 5.6 Correct the Final Compliance Report's stale "creation undo deactivates" row.
- 5.7 Record the changelog entry and the `Review — 2026-08-24` decision record, and mirror the
  site-lock decision into the decision brief.

### Phase 6: Second re-review remediation (2026-08-28)

- 6.1 Add site create/update undo to invariant 14's Site-lock enumeration and require all
  create-undo refusal predicates to be read after that lock is acquired.
- 6.2 Make mapping commands re-read `deleted_at`, keep activation readiness under the same lock,
  and route an `is_active` update-undo through normal activation/deactivation maintenance.
- 6.3 Add the two-order create-undo-vs-mapping-create transaction test and update the risk row.
- 6.4 Remove the unreachable site-scoped membership unique index and mirror all corrections into
  the decision brief.

### Phase 7: Local candidate self-review remediation (2026-08-28)

- 7.1 Replace the shared one-integer advisory-lock namespace with two reserved `int4` family IDs.
- 7.2 Compute, deduplicate, and numerically sort the physical signed warehouse hash keys before
  acquiring any warehouse lock.
- 7.3 Add a deliberate-collision overlapping-transaction test and name `40P01` in its assertion
  and in the risk row.
- 7.4 Update the spec, brief, changelog, review record, and this execution plan together, then run
  the documentation-only validation and a fresh `om-auto-review-pr` specification review.

### Phase 8: PR #5729 review remediation (2026-08-28)

- 8.1 Replace the mapping-update unconditional membership insert with reconciliation to the active
  Site's distinct live-mapping warehouse set, and add the already-active same-Site convergence test.
- 8.2 Name the WMS lock-key helper path and the repository-wide two-integer family registry that
  prevents future modules from reusing the reserved values.
- 8.3 Add the missing Phase 7 landing SHA, synchronize the spec, brief, changelog, review record,
  and this execution plan, then run the documentation-only validation.

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
- [x] 4.2 Push, link the plan from the PR body, and post the summary comment — 4426ff7df

### Phase 5: Re-review remediation (2026-08-24)

- [x] 5.1 Add the site-scoped serialization point to invariant 14 — 306cac9c3
- [x] 5.2 Document warehouse-deactivation membership behavior and `hashtext` collision safety — 306cac9c3
- [x] 5.3 Add the same-site overlapping-transaction test cases — 306cac9c3
- [x] 5.4 Name the two interleavings in the membership-drift risk row — 306cac9c3
- [x] 5.5 Add the create-undo refusal `409` to the error contract — 306cac9c3
- [x] 5.6 Correct the stale compliance-matrix row — 306cac9c3
- [x] 5.7 Add the changelog entry, review record, and brief update — 306cac9c3

### Phase 6: Second re-review remediation (2026-08-28)

- [x] 6.1 Serialize site create/update undo on the Site key — 38d9ba6b1
- [x] 6.2 Re-read parent/activation state and reuse membership paths — 38d9ba6b1
- [x] 6.3 Add undo-vs-mapping concurrency coverage and update the risk — 38d9ba6b1
- [x] 6.4 Remove the redundant index and synchronize the brief — 38d9ba6b1

### Phase 7: Local candidate self-review remediation (2026-08-28)

- [x] 7.1 Separate Site and warehouse physical lock families — bece57452
- [x] 7.2 Deduplicate and sort physical warehouse keys — bece57452
- [x] 7.3 Add deliberate-collision coverage and risk treatment — bece57452
- [x] 7.4 Synchronize the spec, brief, changelog, review record, and execution plan — bece57452

### Phase 8: PR #5729 review remediation (2026-08-28)

- [x] 8.1 Reconcile membership as the distinct active-Site warehouse set and test convergence — 8b3f50bc1
- [x] 8.2 Name the WMS helper and repository-wide lock-family registry — 8b3f50bc1
- [x] 8.3 Synchronize the review remediation and run documentation validation — 8b3f50bc1

### Resume notes — 2026-08-24

- Ran in the primary worktree again, for the same reason as the previous resume: the PR head branch
  is checked out there with a clean tree, so `git worktree add` on the same branch would have had to
  detach and push from a second checkout, leaving the primary one silently behind.
- `om-auto-review-pr` again could not run — GitHub rejects a review from a PR's own author, and this
  account has neither label-write nor `RequestReviewsByLogin` permission upstream. The `om-code-review`
  checks (breaking change, security, API contract, scope) were applied to the diff by hand and reported
  as a manual pass in the summary comment, explicitly not as a review verdict. A maintainer re-review
  is still required.
- The configured validation gate is runtime-only and this change compiles nothing, so it was replaced
  by `git diff --check`, relative-link resolution, a superseded-wording sweep, and the two pre-commit
  hook steps run by hand (`i18n-check-sync --fix`, `template:sync:fix` — both already in sync).
- Labels could not be normalized. `changes-requested` is now stale and `review` is the correct state;
  both were requested from a maintainer in the summary comment.
- No `in-progress` lock was taken or released, for the same reason as the previous resume.

### Resume notes — 2026-08-23

- Ran in the primary worktree rather than an isolated one, deliberately: the remediation was already
  authored and uncommitted on the PR head branch there, so branching a fresh worktree from the PR
  head would have stranded the work rather than resuming it.
- `om-auto-review-pr` could not run: this account authors PR #5449 and GitHub rejects an
  approve/request-changes review from a PR's own author. A manual consistency pass substituted for
  it and produced one real fix (`4426ff7df`).
- Labels were not normalized and review could not be re-requested — the account has neither
  label-write nor `RequestReviewsByLogin` permission on the upstream repository. The stale
  `changes-requested` label needs a maintainer. Hand-off was delivered as a PR comment instead.
- No `in-progress` lock was taken or released: the account cannot write labels, and the PR was
  already assigned to the current user, so step 1 resolved as re-entry.

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
