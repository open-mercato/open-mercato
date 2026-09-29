# Extensible Documents Record-Link Registry

**Status:** Proposed  
**Issue:** [#6730](https://github.com/open-mercato/open-mercato/issues/6730)  
**Related:** [Documents Collaborative Editor](./2026-07-08-documents-collaborative-editor.md), [Module Extension Point Catalog](./2026-08-01-module-extension-point-catalog.md), [Calendar Event Type Extensions in PR #6687](https://github.com/open-mercato/open-mercato/pull/6687)

## 📝 TLDR

An enabled module can opt its own custom entity into Documents' **Insert record** picker and the same link, template, duplication, field-insertion, and related-record flows used by built-in records. One typed module declaration is generated into both browser and server registries; Documents does not import Customers, Catalog, Sales, or app modules. A nullable generic target pair makes contributed links durable while all eight existing type strings, columns, labels, order, routes, and authorization behavior remain intact.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Why |
|---|---|---|---|
| Q1 | Should registry, persistence, and built-in ownership be separate specs? | One spec with independently verifiable phases. | A picker contribution without a durable, server-verified link is not a working capability; the ownership move proves the same contract serves existing peers. |
| Q2 | How does one declaration reach both runtimes? | A generated registry plus server bootstrap registration and a lazy Documents client registry group, with empty stubs when Documents is disabled. | Reuses the repository's generator/bootstrap pattern; neither package imports an app-generated file. |
| Q3 | How are old and new targets distinguished? | The eight reserved legacy type strings keep their existing columns; a new namespaced custom-entity type uses the generic pair. | Existing rows and external identifiers stay byte-for-byte stable. |
| Q4 | What happens when a contributor disappears? | Preserve its stored row; redact target data on reads, deny new links and extraction, and allow a Documents-authorized unlink. | Re-enabling the module can restore access without leaking a revoked or unavailable record. |

## 📝 Problem Statement

`DOCUMENT_ENTITY_REGISTRY` in `packages/documents/src/modules/documents/lib/entityRegistry.ts` hard-codes eight record types and the Customers, Catalog, and Sales read paths. The picker, templates, and server verification use that list. `documentEntityTypeSchema` accepts only those strings; `DocumentEntityLink` stores seven target columns, with a customer-kind discriminator for two types; relation filtering has a matching column map. A module with `ce.ts` can create a scoped custom entity, but cannot contribute its records to Documents without editing Documents itself.

The design is similar to [PR #6687](https://github.com/open-mercato/open-mercato/pull/6687) in **owner-defined, optional contributions** and server enforcement. Its mechanism differs: calendar event types reuse existing widget injection and need no generator or new link storage, whereas Documents needs one generated client/server registry and additive generic persistence. The calendar contract is not copied into Documents.

## 📝 Proposed Solution

Add the module-root convention `document-entities.ts` with the named export `documentEntityTypes`. The CLI discovers enabled modules through its existing scanner, validates each contribution and collision, and emits one source-derived registry with browser and server bootstrap projections. Documents owns registry resolution and link behavior. Customers, Catalog, and Sales declare their current types in their own module roots; Documents declares `document` locally. An app module declares a namespaced custom-entity type and gets standard search and canonical detail paths from the shared custom-entity strategy.

Add `entity_type` and `entity_id` to `document_entity_links`. Legacy targets continue to use their current columns and serialized strings. Old deep-import exports remain available through a compatibility adapter for at least one minor release. Existing routes gain support for registered namespaced types; unknown or disabled types fail closed before persistence.

### Goals and non-goals

- **Goal:** A contributor defined beside its `ce.ts` is searchable, linkable, reloadable, filterable, and usable in field insertion, templates, and document duplication without editing Documents.
- **Goal:** Every read and mutation uses Documents permission plus current target visibility; a stored link never grants access to its target.
- **Goal:** Built-in type strings, order, labels, search endpoints, token fields, canonical URLs, feature/module gates, and database rows behave as before.
- **Non-goal:** Expose all custom entities automatically, add direct cross-module ORM relations, replace the picker, add portal/public access, or rewrite legacy rows merely for normalization.
- **Non-goal:** Add administrator-authored code or a second server-only contribution declaration.

### Market reference

[Frappe's custom DocType links](https://docs.frappe.io/framework/user/en/basics/doctypes/customize) show why opt-in links belong with an entity's metadata. [Airtable's linked-record selection](https://support.airtable.com/articles/8324991167-limiting-linked-record-selection-to-a-view-in-airtable) illustrates a searchable, constrained choice instead of arbitrary IDs. Documents keeps its own security model: target verification occurs under the caller's credentials on every sensitive server path, and a picker result alone never authorizes a link.

## 📝 Architecture

```text
owner module: ce.ts + document-entities.ts
                      │ enabled-module CLI scan; validate IDs and collisions
                      ▼
      document-entities.generated.ts (one declaration set)
             ├─ server bootstrap registration ─► Documents registry
             └─ lazy Documents client group ───► same Documents registry
                                                     │
                picker / templates ◄─────────────────┤
                server verification / link commands ◄┘
                                  │
                        document_entity_links
                       legacy columns | generic pair
```

### Ownership and declaration contract

The module-root file exports `documentEntityTypes` (named; no default fallback) as a readonly array of `DocumentEntityContribution` declarations. Define the public type and optional identity helper in a dependency-neutral type-only shared module path such as `@open-mercato/shared/modules/documents/entity-links`; this path contains no Documents runtime code and lets `core` and app modules compile without a `@open-mercato/documents` dependency. Record the final public path in `BACKWARD_COMPATIBILITY.md` before release.

There are two discriminated strategies:

| Strategy | Type ID and owner | Search/read and detail route | Persistence |
|---|---|---|---|
| `legacy` | One of the eight reserved strings; only its existing owning first-party module may declare it | Preserve the existing explicit endpoint, mapping, feature gates, token fields, and canonical-href policy | Existing target column and customer-kind semantics |
| `custom-entity` | `type` equals the contributor's `ce.ts` ID (`module:entity`), and its prefix equals the declaring module ID | Derive `/api/entities/records?entityId=<encoded>` and `/backend/entities/user/<encoded-entityId>/records/<encoded-recordId>`; use a declared safe `labelField`, optional safe subtitle field, and allowlisted token fields | Generic `entity_type` + `entity_id` pair |

`type` is stable, bounded to 191 characters, and for new types matches `entityIdRegex` (`^[a-z0-9_]+:[a-z0-9_]+$`). The generic ID is a UUID from existing custom-record storage. Require a nonempty localized `labelKey`, finite integer `order`, one label field, and explicit token-field keys and localization keys. Contributed field names must match safe identifier syntax and a declared/readable custom field; reject `id`, hidden fields, encrypted fields without an existing authorized read/search contract, and identifier-shaped labels. A type may declare `requiredModules` and `requiredFeatures`; the owner, `entities`, and `documents` requirements are implied. Availability checks use the platform's wildcard-aware ACL matcher. The `ce.ts` ID must exist and be enabled in the generated module set; a missing or mismatched declaration fails generation.

For a custom entity, search uses `searchFields=cf_<labelField>` on existing `GET /api/entities/records` (custom fields are stored with the `cf:` prefix; the query engine's `cf_` field path addresses them). The response mapper reads the route's normal bare `<labelField>` key. Exact verification uses `id=<uuid>&pageSize=1`. Build URLs with `URL`/`URLSearchParams` so the fixed `entityId` query is retained when adding search/pagination. The current route already enforces `entities.records.view`, per-entity ACL, tenant, selected-organization scope, and document-storage classification. If the label field is not server-searchable/readable, generation rejects the contribution or the type stays unavailable until corrected; never use a UUID as display label.

The current exact GET is **not** sufficient proof of the target's organization: it can read selected-organization descendants, and custom-record UUIDs can repeat in separate organizations. Add optional `scopeOrganizationId=<uuid>` to `GET /api/entities/records` for Documents' exact read (and picker search when bound to a document). The owner route resolves that explicit selection under the caller's tenant and organization ACL, rejects a missing/inaccessible organization, and narrows both `QueryOptions.organizationIds` and the storage predicate to **exactly** that one organization before applying `id`. The route must never trust a client-supplied scope without authorization, and Documents passes the document's immutable `organizationId`, not the browser's current selection. A matching ID from a descendant or sibling must not satisfy verification. The response need not expose raw organization IDs. Unqualified calls retain their present behavior; new route tests pin both modes. This is an additive owner-API parameter, not an unscoped Documents endpoint.

The generator validates literal type IDs and declaration shape before emitting output, fails with both source paths on duplicate IDs (including a reserved built-in), and sorts by `order`, module ID, then type ID. `legacy` IDs have locked order 10–80 and locked owner/strategy. The seven peer entries move into `customers/document-entities.ts`, `catalog/document-entities.ts`, and `sales/document-entities.ts`; `document` stays in Documents. A parity test compares each moved built-in entry's endpoint, feature, mapper, token fields, href policy, label, and order to the pre-move contract. No hard `requires` edge joins optional peers to Documents.

### Bootstrap and lifecycle

The CLI emits `document-entities.generated.ts` with typed entries only for enabled modules. The server bootstraps entries before the first API/command read through the existing generated bootstrap-registration path; CLI/worker bootstrap follows the same registration. The backend Documents client profile lazily loads a client projection of **that generated file** before mounting picker or template slot selector. The projection imports only browser-safe declaration modules. `document-entities.ts` avoids Node-only imports, ORM entities, secrets, and request-specific values. The registry is a Documents-owned process-local store, registered by replacement (not append) on bootstrap/HMR/tests with an immutable version for subscribers. Generation emits valid empty no-op stubs when Documents or contributors are disabled so an app without Documents never imports its runtime package.

Packages never import `apps/mercato/.mercato/generated/*`; only app bootstrap files do. Mirror app-shell client bootstrap changes into `packages/create-app/template/src/components/ClientBootstrap.tsx` and equivalent server bootstrap paths. Registry reads before bootstrap complete return a retryable unavailable state, not an unverified legacy list. No direct peer module import is added inside Documents. A generated source fingerprint invalidates in-memory views when enabled modules change; tenant/organization-specific results stay separately scoped.

### Compatibility bridge

Preserve public `EntityRegistryEntry`, `DocumentEntityRegistryEntry`, `DOCUMENT_ENTITY_REGISTRY`, `getEntityRegistryEntry`, `getEntityTokenFieldNames`, `DocumentEntityType`, and `documentEntityTypeSchema` exports at their current deep-import paths. The old `DocumentEntityType` and zod enum remain the **legacy eight-type** contract; introduce `DocumentLinkType` and `documentLinkTypeSchema` for registered types in new API, command, and persistence paths. The existing exported schemas and inferred types that embed the enum also remain legacy: `documentEntityLinkCreateSchema` / `DocumentEntityLinkCreateInput`, `documentTemplateContextSlotSchema` / `DocumentTemplateContextSlotInput`, `documentTemplateFillSlotSchema` / `DocumentTemplateFillSlotInput`, and their exported containing template create/update/preview/instantiate schemas and types. Add clearly named registered-type counterparts for route and internal use; do not widen a legacy inferred union in place. A type-level compatibility test compiles an exhaustive third-party switch and the old schema inputs. This avoids a source break for external consumers.

The deprecated `DOCUMENT_ENTITY_REGISTRY` remains an eight-entry read-only compatibility snapshot for at least one minor version; runtime paths use the generated effective registry. A parity test keeps the snapshot identical to owner declarations during the bridge; `@deprecated` plus `UPGRADE_NOTES.md` guide consumers to `listDocumentEntityRegistryEntries()` / `resolveDocumentEntityRegistryEntry()` (final names fixed at implementation). Existing functions keep their built-in inputs/results; registered custom types are additive. No legacy link or chip is rewritten.

## 📝 Data Model

Add nullable `entity_type varchar(191)` and `entity_id uuid` to `document_entity_links`. Keep seven existing target columns, `customer_kind`, foreign keys, indexes, and rows. Broaden `document_entity_links_exactly_one_target_chk` to count `entity_id` as one target **and** require `entity_type` iff `entity_id` is non-null; legacy target columns require both generic fields null. A generic row uses exactly one generic pair and no legacy target. Preserve the existing no-self-link check for `linked_document_id`.

Add a partial active uniqueness index on `(document_id, entity_type, entity_id)` where `entity_id IS NOT NULL AND deleted_at IS NULL`, and a partial reverse index on `(tenant_id, organization_id, entity_type, entity_id)` with the same active predicate. Existing legacy uniqueness/reverse indexes remain. Migration is additive for stored data, has a reviewed snapshot, and does not backfill/change existing rows. The `down()` path refuses to drop the pair while generic rows exist; an operator first exports/removes those links or rolls forward. A deploy rollback that disables registry code leaves generic rows intact and redacted.

`buildDocumentEntityLinkTarget`, `getDocumentEntityLinkType`, `getDocumentEntityLinkEntityId`, `visibility.ts`, serializers, undo snapshots, duplicate, template slot persistence, and relation predicates handle both strategies. Generic predicates use **bound** type/ID parameters and the scoped reverse index; legacy column identifiers come from a closed constant map, never user input. Tenant and document organization scope remain in every query. Generic rows store sanitized label and same-origin href snapshots, but active responses expose only current, verified target values and href. A disabled/unreadable target serializes with `canOpen: false`, `entityId: null`, `href: null`, no `values`, and a localized restricted label; row and type remain recoverable. Historical inline chips retain their static-snapshot semantics and never become access tokens.

## 📝 API Contracts

No new public mutation route is required. Existing Documents routes accept a `DocumentLinkType` after bounded syntax validation **and** effective registry-membership/availability validation:

| Path | Changed behavior | Required verification |
|---|---|---|
| `GET /api/documents` with relation filter | Registered generic type + UUID uses scoped generic reverse predicate. | Verify exact target under caller credentials and document organization before filtering; missing/forbidden share a denial. |
| `GET /api/documents/{id}/links` | Include generic rows in the unchanged link projection; the document detail route remains a separate read. | Re-fetch target; redact inaccessible fields and snapshots. |
| `POST /api/documents/{id}/links` and `DELETE /api/documents/{id}/links/{linkId}` | Create verified generic row; allow owner-authorized unlink if target module is later disabled. | Optimistic lock, Documents capability, scope, active uniqueness, target verification on create. |
| Template create/edit/preview/instantiate and record-field insertion | Registered generic type can be selected, previewed, inserted, materialized. | Validate slot type/field allowlist and refresh each target before extraction; required inaccessible slot fails, optional one omits. |
| `POST /api/documents/{id}/duplicate` and command undo/redo | Copy permitted generic links; restore exact type/ID snapshots on undo. | Re-verify each target before copying; unavailable links are omitted with safe report, never copied from stale label/href. |

Picker toolbar, `@` insertion, related-document widget, and template slot selector consume the same registered list. Search calls `apiCall` and stays at or below `pageSize=100` (picker remains 20). Server re-fetches the exact target using the existing bounded, same-origin lookup, caller credentials, no redirects, timeout, response-size cap, safe label mapping, canonical href check, and the owner API's new exact-organization qualifier. Broad caller access must not attach another organization's record. Unknown, malformed, disabled, duplicated, or unauthorized types fail before writes with current localized error family and no existence oracle. Route OpenAPI and **new registered-type** zod schemas widen additively; existing public legacy schemas, request/response fields, and status meanings remain valid.

## 📝 UI/UX

The current `documents.entityPicker` keeps its tabs, keyboard navigation, loading/empty/error states, and eight built-in labels/order. A readable contributed type appears in deterministic order with its localized label. A contributor whose module/entity is disabled is omitted; a caller without its read feature sees no results and cannot create a link. Selecting a custom record shows sanitized label and optional subtitle and navigates only to canonical encoded detail route. A revoked target appears as a restricted related-record card without link or field-insertion action. Standard dialog shortcuts (`Cmd/Ctrl+Enter`, Escape) and accessible tab labels remain.

The generic custom-record edit page currently has no Documents panel injection spot. Add one additive host spot (proposed `detail:entities.custom-record:footer`) passing stable `{ entityType, recordId }` context after load, and map the existing Documents related-record widget to it. The widget derives the canonical Documents type from generated registry and uses the same Documents relation query/permission logic as built-in hosts; it is inert when Documents or contribution is absent. This is an additive UI surface, not a direct `entities` → `documents` import. Freeze final spot ID/context shape in `BACKWARD_COMPATIBILITY.md` when implemented.

The picker gains a tab for an opted-in custom entity; no redesign or administration page is proposed. For the implementation PR, capture current picker and proposed contributed tab/related-record card in browser screenshots and verify light/dark and keyboard behavior using backend-UI and design-system rules.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| Duplicate, invalid, wrong-owner, or reserved declaration | `yarn generate` fails before output is published, naming both sources and invalid field. |
| Documents or optional peer disabled | Empty/no-op projection or omitted entry; unrelated module behavior boots. Generic rows remain stored/redacted. |
| Client bootstrap chunk fails | Picker/template selector shows retryable registry error; no unverified fallback selection. |
| Server registry absent or stale | Mutations fail closed with retryable error; never trust client list/stale snapshot. |
| Target 404/403, wrong tenant/org, malformed label/href, or redirect | Mask target existence as current restricted/unavailable response; no link or field extraction. |
| Target timeout or oversized response | Bounded 503/retry; no partial insert/template creation. |
| Duplicate link race | Database unique index resolves it; command maps conflict and preserves undo history. |
| Contributor removed after linking | Row remains; projections redact; Documents-authorized unlink works; re-enable can restore visibility. |
| Generic rows during migration rollback | `down()` refuses destructive column removal; export/remove or roll forward. |

Structured logs record owner module, type, phase, and outcome, not target response content, labels, document text, credentials, or record IDs.

## 📝 Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Wrong-scope target disclosed through search/reverse lookup | Critical | Documents API/picker | Caller-credential exact read, document-scope check, bound reverse query, redacted projection, cross-tenant/org tests | Future owner routes must preserve their ACL/scope contract. |
| Generated browser/server registry divergence | High | Bootstrap/authorization | One declaration set, two projections, versioned replacement, parity tests in app and standalone | Bad deploy fails closed until regeneration. |
| Legacy behavior drift during ownership move | High | Deep imports/stored links | Frozen eight-ID parity fixture, deprecated compatibility snapshot, additive migration, `UPGRADE_NOTES.md` | Bridge maintenance for one minor release. |
| Generic constraint/index affects large table | Medium | Database deploy | Nullable columns, partial indexes, migration review and rollback guard; measure lock time | Index creation may need an operational window. |
| Extracted target data survives in shared document | Medium | Privacy | Explicit static-snapshot copy, current authorization before extraction, disclosure copy retained | Previously inserted text cannot be retracted automatically. |
| Unsafe custom field/label reaches editor | Medium | UI/export | Allowlist readable scalar fields, sanitizer, bounded response/value lengths, same-origin href check | Trusted module authors can misconfigure field semantics. |

## 📋 Phasing

1. **Contract and bootstraps:** Declared custom type reaches both registries; all eight old types remain operational.
2. **Persistence and flows:** Generic links work end to end, legacy storage stays unchanged, server checks are authoritative.
3. **Standalone proof and documentation:** App-owned custom entity passes integration, generator/build, and harness gates; UI evidence accompanies implementation.

## 📋 Implementation Plan

### Phase 1 — Declaration and registry

1. Add type-only contribution contract, `document-entities.ts` discovery, generator collision/owner/field checks, deterministic order, and empty stubs. Test source and compiled-package discovery, invalid/duplicate IDs, and Documents-disabled generation.
2. Add server registration and lazy Documents client group from one generated set in monorepo and create-app template. Test API/worker/browser first-read timing, replacement/HMR, missing-chunk retry, and no package-to-app import.
3. Move seven peer-owned legacy declarations outward and retain eight-entry compatibility bridge. Test all built-in labels, order, endpoint, ACL, token, href, and legacy deep-import behavior against immutable parity fixture.

### Phase 2 — Durable links and UI flows

4. Add generic target pair, broaden checks, and add active unique/reverse indexes with migration snapshot and rollback guard. Test existing rows, both strategies' exactly-one invariant, soft-delete/revive, duplicate races.
5. Add `DocumentLinkType` validation and registered-type schema counterparts to Documents commands, API routes, visibility, serialization/redaction, template/field insertion, duplicate, and undo. Add the exact-org qualifier to the owner records GET. Test malformed/disabled/unauthorized types, `cf_` label search, same-origin href, current target ACL, and same-organization scope before persistence.
6. Bind picker/toolbar/`@` selector and template slots to effective client registry. Add generic custom-record detail injection spot and map Documents' related-record widget. Test keyboard, loading, inaccessible type, revoked link, and related-panel behavior.

### Phase 3 — Standalone and contract proof

7. In mirrored disabled-by-default `example` module, add `labelField: 'title'` to `ce.ts` entity `example:calendar_entity` and matching Documents opt-in declaration. In fresh scaffold fixture, enable example plus Documents, install entity, create its own record, link it, and clean up. Do not expose entity with example disabled.
8. Update Documents README and parent spec, module-development guide, auto-discovery catalog, generated module facts, `BACKWARD_COMPATIBILITY.md`, and `UPGRADE_NOTES.md` with exact frozen filename/export/type/bootstrap/spot contracts. Mirror template app-shell and example changes. Run `om-refresh-standalone-harness` for implementation range and its `om-evolve-harness` knowledge-change contract: add distinct failure-first fresh-scaffold case separate from `OMH-234`, synchronize knowledge owners/catalogs, source-link/surface inventories, validator counts, release matrix/fixture/oracle, and require certified affected lane plus manifest gate.
9. Run `yarn build:packages → yarn generate → yarn build:packages → yarn i18n:check-sync → yarn i18n:check-usage → yarn typecheck → yarn test → yarn build:app`, package/standalone gates, `yarn template:sync`, module-decoupling coverage, and integration cases below. Review generated output; never hand-edit registries or apply local DB migration merely to quiet generator.

## Integration Coverage

All new tests are self-contained: create tenant/organization, Documents, app-owned custom-entity definition/record, and access grants in setup; remove records, links, templates, definitions, Documents in `finally`. No seeded/demo records.

| Case | API and key UI path | Assertions |
|---|---|---|
| `TC-DOCUMENTS-023` | Picker, `POST/GET/DELETE /api/documents/{id}/links`, reload | Contributed tab searchable by label, create durable generic row, reload/href/label, unlink; keyboard and no raw UUID label. |
| `TC-DOCUMENTS-024` | `GET /api/documents?entityType=...&entityId=...`, exact `GET /api/entities/records?...&scopeOrganizationId=...`, custom-record detail panel | Correct reverse relation/panel; restricted, disabled, sibling-org and cross-tenant access denied without existence leak. Create the **same record UUID in two organizations** with different labels and prove only the document-org record can verify. |
| `TC-DOCUMENTS-025` | Template slot edit/preview/instantiate, record-field insertion, duplicate, undo/redo | Exact re-verification, allowlisted extraction, generic round-trip, restricted/removed target redaction and duplicate omission. |
| `TC-DOCUMENTS-026` | Built-in picker/link/related-panel paths | Eight types, URLs, labels/order, legacy columns, features, deep-import bridge retain old behavior; disabled optional peer boots. |
| `OMH-DOCUMENTS-EXT` | Fresh standalone scaffold with `ce.ts` + `document-entities.ts` | Failure-first harness resolves installed contract, then generation/typecheck/lint/build/focused test and knowledge-change manifest pass. |

Add unit/structural coverage for generator output/collision/order, missing-host paths, client/server registration parity, `cf_` search URL, exact-org owner query, label/href sanitization, new registered validation + membership alongside legacy type compatibility, DB checks/indexes, generic reverse predicate, redaction, and migration rollback refusal. Run `packages/core/src/__tests__/module-decoupling.test.ts` or equivalent and prove Documents contains no direct peer import.

## Migration & Backward Compatibility

This design adds one auto-discovery convention, public type/import path, generated registry exports, optional bootstrap handoff, optional exact-organization API query field, generic columns/indexes, and one injection spot. Document exact shipped names in `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md`; they become FROZEN/STABLE. No existing generated export, route URL, event/ACL/notification ID, widget spot, legacy type string, schema column, schema/type deep import is removed, renamed, or widened incompatibly. Existing enum, dependent exported schemas/types, and eight-entry registry export remain compatibility surfaces for at least one minor version, marked `@deprecated` only when replacements ship. Unqualified owner API reads and legacy row/API projections remain byte/behavior compatible; new request fields/types are additive. Future removal needs normal deprecation protocol and separate migration spec.

Deployment order is additive migration → generated registries and app/template bootstrap → runtime activation. Older code ignores nullable columns. If new code is rolled back, generic rows stay stored but cannot open through old runtime; rollback does not drop them. Re-enable new runtime or export/remove generic links before schema down migration. Source PR #6687 provides an analogous optional-contribution pattern but is not a runtime dependency of Documents.

## Final Compliance Report

| Rule | Verdict | Evidence / implementation gate |
|---|---|---|
| Module isolation | Pass in design | Owner files discovered by CLI; Documents never imports peers; no cross-module ORM relation or hard `requires`. |
| Contract stability | Pass in design | Legacy strings, exports, columns, routes, spots, behavior retained; additive names documented before release. |
| Tenant/org security | Pass in design | Exact owner-API read under caller credentials, document-scope check, bound reverse lookup, fail-closed redaction/denial tests. |
| Client/server parity | Pass in design | One generated declaration set with two bootstraps and parity/disabled-module tests. |
| UI and i18n | Pass in design | Existing picker/widget patterns; localized labels, retry/restricted states, keyboard coverage. |
| Integration requirement | Pass in design | `TC-DOCUMENTS-023`–`026` and fresh standalone case cover affected API and key UI paths. |

**Review verdict:** Ready for specification review. This document is design-only; its compliance gates become implementation acceptance tests.

## Changelog

### 2026-09-29 — Initial proposal

- Defined module-owned declaration, generated client/server handoff, legacy compatibility bridge, generic persistence and rollback, Documents flow coverage, and standalone harness owner for #6730.
