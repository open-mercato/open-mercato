# Correct WMS Sites P1.2 create-undo semantics and make active-site warehouse exclusivity enforceable

- Date: 2026-08-23
- Category: documentation
- Priority signal: medium — blocks implementation of P1.2; PR #5449 carries `changes-requested` until resolved
- Risk signal: low — specification-only edits; no runtime code, schema, or existing contract changes in this change
- Routing: Next: om-auto-continue-pr 5449
- Status: **Specification-only corrections applied** to `.ai/specs/2026-08-13-wms-sites-and-warehouse-roles.md`; implementation remains pending.

## Problem

The review of [PR #5449](https://github.com/open-mercato/open-mercato/pull/5449) raised two High correctness findings against `.ai/specs/2026-08-13-wms-sites-and-warehouse-roles.md`, the P1.2 WMS Sites design tracked by issue #5389.

First, site create-undo is specified as "deactivate the site and never delete the stable identity", but the same spec requires every site to be created inactive. Undo is therefore a no-op for the entity it claims to undo: the accidentally created row stays visible, its unique code stays reserved, and the audit log reports the creation as reversed. The proposed test codifies this incorrect lifecycle.

Second, the rule that an assigned warehouse must be absent from every other active site is backed only by the phrase "activation locks", with no lock key, acquisition order, or database invariant named. The listed unique constraints cover assignment uniqueness and one default per role group — neither expresses cross-site exclusivity. Two inactive sites sharing a warehouse can both observe no conflict and both activate, even inside separate `withAtomicFlush` transactions.

## Agreed direction

Correct the specification in place, on the existing PR branch. Specification-only; no implementation ships here.

**Create-undo becomes a soft-delete.** Undo sets `deleted_at`, emits the `deleted` CRUD side effect, and clears the canonical custom-field contribution, while the audit snapshot retains the site ID so redo restores the same identity. This matches the platform's existing create-undo convention rather than inventing a WMS-local one. Because the site-code uniqueness index is already partial (`WHERE deleted_at IS NULL`), the code is released automatically — no migration or index change is required for this half.

Rejected: declaring site create non-undoable (honest, but inconsistent with every other module's command contract, and it still leaves debris after each mistaken create). Rejected: keeping the current deactivate wording (indefensible — the row is already inactive when created, so undo changes nothing while audit claims otherwise).

**Warehouse exclusivity gets a materialized membership constraint plus a transaction-scoped lock.** A dedicated membership relation holds one row per (site, warehouse) pair while that site is active, with a unique constraint on `(tenant_id, organization_id, warehouse_id)` so the database — not a preflight check — arbitrates the race; the loser's constraint violation translates to the already-specified stable `409`. A `pg_advisory_xact_lock` keyed on `(tenant_id, organization_id, warehouse_id)` and acquired in stable sorted order makes concurrent activation deterministic instead of surfacing as a deadlock abort.

**Follow-up (2026-08-24 re-review): the lock also has to cover `is_active`.** Keying the lock only by warehouse serializes two activations but not an activation against a concurrent mapping create on the same site, and mapping writes on an inactive site took no lock at all — so a site could commit as active with a mapping whose warehouse held no membership row, silently unreserved. A site-scoped key `wms:active-site:{tenantId}:{organizationId}:{siteId}` is now acquired first by activation, deactivation, and every mapping write regardless of the site's state, with `is_active` re-read inside it; the warehouse keys follow in ascending order. Rejected: `SELECT ... FOR UPDATE` on the site row, which works but mixes two locking disciplines whose mutual ordering would then also need specifying.

**Follow-up (2026-08-28 second re-review): undo shares that same serialization point.** Site create/update undo now acquire the site key before reading the Site. Create-undo evaluates `is_active`, `deleted_at`, the live-mapping count, and the unchanged-since-creation predicate inside it; mapping create also re-reads `deleted_at` there, so an overlap cannot commit both a soft-deleted parent and a live child. Activation's readiness check is inside the same lock and held through its state/membership writes, while site update undo that reverses `is_active` reuses the corresponding activation/deactivation path. The redundant unique `(tenant_id, organization_id, site_id, warehouse_id)` index is omitted in Phase 1 because the stricter warehouse-exclusivity constraint already makes it unreachable; a future capability that relaxes exclusivity must add the site-scoped invariant as part of its redesign.

**Follow-up (2026-08-28 local candidate self-review): logical lock order must also be physical lock order.** The one-integer `pg_advisory_xact_lock(hashtext(...))` form placed Site and warehouse hashes in one physical namespace, so a 32-bit collision could invert the documented family order; sorting warehouse UUIDs likewise did not sort the keys PostgreSQL actually acquires. The design now uses `pg_advisory_xact_lock(familyId, resourceHash)` with centrally owned `WMS_SITE_LOCK_FAMILY_ID = 1464685313` and `WMS_WAREHOUSE_LOCK_FAMILY_ID = 1464685314`. Multi-warehouse commands compute signed `hashtext` values first, deduplicate collisions, and sort those physical keys numerically. A deliberate-collision overlapping-transaction test must prove that no `40P01` escapes and that a real membership conflict still yields one winner and one stable `409`.

Rejected: a plain partial unique index on the existing mapping table. It cannot express this invariant — the spec deliberately allows one warehouse to serve several roles inside the same site, and `is_active` lives on the site row, so the constraint is inherently cross-row. Rejected as insufficient-alone: advisory locks with no database backstop, which protect only the code paths that remember to take the lock.

"Change nothing" lost on both counts: the review blocks implementation, and freezing either rule as written would bake a no-op undo contract and an unenforceable exclusivity rule into the P1.2 implementation.

## Resolved unknowns

| Question | Answer (from the conversation) |
|----------|--------------------------------|
| Should site create-undo remove the row or deactivate it? | Soft-delete (`deleted_at`) with the site ID preserved in the audit snapshot for redo — matching the platform's canonical create-undo pattern |
| Does releasing the site code need a schema change? | No — the uniqueness index is already `WHERE deleted_at IS NULL`, so soft-delete releases the code as a side effect |
| Can a partial unique index alone enforce active-site warehouse exclusivity? | No — one warehouse may legitimately serve several roles within one site, and `is_active` lives on the site row, making the invariant cross-row |
| What enforces exclusivity instead? | A materialized active-membership relation unique on `(tenant_id, organization_id, warehouse_id)`, plus two-integer `pg_advisory_xact_lock(familyId, resourceHash)` keys with reserved Site/warehouse families and warehouse hashes deduplicated and sorted by their signed physical value |
| Which paths must maintain the membership relation? | Activation, deactivation, mapping create, and mapping update/delete while the parent site is active; site update undo reuses activation/deactivation when reversing `is_active` |
| What serializes the Site state that decides membership or permits undo? | A site-scoped advisory key taken before any warehouse keys by activation, deactivation, site create/update undo, and every mapping write — including writes on an inactive site — with `is_active` and `deleted_at` re-read inside it |
| What shape must the concurrency test take? | Two genuinely overlapping transactions proving the chosen constraint or lock, not sequential preflight checks; deliberate cross-family and within-warehouse hash collisions must complete without `40P01`, while a shared membership still resolves to one commit and one stable `409` |
| What must the create-undo test assert? | Removal from list results, release of the site code, redo restoring the same site ID, and both commit orders against a concurrent same-Site mapping create without an orphan child |
| Should the roadmap document change too? | No — the reviewer confirmed the roadmap decomposition is sound and that no split is needed |

## Non-goals

- No implementation, migration, entity, or command code in this change — the specification is the deliverable.
- No change to `.ai/specs/2026-08-13-manufacturing-product-roadmap` scope or to any other capability spec in the PR.
- No relaxation of the exclusivity rule itself; shared warehouses across active sites stay deliberately out of the first core.
- No new `DELETE` route, OpenAPI operation, command, or UI action for a site — soft-delete remains reachable only through the undo path.
- No revisiting of the default-promotion, readiness, or optimistic-locking rules the review did not challenge.

## Affected areas (if known)

- `.ai/specs/2026-08-13-wms-sites-and-warehouse-roles.md`, at the affected points established during the conversation and subsequent reviews:
  - line ~114 — "No route or normal command sets `deleted_at` on a site" must be narrowed to exclude the undo path
  - lines ~157 and ~165 — invariant 5 and the "activation locks" clause must name the membership constraint, the lock key, and the acquisition order
  - invariant 14 — use separate physical lock families, deduplicate/sort actual warehouse hash keys, and cover deliberate collisions in an overlapping-transaction test
  - the entity/index section — the new active-membership relation and its unique constraint must be specified
  - line ~265 — the site create-undo audit rule
  - lines ~394–395 — the concurrency and create-undo test expectations
  - lines ~449–450 — the two risk-table rows that still describe the superseded mitigations
- Tracking issue #5389 (`readiness(wms): P1.2 Sites and warehouse roles`) — context only; no change required by this brief.
