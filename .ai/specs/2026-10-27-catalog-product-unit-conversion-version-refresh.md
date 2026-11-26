# Catalog product unit-conversion version refresh

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md`
**Related:** `.ai/specs/2026-09-30-catalog-product-form-section-policy.md`

## TLDR

Make the existing product unit-conversion create/update responses return each persisted row's authoritative `updatedAt`, and make the product edit synchronizer retain the returned id/version after every committed child write. Successive saves use the child's current optimistic-lock token; a stale child stops later conversion calls while preserving and exposing the existing post-parent partial-success boundary. This capability is independently deployable and does not implement section policy.

## Overview

The catalog product edit page currently updates the parent first and then deletes, updates, and creates `catalog_product_unit_conversions`. It correctly sends each loaded conversion's own version, but the create and update routes return no fresh version and the page rebuilds its baseline without `updatedAt`. A second save can therefore send a null or stale child token. If a later conversion fails after earlier child writes committed, retry state can also repeat an already completed create or use an obsolete version.

## Problem Statement

Optimistic locking is effective only when every successful mutation returns or reloads the authoritative next token and the client adopts it. The current route responses are `{ id }` for create and `{ ok: true }` for update, while the edit page stores conversion rows without refreshed versions. The already committed parent and earlier child writes are not rolled back when a later conversion conflicts, so retry state must precisely represent that partial completion.

## Goals and Non-goals

### Goals

- Return an authoritative ISO `updatedAt` after conversion create and update.
- Preserve the existing child-scoped optimistic-lock header and `catalog.product_unit_conversion` resource kind.
- Update the edit page's conversion baseline after every successful child mutation.
- Stop on the first child failure and never execute a later conversion/action.
- Pin the existing parent-first, non-atomic partial-success behavior with tests and documentation.

### Non-goals

- Making parent and conversion writes one transaction.
- Adding section-policy descriptors, capabilities, or façades.
- Changing conversion validation, uniqueness, events, audit, undo/redo, or index behavior.
- Changing product create or any non-catalog module.

## Proposed Solution

Extend the existing command results and CRUD route responses with the refreshed conversion version, then extract the page's post-parent conversion loop into a focused synchronizer that owns a mutable authoritative working snapshot. Every successful delete removes a row from that snapshot; every update replaces its version with the returned version; every create replaces the draft with the returned persisted id/version. The synchronizer publishes the working snapshot to both retry state and the form baseline before continuing and before surfacing any later failure.

## Architecture

| Area | Change |
|---|---|
| conversion commands | Return `conversionId` plus authoritative `updatedAt` after create/update flush |
| conversion CRUD route/OpenAPI | Add exact create/update response schemas containing the refreshed version |
| product edit conversion synchronizer | Sequence delete/update/create, adopt each response, and publish partial progress |
| conflict UI | Continue using child headers and `surfaceRecordConflict`; stop later work |
| tests | Route/command response, two-save, stale-child, partial-progress, and side-effect ordering |

The command remains the mutation authority. The route does not synthesize a timestamp and the browser never increments or guesses one.

## Data Models

No database or migration change. `CatalogProductUnitConversion.updated_at` already exists and is maintained by MikroORM. The page's existing `ProductUnitConversionDraft.updatedAt` field becomes mandatory for persisted rows and remains absent only for an unsaved draft.

The create/update command result becomes additive:

```ts
type ProductUnitConversionMutationResult = {
  conversionId: string
  updatedAt: string
}
```

The timestamp is read from the flushed/refreshed scoped entity and serialized as ISO-8601 UTC.

## API Contracts

Existing URLs, methods, request bodies, authorization, tenant/organization scoping, and error envelopes remain unchanged.

- `POST /api/catalog/product-unit-conversions` returns HTTP 201 `{ id: string, updatedAt: string }`.
- `PUT /api/catalog/product-unit-conversions` returns HTTP 200 `{ ok: true, id: string, updatedAt: string }`.
- `DELETE /api/catalog/product-unit-conversions?id=:id` keeps HTTP 200 `{ ok: true }`; a deleted row has no next edit token.

Strict Zod response schemas and OpenAPI describe those exact shapes. Create/update fail if the command cannot obtain a valid authoritative version; they never return a null or pre-mutation token. Existing clients that ignore additive fields remain compatible.

## UI/UX

The product edit UI and messages remain unchanged. After a successful save, conversion drafts silently retain their server ids and versions. On a child conflict, the unified conflict bar remains authoritative; the parent and any earlier conversions may already be committed, later conversions are not called, and retry uses the published partial-progress snapshot rather than replaying completed work.

## Frontend Architecture Contract

The existing product edit client root remains unchanged. The conversion loop may move into one typed route-local helper/hook, with no provider, route-root, dynamic import, or production dependency. It continues using `createCrud`/`updateCrud`/`deleteCrud`, `withScopedApiRequestHeaders(buildOptimisticLockHeader(child.updatedAt), ...)`, and `surfaceRecordConflict`. Focused tests use the real response parser and assert that no raw `fetch` or guessed token is introduced.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Two consecutive saves update the same conversion | Second request carries the first response's `updatedAt` and succeeds |
| Create followed by another save | Returned id/version replace the unsaved draft; no duplicate create |
| Delete succeeds, later update fails | Deleted id is removed from retry baseline; it is not deleted again |
| Update succeeds, later create fails | Updated row's new version is retained; retry does not use the stale token |
| First child is stale | Standard 409 is surfaced; no later child call runs |
| Response lacks/invalidates `updatedAt` | Treat as a failed synchronization, report internally, reload before retry; never store null |
| Parent update succeeds, child conflicts | Parent remains committed by documented legacy ordering |
| Wrong tenant/organization | Existing scoped not-found behavior; no version leak |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Successive save sends a stale child token | High | Exact server version in create/update response and immediate baseline adoption | External clients must also adopt returned versions |
| Partial failure replays a committed child write | High | Publish working snapshot after each success and before throwing | Parent/child flow remains intentionally non-atomic |
| Route returns guessed or pre-flush version | High | Command refresh/serialization tests and strict non-null schema | ORM timestamp precision remains database-defined |
| Additive response breaks a strict consumer | Medium | Preserve existing fields/status and add contract fixtures | Undocumented exact-equality consumers may require adjustment |

Rollback may restore the previous page synchronizer only while retaining additive response fields for compatibility. Removing `updatedAt` after publication follows the deprecation protocol. Rollback does not undo already committed parent or conversion writes.

## Migration & Backward Compatibility

No data migration. Response fields are additive, existing request shapes and statuses remain stable, and command ids/events/audit labels do not change. `updatedAt` becomes a documented stable response field. The implementation updates `BACKWARD_COMPATIBILITY.md`/upgrade notes only if repository policy requires an entry for the additive API field; it does not rename any route or resource kind.

## Phasing and Implementation Plan

1. Extend create/update command results to obtain and return the post-flush ISO version; add command tests for a changed token and existing side effects.
2. Add strict route response schemas/OpenAPI and API tests for create/update values, scope failures, malformed/missing versions, and unchanged delete behavior.
3. Extract the product-edit conversion synchronizer, retain a working authoritative snapshot, and publish id/version/removal progress after every successful child write.
4. Add two-save and partial-failure tests that pin parent-first ordering, exact per-child headers, early stop, retry behavior, events/audit/index counts, and localized conflict handling.
5. Run focused catalog command/API/page tests, core build/typecheck, `git diff --check`, and the configured validation gate.

## Integration Coverage

- Commands: create/update return the flushed row's id/version without changing validation, event, index, audit, undo, or redo behavior.
- API: exact create/update/delete status and response shapes, OpenAPI parity, permission and tenant/organization isolation, standard optimistic-lock 409.
- Product edit: delete/update/create ordering, per-row headers, authoritative response adoption, two successive saves, create retry, and no later call after failure.
- Partial success: barrier-controlled stale middle child proves the parent and earlier children stay committed, working snapshot is published, later children/actions are untouched, and retry does not duplicate completed work.
- Compatibility: clients ignoring additive fields, unchanged no-conversion save, and unchanged product-create flow.

## Acceptance Criteria

1. Every successful conversion create/update response contains its authoritative non-null ISO `updatedAt` and OpenAPI matches runtime.
2. The product edit page sends each persisted conversion's own latest token on every update/delete.
3. Two successive saves and create-then-save complete without a false optimistic-lock conflict or duplicate create.
4. A child failure stops every later conversion/action and preserves accurate retry state for all earlier committed children.
5. Parent-first partial success remains explicit; no test or message implies atomic rollback.
6. Existing scope, feature, validation, event, audit, query-index, undo/redo, and delete-response contracts remain compatible.
7. Focused and configured validation pass with recorded evidence.
8. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root optimistic-lock rules | Use each child entity's version and surface standard conflicts | Compliant | Responses return the authoritative conversion version and every update/delete overrides the parent header |
| catalog guide | Preserve command/event patterns and scoped entities | Compliant | Existing commands remain authoritative and tenant/organization filters are unchanged |
| UI/backend guide | Use shared CRUD/API and conflict helpers | Compliant | Synchronizer keeps existing helpers and the unified conflict bar |
| `.ai/specs/AGENTS.md` | One independently deployable capability with integration coverage | Compliant | Only conversion response/version-refresh and its existing partial-success client are included |
| `BACKWARD_COMPATIBILITY.md` | Preserve stable routes and evolve responses additively | Compliant | Existing fields/status remain and `updatedAt` is additive |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Existing `updated_at` is the sole response token source |
| API contracts match UI/UX | Pass | The synchronizer adopts the documented create/update response |
| Risks cover every write | Pass | Create, update, delete, two-save, partial failure, and rollback are explicit |
| Commands defined for all mutations | Pass | Existing three conversion commands remain authoritative |
| Frontend architecture contract is measurable | Pass | One route-local synchronizer, shared helpers, and focused source/test gates are required |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — independently deployable before any section-policy adopter.

## Changelog

- **2026-10-27:** Split authoritative conversion version refresh and partial-progress retry behavior from the catalog section-policy adopter.
