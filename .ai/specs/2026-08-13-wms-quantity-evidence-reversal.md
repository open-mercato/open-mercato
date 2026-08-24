# WMS Quantity Evidence and Correlated Reversal

## TLDR

P1.3c adds immutable UoM evidence to UoM-aware WMS reservations and movements and makes reversal explicitly reference the original movement. A reversal copies the historical quantity evidence and negates the persisted normalized quantity; it never recalculates from current Catalog configuration.

This capability is independently deployable after P1.3a and P1.3b. It does not introduce production-specific movement names, generic posting groups, opaque reference/reason registration, backflush calculation, or Manufacturing orchestration; P1.8 consumes this generic evidence and reversal foundation.

## Overview and Status

**Status:** Design complete — parent-roadmap acceptance and readiness review pending.

**Roadmap classification:** P1.3c, WMS-owned backlog. It resolves missing historical evidence in the existing ledger and is non-critical for current WMS operation and non-stock Manufacturing work. It is mandatory before P1.8/P1.11 stock-affecting production.

**Dependencies:**

- `2026-08-13-catalog-quantity-normalization.md` for `QuantityNormalizationSnapshotV1`.
- `2026-08-13-wms-quantity-precision-alignment.md` for exact WMS storage and arithmetic.

**Consumer:** P1.8 generic WMS posting-group contract and Manufacturing adapter, including exact compensation of explicit issues and cumulative/fixed backflush lines from their persisted evidence.

## Problem Statement

WMS currently stores a normalized-looking quantity without recording how the caller arrived at it. After a Catalog base unit, factor, or rounding policy changes, a historical movement cannot prove its entered quantity/unit, factor, rounding, or normalized result.

Current guidance prefers counter-actions over generic command undo, but the movement model has no `reversalOfMovementId`, no remaining-reversible quantity, and no rule requiring reversal to use the original persisted value. A caller can simulate a reversal with a new adjustment, but that loses causation and may produce a different amount.

P1.8 cannot safely translate Manufacturing issue, output, scrap, or backflush semantics into generic physical posting groups until this historical contract exists.

## Scope

### In scope

- A bounded, versioned provider-neutral quantity snapshot on UoM-aware WMS reservations and movements.
- Additive entered/normalized quantity request and response fields for UoM-aware operations.
- Source movement correlation and remaining-reversible accounting.
- Full and partial reversal commands with idempotency, locking, audit, events, and exact arithmetic.
- Compatibility behavior for legacy records without evidence.
- Read APIs, OpenAPI, migrations, integration tests, and reconciliation evidence.

### Out of scope

- Precision widening or base ledger arithmetic, owned by P1.3b.
- Catalog normalization implementation, owned by P1.3a.
- Generic posting groups, opaque source/reason registration and display fallback, Manufacturing backflush calculation/authorization, or saga orchestration, owned by P1.8.
- Sales returns/RMA business flow redesign.
- Reconstructing fabricated snapshots for legacy movements.
- A generic undo button for physical stock history.

## Current State Audit

| Surface | Current behavior | Evidence | Gap |
|---|---|---|---|
| Movement | Quantity, type, reference type/id, actor/time; no UoM evidence | `packages/core/src/modules/wms/data/entities.ts` | Cannot interpret conversion history |
| Reservation | Quantity and source; no UoM evidence | `wms/data/entities.ts` | Same gap |
| Actions | Receive/move/adjust/reserve accept quantity but no entered unit/snapshot | `wms/data/validators.ts`; `commands/inventory-actions.ts` | Consumers can implement inconsistent conversion |
| Idempotency | Stable lookup keys prevent duplicate requests | `wms/lib/inventoryIdempotency.ts` | Reuse for reversal |
| Counter-actions | Preferred over generic undo for physical facts | `wms/commands/inventory-actions.ts` | No explicit source correlation |
| Release | State behavior exists for reservations | `inventory-actions.ts` | Does not replace movement reversal contract |

## Data and Domain Contract

### Quantity evidence

UoM-aware reservation and movement writes persist a bounded snapshot compatible with the P1.3a provider-neutral type:

```ts
type QuantityNormalizationSnapshotV1 = {
  version: 1
  productId: string
  productVariantId: string | null
  baseUnitCode: string
  enteredUnitCode: string
  enteredQuantity: string
  toBaseFactor: string
  normalizedQuantity: string
  rounding: { mode: 'half_up' | 'down' | 'up'; scale: number }
  source: { conversionId: string | null; resolvedAt: string }
}
```

Rules:

- WMS validates snapshot scope, variant identity, canonical decimal fields, and that `normalizedQuantity` equals the command's base-unit quantity.
- A trusted in-process command may resolve the snapshot through Catalog inside its transaction preparation; an external caller cannot assert arbitrary normalized evidence without validation.
- The snapshot is immutable evidence and is not an inventory aggregation dimension.
- Snapshot JSON is bounded, versioned, and contains no growing arrays.
- Read responses expose a typed snapshot or explicit `null` for legacy evidence.

### Additive storage

Candidate additive fields:

| Entity | Field | Purpose |
|---|---|---|
| `wms_inventory_reservations` | `quantity_snapshot jsonb null` | Historical entered/base conversion evidence |
| `wms_inventory_movements` | `quantity_snapshot jsonb null` | Historical entered/base conversion evidence |
| `wms_inventory_movements` | `reversal_of_movement_id uuid null` | Scalar self-reference to original movement |

The implementation may add a separate bounded reversal-allocation table if partial reversals require more than a unique source link. It remains WMS-local, scoped, indexed, append-only, and must not create cross-module ORM relations.

Required indexes support scoped lookup by original movement and idempotency/correlation. Existing movement IDs and indexes remain stable.

### Reversal invariant

- A reversal identifies exactly one original movement in the same tenant and organization.
- It uses the exact persisted normalized quantity, or an exact partial amount no greater than the unreversed remainder.
- It copies the original quantity snapshot and records source correlation.
- It does not read current Catalog policy to compute the reversal amount.
- Direction/location effects are the exact inverse defined for the original generic WMS action.
- A full reversal restores affected balances to their exact preceding values.
- Multiple partial reversals may sum to the original amount but never exceed it.
- Remaining-reversible validation and movement creation occur under appropriate locks in one transaction.
- The same idempotency key returns the existing reversal; concurrent distinct requests cannot over-reverse.
- Physical movements are never deleted. Reversal is an append-only compensating fact.

P1.8 later defines how a generic posting group invokes these primitives atomically and how a Manufacturing-owned adapter derives its concrete lines.

## Commands, API, and Errors

All writes remain command-driven. Conceptual additive commands:

- `wms.inventory-movement.reverse`
- an additive UoM-aware variant or optional fields on existing reservation/receive/move commands, selected during compatibility review.

Existing command IDs and payload meanings are not changed. A published quantity field cannot switch from normalized/base quantity to entered quantity.

Any custom HTTP write route:

- exports `openApi` and method metadata with feature guards;
- runs mutation guards and uses the existing command bus;
- returns canonical decimal strings for new exact fields;
- uses the original movement's optimistic/concurrency state and database locks rather than trusting client-calculated remainder.

| Error | Status | Meaning |
|---|---|---|
| `wms.quantity_snapshot_invalid` | `422` | Snapshot is malformed or disagrees with normalized quantity/scope |
| `wms.quantity_snapshot_required` | `422` | UoM-aware operation lacks authoritative evidence |
| `wms.movement_not_reversible` | `409` | Movement type/state cannot be reversed by this primitive |
| `wms.reversal_exceeds_original` | `409` | Requested amount exceeds remaining reversible quantity |
| `wms.reversal_already_complete` | `409` | Original movement has no reversible remainder |
| Not found | `404` | Original/related record is absent or foreign-scope |

## Legacy and Migration Behavior

- Add nullable columns/tables only; existing records remain unchanged.
- Legacy records expose `quantitySnapshot: null` and an evidence status such as `legacy_base_quantity`.
- P1.3c does not fabricate historical entered units or factors.
- A legacy movement may use a restricted base-quantity reversal only when the current profile/base-unit identity is unambiguous and the operator provides an audited reason; otherwise it fails closed and requires an existing manual correction process.
- Existing adjustment/move/return endpoints retain their behavior and are not relabeled as reversals.
- Existing API response fields remain; new snapshot and correlation fields are optional additions.
- New events use singular entity naming and additive payload fields. Existing event IDs are never renamed or removed.
- Database migrations and snapshots ship with the implementation; local application requires explicit approval.

## Implementation Tasks

| Task | Deliverable | Evidence |
|---|---|---|
| C1 | Snapshot schema, validator, and compatibility mapper | Round-trip and malformed/scope mismatch tests |
| C2 | Reservation/movement additive persistence | Migration SQL, snapshot, API read/write tests |
| C3 | Trusted normalization handoff | Catalog-resolved result cannot be forged by external input |
| C4 | Full reversal command | Exact balance restoration, audit/event/idempotency evidence |
| C5 | Partial reversal accounting | Locked remainder and concurrent over-reversal tests |
| C6 | Legacy policy | Readability plus allowed/blocked legacy reversal scenarios |
| C7 | Reconciliation projection | Original, reversed, and remaining quantities are explainable |
| C8 | P1.8 consumer contract | Contract tests prove generic posting groups and optional namespaced source/reason registrations can be added without changing P1.3c semantics or hard-coding Manufacturing vocabulary in WMS |

## Integration Coverage and Exit Criteria

Required self-contained cases:

1. Receive in `box`, normalize through Catalog, and store entered plus base evidence.
2. Change the Catalog factor; historical movement response remains unchanged.
3. Full reversal uses the stored value and restores the exact prior balance.
4. Two partial reversals sum exactly to the original.
5. A partial reversal exceeding the remainder returns `409` without mutation.
6. Duplicate idempotency key returns the same reversal.
7. Concurrent reversals cannot exceed the original.
8. At least 10,000 movement/full-reversal cycles produce zero decimal drift.
9. Foreign tenant/org original movement returns non-disclosing `404`.
10. Invalid or forged snapshot is rejected.
11. Legacy record without snapshot remains readable; restricted reversal follows the declared policy.
12. Existing non-reversal WMS APIs regress cleanly.

Tests create Catalog/WMS fixtures through APIs and clean them in `finally`/teardown. Query-count assertions prevent per-row Catalog lookups on lists.

P1.3c passes when immutable evidence survives master-data changes, correlated full/partial reversals are exact and concurrency-safe, and legacy behavior is explicit. P1.3a remains the early quantity-schema gate; completion of P1.3b–c is the later WMS execution gate before stock-affecting production.

## Performance, Security, and Cache

- Snapshot writes add no post-normalization lookup.
- Reversal lookup is indexed by tenant/org/original movement and uses bounded locked rows.
- Snapshot size has a tested upper bound and no nested history.
- Reconciliation over large history is paginated; operations over 1,000 rows use queue/progress.
- Cache is not authoritative for reversible remainder; transaction reads use the database.
- Every query filters tenant and organization and validates related IDs.
- Snapshot data is non-PII; encryption changes are N/A.
- Inputs use zod, parameterized persistence, translated errors, and bounded logging.

## Risks and Impact Review

| Severity | Scenario | Mitigation | Residual risk |
|---|---|---|---|
| Critical | Cross-scope movement is reversed | Scoped locked lookup and adversarial test | Low |
| Critical | Concurrent partial reversals exceed original | Transactional remainder lock and exact arithmetic | Low |
| High | Current factor is used for historical reversal | Snapshot copy and no Catalog read in reversal calculation | Low |
| High | External caller forges normalized evidence | Trusted resolver handoff and server validation | Low |
| Medium | Legacy movement cannot be safely reversed | Explicit restricted policy and audited manual correction fallback | Medium |
| Medium | Snapshot storage grows ledger | Bounded schema and size test | Low |
| Low | Reconciliation query becomes slow | Scoped indexes and pagination | Low |

## Validation and Compliance

Documentation validation uses `git diff --check` and `yarn agents:check-budget`. Implementation uses generation, migration generation/review, relevant shared/core tests, core build, and focused self-contained WMS integration tests. `yarn db:migrate` requires approval.

- One capability: immutable WMS quantity evidence plus its correlated compensation lifecycle.
- Generic posting-group and Manufacturing-specific adapter semantics remain P1.8.
- Commands are append-only, transactionally locked, auditable, idempotent, and scoped.
- API/schema changes are additive and legacy records remain readable.
- No cross-module ORM relationship is introduced.
- No new UI is required beyond existing detail/audit presentation of additive evidence.

**Verdict:** Design complete as WMS-owned non-critical backlog, pending P1.3a/P1.3b and pre-implementation readiness audit; mandatory before stock-affecting production.

## Changelog

- 2026-08-13: Created P1.3c from the audited WMS evidence/reversal portion of the original quantity proposal.
- 2026-08-19: Aligned P1.3c with the generic WMS posting-group boundary: Manufacturing semantics and line derivation remain in the future P1.8 adapter; aligned governance with pending parent-roadmap acceptance.

### Review — 2026-08-13

- **Reviewer:** Agent
- **Security:** Passed.
- **Performance:** Passed.
- **Cache:** Passed; database remains authoritative for remainder.
- **Commands:** Passed; append-only reversal is fully specified.
- **Risks:** Passed.
- **Verdict:** Design complete, pending parent-roadmap acceptance and readiness review; implementation remains gated.
