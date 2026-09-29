# Sales document update value persistence

## TLDR

- Restore successful `PUT /api/sales/invoices` and `PUT /api/sales/credit-memos` updates by assigning validated values to entity fields instead of assigning audit diff objects.
- Preserve the existing command IDs, route schemas, tenant and organization scope, undo snapshots, events, cache invalidation, and public API responses.
- Prove the behavior with focused command tests and create → read → update → read → delete API integration coverage in TC-SALES-031 and TC-SALES-032.

**Scope boundary:** This change fixes one independently deployable capability: existing invoice and credit-memo header updates. It does not add line replacement, relation updates, custom-field updates, new fields, new routes, or UI behavior.

## Overview

Invoice and credit-memo update commands already have authenticated, feature-gated CRUD routes, scoped validators, undo snapshots, CRUD events, indexing, and cache invalidation. This change restores the intended write behavior without changing those contracts.

The authoritative implementation reference is the existing `sales.orders.update` / `sales.quotes.update` pattern in this module: mutation logic applies validated values to the entity, while `buildChanges` compares before and after snapshots exclusively for the action log. External product research is not applicable because this is an internal persistence defect rather than a new product or accounting behavior.

## Problem Statement

`sales.invoices.update` and `sales.credit_memos.update` pass the result of `buildChanges` to `Object.assign`. `buildChanges` returns audit entries shaped as `{ from, to }`, so MikroORM receives objects for scalar and date columns and the routes fail with HTTP 500 instead of persisting the requested fields.

## Proposed Solution

Apply only the update schemas' supported header fields when they are present, normalize numeric values with the existing sales numeric helper, and keep dictionary-backed status resolution intact. Build audit changes from the before/after command snapshots, matching the established quote and order update pattern.

### Acceptance Criteria

1. `PUT /api/sales/invoices` returns 200 for a valid scoped update and preserves the existing `{ invoiceId }` response.
2. A subsequent invoice GET returns the updated header values as scalars, never `{ from, to }` objects.
3. `PUT /api/sales/credit-memos` returns 200 for a valid scoped update and preserves the existing `{ creditMemoId }` response.
4. A subsequent credit-memo GET returns the updated header values as scalars, never `{ from, to }` objects.
5. Omitted update fields remain unchanged; organization, tenant, relation, line, custom-field, and lifecycle fields are not mass-assigned.
6. Each update action log derives a `{ from, to }` diff from before/after snapshots, treats equal-valued dates and metadata as unchanged, and keeps the existing snapshot-based undo payload.
7. Existing route metadata, Zod schemas, optimistic-lock behavior, tenant and organization checks, events, query indexing, cache invalidation, command IDs, and API paths remain unchanged.

### Design Decisions

| Decision | Rationale |
|---|---|
| Explicitly assign supported fields when present | Prevents audit structures and unrelated validated context fields from entering ORM entities. |
| Normalize numeric inputs with `toNumericString` | Keeps entity values consistent with create commands and numeric column typings. |
| Resolve dictionary status before scalar mutation | Avoids a query between pending scalar mutations and `em.flush()`, preserving MikroORM unit-of-work safety. |
| Compute audit changes in `buildLog` | The command bus already supplies authoritative before/after snapshots there, matching sibling document commands. |
| Compare selected audit values semantically | Separate entity-manager forks produce distinct date and JSON object instances even when their persisted values are equal. |
| Deliver invoice and credit-memo repairs together | Issue #3801 explicitly defines both instances of the same defect and both integration scenarios as one implementation unit. |

### Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Assign `change.to` from the current `buildChanges` result | Continues coupling persistence to an audit helper and still risks treating omitted fields as changes to `undefined`. |
| `Object.assign(entity, parsed)` | Would mass-assign scope, relation, line, and custom-field inputs outside the existing header-update contract. |
| Change `buildChanges` to return values | Would break a shared, stable helper and every audit consumer that depends on `{ from, to }`. |

## User Stories / Use Cases

- An authorized sales operator can update an invoice header and see the persisted values on reload.
- An authorized sales operator can update a credit memo's reason or totals and see the persisted values on reload.
- An auditor can inspect scalar before/after changes while undo continues to restore the prior snapshot.

## Architecture

The existing request lifecycle is unchanged:

1. `makeCrudRoute` authenticates and authorizes the PUT request.
2. `withScopedPayload` supplies trusted tenant and organization scope and the update schema validates the payload.
3. The registered command loads the scoped, non-deleted entity.
4. Dictionary-backed status is resolved before mutation when `statusEntryId` is present.
5. Explicit header-field assignments and one flush persist the update.
6. Existing CRUD side effects update events and the query index, then cache invalidation runs.
7. `captureAfter` and `buildLog` compare snapshots for audit and retain the undo envelope.

### Architecture Guidance Applied

- Organization architecture §9: preserve command-based writes and undo metadata.
- §12: preserve the declared invoice and credit-memo CRUD event identities and post-write side effects.
- §§14–15: preserve feature guards and explicit tenant/organization scoping.
- §27: do not modify stable API, command, schema, or event contracts.
- §30 and §31 D/H/O: add command and self-contained API integration coverage and run the configured validation gate.

### Commands & Events

- Commands remain `sales.invoices.update` and `sales.credit_memos.update`.
- Events remain `sales.invoice.updated` and `sales.credit_memo.updated` through the existing CRUD event configuration.
- Undo remains based on the existing before/after graph snapshots.

### Data and Permission Boundaries

- The command lookup continues filtering `id`, `organizationId`, `tenantId`, and `deletedAt: null`.
- Scope values are validated against the command context before lookup.
- No entity, column, relation, encryption map, ACL feature, or role grant changes.
- Omitted fields are not assigned. Relation IDs, lines, custom fields, and scope fields remain outside this fix.

## Data Models

No data-model or migration change. Existing `SalesInvoice` and `SalesCreditMemo` header properties retain their current types and database columns.

## API Contracts

### Update invoice

- `PUT /api/sales/invoices`
- Authorization: unchanged `sales.invoices.manage`.
- Request: unchanged `invoiceUpdateSchema`, including `id` and optional header fields.
- Success: unchanged 200 response `{ invoiceId: string }`.
- Validation, scope, not-found, and optimistic-lock errors remain unchanged.

### Update credit memo

- `PUT /api/sales/credit-memos`
- Authorization: unchanged `sales.credit_memos.manage`.
- Request: unchanged `creditMemoUpdateSchema`, including `id` and optional header fields.
- Success: unchanged 200 response `{ creditMemoId: string }`.
- Validation, scope, not-found, and optimistic-lock errors remain unchanged.

## Failure Behavior

- Invalid inputs continue failing Zod validation before command mutation.
- Cross-scope requests continue failing the existing organization/tenant guards.
- Missing or deleted records continue failing the scoped entity lookup.
- If status resolution or persistence fails, no success side effect or cache invalidation runs.
- Audit diff construction occurs after persistence from captured snapshots and cannot write entity fields.

## Internationalization

No user-facing strings or translation keys change. Existing localized action labels remain in use.

## UI/UX

No UI-rendering files or interaction flows change. Existing forms benefit from the repaired API behavior.

## Rollout

Code-only rollout with no feature flag, migration, backfill, dependency, or operator action. Reverting the code restores the prior behavior; no stored data shape changes.

## Migration & Backward Compatibility

No breaking change. The fix restores the existing stable PUT routes and response shapes. Command IDs, event IDs, schemas, import paths, database structure, ACL features, and generated contracts are unchanged.

## Implementation Plan

### Phase 1: Correct command mutation and audit behavior

1. Add explicit invoice and credit-memo scalar update application in `commands/documents.ts`.
2. Move `buildChanges` usage to each command's `buildLog` path and retain snapshot-based undo.
3. Add focused unit regression coverage for persisted values and audit diffs.

### Phase 2: Restore API round-trip coverage

1. Extend TC-SALES-031 with a credit-memo update and read-back assertion.
2. Extend TC-SALES-032 with an invoice update and read-back assertion.
3. Run focused tests, path-triggered checks, the configured validation gate, and independent review.

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/core/src/modules/sales/commands/documents.ts` | Modify | Apply validated update values and build audit diffs from snapshots. |
| `packages/core/src/modules/sales/commands/__tests__/documents.invoice-credit-memo-update.test.ts` | Create | Pin scalar mutation, omission safety, numeric normalization, and audit diffs. |
| `packages/core/src/modules/sales/__integration__/TC-SALES-031.spec.ts` | Modify | Add credit-memo PUT and read-back coverage. |
| `packages/core/src/modules/sales/__integration__/TC-SALES-032.spec.ts` | Modify | Add invoice PUT and read-back coverage. |

### Testing Strategy

- Unit: execute both commands against managed entity doubles and assert scalar values, omitted-field preservation, numeric normalization, and absence of diff objects on entities.
- Unit: invoke each `buildLog` with before/after snapshots, assert audit `{ from, to }` values and unchanged undo snapshots, and prove distinct but equal-valued date and metadata objects are omitted.
- Integration: extend TC-SALES-031 and TC-SALES-032 to run create → read → update → read → delete with per-test fixtures and `finally` cleanup.
- Validation: run focused Jest and Playwright tests, then all commands returned by `required-checks` and the configured validation gate.

## Risks & Impact Review

#### Omitted field accidentally cleared
- **Scenario**: A partial PUT assigns `undefined` to a stored field.
- **Severity**: High
- **Affected area**: Invoice and credit-memo header data.
- **Mitigation**: Assign each supported field only when the parsed value is not `undefined`; assert omission behavior in unit tests.
- **Residual risk**: None beyond the existing schema's nullability contract.

#### Numeric representation drift
- **Scenario**: Zod-coerced numbers are assigned directly to entity properties typed and persisted as numeric strings.
- **Severity**: Medium
- **Affected area**: Document totals and downstream audit snapshots.
- **Mitigation**: Reuse `toNumericString` for every numeric header field and assert normalized values.
- **Residual risk**: Database precision behavior is unchanged from create commands.

#### Status mutation loses unit-of-work changes
- **Scenario**: Dictionary resolution queries after scalar mutation and resets pending MikroORM changes before flush.
- **Severity**: Medium
- **Affected area**: Updates that include `statusEntryId`.
- **Mitigation**: Resolve status before applying any scalar values, then mutate and flush without an intervening query.
- **Residual risk**: Existing dictionary availability and validation behavior remains.

#### Query projection is stale after update
- **Scenario**: The command persists the entity but a follow-up GET reads old query-index data.
- **Severity**: Medium
- **Affected area**: Invoice and credit-memo list/read APIs.
- **Mitigation**: Preserve `emitCrudSideEffects` and indexer configuration; integration tests assert immediate API read-back.
- **Residual risk**: Existing data-engine failure handling is unchanged.

#### Audit or undo regression
- **Scenario**: Moving diff calculation removes useful audit details or corrupts undo snapshots.
- **Severity**: Medium
- **Affected area**: Action logs and undo for both update commands.
- **Mitigation**: Build diffs from captured snapshots, compare selected values with the command bus's date-aware deep-equality semantics, preserve `snapshotBefore`, `snapshotAfter`, and the undo envelope, and cover them in unit tests.
- **Residual risk**: The shared audit helper remains unchanged for unrelated command handlers.

#### Tenant or authorization regression
- **Scenario**: The fix bypasses scoped lookup or permission enforcement.
- **Severity**: Critical
- **Affected area**: Cross-tenant sales data.
- **Mitigation**: Do not change routes, guards, validators, scope checks, or scoped lookup predicates; review against architecture §31 H.
- **Residual risk**: No new boundary is introduced.

## Final Compliance Report — 2026-08-21

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `omdyo-general/architecture/ARCHITECTURE.md` overview, §§9, 12, 14–15, 27, 30, and complete §31 checklist

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| Root + architecture §9 | Writes stay in registered commands with undo/audit | Compliant | Existing command and snapshot lifecycle is preserved. |
| Root + architecture §15 | Scope every tenant-owned read/write | Compliant | Existing scoped validation and four-field lookup remain unchanged. |
| Core AGENTS | Avoid mutate → query → flush UoW loss | Compliant | Status is resolved before scalar mutation; no query follows before flush. |
| Sales AGENTS | Preserve sales command side effects | Compliant | Events, indexer, and cache invalidation remain after flush. |
| Backward compatibility | Do not break stable APIs, commands, events, or schemas | Compliant | No public contract changes. |
| QA AGENTS | Self-contained integration tests with cleanup | Compliant | Existing created fixtures and `finally` cleanup are retained. |
| Architecture §31 O | Cover affected API paths and run validation | Compliant | Both PUT paths receive read-back coverage plus command unit tests. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No model or contract change. |
| API contracts match implementation | Pass | Existing schemas define the explicit header assignment set. |
| Risks cover all write operations | Pass | Mutation, projection, audit/undo, scope, and numeric risks are covered. |
| Commands defined for all mutations | Pass | Existing registered commands are retained. |
| Cache and event behavior covered | Pass | Existing post-flush paths remain intact and read-back integration tests exercise projection. |

### Non-Compliant Items

None.

### Verdict

Fully compliant: approved for implementation, subject to the pre-implementation audit and final independent code review.

## Changelog

### 2026-08-21

- Drafted and completed the issue #3801 implementation specification.
- Added acceptance criteria, contract boundaries, failure behavior, phased tests, risk analysis, and architecture compliance review.
- Reconciled the fresh scope review's split suggestion against the issue brief: retained one atomic repair because #3801 explicitly requires both affected document commands and both API scenarios.
- **Review**: Security passed; performance passed; cache/event behavior passed; commands and undo passed; risks passed; verdict approved for implementation.
- Implemented both phases with focused command regression coverage and passing TC-SALES-031/032 API round trips.

### 2026-08-26

- Addressed review feedback by filtering invoice and credit-memo audit diffs with date-aware deep equality before calling the shared audit helper.
- Added focused regression cases for equal-valued, separately loaded dates and nested metadata objects.

## Implementation Status

| Phase | Status | Date | Notes |
|---|---|---|---|
| Phase 1 — Correct command mutation and audit behavior | Done | 2026-08-26 | Explicit field application, numeric normalization, semantic snapshot-derived audit diffs, and 6 focused Jest cases pass. |
| Phase 2 — Restore API round-trip coverage | Done | 2026-08-21 | TC-SALES-031 and TC-SALES-032 each pass both cases in fully managed ephemeral environments. |

### Phase 1 — Detailed Progress

- [x] Apply supported invoice and credit-memo header values without mass assignment.
- [x] Keep dictionary lookup before mutation and normalize numeric entity values.
- [x] Build audit diffs from before/after snapshots and preserve undo envelopes.
- [x] Add and pass focused command regression tests.

### Phase 2 — Detailed Progress

- [x] Add credit-memo PUT response and scalar/numeric read-back assertions.
- [x] Add invoice PUT response and date/numeric read-back assertions.
- [x] Preserve fixture ownership and `finally` cleanup.
- [x] Pass TC-SALES-031 and TC-SALES-032 in disposable environments.
