# Query-index scope resolution for global entities

**Date**: 2026-07-18
**Status**: Proposed — ready for implementation

## TLDR

**Key points:**

- `query_index.upsert_one` and `query_index.delete_one` currently select `organization_id` and `tenant_id` from every source table. That is invalid for legitimate global entities such as `feature_toggles.feature_toggle`, whose mapped table has neither column.
- Make the existing scope-verification path metadata-aware. It will require the generated entity-ID registry and resolved MikroORM metadata, read only declared scope columns, skip the source read for a global entity, and keep source-row authority and mismatch rejection for tenant-scoped entities.
- Correct the global feature-toggle command producer so every query-index event declares the global scope explicitly as `organizationId: null` and `tenantId: null`.

**Scope:**

- Resolve a registered source entity and its physical scope columns from MikroORM metadata; never infer a table or column from an unregistered `entityType`.
- Cover the upsert path and the delete path, including delete coverage's second source-table probe.
- Add focused unit coverage and extend the existing global feature-toggle API integration test to prove that the resulting `entity_indexes` row has global scope.

**MVP:**

- The complete deliverable is the producer, metadata-aware subscriber, delete-coverage, and regression-test set described here. No follow-on phase is planned; later entities gain support automatically through their registered metadata.

**Out of scope:**

- Database schema or migration changes, reindex/backfill work, public API/OpenAPI changes, new UI, cache policy changes, and changes to the all-tenant reindex contract.
- Treating an unknown/unregistered entity as global. That would turn a metadata/wiring fault into an unchecked event payload.

## Overview

The query-index subscriber is a shared projection consumer. A CRUD mutation emits an existing `query_index.upsert_one` or `query_index.delete_one` event; the subscriber derives the authoritative index scope before touching `entity_indexes`, search tokens, coverage, or search side effects.

`FeatureToggle` is intentionally instance-global: it declares neither `organizationId` nor `tenantId`. Its global command currently carries the authenticated actor's tenant ID into the generic CRUD side-effect helper, which is actor context rather than ownership context. The new invariant is therefore explicit: a source entity with neither mapped scope property emits and indexes only `{ organizationId: null, tenantId: null }`.

> **Market reference:** MikroORM exposes runtime entity metadata, including `properties`, mapped `tableName`, and each property's `fieldNames`; that is the application-authoritative mapping for a code-first ORM ([EntityMetadata](https://mikro-orm.io/api/next/core/class/EntityMetadata), [EntityProperty](https://mikro-orm.io/api/core/interface/EntityProperty)). PostgreSQL's `information_schema.columns` can also reveal table columns, but it is a privilege-filtered database catalogue view ([PostgreSQL documentation](https://www.postgresql.org/docs/17/infoschema-columns.html)). We deliberately do not add a per-event catalogue query or cache: the ORM has already resolved the mapping at bootstrap, and its metadata gives the correct physical column name even if a naming strategy changes.

## Problem statement

`loadQueryIndexRowScope()` resolves a table with `resolveEntityTableName()` and unconditionally projects `organization_id` and `tenant_id`.

For `feature_toggles.feature_toggle`, PostgreSQL rejects that projection because the `feature_toggles` table has neither column. Both subscribers currently convert any load error into `null`, so the event can continue only because its payload supplies a scope. This creates three defects:

1. Every indexed global feature-toggle mutation attempts an invalid SQL read.
2. A failed source-scope read is indistinguishable from a legitimately deleted/missing source row, weakening the trusted-row boundary added by `fix(query-index): enforce trusted tenant scope in subscribers`.
3. `delete_one` independently probes `deleted_at` with unconditional `organization_id` and `tenant_id` predicates for coverage accounting, so correcting only `loadQueryIndexRowScope()` leaves the delete path invalid.

The producer adds a fourth issue. `featureToggleIdentifiers()` currently sends `ctx.auth?.tenantId`, even though the source entity is global. An actor's selected tenant must not decide the scope of a global projection row.

## Goals and non-goals

| Goal | Decision |
|---|---|
| Preserve tenant isolation | A present source-row scope remains authoritative; a supplied non-null or null value that differs from it is rejected. |
| Support all three source shapes | Handle both columns, only one scope column, and neither scope column. |
| Keep global events explicit | A metadata-declared global entity requires both payload keys and each must be exactly `null`. |
| Fail safely on wiring faults | An unregistered entity or unusable scope metadata throws a `QueryIndexScopeError`; it is recorded by the existing subscriber error path and the originating domain write remains best-effort. |
| Avoid schema probing | No `information_schema` lookup, migration, cache, or new DI service. |
| Preserve contracts | Event IDs and payload fields remain unchanged. Only the values emitted for a global feature toggle become correct. |

## User stories / use cases

- **A super administrator** creates, edits, restores, or soft-deletes a global feature toggle, so its index projection is stored once at global scope and no invalid-column query is attempted.
- **A tenant-scoped module** emits an index event, so the subscriber still derives omitted scope from the source row and rejects an event whose supplied scope differs from that row.
- **An operator** encounters a bad or unregistered index `entityType`, so the indexer reports a deterministic wiring error instead of silently trusting event scope or guessing a database table.

## Proposed solution

### Design decisions

| Decision | Rationale |
|---|---|
| Require generated entity-ID membership plus registered table metadata, not `resolveEntityTableName()` fallback | The fallback pluralizes unregistered IDs, and `resolveRegisteredEntityTableName()` alone can match a different module prefix that shares an entity segment. Index scope is security-sensitive and must not query an attacker- or typo-chosen table. |
| Read `properties.organizationId?.fieldNames[0]` and `properties.tenantId?.fieldNames[0]` | The property presence describes whether a scope dimension exists; `fieldNames` supplies the mapped physical identifier. A missing property is a true absent dimension, not a nullable value. |
| Carry a discriminated source-scope result | `global`, `row`, and `missing` are materially different states. Reusing `null` for all three would let a global entity or a metadata error bypass the correct validation rule. |
| Remove `loadQueryIndexRowScope(...).catch(() => null)` | A missing row is a normal, explicit result. A metadata or SQL failure must reach the existing outer error handler rather than be mistaken for a deleted row. |
| Make `FeatureToggle` identifiers constant-global | The source entity owns its scope, not the current actor. This fixes all create/update/delete/undo/redo call sites through one helper. |
| Reuse source metadata in delete coverage | The delete coverage probe must conditionally add only the scope predicates declared by the source entity; global rows get no scope predicate. |

### Alternatives considered

| Alternative | Rejected because |
|---|---|
| Catch missing-column SQL errors and continue from payload | It hides genuine source-read failures and leaves an error on every global mutation. |
| Query `information_schema.columns` on each event | It adds database round trips and a cache/invalidation problem for data already known to MikroORM. |
| Maintain a hard-coded allowlist of global entity IDs | Every new global entity would require a central update and could drift from its entity declaration. |
| Normalize any non-null global payload silently | It masks a producer bug and permits an event contract violation to recur. A global event must explicitly carry two null keys. |
| Remove query indexing from global feature toggles | It changes existing behavior instead of making the generic indexer correctly support an entity shape it already receives. |

## Architecture

```text
FeatureToggle command
  └─ featureToggleIdentifiers() -> { organizationId: null, tenantId: null }
       └─ DataEngine emits existing query_index.upsert_one / delete_one
            └─ Query-index subscriber
                 ├─ resolve registered entity + mapped scope columns
                 ├─ global: require explicit null/null, no source scope SELECT
                 ├─ scoped: read only declared scope columns; validate payload against row
                 └─ write/soft-delete entity_indexes at resolved scope
```

### 1. Resolve source metadata once per subscriber invocation

Add an internal helper in `packages/core/src/modules/query_index/lib/subscriber-scope.ts` that returns a typed descriptor:

```ts
type QueryIndexSourceMetadata = {
  table: string
  organizationColumn: string | null
  tenantColumn: string | null
}
```

It MUST:

1. Require `entityType` to be an exact member of the generated entity-ID registry, then resolve it with `resolveRegisteredEntityTableName(em, entityType)`.
2. Find the matching MikroORM metadata entry by the resolved table name.
3. Read `organizationId` and `tenantId` only from that metadata entry's properties. When present, require exactly one mapped `fieldNames` entry and use that physical column name.
4. Throw `QueryIndexScopeError` if the ID is not registered, the table is not registered, metadata cannot be matched, or an expected scope property has no single physical field name.

This descriptor is local to `query_index`; it does not introduce a new shared public API or DI service.

### 2. Represent source-scope state explicitly

Replace the nullable-only internal hand-off with a discriminated result such as:

```ts
type QueryIndexSourceScope =
  | { kind: 'global' }
  | { kind: 'missing' }
  | { kind: 'row'; scope: QueryIndexScope }
```

`loadQueryIndexRowScope()` receives the resolved descriptor and behaves as follows:

| Source metadata | Database read | Result |
|---|---|---|
| Neither scope property | None | `{ kind: 'global' }` |
| One or two scope properties, row exists | Select only those mapped columns by primary key | `{ kind: 'row', scope }`; an absent dimension is `null` |
| One or two scope properties, row absent | Same narrow lookup | `{ kind: 'missing' }` |

All dynamic table and column identifiers originate exclusively in trusted ORM metadata. Query values, including `recordId`, remain Kysely parameters.

### 3. Resolve and validate the index record scope

`resolveQueryIndexRecordScope()` consumes payload-key presence, payload values, and `QueryIndexSourceScope`:

| Source state | Required behavior |
|---|---|
| `global` | Both keys MUST be present and both values MUST be `null`; otherwise throw `QueryIndexScopeError`. Return global null/null scope. |
| `row` | Preserve current behavior: every supplied dimension must equal the row dimension; fill omitted dimensions from the row. |
| `missing` | Preserve current delete-safe behavior: both payload keys are required because there is no row left to verify; normalize their values exactly as today. |

The `upsert_one` and `delete_one` subscribers must call the helper without an error-swallowing catch. Their existing outer `try/catch` continues to record failures through `recordIndexerError()` and rethrow. The originating `DataEngine` already logs a failed index event without failing the completed domain mutation, so this is fail-closed for the projection but not a user-visible write failure.

### 4. Delete coverage probe

After `markDeleted()`, `delete_one` currently probes the source row to calculate coverage delta. Reuse `QueryIndexSourceMetadata.table` instead of the permissive resolver and add predicates only when the corresponding mapped column exists:

- always: `id = recordId`;
- when `organizationColumn` exists: compare it with resolved `organizationId`, including `IS NULL` semantics;
- when `tenantColumn` exists: use existing null-safe equality against resolved `tenantId`.

For `FeatureToggle`, the coverage probe therefore selects `deleted_at` by ID with no organization or tenant predicate. The existing fallback remains unchanged when the `deleted_at` probe itself cannot run; this spec changes only the invalid scope-column assumptions.

### 5. Correct the global producer

Change `featureToggleIdentifiers()` in `packages/core/src/modules/feature_toggles/commands/global.ts` to return a constant scope:

```ts
{ id: toggle.id, organizationId: null, tenantId: null }
```

Remove its dependency on `ctx.auth`. Every call site already uses this one helper, including create, update, delete, undo, and redo. No command ID, event ID, request schema, or authorization rule changes.

## Data models

No entity or column changes are introduced.

| Existing model | Change |
|---|---|
| `feature_toggles` / `FeatureToggle` | Remains intentionally global with no `organization_id` or `tenant_id`. |
| `entity_indexes` / `EntityIndexRow` | Receives the existing nullable `organization_id` and `tenant_id` values as null/null for global toggles. |
| MikroORM metadata | Read-only runtime input to choose a safe projection and predicate; never persisted. |

There are no new PII fields, encryption maps, relationships, foreign keys, lifecycle columns, or transactions.

## Commands and events

No new commands or events are introduced.

| Existing surface | Compatibility decision |
|---|---|
| `feature_toggles.global.create`, `.update`, `.delete` | Keep IDs, input schemas, authorization, undo/redo behavior, and cache invalidation. Correct the index side-effect identifiers to global null/null. |
| `query_index.upsert_one` | Keep event ID and payload shape. For a global `FeatureToggle`, existing scope fields are now explicitly null. |
| `query_index.delete_one` | Same compatibility rule; delete uses the validated global scope for index soft deletion and coverage. |
| `query_index.reindex` | Unchanged. In particular, `resolveQueryIndexReindexScope()` and its `allowAllTenants` requirement are not modified. |

The only mutation remains the source feature-toggle command and its existing index side effect. There is no new command graph, event subscription, external call, or undo contract. The projection remains rebuildable from the source entity; command undo/redo continue to emit the appropriate existing index event.

## API contracts and UI/UX

No HTTP route, request/response schema, OpenAPI document, page, component, client boundary, translation, or design-system surface changes.

The existing `GET/POST/PUT/DELETE /api/feature_toggles/global` routes retain their contracts. Their command implementation produces a corrected internal index scope only. Consequently, `CrudForm`, `DataTable`, `apiCall`, `useGuardedMutation`, i18n, and the Frontend Architecture Contract are not applicable.

## Performance, cache, and scale

| Concern | Design |
|---|---|
| Global mutation | Removes one failing source scope query entirely. |
| Tenant-scoped mutation | Keeps one primary-key point lookup, but narrows its projection to one or two actual columns. |
| Delete coverage | Retains its one source-row point lookup; it removes nonexistent predicates for global/partial-scope tables. |
| Metadata lookup | In-memory ORM metadata only; no database catalogue read, cache, or invalidation path. |
| Indexes | Existing source primary keys support all lookups. No new index is necessary. |
| N+1 / bulk | Each event handles one record as before. Existing bulk/reindex batching is unchanged. |
| Cache | No read cache or cache key is introduced; no invalidation changes are needed. |

## Migration and backward compatibility

- No migration, backfill, generated-file change, configuration change, or deployment ordering constraint is required.
- The existing event IDs and fields remain stable. The corrected null/null values for global feature-toggle events are a bug fix: they now match the ownership model declared by `FeatureToggle`.
- Tenant-scoped event behavior remains backward compatible: omitted scope still derives from a source row, and a deleted source row still requires an explicit full payload scope.
- An unregistered `entityType` changes from best-effort table guessing to a logged index failure. This is intentional security hardening; valid CRUD indexers are registered through generated entity metadata.
- Rollback is code-only. Reverting the change restores prior behavior; it does not need data reversal. A pre-existing wrongly scoped global index row will be corrected by the next create/update/redo/reindex path, with no schema work.

## Implementation plan

### Phase 1 — Establish the global producer contract

1. Modify `featureToggleIdentifiers()` to emit null/null without reading the command actor. Update `commands/__tests__/global.test.ts` so a super-admin context with a real tenant ID still passes null/null identifiers to `markOrmEntityChange`. **Verification:** existing global command tests pass, and the assertion proves actor scope cannot leak into a global index event.
2. Extend `TC-FT-001.spec.ts`'s self-cleaning create → update → delete flow. After create and update, read the existing `entity_indexes` projection through `withClient()` and assert `organization_id IS NULL` and `tenant_id IS NULL`; after delete, assert the projection row is removed. `markDeleted()` already physically removes projection rows, so this preserves the existing delete contract. **Verification:** the API flow succeeds and the persisted active projection is global at every lifecycle point.

### Phase 2 — Make query-index scope resolution metadata-aware

3. Add the internal registered-source metadata descriptor and discriminated `global`/`row`/`missing` source-scope result in `lib/subscriber-scope.ts`. Replace permissive table fallback with `resolveRegisteredEntityTableName()`, project only declared mapped scope columns, and reject unknown metadata. **Verification:** unit tests cover both, tenant-only, global, missing-row, and unknown-metadata cases.
4. Update `resolveQueryIndexRecordScope()` to enforce explicit null/null for a metadata-declared global entity while retaining existing row authority and missing-row compatibility. Remove the `.catch(() => null)` from both subscribers. **Verification:** mismatch and missing-row regression tests remain green; global wrong/non-null payloads are rejected.
5. Reuse the source descriptor in `subscribers/delete_one.ts` so its coverage probe conditionally applies scope predicates. **Verification:** a global delete makes no scope predicate/read, while a tenant-scoped delete retains both predicates.

### Phase 3 — Prove the event paths and validate

6. Add subscriber-level unit tests for global upsert and delete. Assert global upsert calls `upsertIndexRow` with null/null and never creates a scope SELECT; assert global delete's coverage probe uses only the ID predicate and writes/marks the global index row. **Verification:** these tests fail against the old unconditional-column implementation.
7. Run the focused Jest suites, the affected integration scenario, and type checking with the repository's selected runner. **Verification:** no generated files change and the diff has no whitespace errors.

### File manifest

| File | Action | Purpose |
|---|---|---|
| `packages/core/src/modules/query_index/lib/subscriber-scope.ts` | Modify | Resolve registered metadata, model source-scope state, and enforce its validation rules. |
| `packages/core/src/modules/query_index/subscribers/upsert_one.ts` | Modify | Use the strict metadata/scope result and stop swallowing scope-load failures. |
| `packages/core/src/modules/query_index/subscribers/delete_one.ts` | Modify | Use the strict result and build the coverage probe from declared source columns. |
| `packages/core/src/modules/query_index/__tests__/subscriber-scope.test.ts` | Modify | Cover metadata shapes and resolver invariants. |
| `packages/core/src/modules/query_index/__tests__/delete-one-coverage.test.ts` or a focused sibling | Modify/Create | Prove global delete omits scope predicates while scoped behavior remains intact. |
| `packages/core/src/modules/query_index/__tests__/upsert-one-global-scope.test.ts` | Create | Prove global upsert uses null/null without a source scope SELECT. |
| `packages/core/src/modules/feature_toggles/commands/global.ts` | Modify | Emit global identifiers through the existing shared helper path. |
| `packages/core/src/modules/feature_toggles/commands/__tests__/global.test.ts` | Modify | Assert global command side effects are independent of actor tenant scope. |
| `packages/core/src/modules/feature_toggles/__integration__/TC-FT-001.spec.ts` | Modify | Assert index projection scope through the existing self-cleaning API lifecycle test. |

## Testing strategy

### Unit tests

| ID | Coverage | Expected result |
|---|---|---|
| `TC-QI-SCOPE-001` | Registered entity with both scope columns | A primary-key lookup selects both mapped fields; omitted payload scope derives from the row; mismatches reject. |
| `TC-QI-SCOPE-002` | Registered tenant-only entity | The lookup selects only `tenant_id`; the absent organization dimension is null and a non-null payload organization is rejected. |
| `TC-QI-SCOPE-003` | `FeatureToggle` global entity | No Kysely scope query is made; only explicit `organizationId: null, tenantId: null` resolves. |
| `TC-QI-SCOPE-004` | Missing source row | Existing full explicit payload behavior remains valid for delete timing. |
| `TC-QI-SCOPE-005` | Unknown, prefix-colliding, or unmatched metadata | A `QueryIndexScopeError` is raised; no pluralized-table or class-name collision fallback is used. |
| `TC-QI-UPSERT-001` | Global upsert subscriber | Calls `upsertIndexRow` with null/null and does not record a missing-column source-read error. |
| `TC-QI-DELETE-001` | Global delete subscriber | Coverage source probe includes only ID (no organization/tenant predicate); global `markDeleted` scope is null/null. |
| `TC-FT-SCOPE-001` | Create/update/delete and undo/redo command paths | Every `markOrmEntityChange` identifier set is null/null even when the actor has a tenant ID. |

### Integration coverage

Extend `packages/core/src/modules/feature_toggles/__integration__/TC-FT-001.spec.ts`; do not add a separate fixture family.

1. Log in as the existing super-admin fixture and create a uniquely named global feature toggle through `POST /api/feature_toggles/global`.
2. Read `entity_indexes` with the existing exported `withClient()` test helper and assert the one `feature_toggles:feature_toggle` projection has null organization and tenant fields.
3. Update through the existing API and assert the same global scope again.
4. Delete through the existing API, assert the projection has no remaining row, then use the test's current `finally` cleanup path.

The test creates data through the API, reuses its existing `finally` cleanup, and reads only its own generated record ID. It needs no seeded feature toggle, no migration, no external service, or UI path because this is an internal index-side-effect correction with no customer-facing UI change.

### Validation commands

Choose the runner once using the root `AGENTS.md` rule. Expected minimal gate sequence:

```bash
# Local runner
yarn workspace @open-mercato/core test --runInBand --runTestsByPath \
  src/modules/query_index/__tests__/subscriber-scope.test.ts \
  src/modules/query_index/__tests__/delete-one-coverage.test.ts \
  src/modules/query_index/__tests__/upsert-one-global-scope.test.ts \
  src/modules/feature_toggles/commands/__tests__/global.test.ts

OM_INTEGRATION_MODULES=feature_toggles npx playwright test --config .ai/qa/tests/playwright.config.ts TC-FT-001
yarn workspace @open-mercato/core typecheck
git diff --check
```

In Docker mode, replace each `yarn …` gate with `node scripts/docker-exec.mjs …`; invoke the Playwright command in the environment selected by the integration-test runner. No `yarn generate` is required because no auto-discovered module file is added or changed.

## Risks and impact review

#### Incorrectly treating an unknown entity as global

- **Scenario**: An index event contains a typo or unregistered `entityType`; a permissive fallback infers a table or treats the absence of metadata as global and accepts its payload scope.
- **Severity**: High
- **Affected area**: Query-index tenant isolation and projection integrity.
- **Mitigation**: Resolve only registered metadata and throw `QueryIndexScopeError` when it cannot be found. Do not convert this error to `missing`.
- **Residual risk**: The originating domain write can complete without its index projection because index side effects are intentionally best-effort. The existing indexer-error logging makes the fault detectable and a later reindex can repair it.

#### Cross-tenant or duplicate global projection

- **Scenario**: The actor's selected tenant is emitted for a global feature toggle, yielding a tenant-scoped index row for instance-global data.
- **Severity**: High
- **Affected area**: `entity_indexes`, coverage, and downstream search/index events.
- **Mitigation**: The global producer emits null/null; the metadata-declared global resolver requires exactly null/null; integration coverage observes the persisted projection after all three API mutations.
- **Residual risk**: Legacy rows may retain an old non-null tenant until the record changes or is reindexed. No schema or API data is exposed through this correction, and the next lifecycle event corrects the row.

#### Delete path still queries missing columns

- **Scenario**: Scope loading is fixed but delete coverage retains unconditional organization/tenant predicates, causing an invalid-column read during every global delete.
- **Severity**: Medium
- **Affected area**: `query_index.delete_one` coverage accounting.
- **Mitigation**: Reuse the resolved source descriptor to construct predicates only for declared scope fields; add a subscriber-level global-delete regression test.
- **Residual risk**: The independent `deleted_at` probe may still use its established fallback for entities that do not support soft delete. That existing fallback remains conservative (`baseDelta = -1`).

#### Metadata shape or naming-strategy regression

- **Scenario**: A future entity maps a scope property unusually, yielding no or multiple physical `fieldNames`.
- **Severity**: Medium
- **Affected area**: Index event processing for that entity.
- **Mitigation**: Validate a single mapped column in the descriptor and fail with a diagnosable `QueryIndexScopeError`; tests cover mapped column selection rather than hard-coded names.
- **Residual risk**: Such an entity will not be indexed until its mapping is corrected, which is safer than reading an arbitrary physical column.

#### Event storm or latency regression

- **Scenario**: Metadata resolution adds work to every write-heavy index event.
- **Severity**: Low
- **Affected area**: CRUD latency and event throughput.
- **Mitigation**: Use already-loaded runtime metadata, remove the global-table scope query, retain one primary-key lookup only for scoped records, and add no database catalogue query or cache.
- **Residual risk**: Existing per-record query-index work remains; bulk/reindex batching and coverage throttling are unchanged.

## Final compliance report — 2026-07-18

### AGENTS.md files reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/search/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| Root `AGENTS.md` | Preserve behavior unless a spec requests change; keep changes minimal and integrated at real call sites | Compliant | Corrects two real event paths and the single global producer helper; no unrelated refactor. |
| Root `AGENTS.md` | Never expose cross-tenant data or skip tenant/organization scoping | Compliant | Source row remains authoritative; global entities explicitly resolve only null/null; unknown metadata fails closed. |
| `BACKWARD_COMPATIBILITY.md` | Do not remove/rename event IDs or payload fields | Compliant | `query_index.*` IDs and fields are unchanged; global value correction is intentional. |
| `packages/core/AGENTS.md` | Event subscribers use module subscriber conventions | Compliant | Modifies existing non-persistent subscribers only; no new cross-module import or event. |
| `packages/core/AGENTS.md` | Cross-module side effects use events | Compliant | Retains existing DataEngine → query-index event boundary; no direct module coupling. |
| `packages/shared/AGENTS.md` | Shared has no domain logic; avoid new broad public contracts | Compliant | The metadata helper remains inside `query_index`; it reuses the existing strict shared table resolver. |
| `packages/search/AGENTS.md` | Search/index changes define scope and index strategy | Compliant | Projection scope is explicit; no search schema, index, or reindex strategy change. |
| `.ai/qa/AGENTS.md` | Integration tests are self-contained and clean up fixtures | Compliant | Extends existing API-created, `finally`-cleaned `TC-FT-001`; DB read is limited to its own record. |
| Root/API and UI rules | `makeCrudRoute`, OpenAPI, CrudForm/DataTable, `apiCall`, i18n, DS tokens | N/A | No route, UI, client, or user-visible string change. |
| Root/data rules | New entities require tenancy, optimistic locking, migrations, and encryption review | N/A | No entity or sensitive data is added or changed. |
| Frontend Architecture Contract | Required for app/UI/client-boundary work | N/A | No frontend file or UI behavior changes. |

### Internal consistency check

| Check | Status | Notes |
|---|---|---|
| Data models match event scope | Pass | `FeatureToggle` has no scope fields; projection scope becomes null/null. |
| Event contract matches producer and subscriber | Pass | Existing fields retained; producer, source metadata, and resolver agree on global semantics. |
| Risks cover all mutation paths | Pass | Create/update/delete plus undo/redo share one corrected identifier helper; delete coverage is explicit. |
| Cache and scale behavior | Pass | No cache added; source reads remain primary-key point lookups. |
| API/UI compatibility | Pass | No public endpoint or UI contract changes. |

### Non-compliant items

None.

### Verdict

**Approved — ready for implementation.**

## Review record

### Author review — 2026-07-18

- **Security**: Passed — strict registered metadata resolution, row mismatch rejection, and explicit global null scope.
- **Performance**: Passed — removes global scope reads and adds no database catalogue query.
- **Cache**: N/A — no cache behavior changes.
- **Commands**: Passed — existing command IDs, undo/redo, and event IDs stay intact.
- **Risks**: Passed — scope, delete coverage, metadata drift, and operational detection documented.
- **Verdict**: Approved.

### Independent scope-cohesion review — 2026-07-18

- **Reviewer**: Fresh-context agent, given only this spec path.
- **Result**: **KEEP** — source producer, generic metadata-aware scope resolver, and delete-coverage predicate repair are one atomic capability. Each half alone would either retain invalid source-column probes or cause existing global feature-toggle events to fail.
- **Boundary check**: The strict unregistered-entity rule is a necessary security property of the same resolver, not an independently deployable feature. No schema, reindex, API, or UI scope has been added.
- **Follow-up applied**: Added an explicit MVP/no-future-phase statement.

## Changelog

### 2026-07-18

- Expanded the skeleton into an implementation-ready specification.
- Resolved Q1: global feature-toggle events must emit explicit null/null scope rather than normalize actor tenant scope inside `query_index`.
- Added metadata-driven scope resolution, strict unknown-entity handling, delete-coverage repair, unit/integration coverage, compatibility, risk, and compliance requirements.
- Recorded an independent scope-cohesion **KEEP** review and explicit MVP boundary.
- Corrected the integration delete expectation to match the established physical removal of `entity_indexes` rows by `markDeleted()`; this avoids an unrelated projection-storage semantics change.
- Required exact generated entity-ID membership before resolving MikroORM metadata, because table resolution alone can match a class-name collision under another module prefix.

## Implementation Status

| Phase | Status | Date | Notes |
|---|---|---|---|
| Phase 1 — Establish the global producer contract | Done | 2026-07-18 | All feature-toggle lifecycle side effects now emit explicit null/null identifiers; unit and integration assertions were added. |
| Phase 2 — Make query-index scope resolution metadata-aware | Done | 2026-07-18 | Registered entity-ID and metadata resolution distinguish global, row, and missing scope state; delete coverage uses declared predicates only. |
| Phase 3 — Prove event paths and validate | In Progress | 2026-07-18 | Focused Jest suites pass; managed integration and repository validation gates remain. |
