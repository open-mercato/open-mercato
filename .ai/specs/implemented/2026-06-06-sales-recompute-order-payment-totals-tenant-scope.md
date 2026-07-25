# sales(payments): scope `recomputeOrderPaymentTotals` order lookups by tenant/organization

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | izqzmyli (rajan.bor@boringcode.pl) |
| **Co-Author** | Claude Opus 4.8 |
| **Created** | 2026-06-06 |
| **Related** | [#2111](https://github.com/open-mercato/open-mercato/issues/2111), [#2333](https://github.com/open-mercato/open-mercato/issues/2333) (umbrella), [#2121](https://github.com/open-mercato/open-mercato/issues/2121) (audit tracker), [#2122](https://github.com/open-mercato/open-mercato/pull/2122) (S-01 sibling), [packages/core/AGENTS.md](../../packages/core/AGENTS.md), [packages/core/src/modules/sales/AGENTS.md](../../packages/core/src/modules/sales/AGENTS.md) |

## TLDR

**Key Points:**
- `recomputeOrderPaymentTotals` and its callers in `packages/core/src/modules/sales/commands/payments.ts` look up `SalesOrder` rows **by id alone**, without a `tenantId`/`organizationId` filter.
- After PR #2122 closed the most obvious injection vector (cross-tenant payment allocations), this remains a defence-in-depth gap — any future bug, mis-migration, or admin path that places a foreign `orderId` on a payment would silently re-open cross-tenant write of `paid_total_amount` / `refunded_total_amount` / `outstanding_amount`.
- Fix: derive a `scope` object from the controlling payment row once per handler and forward it to every `findOne(SalesOrder, …)` (including the `PESSIMISTIC_WRITE` row-lock acquisitions), then add an explicit `ensureSameScope(order, expectedOrgId, expectedTenantId)` guard immediately after every fetch.

**Scope:**
- Modify only `packages/core/src/modules/sales/commands/payments.ts`. Seven (7) call sites + the inner lock in the function itself.
- No public API or schema change. Unit tests proving cross-tenant `orderId` → no-op / 404 (never an `UPDATE`).
- No migration. No new dependencies. No locale changes.

**Concerns:**
- Two of the call sites already follow the correct shape (`findOneWithDecryption(..., scope)`); the rest use raw `em.findOne` / `tx.findOne` and skip scope. Keep `findOne` (not `findOneWithDecryption`) for the lock-only and cache-lookup sites — they do not read encrypted fields — but they still need the scope filter (per `packages/core/AGENTS.md` "Never expose cross-tenant data or omit tenant/organization scoping").
- Preserve `LockMode.PESSIMISTIC_WRITE` semantics exactly: only the WHERE clause gains the `tenantId`/`organizationId` filter.
- Behaviour for legitimate cross-org transfers within one tenant: scope is derived from `payment.tenantId`/`payment.organizationId` (which IS the trust root for that command). A payment cannot legitimately reference an order in a different tenant or organization, so failing closed here matches the existing security model already enforced for `recomputeOrderPaymentTotals` callers via prior PRs.

## Overview

Security finding S-02 from the 2026-05-27 CRM/Sales/Catalog audit (`.ai/runs/2026-05-27-crm-sales-catalog-audit/`) confirmed `recomputeOrderPaymentTotals` and its surrounding command flows in `payments.ts` read `SalesOrder` by id only. S-01 (PR #2122) closed the visible injection path (cross-tenant `orderId` on payment allocation), but the reads remain unscoped — a single-layer defence. This spec hardens the read side so the function fails closed even if a future injection vector is reintroduced.

## Problem Statement

In `packages/core/src/modules/sales/commands/payments.ts`:

| Site | Handler | Current shape | Risk |
|------|---------|---------------|------|
| L258 | `recomputeOrderPaymentTotals(em, order)` lock | `em.findOne(SalesOrder, { id: orderId }, { lockMode: PESSIMISTIC_WRITE })` | Locks any order with matching id, regardless of scope |
| L668 | `createPaymentCommand.redo` cache lookup | `em.findOne(SalesOrder, { id: orderId })` | Refreshes cache for any tenant's order |
| L932 | `updatePaymentCommand.execute` lock | `tx.findOne(SalesOrder, { id: nextOrderId }, { lockMode: PESSIMISTIC_WRITE })` | Locks + recomputes totals on a foreign order |
| L941 | `updatePaymentCommand.execute` cache lookup | `em.findOne(SalesOrder, { id: nextOrderId })` | Cache invalidation on a foreign order |
| L947 | `updatePaymentCommand.execute` previous-order lock | `tx.findOne(SalesOrder, { id: previousOrder.id }, { lockMode: PESSIMISTIC_WRITE })` | Locks + recomputes totals on a foreign order |
| L1072 | `deletePaymentCommand.execute` lock | `tx.findOne(SalesOrder, { id: orderId }, { lockMode: PESSIMISTIC_WRITE })` | Locks + recomputes totals on a foreign order |
| L1083 | `deletePaymentCommand.execute` cache lookup | `em.findOne(SalesOrder, { id: orderId })` | Cache invalidation on a foreign order |

If any code path manages to place a foreign-scope `orderId` onto a payment or allocation row (defensive-depth concern), these reads silently produce a writable, locked `SalesOrder` from another tenant/org, and `recomputeOrderPaymentTotals` then overwrites its financial totals. There is no current exploit after #2122; this spec eliminates the latent single-layer-defence risk.

## Proposed Solution

For every site above, two changes:

1. **Scope filter in the WHERE clause** — extend `{ id }` to `{ id, organizationId, tenantId }`. The scope values come from the **controlling payment row** (the trust root of each command), already loaded via `findOneWithDecryption(..., scope)` earlier in the handler and validated by `ensureSameScope(payment, …)`.

2. **Defence-in-depth `ensureSameScope`** — immediately after each fetch, call `ensureSameScope(orderRecord, expectedOrgId, expectedTenantId)` so a soft-deletion / replication race / future helper-side bug cannot still hand back a foreign record without being noticed.

For `recomputeOrderPaymentTotals` itself, derive `scope` exactly as today (`{ organizationId: order.organizationId, tenantId: order.tenantId }`) and forward it into the L258 lock query; this turns the function into self-defence (catches a caller that passed a wrong-scope `order` parameter).

### Visual shape

Before:

```ts
const lockedOrder = await tx.findOne(SalesOrder, { id: nextOrderId }, { lockMode: LockMode.PESSIMISTIC_WRITE })
if (!lockedOrder) return undefined
const result = await recomputeOrderPaymentTotals(tx, lockedOrder)
```

After:

```ts
const scope = { organizationId: payment.organizationId, tenantId: payment.tenantId }
const lockedOrder = await tx.findOne(
  SalesOrder,
  { id: nextOrderId, ...scope },
  { lockMode: LockMode.PESSIMISTIC_WRITE },
)
if (!lockedOrder) return undefined
ensureSameScope(lockedOrder, payment.organizationId, payment.tenantId)
const result = await recomputeOrderPaymentTotals(tx, lockedOrder)
```

The same shape applies to L668/L941/L1083 (cache-lookup `findOne`) and L1072 (delete-handler lock).

## Architecture

The fix is local to `payments.ts`. It does not introduce new helpers, new modules, or new DI bindings. `ensureSameScope` is already imported from `./shared` (re-exported from `@open-mercato/shared/lib/commands/scope`).

No event/payload, no API URL, no DB schema, no DI key, no ACL feature is added or renamed.

## Data Models

No data-model changes.

## API Contracts

No HTTP/API contract changes.

### Status codes / shape

- Cross-tenant `orderId` on a payment now returns the same result as a missing order: the `recompute` step is a no-op, no `UPDATE` is issued, `invalidateOrderCache` is skipped. `ensureSameScope` will throw `CrudHttpError(400)` only when a row IS returned but its scope differs from the controlling payment — a near-impossible state given the scope filter in the WHERE, but enforced as belt-and-suspenders.

## UI/UX

N/A.

## Configuration

No env vars, no feature flags.

## Alternatives Considered

1. **Add `ensureSameScope` only, leave the WHERE clauses unscoped.** Rejected — `ensureSameScope` is a runtime assertion, not a SQL filter. The row would still be locked / read at the DB layer before the assertion fires; preserving the scope filter avoids the cross-tenant `SELECT ... FOR UPDATE` entirely. Also leaves DB-layer audit logs showing cross-tenant reads.
2. **Replace raw `em.findOne` with `findOneWithDecryption` everywhere.** Rejected for this PR — the affected sites do not read encrypted fields and the existing in-line comment justifies the raw `findOne` choice. Mixing the helper change with the scope fix would expand the diff beyond the audit finding and conflate two concerns (#2111 vs #2112). #2112 will address decryption-helper usage in a separate PR.
3. **Centralise lock acquisition in a `scopedLockOrder(em, id, scope)` helper.** Rejected — adds a new module-internal abstraction for two distinct lock-vs-cache-lookup shapes for the sake of a 7-site fix. Trivial in-place edits are clearer and easier to audit.
4. **Defer to umbrella #2333.** Rejected — #2333 is a tracker; the individual hardening fixes land as separate PRs (as #2122 did for S-01).

## Implementation Approach

### Phase 1 — Apply the seven scope fixes (single commit)

Edit `packages/core/src/modules/sales/commands/payments.ts`:

1. **L258 — `recomputeOrderPaymentTotals` function** (the inner lock):
   - Existing `const scope = { organizationId: order.organizationId, tenantId: order.tenantId }` is already in scope.
   - Replace `em.findOne(SalesOrder, { id: orderId }, …)` with `em.findOne(SalesOrder, { id: orderId, ...scope }, …)`.

2. **L668 — `createPaymentCommand.redo` cache lookup**:
   - Add `const scope = { organizationId: after.organizationId, tenantId: after.tenantId }` (or inline the spread).
   - Replace with `em.findOne(SalesOrder, { id: orderId, ...scope })` and call `ensureSameScope(target, after.organizationId, after.tenantId)` if found.

3. **L932 — `updatePaymentCommand.execute` lock**:
   - Use `payment.organizationId / payment.tenantId` (already validated by `ensureSameScope(payment, …)` earlier in the handler).
   - Replace with `tx.findOne(SalesOrder, { id: nextOrderId, organizationId: payment.organizationId, tenantId: payment.tenantId }, { lockMode: LockMode.PESSIMISTIC_WRITE })` and assert `ensureSameScope(lockedOrder, payment.organizationId, payment.tenantId)` after the null-check.

4. **L941 — `updatePaymentCommand.execute` cache lookup**: same pattern as 3.

5. **L947 — `updatePaymentCommand.execute` previous-order lock**: use `previousOrder.organizationId / previousOrder.tenantId` (the previous order was loaded with scope on the controlling payment, so its scope equals `payment.organizationId/tenantId`). Assert `ensureSameScope` after fetch.

6. **L1072 — `deletePaymentCommand.execute` lock**: use `payment.organizationId / payment.tenantId`. Same shape as 3.

7. **L1083 — `deletePaymentCommand.execute` cache lookup**: use `payment.organizationId / payment.tenantId`. Same shape as 3.

### Phase 2 — Unit tests (same commit)

Add tests in `packages/core/src/modules/sales/commands/__tests__/payments.tenant-scope.test.ts`:

- A payment in tenant `T1`/org `O1` whose `orderId` was somehow set to an order in `T2`/`O2`: `sales.payments.update` must skip the recompute branch, never issue `UPDATE sales_orders SET paid_total_amount = …`, and never call `invalidateOrderCache` for the foreign row.
- Same for `sales.payments.delete`.
- Same for `sales.payments.create.redo`.
- Regression: legitimate same-scope path still recomputes and invalidates exactly once.

The tests use the existing mock pattern in `packages/core/src/modules/sales/commands/__tests__/` (no DB roundtrip; jest fakes for `em.findOne` / `tx.findOne`).

### Phase 3 — Validation

```bash
yarn workspace @open-mercato/core test --testPathPatterns="sales/commands"
yarn typecheck
```

No `yarn db:generate` (no schema change). No `yarn generate` (no auto-discovered file changed).

## Migration Path

No callers change. No deprecation needed. The behaviour change is "fail-closed where the prior behaviour was fail-open at the same call site"; semantics for legitimate same-scope traffic are identical.

## Backward Compatibility

| Surface | Classification | Impact |
|---------|----------------|--------|
| Public exports from `payments.ts` | UNCHANGED | All command ids, schemas, handler signatures preserved |
| `recomputeOrderPaymentTotals` internal function | UNCHANGED signature | Body gains a scope filter inside the existing `if (options?.lock)` branch |
| API request/response | UNCHANGED | No HTTP-surface change |
| DB schema | UNCHANGED | No migration |
| Events / indexer / cache aliases | UNCHANGED | Same emit + invalidation calls; just guarded by scope |

No `BACKWARD_COMPATIBILITY.md` contract surface is touched.

## Success Metrics

- All seven sites pass the scope filter + `ensureSameScope` assertion.
- New regression tests fail on `main` (pre-fix) and pass on the fix branch.
- `yarn workspace @open-mercato/core test` for `sales/commands/` is green; no existing sales test regresses.
- `tsc --noEmit` clean for `packages/core`.

## Open Questions

- Whether to extend the same hardening to the `findOneWithDecryption(..., SalesOrder, …)` sites in `payments.ts` (L603, L638) — those already pass scope to the helper, so they are correct. No change needed; flagged here only for review reviewers' convenience.
- Whether the audit's mention of "related SalesInvoice lookups" requires action — current `payments.ts` has no unscoped `findOne(SalesInvoice, …)` (verified via grep). Likely already addressed in a previous PR; left out of scope.

## Risks & Impact Review

| # | Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|----------|----------|---------------|------------|---------------|
| R1 | Legitimate same-scope flow regression: scope filter rejects a row that previously matched | Medium | `sales.payments.{create.redo, update, delete}` | Tests assert the legitimate same-scope path still recomputes + invalidates exactly once; scope is derived from the controlling payment row whose tenant/org match was already enforced by `ensureSameScope(payment, …)` earlier in each handler | None for in-tenant traffic — payments cannot legitimately reference cross-tenant orders, which is exactly the property the fix enforces |
| R2 | `ensureSameScope` throws on a soft-deleted-and-replicated row whose scope is unchanged | Low | All 7 sites | `ensureSameScope` compares the loaded row's `tenantId`/`organizationId` against the controlling payment's. Soft-deletion does not change scope; so this assertion is true by construction whenever the scope filter returned a row | None |
| R3 | Cross-org transfer within one tenant: payment in org `O1` of tenant `T1` referencing order in org `O2` of `T1` | Low | `updatePaymentCommand` (orderId change) | The fix uses `payment.organizationId` (not `tenant-only`). Cross-org transfer would be rejected. **This matches the existing security model**: `ensureOrganizationScope(ctx, input.organizationId)` already gates every command, so cross-org references via UI are impossible today. Fix is consistent | None — semantics unchanged for legitimate use |
| R4 | Audit logging shows a cross-tenant `SELECT … FOR UPDATE` that didn't happen pre-fix | Informational | DB query logs | New behaviour: the scoped SELECT silently returns 0 rows when the foreign id is queried, vs the old behaviour that returned the row and proceeded to UPDATE. This is a strict improvement for audit trails | None |
| R5 | Future code path adds a new `findOne(SalesOrder, …)` in `payments.ts` and forgets the scope | High | All future `payments.ts` edits | Documentation: spec linked from PR; new tests serve as red-line example; `packages/core/AGENTS.md` "Never expose cross-tenant data" rule is already in place. Future auto-review surfaces this | Out of scope for this PR; addressed by general code-review discipline |

### Failure-mode demonstration

The new tests assert the failure mode goes from "silent cross-tenant UPDATE" to "no-op". Specifically: a payment in scope `{T1, O1}` whose `orderId` is set (by a hypothetical bug) to an order in `{T2, O2}`:

- Pre-fix: `tx.findOne(SalesOrder, { id: foreignId }, { lockMode: PESSIMISTIC_WRITE })` returns the foreign order, `recomputeOrderPaymentTotals` issues `UPDATE sales_orders SET paid_total_amount = …` against it.
- Post-fix: same call with `…, organizationId: 'O1', tenantId: 'T1'` returns `null`, the handler returns `undefined` from the inner `em.transactional` block, no UPDATE is issued, `invalidateOrderCache` is skipped.

## Final Compliance Report

| Check | Result | Notes |
|-------|--------|-------|
| `BACKWARD_COMPATIBILITY.md` contract surfaces touched | None | No public API, type, signature, import-path, event-id, widget-spot-id, route, DB schema, DI key, ACL feature, notification id, CLI command, or generated file changes |
| `packages/core/AGENTS.md` "Never expose cross-tenant data or omit tenant/organization scoping" | Satisfied | Every `findOne(SalesOrder, …)` site now passes a scope filter |
| `packages/core/AGENTS.md` Encryption rule (use `findWithDecryption`/`findOneWithDecryption` for encrypted entities) | Not applicable here | Affected sites are lock-only or cache-only lookups that do not read encrypted fields; existing in-line comments already justify the raw `findOne` choice. Decryption-helper coverage is tracked separately by [#2112](https://github.com/open-mercato/open-mercato/issues/2112) |
| `packages/core/src/modules/sales/AGENTS.md` "MUST scope all documents to a channel" | Not affected | Channel scoping is independent of tenant/org scoping; this fix tightens tenant/org only |
| Validators (zod) updates | None | No input schema change |
| Migrations / `yarn db:generate` | None required | No schema change |
| Generators / `yarn generate` | None required | No auto-discovered file changed |
| Integration coverage | Implemented in this PR | Unit-test coverage proves the scope filter and `ensureSameScope` assertion; documented in "Implementation Approach → Phase 2" |
| Locale / i18n | None | No user-facing string added |
| Default role features / ACL sync | None | No new feature declared |
| `runCrudCommandWrite` opportunistic migration | Skipped | This is a defensive-read fix, not a write-orchestration refactor; out of scope |

## Changelog

### 2026-06-06
- Initial draft.
