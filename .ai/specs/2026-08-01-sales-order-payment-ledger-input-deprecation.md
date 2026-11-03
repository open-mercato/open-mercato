# Sales order payment-ledger input deprecation

## 📝 TLDR

`paidTotalAmount`, `refundedTotalAmount`, and `outstandingAmount` remain accepted by `orderCreateSchema`, `sales.orders.create`, and `POST /api/sales/orders` for at least one minor release, preserving the shipped contract. When supplied, they remain ignored because recorded payments are the authoritative ledger, but the command and HTTP response now return a machine-readable deprecation warning and the process emits a bounded structured warning.

## Resolved assumptions (autonomous defaults)

| Question | Decision | Rationale |
|---|---|---|
| Q1: Stage deprecation or introduce supported header-level ledger semantics now? | Stage deprecation. | This is the lowest-blast-radius path that satisfies the released-contract rules without inventing a second payment source of truth or requiring a schema migration. |
| Q2: Reject the fields during this release? | No. | `BACKWARD_COMPATIBILITY.md` requires the working acceptance bridge to remain for at least one minor release. |
| Q3: Use an HTTP `Deprecation` header? | No. | RFC 9745 scopes that header to the resource/operation; only three request fields are deprecated, so a response-body warning is more precise and directly available to command callers too. |
| Q4: Include removal or header-level import support in this PR? | No; defer both. | Either follow-up is independently deployable and requires a new compatibility/product decision. |

## 📝 Problem Statement

The released order-create schema accepts three payment-ledger projection fields, but the create command ignores their values and recomputes the ledger from recorded payments. Immediate rejection would expose the bug but would also narrow exported validator/type and HTTP request contracts in violation of the repository deprecation protocol.

## 📝 Proposed Solution

Preserve request acceptance and current persistence semantics for one minor release. Detect supplied legacy fields before command execution, return a stable warning code plus the exact supplied field names from both the command and HTTP create response, emit one structured process warning to avoid bulk-import log floods, retain the fields in OpenAPI with explicit deprecation guidance, and document migration to real payment rows.

### Design decisions

| Decision | Rationale |
|---|---|
| Payment rows remain the sole ledger source of truth. | Medusa likewise models order payment state through payment capture/refund operations rather than writable order aggregates; Open Mercato already recomputes these columns from `SalesPayment` and `SalesPaymentAllocation`. |
| Add an optional command/HTTP warning result. | It reaches HTTP, command-bus, importer, inbox, and AI callers without changing accepted input or successful persistence behavior. |
| Emit one structured process warning. | Operators see legacy usage while a 473k-row import cannot flood logs. The returned warning remains per-call. |
| Do not use RFC 9745's `Deprecation` response header. | [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html) says the header describes deprecation of the resource identified by the URI and must not change resource behavior. Here the endpoint remains supported; only three request members are deprecated. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Reject the fields immediately. | Breaks a released request and exported schema/type contract without the required bridge window. |
| Persist the supplied aggregate directly. | The next real payment mutation overwrites it from payment rows, producing an unreconciled second source of truth. |
| Create a synthetic payment row automatically. | Requires payment method/status/idempotency semantics that are absent from the request and is a larger money-path product design. |
| Return only a translated message. | Messages are presentation concerns; a stable code plus field list is machine-readable and avoids adding hard-coded user-facing text. |

## 📝 Overview

This specification covers one independently deployable capability: a compatibility-safe deprecation bridge for legacy order-create payment totals. It does not add support for importing header-only payment aggregates and it does not remove the fields.

> **Market reference:** [Medusa's order payment model](https://docs.medusajs.com/user-guide/orders/payments) treats payment status and outstanding amounts as results of capture/refund flows. Open Mercato adopts that single-ledger principle and rejects the complexity of silently synthesizing payment history from an order header.

## User stories / use cases

- An integration author sending a legacy full-order payload wants the request to keep succeeding during the migration window and to receive a machine-readable signal naming ignored fields.
- An operator running a bulk import wants one actionable warning in structured logs without a warning per imported order.
- A module author wants OpenAPI and upgrade notes to explain that recorded payments, not order aggregates, are the supported migration path.

## 📝 Architecture

The change stays inside the `sales` module and reuses the existing command-backed `makeCrudRoute` flow.

1. `orderCreateSchema` continues parsing the three optional non-negative decimal fields. Each source declaration carries `@deprecated` guidance, and `ORDER_PAYMENT_LEDGER_FIELDS` remains the canonical detection list.
2. `sales.orders.create` detects own properties on the raw input before its first parse. It never trusts these values for calculation or persistence.
3. The command returns `{ orderId, warnings? }`. When one or more deprecated fields were supplied, `warnings` contains one entry with a stable code and the supplied field names.
4. The route's existing command response mapper converts `orderId` to `id` and forwards `warnings` unchanged. No wrapper route or duplicate request parsing is introduced.
5. A module-level boolean bounds the structured deprecation warning to once per process. The log contains field names, not values, credentials, or customer data.
6. `buildDocumentOpenApi` keeps the fields in the create request schema, adds deprecation/migration guidance to the order-create operation description, and documents the optional warning result.

No new DI key, event, subscriber, queue, cache, or cross-module dependency is introduced.

## 📝 Data Model

No entity, column, relationship, migration, backfill, or cache key changes. `SalesPayment` and `SalesPaymentAllocation` remain authoritative. `SalesOrder.paid_total_amount`, `refunded_total_amount`, and `outstanding_amount` remain derived projections.

## 📝 API Contracts

### Command: `sales.orders.create`

The request remains structurally compatible:

```ts
{
  // existing fields
  /** @deprecated Ignored. Record a payment instead. */
  paidTotalAmount?: number
  /** @deprecated Ignored. Record a payment instead. */
  refundedTotalAmount?: number
  /** @deprecated Ignored. Derived from the order total and payments. */
  outstandingAmount?: number
}
```

The response is additive:

```ts
{
  orderId: string
  warnings?: Array<{
    code: 'sales.order.payment_ledger_input_deprecated'
    fields: Array<'paidTotalAmount' | 'refundedTotalAmount' | 'outstandingAmount'>
  }>
}
```

### HTTP: `POST /api/sales/orders`

- Authentication, feature guards, status `201`, mutation guards, operation header, and accepted request fields remain unchanged.
- A request omitting all deprecated fields returns the existing `{ id }` response.
- A successful request supplying one or more deprecated fields returns `{ id, warnings }` with the same warning shape as the command.
- Invalid values continue to fail normal decimal validation with the existing CRUD error mapping.
- The warning never echoes submitted amounts.

OpenAPI continues listing the three request properties, labels their behavior in the operation description, and declares the optional warning response. Removing them from the schema is deferred until the bridge window has elapsed and a follow-up spec approves removal.

## Internationalization

No translated string is added. The API returns a stable diagnostic code and field identifiers; human migration prose lives in OpenAPI and `UPGRADE_NOTES.md`. Structured logs are operator diagnostics.

## 📝 UI/UX

N/A. No `.tsx` or user-interface surface changes.

## 📝 Edge Cases & Failure Scenarios

- `0` is still a supplied deprecated value and produces the warning.
- Multiple supplied fields produce one warning entry with each field exactly once in canonical order.
- `null`, strings, negative numbers, or non-finite values remain subject to the existing decimal validation; the bridge does not broaden the contract.
- Unknown object keys retain the existing Zod behavior.
- If structured logging fails internally, command behavior must not change; the normal logger facade is non-throwing.
- A process that has already logged the warning continues returning warnings on every affected command result.

## Migration & Backward Compatibility

Affected surfaces are exported Zod schemas/types, command input/output, and `POST /api/sales/orders` request/response/OpenAPI.

- **Bridge release (0.6.7):** keep all three fields accepted and ignored; add `@deprecated` guidance, per-call machine-readable warnings, bounded structured logging, this spec, and the upgrade note.
- **Minimum bridge window:** the fields remain accepted for at least one minor release after 0.6.7 ships.
- **Removal:** requires a later spec and upgrade note, must verify the bridge window elapsed, and must update all contract and integration tests. No removal is authorized by this specification.
- **Migration:** stop sending the three order-create fields. To represent settled/partially settled orders, create payment records and allocations through `sales.payments.create` / `POST /api/sales/payments` so ledger projections remain reconcilable.
- **Rollback:** reverting this change returns to accepted-but-silent behavior without data migration; no persisted state needs reversal.

Issue #4695 remains open because this bridge makes the silent discard observable but does not provide header-only ERP aggregate import semantics.

## 📝 Risks & Impact Review

#### Clients ignore the warning and keep sending legacy fields
- **Scenario**: An integration accepts the `201` response but never inspects `warnings`.
- **Severity**: Medium
- **Affected area**: External order importers and command-bus callers.
- **Mitigation**: OpenAPI guidance, `UPGRADE_NOTES.md`, per-call warning metadata, and a bounded operator log all point to the payment-record migration.
- **Residual risk**: Some callers may remain unchanged until a later rejection release; preserving acceptance is intentional during the bridge window.

#### Warning response breaks an exact-shape client
- **Scenario**: A client incorrectly rejects additive JSON members even though the response remains valid.
- **Severity**: Low
- **Affected area**: Non-tolerant external clients posting deprecated fields.
- **Mitigation**: `warnings` is optional and appears only when the client used deprecated fields; clean callers receive the byte-shape-equivalent `{ id }` response.
- **Residual risk**: Exact-shape clients using deprecated inputs must update, but the alternative is continued silent loss or immediate request rejection.

#### Log amplification during bulk import
- **Scenario**: Hundreds of thousands of affected rows generate a warning each.
- **Severity**: High
- **Affected area**: Application logging, storage, and observability pipelines.
- **Mitigation**: Emit at most once per process and never log field values.
- **Residual risk**: Multi-replica deployments emit once per process, which is acceptable and useful for locating affected workers.

#### A second ledger source is accidentally introduced later
- **Scenario**: Future code starts honoring one of the deprecated fields without creating payment history.
- **Severity**: High
- **Affected area**: Sales balances, reports, payment gateway amounts, and refunds.
- **Mitigation**: Tests pin zeroed create-time ledger persistence, payment rows remain authoritative, and this spec explicitly forbids honoring the fields under the bridge.
- **Residual risk**: A future intentional model change can supersede this only through its own money-path spec and compatibility review.

## 📋 Phasing

### Phase 1: Compatibility bridge

One shippable phase preserves request behavior, adds observability, documents the contract, and supplies unit, route, OpenAPI, and integration coverage. Removal or supported header-level ledger imports are separate future phases/specifications.

## 📋 Implementation Plan

### Phase 1: Compatibility bridge

1. Restore the released decimal fields in `orderCreateSchema`; `orderUpdateSchema` remains structurally compatible because it is derived from `orderCreateSchema.partial()`. Add `@deprecated` source guidance and define the canonical field list plus warning code/shape.
2. Detect supplied fields in `sales.orders.create`, return the optional warning, and emit a once-per-process structured warning without reading or logging values.
3. Forward command warnings through the order-create CRUD response and keep the OpenAPI request fields while documenting the optional warning response and migration path.
4. Replace rejection tests with schema/command compatibility tests; add route and OpenAPI boundary tests covering zero, multiple fields, clean payloads, and the stable warning code.
5. Add a self-contained API integration test that creates an order with deprecated fields, asserts `201` plus warning metadata, reads the derived zero/unpaid ledger, and deletes its fixture in `finally`.
6. Update `UPGRADE_NOTES.md` to reference this spec and the one-minor bridge timeline, then run generation, focused sales tests, integration coverage, and the configured validation gate.

### File manifest

| File | Action | Purpose |
|---|---|---|
| `.ai/specs/2026-08-01-sales-order-payment-ledger-input-deprecation.md` | Create | Compatibility and migration authority. |
| `packages/core/src/modules/sales/data/validators.ts` | Modify | Restore accepted fields and add deprecation definitions. |
| `packages/core/src/modules/sales/commands/documents.ts` | Modify | Detect legacy use, return warning, and log once. |
| `packages/core/src/modules/sales/api/documents/factory.ts` | Modify | Forward and document warnings. |
| `packages/core/src/modules/sales/commands/__tests__/documents.create-payment-totals.test.ts` | Modify | Schema/command regression coverage. |
| `packages/core/src/modules/sales/api/__tests__/documents.routes.test.ts` | Modify | HTTP route and OpenAPI contract coverage. |
| `packages/core/src/modules/sales/__integration__/TC-SALES-040-order-payment-ledger-deprecation.spec.ts` | Create | Real API-path compatibility coverage. |
| `UPGRADE_NOTES.md` | Modify | Downstream migration and removal window. |

## Final Compliance Report — 2026-08-01

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root `AGENTS.md` | Preserve behavior unless explicitly changed; use real call sites and tests. | Compliant | Accepted input and ledger behavior remain; warnings flow through command and HTTP call sites. |
| `BACKWARD_COMPATIBILITY.md` | Keep a bridge for at least one minor; add `@deprecated`, upgrade notes, and a spec migration section. | Compliant | All four protocol elements are specified; removal is explicitly deferred. |
| root `AGENTS.md` | User-facing strings use i18n. | Compliant | API returns a stable code/field identifiers; no raw user-facing error is added. |
| root `AGENTS.md` | New API behavior ships with integration coverage. | Compliant | Phase 1 includes unit route/OpenAPI tests and a self-contained real API integration test. |
| `packages/core/AGENTS.md` | Domain writes stay in commands and CRUD routes use canonical machinery. | Compliant | Existing `sales.orders.create` and `makeCrudRoute` flow is preserved. |
| sales `AGENTS.md` | Use `salesCalculationService`; payments independently drive order totals. | Compliant | Calculation/persistence logic is unchanged; fields remain ignored. |
| root `AGENTS.md` | Structured logging uses the logger facade. | Compliant | Existing `createLogger('sales')` is reused with a bounded warning. |
| root `AGENTS.md` | No cross-tenant leakage or direct cross-module ORM relationships. | N/A | No query, scope, relationship, or stored data change. |
| root PR policy | API-surface changes retain `needs-qa`. | Compliant | The PR keeps `needs-qa`; approval must come from QA, not the authoring skill. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Data model is unchanged; API warns while ignoring legacy values. |
| API contracts match UI/UX section | Pass | No UI is added; command and HTTP response shapes are defined. |
| Risks cover all write operations | Pass | Persistence semantics and rollback are unchanged and explicitly pinned. |
| Commands defined for all mutations | Pass | Existing command remains the sole write path. |
| Cache strategy covers all read APIs | N/A | No cache/read behavior changes. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: Approved — ready for implementation.**

## Changelog

### 2026-08-01

- Initial specification with autonomous defaults, compatibility bridge, API warning contract, integration coverage, and one-minor removal guard.
- Reviewed security, performance, cache, command, compatibility, and risk requirements; verdict approved.

### Review — 2026-08-01

- **Reviewer**: Agent, with an independent fresh-context scope-cohesion review
- **Security**: Passed — warning metadata contains field identifiers only; values, credentials, and customer data are not logged or returned.
- **Performance**: Passed — detection is bounded to three fields and structured logging occurs at most once per process.
- **Cache**: Passed — no cache read, key, tag, or invalidation behavior changes.
- **Commands**: Passed — the existing command remains the sole mutation path and gains an additive optional result member.
- **Risks**: Passed — compatibility, exact-shape clients, log amplification, and future ledger-source drift have mitigations and residual-risk statements.
- **Scope cohesion**: Passed — removal and header-level ledger imports are independently deployable and explicitly deferred; all included changes serve the one deprecation bridge.
- **Verdict**: Approved
