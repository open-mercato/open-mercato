# Execution Plan: Fix race condition between gateway webhook and submit route on transaction status update

**Issue:** #4700  
**Branch:** `fix/race-condition-between-gateway-webhook-and-submit-route`  
**Base:** `develop`

## Goal

Prevent `CheckoutTransaction.status` from regressing from a terminal state (e.g. `completed`) back to a non-terminal one (e.g. `processing`). This is done by adding an atomic state-machine guard to `updateTransactionStatusCommand` that rejects invalid transitions using a conditional `nativeUpdate` (WHERE-clause lock), mirroring the pattern from `packages/core/src/modules/payment_gateways/lib/status-machine.ts`.

## Scope

- **`packages/checkout/src/modules/checkout/lib/transaction-status-machine.ts`** (NEW) — state machine constants and `assertValidTransition` helper
- **`packages/checkout/src/modules/checkout/commands/transactions.ts`** — replace the unchecked `transaction.status = nextStatus` + `flush()` with an atomic `nativeUpdate` + row-count check
- **`packages/checkout/src/modules/checkout/commands/__tests__/transaction-status-machine.test.ts`** (NEW) — unit tests covering all allowed and rejected transitions
- **`packages/checkout/src/modules/checkout/commands/__tests__/update-transaction-status.test.ts`** (NEW) — unit tests for the updated command, verifying the guard is enforced end-to-end

## Non-goals

- No schema or migration changes (status column already exists)
- No UI changes
- No changes to the submit route or subscriber wiring (they both call `updateStatus` correctly — the fix is in the command itself)
- No changes to other modules

## Risks

- Existing callers that pass an already-terminal status (e.g. a re-delivered webhook) now get a `409`. The subscriber already `.catch(() => null)` so the error is swallowed gracefully; the submit route (error branch at line 512) also catches errors.

## Implementation Plan

### Phase 1: State machine helper

- [ ] 1.1 Create `packages/checkout/src/modules/checkout/lib/transaction-status-machine.ts` with `VALID_CHECKOUT_TRANSITIONS` and `assertValidCheckoutStatusTransition`

### Phase 2: Atomic guard in the command

- [ ] 2.1 Refactor `updateTransactionStatusCommand` to read `currentStatus` and call `assertValidCheckoutStatusTransition(currentStatus, nextStatus)` before the write
- [ ] 2.2 Replace the ORM tracked-entity write (`transaction.status = nextStatus; flush()`) with an atomic `em.nativeUpdate(CheckoutTransaction, WHERE status IN non-terminal AND id/org/tenant, { status: nextStatus, ... })` + row-count check to throw 409 when 0 rows affected (TOCTOU prevention)

### Phase 3: Tests

- [ ] 3.1 Write unit tests for `transaction-status-machine.ts` (all transitions: allowed, rejected, same-state, terminal)
- [ ] 3.2 Write unit tests for `updateTransactionStatusCommand` with a mock EM verifying: terminal→non-terminal is rejected with 409, non-terminal→terminal succeeds, already-terminal→same is rejected

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: State machine helper

- [x] 1.1 Create `transaction-status-machine.ts`

### Phase 2: Atomic guard in the command

- [x] 2.1 Add `assertValidCheckoutStatusTransition` call in command
- [x] 2.2 Replace tracked-entity write with atomic `nativeUpdate`

### Phase 3: Tests

- [x] 3.1 Unit tests for the state machine
- [x] 3.2 Unit tests for `updateTransactionStatusCommand`
