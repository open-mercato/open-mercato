# WMS Ledger Integrity

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Cursor Agent |
| **Created** | 2026-06-13 |
| **Related** | 2026-04-15-wms-phase-1-core-inventory, Issue #388 |

## TLDR

**Key Points:**
- Hardens the WMS inventory engine so the append-only ledger can be trusted as system of record.
- Adds idempotency keys on movements and reservations, ledger↔balance reconciliation, lot eligibility enforcement, per-variant auto-reserve isolation, movements `locationId` filter, and integration test coverage.

**Scope:**
- `InventoryMovement.idempotency_key`, `InventoryReservation.idempotency_key`
- `lib/inventoryIdempotency.ts`, `lib/inventoryReconciliation.ts`
- Command changes in `commands/inventory-actions.ts`
- Auto-reserve changes in `lib/salesOrderInventoryAutomation.ts`
- Events: `wms.inventory.balance_drift`, `wms.inventory.reservation_shortfall`
- CLI: `mercato wms verify-balances`
- API: `GET /api/wms/inventory/movements?locationId=`

## Problem Statement

Six blockers prevent trusting the WMS ledger:

1. No idempotency — `referenceId` required but never deduped; at-least-once paths double-apply stock.
2. No ledger↔balance reconciliation — balances mutated in place; `Math.max(0, …)` on release masks drift.
3. FEFO/FIFO ignores lot eligibility — hold/quarantine/expired lots remain reservable.
4. Auto-reserve has no per-variant error isolation — one `insufficient_stock` aborts all remaining lines.
5. Engine untested against real DB — only mocked cycle-count command test.
6. Movements API lacks `locationId` filter — location detail pages client-filter and drop data.

## Proposed Solution

Six phased fixes, each shippable as a separate PR.

### Phase 1 — Idempotency

- Add nullable `idempotency_key` to `wms_inventory_movements` and `wms_inventory_reservations`.
- Partial unique index: `(organization_id, idempotency_key) where idempotency_key is not null and deleted_at is null`.
- Movement key: `referenceType|referenceId|type|warehouseId|locationFrom|locationTo|catalogVariantId|lotId|serialNumber|quantity`.
- Reservation key: `sourceType|sourceId|catalogVariantId|warehouseId|quantity`.
- Pre-check by key before insert; on unique violation race, reload and return existing result without mutating balances.

### Phase 2 — Reconciliation

- `recomputeBalanceFromMovements()` derives `quantity_on_hand` per bucket from signed movement sums.
- `verifyBalances()` compares derived vs stored balances and reserved/allocated from active reservation metadata.
- CLI `mercato wms verify-balances [--tenant] [--org] [--warehouse] [--repair]`.
- Release command: detect negative post-release values, clamp to 0, emit `wms.inventory.balance_drift` (no hard throw).

### Phase 3 — Lot Eligibility

- `isLotEligible(lot, now)`: `status === 'available'` and (`expiresAt` null or `expiresAt > now`).
- Reserve loop excludes ineligible lots for **all** strategies before availability math.

### Phase 4 — Auto-Reserve Isolation

- Per-variant `try/catch` in `reserveInventoryForConfirmedOrder`.
- Partial reserve allowed; shortfalls collected and emitted as `wms.inventory.reservation_shortfall`.
- In-app notification for supervisors (`wms.inventory.reservation_shortfall` type).

### Phase 5 — Movements `locationId` Filter

- Add `locationId` to `inventoryMovementListQuerySchema`.
- `buildFilters`: `$or` on `location_from_id` / `location_to_id`; compose with search via `$and`.
- `WmsLocationDetailPage`: pass `locationId` server-side, remove client filter.

### Phase 6 — Tests

- Playwright integration specs for idempotency, eligibility, round-trip, concurrency, shortfall, location filter.
- Jest unit tests for `isLotEligible`, idempotency key builder, reconciliation math.

## Data Models

### InventoryMovement (additive)

- `idempotency_key text null`

### InventoryReservation (additive)

- `idempotency_key text null`

## API Contracts

### GET /api/wms/inventory/movements

New query parameter:

- `locationId` (UUID, optional) — matches movements where `location_from_id` or `location_to_id` equals the value.

## Events

| Event ID | When |
|----------|------|
| `wms.inventory.balance_drift` | Release would drive reserved/allocated below zero |
| `wms.inventory.reservation_shortfall` | Auto-reserve could not fully cover order lines |

## Integration Coverage

| ID | Scenario | Test |
|----|----------|------|
| WMS-LI-INT-01 | Duplicate adjust with same reference signature returns same movementId, balance unchanged | `TC-WMS-027` — idempotency retry |
| WMS-LI-INT-02 | Reserve from hold/expired lot rejected; available lot reserved | `TC-WMS-027` — lot eligibility |
| WMS-LI-INT-03 | Reserve → allocate → release round-trip restores availability | `TC-WMS-027` — round-trip |
| WMS-LI-INT-04 | Concurrent reserve on hot SKU (extends TC-WMS-021 pattern) | `TC-WMS-027` — concurrent reserve |
| WMS-LI-INT-05 | Multi-line order partial auto-reserve emits shortfall | `TC-WMS-027` — shortfall notification |
| WMS-LI-INT-06 | Movements filtered by locationId server-side | `TC-WMS-027` — locationId filter |

## Migration & Backward Compatibility

- Additive columns and indexes only.
- New events and notification types are additive.
- Existing API consumers unaffected; `locationId` is optional.

## Changelog

### 2026-06-13
- Initial ledger integrity specification
