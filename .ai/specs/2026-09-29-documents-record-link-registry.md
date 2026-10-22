# Extensible Documents Record-Link Registry

**Status:** Proposed
**Issue:** [#6730](https://github.com/open-mercato/open-mercato/issues/6730)
**Related:** [Documents Collaborative Editor](./2026-07-08-documents-collaborative-editor.md), [Module Extension Point Catalog](./2026-08-01-module-extension-point-catalog.md), [Calendar Event Type Extensions in PR #6687](https://github.com/open-mercato/open-mercato/pull/6687)

## TLDR

An enabled module can opt one of its non-global custom entities into Documents' record picker and every existing record-link flow. Documents keeps its eight built-in registry entries and their storage unchanged; module-owned custom entities are aggregated through the existing `GeneratorPlugin` mechanism into one browser-safe generated declaration set, registered on the API server and in the backend client. A nullable generic target pair stores contributed links, while target reads remain caller-authorized and exactly scoped to the document's tenant and organization.

## Resolved Design Decisions

1. **The spec owns one end-to-end capability.** Registry discovery, generic persistence, picker/search, link CRUD, relation filtering, templates, field insertion, duplication, undo/redo, and redaction are one contract because issue #6730 requires a contributed record to work anywhere an existing record link works. Moving the built-in registry entries is independent cleanup and is excluded.
2. **Use and extend `GeneratorPlugin`.** Documents owns `generators.ts`; contributors only export data from `document-entities.ts`. Two optional additive `GeneratorPlugin` hooks provide convention validation and client registration. No second scanner or Documents-specific generator pipeline is introduced.
3. **Keep the built-ins in Documents.** `DOCUMENT_ENTITY_REGISTRY`, its eight type strings, all legacy columns, deep imports, routes, labels, order, mappers, and token behavior stay where they are. The generated registry contains custom-entity contributions only and is overlaid on the static built-ins at runtime.
4. **Reuse the existing CrudForm host.** The related-documents widget maps to `crud-form:*`, then resolves the normalized `module.entity` context against the effective registry. No new injection spot is added.
5. **Reject global custom entities in v1.** A document link is tenant- and organization-owned, while `CustomEntitySpec.global` records have nullable tenant/organization scope. Generation rejects a contribution whose matching `ce.ts` declaration has `global: true`; supporting global targets requires a separate security model and spec.
6. **CLI and worker processes do not load this registry.** Link verification requires an authenticated request and all affected commands/routes run in the API process. Server registration therefore uses the existing API bootstrap path. The implementation must not claim that `dynamicLoader` loads bootstrap registrations; a future worker/CLI consumer must add and test an explicit bootstrap path.

## Problem Statement

`DOCUMENT_ENTITY_REGISTRY` in `packages/documents/src/modules/documents/lib/entityRegistry.ts` hard-codes eight record types and the Customers, Catalog, and Sales read paths. `documentEntityTypeSchema` accepts only those strings, and `DocumentEntityLink` uses seven nullable target columns plus `customer_kind` to represent the eight types. A module can declare an organization-scoped custom entity in `ce.ts`, but it cannot opt that entity into Documents without editing Documents itself.

The picker is client-side while verification, persistence, templates, relation filters, duplication, undo, and redaction run server-side. A server-only DI registration would leave the browser with a different registry; duplicating client and server declarations would create authorization drift. The design needs one module-owned declaration compiled into both runtime registrations.

## Proposed Solution

Add the module-root convention `document-entities.ts` with the named export `documentEntityTypes`. Each entry references a custom entity declared by the same module's `ce.ts`. Documents adds a module-owned `generators.ts` plugin that uses the existing generic plugin discovery and output machinery.

Extend the STABLE `GeneratorPlugin` interface with two optional capabilities:

- `validateContributions(context)` receives each enabled module's source path, module ID, resolved named export, and declared custom-entity metadata. The Documents plugin validates literal IDs, owning-module prefixes, non-global scope, `ce.ts` membership, field allowlists, duplicate IDs, and stable order before output is written. Diagnostics name every conflicting source path. Existing plugins omit the hook and behave byte-for-byte as before.
- `clientRegistration` parallels `bootstrapRegistration`: it declares an entries export, browser-safe registration imports/call, and one or more named client registry groups. The CLI emits an always-present `client-bootstrap-registrations.generated.ts` dispatcher with empty groups when no plugin contributes. `ClientBootstrap` adds and loads a small `documents` group in backend profiles. Existing plugin output and bootstrap semantics remain unchanged.

The Documents plugin emits one browser-safe `document-entities.generated.ts`. The API bootstrap registration and backend client dispatcher both import that file and replace their Documents-owned custom contribution registry from the same array. Registry state uses a stable `globalThis` key in the publishable package, an immutable version, and change subscribers so late client registration invalidates an earlier empty read. Packages never import `apps/mercato/.mercato/generated/*` directly.

Add nullable `entity_type` and `entity_id` columns to `document_entity_links` for contributed targets. The eight built-in target types continue using their existing columns and static registry. Existing public legacy schemas and type exports retain their current eight-type unions; new registered-type schemas are used by widened runtime routes and commands.

### Goals and Non-goals

- **Goal:** An enabled app or package module opts a non-global custom entity into Documents without modifying or importing Documents.
- **Goal:** The contributed type works in picker search, link create/list/delete, relation filtering, templates, field insertion, duplication, undo/redo, and related-record display.
- **Goal:** Current target authorization and exact document-organization scope are re-checked before sensitive reads or writes.
- **Goal:** The eight built-ins and all existing public/storage contracts remain behavior-compatible.
- **Non-goal:** Move built-in registry ownership to Customers, Catalog, or Sales.
- **Non-goal:** Support `CustomEntitySpec.global`, expose every custom entity automatically, add portal/public access, or replace the picker.
- **Non-goal:** Add a new injection spot or make CLI/worker processes load the registry.

### Alternatives Considered

- **Add Documents metadata to `CustomEntitySpec`:** rejected because it puts a Documents-specific contract in the shared custom-entity DSL and makes future domain integrations accumulate there.
- **Add a Documents-specific CLI scanner:** rejected because `GeneratorPlugin` already provides module-owned convention aggregation, deterministic output, cleanup when the owner is disabled, and server bootstrap registration.
- **Move the eight built-ins outward now:** rejected as independently deployable compatibility work with no benefit to custom-entity contributors.

## Architecture

```text
contributor module
  ce.ts + document-entities.ts
          │
          │ generic GeneratorPlugin scan + validation
          ▼
document-entities.generated.ts (custom entries only)
          ├── API bootstrap registration ──► server registry
          └── backend client group ────────► browser registry
                                             │
static built-ins + generated custom overlay ─┤
                              picker / related widget / server verification
                                             │
                                  document_entity_links
                               legacy columns | generic pair
```

### Declaration Contract

`document-entities.ts` exports a readonly `documentEntityTypes` array. The public type and helper live at a dependency-neutral path such as `@open-mercato/shared/modules/documents/entity-links` and contain data only.

Each v1 entry contains:

- `entityId`: the exact namespaced `ce.ts` ID, whose prefix equals the declaring module ID;
- `labelKey`: localized picker-tab label;
- `order`: finite integer, sorted after the locked built-in order and then by module ID/entity ID;
- optional `subtitleField` and `tokenFields`, each restricted to readable scalar fields declared by the same `ce.ts` entity;
- optional `requiredModules` and `requiredFeatures`; the owner, `entities`, and `documents` requirements are implied.

The display field is not declared twice. It is the matching `CustomEntitySpec.labelField`; generation fails when it is absent, hidden, encrypted without an authorized read contract, identifier-shaped, or not a readable scalar. `subtitleField` and token fields follow the same field validation. Type IDs are bounded to 191 characters and match `^[a-z0-9_]+:[a-z0-9_]+$`.

Generation rejects missing or mismatched `ce.ts` entities, global entities, disabled owners, duplicate IDs, invalid fields, and collisions with the eight reserved built-in strings. The generated file contains enabled modules only and is deterministic. If Documents is disabled, its plugin output is removed and the central client/server dispatchers remain valid no-ops.

### Runtime Lifecycle

The API path invokes `runBootstrapRegistrations()` before any Documents route or command resolves the registry. CLI commands, queue workers, and the collaboration sidecar do not consume the contributed registry in v1.

All backend profiles load the small `documents` client group because the picker appears under Documents while `crud-form:*` hosts may appear on any backend custom-record route. Client registration is replacement-based, not append-based. Hooks subscribe to the registry version so hydration or a late chunk cannot permanently cache an empty result. Failed client loading produces the existing retryable loading/error state and retries on the next bootstrap attempt.

### Registry Resolution

`listDocumentEntityRegistryEntries()` and `resolveDocumentEntityRegistryEntry()` merge the unchanged static eight-entry registry with the generated custom overlay. Reserved built-in IDs always win and collisions fail generation. Custom entries derive:

- search/read: `/api/entities/records?entityId=<encoded>`;
- search field: `searchFields=cf_<labelField>` while the response mapper reads the route's bare `<labelField>` key;
- exact read: `id=<uuid>&pageSize=1&scopeOrganizationId=<documentOrganizationId>`;
- canonical detail: `/backend/entities/user/<encoded-entityId>/records/<encoded-recordId>`.

URLs use `URL` and `URLSearchParams`, preserving the fixed `entityId` query during search and pagination. The picker remains bounded to 20 results and all list requests remain at or below 100.

## Data Model

Add nullable `entity_type varchar(191)` and `entity_id uuid` to `document_entity_links`. Keep every legacy target column, foreign key, type string, index, and row.

Broaden `document_entity_links_exactly_one_target_chk` so a row contains either exactly one legacy target or the generic pair. `entity_type` and `entity_id` must both be null or both be non-null. Add:

- a partial active uniqueness index on `(document_id, entity_type, entity_id)` where `entity_id IS NOT NULL AND deleted_at IS NULL`;
- a partial reverse index on `(tenant_id, organization_id, entity_type, entity_id)` with the same active predicate.

The generated migration and Documents snapshot contain only this additive change. No row is backfilled. `down()` refuses to drop the pair while generic rows exist, so rollback preserves data until an operator exports/removes those links or rolls forward.

Generic rows store scalar IDs plus sanitized label/href snapshots, never a cross-module ORM relation. Active reads expose current verified data only. When the contributor is disabled or inaccessible, the row remains recoverable but serializes with `canOpen: false`, `entityId: null`, `href: null`, no values, and a localized restricted label. Documents-authorized unlink remains available without target access.

## API Contracts

### Exact organization qualifier

Add optional `scopeOrganizationId=<uuid>` to `GET /api/entities/records`. It is a reserved query key and must be added to `listRecordsQuerySchema` and the `qpEntries` exclusion list so it never becomes a record field filter.

When present, the route resolves the requested organization under the authenticated caller's tenant and organization ACL, then narrows both `QueryOptions.organizationIds` and custom storage to exactly that organization. Documents passes the persisted document `organizationId`, never the browser selection. Missing, inaccessible, sibling, descendant, or cross-tenant organizations fail without revealing record existence. Unqualified calls preserve current behavior.

Global custom entities are rejected at generation, so `scopeOrganizationId` never selects an `organization_id IS NULL` record for this feature.

### Documents routes and commands

No new mutation route is required. Existing routes accept a new bounded `DocumentLinkType` only after effective-registry membership and availability checks:

| Path | Added behavior | Required verification |
|---|---|---|
| `GET /api/documents?entityType=...&entityId=...` | Generic reverse predicate by bound type/ID. | Exact target read in the document organization before filtering. |
| `GET /api/documents/{id}/links` | Generic rows use the unchanged response projection. | Re-fetch and redact inaccessible targets. |
| `POST /api/documents/{id}/links` | Create or revive a generic link. | Optimistic lock, Documents capability, exact target scope, active uniqueness. |
| `DELETE /api/documents/{id}/links/{linkId}` | Unlink even when the contributor is unavailable. | Documents edit capability and document/link scope; no target disclosure. |
| Template create/edit/preview/instantiate and field insertion | Registered type and allowlisted token fields. | Re-fetch before extraction; required inaccessible slot fails and optional slot omits. |
| `POST /api/documents/{id}/duplicate` and undo/redo | Round-trip generic targets and snapshots. | Re-verify before copy; omit unavailable links with a safe report. |

Unknown, malformed, disabled, duplicated, or unauthorized types fail before persistence using the current localized error family and no existence oracle. All target lookups retain caller credentials, same-origin URL construction, no redirects, a 3-second timeout, 1 MB response cap, safe label mapping, canonical href validation, and wildcard-aware ACL matching.

### Existing built-in organization gap

The existing eight built-in lookups can accept records visible through a selected organization's descendant scope because their owner routes do not prove exact equality with the document organization. This PR does not move or rewrite those owner contracts. [Issue #7780](https://github.com/open-mercato/open-mercato/issues/7780) defines exact-organization qualifiers for the affected Customers, Catalog, Sales, and Documents lookup routes with cross-organization tests. #7780 must merge before implementation of this spec begins; the implementation PR must not bundle that independently deployable hardening or claim the custom qualifier fixes legacy lookups.

## Compatibility

Preserve these exports and their current legacy-eight semantics at their existing deep-import paths:

- `EntityRegistryEntry`, `DocumentEntityRegistryEntry`, `DOCUMENT_ENTITY_REGISTRY`;
- `getEntityRegistryEntry`, `getEntityTokenFieldNames`;
- `DocumentEntityType`, `documentEntityTypeSchema`;
- `documentEntityLinkCreateSchema` and every exported template/link schema or inferred type that embeds `DocumentEntityType`.

Introduce `DocumentLinkType`, `documentLinkTypeSchema`, and registered-type input schemas for widened runtime paths. Do not widen a legacy inferred union in place. Add a type-level compatibility test containing an exhaustive switch over the old eight-type union and old schema inputs.

The new convention filename/export, optional `GeneratorPlugin` fields, generated dispatcher/export names, registry accessor imports, request query parameter, database columns/indexes, and `crud-form:*` mapping are additive contract surfaces. Record their final names in `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md` when implemented. Future removal follows the normal deprecation protocol.

## UI/UX

The current `documents.entityPicker` retains its built-in tabs, order, keyboard behavior, loading/empty/error states, and page size. A readable contributed type appears after the built-ins using its localized `labelKey`. Missing permissions or a disabled contributor hide it; selecting a result still triggers server verification.

Map `documents.injection.related-documents` to the existing `crud-form:*` wildcard. `CrudForm` already derives `crud-form:<module.entity>` from a custom entity ID and supplies record identity/data. `resolveRelatedDocumentContext` replaces its hard-coded type/label branching with registry resolution, normalizes the host ID back to the registered `module:entity`, and remains inert for an unregistered entity or a create form. The existing built-in mappings stay intact. No new FROZEN injection spot is created.

The implementation PR captures browser screenshots of a contributed picker tab and a custom-record related-documents card, and verifies light/dark rendering, keyboard navigation, cold-load shell, retry/error state, mobile viewport, and permission-hidden behavior.

## Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| Duplicate, invalid, wrong-owner, reserved, global, or undeclared contribution | `yarn generate` fails before publishing output and names the source files. |
| Documents or contributor disabled | Generated custom entry is absent; built-ins and unrelated modules still boot. Stored generic rows remain redacted. |
| API registry not bootstrapped | Route/command fails closed with a retryable unavailable error. |
| Client registration arrives after first render | Registry version invalidates the empty read and the UI retries. |
| Client chunk fails | Picker/widget shows the existing retryable error state; no unverified fallback. |
| Target missing, forbidden, wrong tenant/org, malformed, redirected, or non-canonical | Deny/redact without an existence oracle; do not write or extract. |
| Lookup timeout or oversized response | Bounded 503/retry; no partial insert or template mutation. |
| Duplicate-link race | Partial unique index chooses one winner; command maps the conflict and preserves undo history. |
| Contributor removed after linking | Row persists, projections redact, unlink works, and re-enable can restore visibility. |
| Generic rows exist during rollback | `down()` refuses destructive column removal. |

Structured logs include owner module, type, phase, and outcome, but exclude record IDs, labels, response content, credentials, and document text. Every catch that records an error also reports it through the repository error-reporting helper.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Wrong-scope target disclosed | Critical | Entities/Documents APIs | Caller-authorized exact-org read, bound reverse query, redaction, sibling/cross-tenant tests | Legacy built-ins require the separately tracked prerequisite. |
| Client/server registry divergence | High | Bootstrap/authorization | One generated array, two registrations, versioned replacement, parity and late-registration tests | A bad deployment fails closed until regeneration. |
| Generator contract regression | High | CLI/create-app | Optional `GeneratorPlugin` fields, unchanged defaults, central empty dispatcher, monorepo and standalone tests | Published apps must regenerate after enabling Documents. |
| Generic constraint/index affects a large table | Medium | Database deploy | Nullable columns, scoped partial indexes, migration review, rollback guard | Index creation may need an operational window. |
| Extracted target data persists in document content | Medium | Privacy | Re-authorize before extraction and document static-snapshot semantics | Previously inserted text is not automatically retracted. |
| Wildcard widget loads on unrelated forms | Low | Backend UI | Registry check returns null before data calls; retain exact built-in mappings | Small registration lookup on backend forms. |

## Phasing

1. **Contract and registration:** additive `GeneratorPlugin` capabilities, convention validation, generated custom array, API/client registration, and static-built-in overlay.
2. **Persistence and flows:** generic link schema/migration plus every existing Documents link consumer and exact custom-entity scope.
3. **UI and standalone proof:** picker/widget integration, create-app parity, integration coverage, docs, compatibility ledger, and harness case.

Each phase leaves the application working. Phase 1 keeps custom entries unavailable to mutations until Phase 2 lands behind the registry availability check; Phase 2 exposes the capability only when its migration and all server consumers are present.

## Implementation Plan

### Phase 1 — Generator and registry contract

1. Add the type-only contribution contract and `documents/generators.ts`. Extend `GeneratorPlugin` additively with convention validation and client registration; emit always-present empty client/server dispatchers. Test old-plugin compatibility, output cleanup, Documents-disabled generation, duplicate/source diagnostics, global rejection, and source/compiled-package discovery.
2. Add `globalThis`-backed server/client custom registries, immutable replacement/version notification, and effective accessors that overlay the unchanged static eight entries. Test first read, replacement, HMR, late client registration, collisions, ordering, and built-in parity.
3. Wire API bootstrap and the backend `documents` client group in both the app and create-app template. Prove the registry is not loaded by CLI/worker `dynamicLoader`, package code does not import app-generated files, and disabled Documents leaves valid empty dispatchers.

### Phase 2 — Persistence, authorization, and existing flows

4. Add the generic target pair, check constraint, indexes, generated migration, and snapshot. Extend link target helpers, serializers, visibility, redaction, undo snapshots, and bound reverse predicates. Test legacy rows, both exactly-one strategies, duplicate races, soft-delete/revive, and rollback refusal.
5. Add registered-type schemas without widening legacy exports. Add `scopeOrganizationId` to the entities-records reserved schema/key list and exact organization resolution. Test unqualified compatibility, `cf_` label search, same UUID in two organizations, sibling/descendant/cross-tenant denial, global rejection, and masked absence.
6. Update link CRUD, relation filter, template edit/preview/instantiate, field insertion, duplication, and undo/redo to resolve the effective registry and re-verify at the documented boundaries. Test unavailable contributors, token allowlists, canonical hrefs, optimistic locks, omission/redaction, and legacy behavior.

### Phase 3 — UI, documentation, and standalone proof

7. Bind picker/toolbar/`@` insertion and template selectors to the versioned client registry. Add the `crud-form:*` related-documents mapping and registry-driven context resolver. Test keyboard/loading/error states, create-form inertness, unregistered forms, late registration, revoked target, and permission-hidden entries.
8. Add a non-global `ce.ts` entity and matching `document-entities.ts` to the monorepo example and its create-app template mirror. The example remains enabled in `apps/mercato/src/modules.ts` and disabled by default only in the create-app template. Update Documents README, the parent collaborative-editor spec, module-development/auto-discovery docs, generated module facts, `BACKWARD_COMPATIBILITY.md`, and `UPGRADE_NOTES.md`. Mirror app bootstrap changes with `yarn template:sync:fix`.
9. Run `om-refresh-standalone-harness` and add a failure-first fresh-scaffold case distinct from `OMH-234`. Synchronize knowledge owners/catalogs, source-link/surface inventories, validator counts, release matrix/fixture/oracle, and the knowledge-change manifest.

## Integration Coverage

All integration tests create their tenant, organization, document, custom entity, record, and grants in setup and delete them in `finally`. They do not rely on seeded/demo data.

| Case | API and key UI path | Assertions |
|---|---|---|
| `TC-DOCUMENTS-023` | Picker plus `POST/GET/DELETE /api/documents/{id}/links` | Search by label, durable generic row, reload/href/label, unlink, keyboard, no UUID display label. |
| `TC-DOCUMENTS-024` | Relation filter, exact entities-records GET, custom-record `CrudForm` card | Correct reverse relation; same UUID in two organizations resolves only the document-org record; sibling/cross-tenant/disabled access is masked. |
| `TC-DOCUMENTS-025` | Template slot edit/preview/instantiate, field insertion, duplicate, undo/redo | Exact re-verification, allowlisted extraction, generic round-trip, unavailable-target redaction/omission. |
| `TC-DOCUMENTS-026` | Built-in picker/link/related-panel paths | Eight IDs, URLs, labels/order, legacy columns, features, schemas, and deep imports retain old behavior. |
| `TC-EXAMPLE-017` | Generator plugin source and compiled-package fixtures | Validation hook, client registration, no-op dispatchers, deterministic output, global/duplicate/invalid rejection. |
| `OMH-DOCUMENTS-EXT` | Fresh scaffold with `ce.ts` + `document-entities.ts` | Failure-first authoring, generation, focused tests, typecheck/lint/build, and knowledge-change manifest pass. |

Add unit/structural coverage for registry versioning, client/server parity, generated dispatchers, reserved query keys, legacy type compatibility, schema constraints/indexes, generic predicates, redaction, and module decoupling. The implementation PR runs the configured validation gate in order, `yarn template:sync`, targeted integration tests, the certified harness lane, and browser QA with screenshots.

## Final Compliance Report

| Rule | Verdict | Evidence / implementation gate |
|---|---|---|
| Scope cohesion | Pass in design | Built-in ownership migration, global targets, new spots, and worker/CLI consumers are excluded; all retained flows share the one generic link contract required by #6730. |
| Canonical mechanisms | Pass in design | Extends `GeneratorPlugin`, API bootstrap registration, ClientBootstrap groups, CrudForm wildcard injection, and existing owner API. |
| Module isolation | Pass in design | Contributors export data; Documents imports no peer module and stores no cross-module ORM relation. |
| Contract stability | Pass in design | Static eight registry and legacy schemas/columns/imports remain; all new surfaces are additive and ledgered at implementation. |
| Tenant/org security | Conditional pass | Custom targets require exact authorized organization scope; legacy built-in exact-scope work is an explicit implementation prerequisite. |
| Client/server parity | Pass in design | One generated custom array feeds both replacement registries; late registration is observable. |
| Reversibility | Pass in design | Disable redacts without deletion; unlink remains possible; migration down refuses data loss. |
| Testability | Pass in design | Every implementation step names executable unit, integration, standalone, or browser evidence. |

**Review verdict:** Ready for re-review. Legacy built-in organization-scope hardening is tracked as the implementation prerequisite in #7780.

## Changelog

### 2026-10-22 — Review autofix

- Rebased the design on `GeneratorPlugin`, removed the built-in ownership move and new injection spot, rejected global entities in v1, corrected API-only bootstrap claims, reused `ce.ts.labelField`, reserved `scopeOrganizationId`, and made the legacy built-in organization gap explicit.

### 2026-09-29 — Initial proposal

- Defined module-owned declaration, generated client/server handoff, legacy compatibility bridge, generic persistence and rollback, Documents flow coverage, and standalone harness ownership for #6730.
