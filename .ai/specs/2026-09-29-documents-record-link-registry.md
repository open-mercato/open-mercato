# Documents Record Links via Search and Component Injection

**Status:** Proposed — rewritten for fresh review
**Issue:** [#6730](https://github.com/open-mercato/open-mercato/issues/6730)
**Related:** [Documents Collaborative Editor](./2026-07-08-documents-collaborative-editor.md), [Calendar implementation, PR #6688](https://github.com/open-mercato/open-mercato/pull/6688)

## TLDR

Documents can link authorized ordinary or custom entities contributed through `search.ts`, without a Documents-specific declaration, once Search can enforce their live per-record visibility. Missing owner visibility policy fails closed, even when feature-level ACLs pass. A default-on option in **Settings → Documents** replaces the current fixed record picker with unified search. Modules can additionally contribute record-link definitions through ordinary component injection (CI) widgets and a Documents-owned DI registry, following the Customers calendar event-type implementation in #6688. No Documents generator plugin, new auto-discovery convention, or generated record-link registry is introduced.

## Overview

This revision replaces the generated custom-entity registry proposed earlier in #6731. Search discovery and explicit CI contributions are two sources for the same record-link catalog, verification, persistence, and user interaction. The setting controls automatic discovery; explicit contributions remain available in either mode. Existing documents, links, template slots, and legacy public contracts remain usable.

### Resolved Design Decisions

1. **CI means the existing component/widget injection mechanism.** Follow #6688's headless `widget.ts`, ordinary `widgets/injection-table.ts`, host-owned catalog resolver, and soft-optional module DI registration. Do not use `GeneratorPlugin`, add `document-entities.ts`, or extend generic widget loaders, bootstrap groups, or `CrudForm` with Documents-specific code.
2. **Automatic linking is default on.** Enabled `search.ts` entities with an enforceable owner visibility policy are candidates, including ordinary module entities and custom entities. The feature is not limited to `ce.ts` or a fixed eight-type list. Caller permissions, live record visibility, and document scope determine which records can be shown or linked; feature-level `aclFeatures` alone never establishes record visibility.
3. **One search-first picker replaces the current picker when on.** Do not add another tab alongside the existing fixed tabs. In off mode, retain the built-in picker and add explicit CI definitions. CI definitions can also enrich or add candidates in on mode.
4. **Preserve historical links independently of discovery.** Disabling automatic discovery prevents new automatic assignments; it never deletes links or suppresses an otherwise authorized historical link. Removing a module or revoking access redacts its links until access returns.
5. **Keep domain ownership in Documents and Search.** Documents owns link policy, storage, UI, and CI contracts; Search owns its searchable catalog, strategy execution, and result authorization. Contributions carry browser-safe metadata; authoritative record reads and optional adapters stay server-side.

## Problem Statement

`packages/documents/src/modules/documents/lib/entityRegistry.ts` hard-codes eight types and their Customers, Catalog, and Sales read paths. The legacy `documentEntityTypeSchema` accepts only those strings; `DocumentEntityLink` represents them through seven nullable target columns and `customer_kind`. Adding a searchable entity currently does not make it linkable in Documents.

The previous proposal required a second entity declaration and new generator-plugin capabilities. That duplicates existing discovery and does not follow the recently implemented calendar extension model. Users need to find a record by its name or business reference in one search box, while module authors need an explicit CI extension path when search discovery alone is insufficient.

## Proposed Solution

Add `searchableEntityLinksEnabled` in Documents module settings, defaulting to `true`. Combine automatic Search candidates with explicit CI definitions into one effective catalog; use that catalog throughout picker search, `@` insertion, link CRUD, related-record filtering, templates, field insertion, duplication, and undo/redo.

| Setting | New assignment UI | Candidate sources |
|---|---|---|
| On, including no saved setting | Unified record search, optionally filtered by entity type | Enabled `search.ts` entities plus explicit CI definitions; legacy adapters preserve existing types and token behavior without restoring the fixed-tab UI. |
| Off | Existing built-in picker, extended by CI | Existing eight built-ins plus explicit CI definitions. Automatic-only types cannot receive new links. |

An enabled searchable entity needs no Documents contribution or Documents opt-in. It does need the Search-owned visibility capability specified below; an existing owner read policy can be adapted, but no policy is inferred from `aclFeatures` or nullable scope columns. Availability reflects the registered Search configuration and enforceable policy rather than hard-coded modules, index contents, or only entity types that happen to have results. Missing policy excludes the type from automatic assignment with a type-level diagnostic that contains no record data. A missing index affects results, not otherwise eligible catalog membership.

### Goals and Non-goals

- Support one discover → search → verify → link workflow for all authorized searchable records and explicit CI records.
- Make the setting reversible without rewriting or deleting existing links.
- Preserve legacy exports, persisted identifiers, routes, and template behavior through additive bridges.
- Ship all existing record-link consumers and self-contained API/UI coverage together; a picker-only implementation is incomplete.
- Exclude portal/public linking, automatic indexing/reindexing, new search strategies, a generator framework, and migration of built-in descriptor ownership into other modules.

### Alternatives Considered

- **Generator plugin and `document-entities.ts`: rejected.** Search already discovers searchable entities, and CI already discovers module widgets. A third discovery mechanism is unnecessary.
- **Only explicit CI contributions: rejected.** It would still require extra module work for every already-searchable entity.
- **Only search results: rejected.** Explicit CI adapters are needed for non-searchable records and specialized display/field integration, and historical links must resolve without a query match.
- **Global client registry/bootstrap additions: rejected.** A server-owned effective catalog and feature-local widgets avoid browser/server authorization drift and shell bundle growth.

## Architecture

```text
existing search.ts registration ──► Search catalog / search service ──┐
                                                                  │
ordinary widget.ts + injection-table.ts ──► Documents CI resolver ──┤
same widget metadata + optional di.ts ────► server adapter registry ┤
legacy built-in adapters ───────────────────────────────────────────┤
                                                                  ▼
                          Documents effective catalog + scoped record verifier
                                      │                         │
                             scoped catalog/search API   existing Documents flows
                                      │                         │
                           feature-local picker/widgets  legacy columns / generic pair
```

### Reference Mechanism: #6688

Use these concrete implementation patterns rather than the superseded generator design:

- `packages/core/src/modules/customers/calendar-event-types.ts` defines the domain widget payload and registry.
- `packages/core/src/modules/customers/lib/calendar/eventTypeResolver.ts` waits for registration, calls `loadInjectionWidgetsForSpot`, and refreshes contributions when `getInjectionRegistryVersion()` changes.
- `apps/mercato/src/modules/example/widgets/injection/calendar-visit/widget.ts` exports definitions through a normal injection widget.
- Example's `widgets/injection-table.ts` maps to `calendar:customers.event-types`; its `di.ts` optionally resolves `calendarEventTypeRegistry` and registers the same widget definitions for server execution.

Documents follows the widget lifecycle with its own spot and registry, but must not copy the example's eager optional DI lookup: Documents can load after a contributor. Use the order-independent server collection described below. Declare `documents:record-link-types` in the Documents module's `extension-points.ts` with its browser-safe payload and server catalog projection. The new Documents spot is additive and does not modify the frozen calendar spot. Generic generators continue discovering normal widgets/search declarations as they already do; this feature adds no generator plugin, scanner, generated output, client bootstrap group, or generator interface change.

### Documents CI Contract

Add a Documents-owned public contract at `@open-mercato/documents/modules/documents/record-link-types` and the headless spot **`documents:record-link-types`**. A typed `DocumentRecordLinkWidget` extends `InjectionWidgetModule` with a readonly `recordLinkTypes` payload. Place contributions in existing `widgets/injection/<name>/widget.ts` files and map them through `widgets/injection-table.ts`. No new module-root convention is needed.

Each definition contains:

- `entityId`: canonical namespaced Search/data-engine entity ID, bounded to 191 characters; not a second Documents-specific entity identifier;
- `labelKey` and optional icon for the type, plus finite integer `order`;
- `requiredModules` and `requiredFeatures`, which can add restrictions but cannot relax the owning entity's policy;
- optional `adapterKey` naming a server-only Documents adapter for non-searchable entities or specialized verified reads;
- optional allowlisted `tokenFields`, with localized labels; values are extracted only by the server adapter after authorization.

The widget is browser-safe and contains no ORM, server closures, arbitrary lookup URLs, credentials, or raw record data. A contributor can use a type-only Documents import; it must still load when Documents is disabled. Its `di.ts` registers a lazy, server-only contribution factory under an owner-namespaced DI key referenced by the same widget's `adapterKey`; it never resolves **`documentRecordLinkRegistry`** during module registration. Once registration is complete, the Documents resolver loads the ordinary widgets and resolves their factories in the request container. The registry owns composition and source removal; the contributing module owns its adapter implementation. No process-global list or new discovery file is introduced. A missing optional factory affects only that source and is retried on registration/version refresh. Test contributors both before and after Documents in module order, API-first initialization, HMR/removal, and Documents-disabled boot.

Non-searchable entities require a complete server adapter; an automatic searchable type uses the common Search resolver and needs no Documents adapter contribution. Each CI-only adapter implements both `searchCandidates({ query, cursor, limit, scope, principal })` and `resolveRecords({ recordIds, scope, principal })`. Candidate search returns bounded identity/display candidates and an opaque continuation; it applies owner read policy and exact scope before display, and every selected result is still resolved live at mutation time. Batch resolution accepts at most 40 IDs for one entity and scope and returns only authorized records keyed by canonical identity. A definition with neither an eligible Search resolver nor a complete adapter is unavailable.

The registry supports source-owned upsert/removal and immutable versioned snapshots, keyed by owner module and widget ID. Repeat loading replaces that source rather than appending duplicates; disabling a source removes its active definitions. Widget loading and DI registration of the same source are idempotent. Duplicate ownership, malformed declarations, unregistered adapter keys, and attempts to replace another owner's definition produce source-specific diagnostics and disable the offending source. CI overrides of searchable display/token metadata cannot remove Search ACLs, change scope, substitute another target, or override a reserved legacy alias.

### Effective Catalog and Runtime Lifecycle

Documents resolves settings, enabled modules, Search configurations, CI definitions, legacy adapters, and caller ACLs on the server. Reuse `getSearchModuleConfigs()` / the registered Search indexer catalog; do not scan source files or import app-generated paths. Reuse the Search entity-access policy from `@open-mercato/shared/lib/search/entityAccess`, including wildcard grants and the established superadmin behavior. Missing ACL metadata follows Search's fail-closed policy for ordinary callers.

For searchable CI definitions in off mode, explicit CI membership still permits the existing Search service to find that type; the switch disables automatic inclusion, not Search execution. For non-searchable CI definitions, both modes use the adapter candidate-search contract. In unified mode, merge Search and CI-only candidate batches by canonical identity, using deterministic source priority and source-local rank, then apply the shared result cap and verified continuation policy. Adapter failure produces a visible retry state for that source; never silently present an incomplete set as an exhaustive no-match result.

Catalog identity is the canonical entity ID. A searchable type also contributed through CI appears once: Search supplies search/authorization and CI supplies permitted presentation, adapter, or token-field enrichment. Built-in aliases map to the same canonical targets. If an owner uses different profile/base record IDs, the legacy adapter resolves that translation through an authorized owner lookup; never assume the IDs are equal or normalize only the type string. Preserve legacy storage/type projection when a canonical target has an existing built-in adapter; never create a second generic representation of that same built-in link.

The Documents host waits for ordinary registration, loads only `documents:record-link-types`, resolves lazy contribution factories, and refreshes on injection-registry version changes. Never memoize a pre-registration empty set. The API returns the effective catalog; the client does not independently reconstruct authorization from widget declarations. Browser state is keyed by tenant, document organization, principal, and catalog/settings revision, and is cleared on scope changes. Do not cache caller ACLs or scoped data in a process-global registry. Recompute Search catalog membership from the current registered configurations per request; do not assume the injection version also versions Search registration. Any response revision must cover effective Search/CI membership and the settings version.

The API and command path must use this resolver before verification. There is no claim that `dynamicLoader` runs API bootstrap registrations. CLI/worker/sidecar link consumers are not introduced; any future non-request consumer must provide a tested explicit initialization and authorization context. Optional Documents or Search absence must leave unrelated modules bootable. When Search is absent, on mode reports automatic search unavailable and continues offering CI/legacy sources; it does not silently change the saved setting.

### Search and Authoritative Target Verification

Documents-owned search uses a new additive Search-owned `searchForRecordLinks(query, context)` operation with caller-authorized entity types, authenticated tenant, principal, and the persisted document's exact organization. Existing `searchService.search()` remains unchanged for existing callers. Reuse strategy execution and pre-query/post-result entity ACL filtering; do not call the Search administration playground or require `search.view`/`search.manage` merely to link a document. No external provider is mandatory; use available configured strategies, including the existing token strategy. Do not change global-search preferences or trigger reindexing.

Search is candidate discovery, not proof of access or existence. Add optional `recordAccess` capability metadata to `SearchEntityConfig`, backed by an owner-registered server policy adapter with explicit `organization`, `tenant`, or `global` scope classification and `resolveRecords({ recordIds, principal, documentScope, signal })`. This is a new Search contract: current `aclFeatures` checks do not implement per-record visibility. The adapter must perform the same live read authorization as the owning API, including ownership, shares and channel restrictions, on decrypted records. A policy may adapt an existing owner read service; feature grants, index metadata and scope-nullness cannot replace it. Missing, disabled, incomplete or failing policy denies automatic resolution for ordinary callers and superadmins alike unless the owner's policy explicitly permits that principal. Existing Search callers and configurations omitting `recordAccess` retain their previous global-search behavior; only this new linking capability requires it.

Add a Search-owned, DI-resolved **`searchRecordResolver`** with `resolveRecords({ entityId, recordIds, principal, documentScope, signal })`, reusable without importing another business module's entities into Documents or Search. Resolve at most 40 IDs per entity in one owner-policy call, with at most four entity batches in flight under the shared 3-second request deadline; single-record mutation checks use the same operation with one ID. Return only verified identity, scope, safe display information and explicitly readable values, then run existing presenter/URL formatting after authorization. Never infer API paths from an entity ID, trust indexed metadata as live data, or fall back to a generic ORM/query-engine read when the owner policy is missing. Add adapters and parity tests for every legacy/Example type included in automatic mode; other owner types become eligible only when their Search policy exists.

For organization-owned targets, `tenant_id` and `organization_id` must exactly equal the document's persisted scope, including when UUIDs repeat in separate organizations. Descendant visibility never proves equality. Tenant-wide or global searchable targets are eligible only with declared classification and live owner authorization for that document context; nullable scope alone never establishes global visibility. Undeclared scope fails closed. No blanket rejection of custom/global entities based on `ce.ts` is imposed by Documents.

The existing organization-filtered `search()` drops results with empty `organizationId`, so it cannot supply tenant/global candidates as written. `searchForRecordLinks` must run separate, bounded queries per declared scope class: exact tenant plus document organization for organization-owned types, exact tenant and null organization for tenant-owned types, and only explicitly global types for the global lane. These predicates apply inside a capable strategy before fetching candidates, not by removing the tenant/org filter from a mixed query. Add optional strategy capability metadata for these predicates; an unsupported lane reports unavailable rather than broadening scope. Merge the bounded lanes only after owner batch verification. Test real token/fulltext/vector boundaries or report that a lane has no supported strategy. The legacy `search()` organization filter stays unchanged.

`searchForRecordLinks` returns `{ results, status, sources, continuation? }`, where `status` is `ok`, `partial`, or `unavailable`, and each source has a safe type/scope-lane identifier and `ok`, `failed`, or `unavailable` outcome. Compute outcomes from actual strategy availability and settled execution results inside Search; do not infer success from an empty array or call the private `getAvailableStrategies` from Documents. `ok` with no verified results is the only exhaustive no-match outcome. `partial` keeps verified results with a retry warning, even when the result list is empty; `unavailable` means no eligible source completed. Failure details contain no target IDs, content or raw provider errors. This operation and its capability/status types are additive; existing `search(): Promise<SearchResult[]>` and third-party strategy implementations remain compatible.

Run exact verification before returning search candidates, creating/reviving links, projecting existing targets, extracting template values, and copying/replaying links. Apply record policy before serializing titles, subtitles, URLs, or totals; unauthorized results must not leak through counts. A stale index hit, deleted record, revoked grant, or wrong scope is omitted. Verify a bounded overfetch batch and cap output at 20; report continuation only when another verified result is available. Check deadlines/cancellation and avoid per-result unbounded loops.

CI-only and legacy adapters expose bounded candidate search as well as the same verified-read contract under the caller's request scope. Legacy candidate search preserves existing owner-route query behavior and uses the canonical normalization/verification layer. Keep the current same-origin/no-redirect protections, 3-second deadline and 1 MB response cap for HTTP-backed adapters. Canonicalize and validate hrefs, render text safely, and reject executable/external URLs. Do not fetch a URL supplied by the browser or a search result.

## Data Models

### Settings

Store the boolean under module `documents`, key `searchable_entity_links_enabled`, using the existing tenant-scoped `ModuleConfigService`. The API exposes `searchableEntityLinksEnabled`. Reads resolve the tenant row, existing instance fallback if present, then `true`; new installs and upgrades with no saved value both default on. Tenant writes never alter global defaults or another tenant. Tenant identity comes from authentication, not request input.

The existing service has no atomic compare-and-set or tenant-override deletion. Add a Configs-owned, DI-resolved **`moduleConfigOverrideService`** exposing `getState` and `compareAndSetOverride`; do not have Documents import Configs entities or mutate them directly. Keep all existing `ModuleConfigService` signatures and required fields unchanged, including for third-party implementations. The new service is an optional DI capability: when absent, settings GET can show the effective value but writes fail safely as unavailable, without falling back to `setValue`.

`getState({ moduleId, name, tenantId })` returns the effective value/source/`updatedAt`, the tenant override or absence, and an opaque revision covering both override existence/version and the inherited instance/default version when used. `compareAndSetOverride({ moduleId, name, tenantId, expectedRevision, change })` accepts either `{ kind: 'set', value }` or `{ kind: 'remove' }`; removal affects only that tenant's override. Inside one Configs-owned transaction it locks the global key then tenant key in a fixed total order, rereads uncached state, compares the revision, applies the change and returns the before/after state. Existing `setValue`/default writers must join the same locking protocol without changing their signatures so they cannot bypass comparisons. Missing-row races use a bounded transaction advisory lock plus the existing partial unique indexes; a losing concurrent first writer returns the standard optimistic-lock `409`.

The Documents command passes the settings revision explicitly; `CrudForm` still receives `updatedAt` for the existing timestamp header, but that header alone cannot represent inherited/no-row state. GET/PUT also return `revision`, and PUT requires the value from the last GET. Reject either mismatched supplied timestamp or revision. Audit/undo records the prior tenant override, including absence, and uses the post-write revision to conditionally restore that override through the same API; it never writes an old effective instance value as a tenant override. Cache and Documents catalog invalidation happen after commit and include all tenants inheriting a changed instance row; rolled-back work publishes no new cached projection. Every new/touched editable entity and form follows default-on optimistic locking.

### Generic Links

Add nullable `entity_type varchar(191)` and `entity_id uuid` to `document_entity_links` for non-legacy targets. Retain every existing target column, FK, index, type string, and row. Broaden `document_entity_links_exactly_one_target_chk` to allow exactly one legacy target or one complete generic pair, never both; retain the self-link prohibition for Documents targets, including canonical aliases.

Add active partial uniqueness on `(document_id, entity_type, entity_id)` and a reverse index on `(tenant_id, organization_id, entity_type, entity_id)`, both where the generic pair is present and `deleted_at IS NULL`. Commands normalize aliases before uniqueness checks so the same target cannot be linked twice through Search and CI or legacy aliases. Generic targets use scalar IDs, never cross-module ORM relations.

No historical rows are backfilled. Include the intended migration and Documents snapshot; do not apply local migrations without approval. `down()` refuses destructive removal while generic rows exist. A feature rollback can turn the setting off while retaining the additive schema and authorized historical links.

Prefer live verified presentation over new stored snapshots. Existing `label_snapshot` and `href_snapshot` columns are NOT NULL: each new generic row writes the just-authorized display label and canonical href, never indexed or browser-supplied values. Include sensitive labels/values in Documents' `encryption.ts` `defaultEncryptionMaps` and use `findWithDecryption`/`findOneWithDecryption`; snapshots are never an authorization or redaction fallback. Do not copy raw records into new JSON blobs. No new plaintext PII storage is introduced.

## API Contracts

New endpoints are Documents-owned and export `metadata`, zod schemas, localized errors, and `openApi`. Reuse the existing Documents context, document tier checks, mutation guards, commands, audit, and error helpers.

| Endpoint | Contract and authorization |
|---|---|
| `GET /api/documents/settings/record-links` | Requires new `documents.settings.manage`; returns `{ searchableEntityLinksEnabled, source, updatedAt, revision }`, where `source` is `tenant`, `instance`, or `default`, `updatedAt` is nullable for the default, and `revision` includes override/inheritance state. |
| `PUT /api/documents/settings/record-links` | Requires `documents.settings.manage`; strict body `{ searchableEntityLinksEnabled: boolean, revision: string }`; uses command `documents.record_link_settings.update`, mutation guards, timestamp header when present and Configs atomic revision comparison; returns the updated settings projection. Tenant/org keys in the body are rejected. |
| `GET /api/documents/{id}/link-types` | Requires `documents.view` and document read access; returns the effective mode, revision, and readable type metadata, without server adapter details or hidden types. Ordinary linking users do not need settings-management access. |
| `GET /api/documents/{id}/link-search?q=...&entityType=...&limit=20` | Requires `documents.view` and document read access. Trim/bound `q` to 200 characters; optional type must belong to the effective catalog. No query means no automatic search request. Return verified candidates `{ entityType, entityId, label, subtitle?, href, alreadyLinked }`, revision, source status and an optional opaque continuation token. A partial response carries verified results plus a retry warning; no usable source returns retryable `503`. Enforce `limit <= 20`, bind continuation to query/principal/scope/revision, and never accept tenant/org from the browser. |
| `GET /api/documents?entityType=...&entityId=...` | Extend the existing relation filter through canonical target normalization and bound generic predicates; verify target scope and authorization before filtering. Legacy inputs keep their meaning. |
| `GET /api/documents/{id}/links` | Project legacy/generic targets through current authorization, independently of the automatic-discovery toggle. |
| `POST /api/documents/{id}/links` | Existing route and body field names; accept a registered namespaced `entityType` alongside legacy types. Require existing edit/tier policy, current document version, effective eligibility, and exact live target verification; create/revive atomically. |
| `DELETE /api/documents/{id}/links/{linkId}` | Existing document edit/tier policy and link scope; unlink works even when discovery is off or target access is unavailable. Never reveal target data to authorize unlink. |

New type/schema exports (`DocumentLinkType`, `documentLinkTypeSchema`, registered-type input/output schemas) widen runtime consumers additively. Legacy exported unions and schemas are not widened in place. Existing HTTP link fields remain: generic targets use namespaced `entityType` and UUID `entityId`; labels/hrefs posted by a client are recomputed or checked, never trusted.

Malformed input returns `400`; inaccessible document returns the existing masked response; missing/forbidden targets share the existing restricted result; stale document/settings revision returns the existing optimistic-lock `409` body; service failure returns a retryable `503`. Search, cache, and adapter failures cannot cause partial links or a settings write. A client whose automatic candidate became ineligible after a setting change must refresh rather than silently assign it.

### Existing Link Consumers

Templates (create/edit/preview/instantiate), field insertion, toolbar/`@` insertion, duplication, undo/redo, and related-document cards must share canonical resolution. Automatic records expose verified presentation tokens only; arbitrary indexed fields or raw record columns are never implicitly available as template tokens. Existing built-in token fields remain intact, and CI adapters may add explicit readable scalar allowlists. Required inaccessible slots fail; optional slots omit values with the existing safe report. Text already inserted into document content is a static snapshot and is not retroactively removed by a setting or permission change.

Undo/redo rechecks current authorization and new-link eligibility: unlink and read remain possible with discovery off; replay that creates an automatic-only link requires current automatic eligibility. Duplication re-verifies each link and reports omitted unavailable/ineligible links without disclosing restricted targets. Preserve command side effects and parent-document version checks, with a child's own version for child mutations.

For related-document display, reuse the existing `crud-form:*` host. Normalize its `module.entity` identity to the canonical entity ID through registered metadata, not blind string guessing; create forms or hosts without a record ID remain inert. Preserve existing built-in injection mappings and add no generic `CrudForm` behavior. An eligible automatic or CI entity can use the same related-documents card.

## Migration & Backward Compatibility

Preserve `EntityRegistryEntry`, `DocumentEntityRegistryEntry`, `DOCUMENT_ENTITY_REGISTRY`, `getEntityRegistryEntry`, `getEntityTokenFieldNames`, `DocumentEntityType`, `documentEntityTypeSchema`, and existing exported link/template schemas at their deep-import paths with their current legacy-eight semantics. Add type-level exhaustive-switch/schema compatibility tests. Existing legacy routes and storage remain available in either mode.

The rewritten proposal retains a default-on picker: no saved setting means unified search, including on upgrades. This differs from #6730's original UX-preservation requirement; acceptance of this specification must explicitly record approval of that behavior before implementation. Do not describe the issue as evidence that it requested the replacement. Document the agreed default and off-mode fallback in `UPGRADE_NOTES.md`. New spot IDs, DI keys, optional Search policy/strategy capabilities, status-returning operation, Configs override service, ACL feature, route URLs, setting key and generic columns are additive contracts and must be recorded in `BACKWARD_COMPATIBILITY.md` when implemented. Existing Search return types, strategy required methods and Configs service signatures stay unchanged. Any eventual removal follows the one-minor-version deprecation bridge.

Retain [#7780](https://github.com/open-mercato/open-mercato/issues/7780) as the separate prerequisite for exact organization verification of existing legacy HTTP lookups. Its owner-route hardening must be merged or equivalent implementation evidence provided before this feature ships; the new Search resolver does not fix legacy paths. This spec requires exact-scope tests for both paths and does not bundle unrelated owner-module hardening.

## UI/UX

**Settings → Documents → Record links**, at `/backend/settings/documents/record-links`, contains a localized switch, “Link searchable records”, initially on. Its server page metadata declares `requireAuth` and `requireFeatures: ['documents.settings.manage']`, a localized settings title/group and the Documents settings navigation path. Add that feature to `acl.ts` and setup defaults for authorized tenant administrators, with grant-sync coverage for existing roles; ordinary `documents.manage` does not confer tenant-settings authority. Help text explains that on mode searches entities with enforceable read policy and off mode uses built-ins plus module contributions. Saving uses `CrudForm`, preserves the opaque revision alongside `updatedAt`, displays inherited/default state, handles `409` through `surfaceRecordConflict`, and never changes another tenant's setting. This switch belongs to Documents settings, not Search administration.

On mode opens a focused “Link a record” dialog with one search input. Search across eligible types without forcing the user to choose a module first; provide an optional localized type filter when useful. Debounce by 250 ms, cancel superseded requests, and discard stale responses after query, scope, document, or revision changes. Show readable title/business reference, subtitle and entity badge; never make a UUID the display-label fallback. Selecting a row and confirming creates the link, updates the related-record card, and prevents duplicate selection through `alreadyLinked`.

Support keyboard arrows, Enter to select, Cmd/Ctrl+Enter to confirm, Escape to cancel, focus return, and labeled icon buttons. Before typing, show a localized prompt; distinguish loading, no matches, restricted/unavailable search, and retry states. Search failures do not show misleading empty results. Off mode keeps built-in tabs and makes explicit CI types discoverable. Both modes reuse `LoadingMessage`, `ErrorMessage`, shared dialog/input/button primitives, semantic DS tokens, and light/dark behavior. All copy uses locale keys.

### Frontend Architecture Contract

| Surface | Server boundary / data owner | Client island and reason |
|---|---|---|
| Documents settings | Server page and guarded settings API | `RecordLinkSettingsForm.tsx`: switch state, validation, submit and conflict handling. |
| Document picker, toolbar and `@` insertion | Existing document server root and scoped link APIs | Existing `EntityPicker.tsx` plus small `SearchableRecordPicker.tsx`: query debounce, cancellation, keyboard selection, dialog focus. |
| Related-documents widget | Existing CrudForm host and scoped related-link APIs | Existing widget client: dialog state and link refresh. No new shell provider. |

The implementation's `"use client"` ledger must enumerate each touched file above with importer, cleanup and hydration checks; no new client page/layout root, no new client file over 300 LOC, and no heavy editor/search SDK at a root. Search execution and contribution adapters stay server-only. Existing injection registration is reused; no Documents client bootstrap group or globally eager widget import is added. Capture `yarn check:client-boundaries`, cold-load hydration and key interactions for settings/document/related-card routes, and a before/after route bundle report showing no added shell dependency. Browser evidence covers light/dark, mobile viewport, errors/retry, toggling modes, and permission-hidden entries.

## Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| Setting missing on a new or upgraded tenant | Effective value is on; default source is shown without creating rows on GET. |
| Search absent or strategies unavailable | Localized unavailable state; eligible legacy/CI sources remain usable. No saved-setting mutation or automatic reindex. |
| Entity registered but index empty/stale | Type remains eligible; no-match or verified-hit omission, never an unverified link. |
| Same entity appears in Search, CI, and a legacy alias | One canonical candidate and one active target link; preserved legacy storage where applicable. |
| Duplicate CI ownership or missing server adapter | Invalid source is excluded with diagnostics; unrelated sources continue. |
| Bootstrap incomplete or contribution chunk fails | Retryable state; do not permanently memoize an empty catalog or trust client declarations. |
| Setting turned off while picker is open | Old candidate is rejected at save, catalog refreshes; existing links survive. |
| Module disabled, record deleted, or target grant revoked | Preserve stored links; redact target ID, label, href, and values in responses, with `canOpen: false`; Documents-authorized unlink remains available. Re-enable can restore authorized display. |
| Null organization or repeated UUID | Apply declared entity classification and exact scoped identity; never treat null as blanket global access. |
| Timeout, unsafe URL, malformed or oversized adapter response | Fail closed within bounds; no partial mutation, value extraction, or leaked content. |
| Concurrent link/settings edits | Atomic uniqueness/version checks choose a winner; surface the standard conflict UI. |
| Generic rows present during migration rollback | Refuse destructive column removal; switch off discovery or roll forward. |

Logs use structured owner/type/phase/outcome metadata without record IDs, labels, document text, tokens, or response bodies. A catch that logs an error also uses the repository error-reporting helper.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Search index exposes a stale or wrong-scope presenter | Critical | Search/Documents | Exact decrypted read, owner/entity ACL policy, pre/post filtering, no unverified counts; cross-tenant/org tests | Legacy HTTP verification also depends on #7780. |
| CI source weakens Search authorization | High | Catalog/adapters | Source ownership, additive restrictions, server-owned catalog and live recheck | Contributor adapters remain trusted application code and need review. |
| Default-on upgrade changes assignment workflow | Medium | Documents UX | Explicit upgrade note, simple tenant switch, historical-link preservation | Teams may choose off mode after upgrade. |
| Settings/cache or browser scope becomes stale | High | Multi-tenant UI/API | Tenant/principal/org/revision keys, post-commit invalidation, eligibility recheck at save | A stale client sees a recoverable refresh/conflict. |
| Generic indexes affect a large link table | Medium | Database deploy | Additive migration/snapshot, bounded indexes, rollback guard | Deployment may require an operational index window. |
| Broad catalogs make search expensive | Medium | Search/picker | Available strategies, 20-result cap, bounded overfetch, cancellation and 3-second deadline | Large tenant search requires existing operational monitoring. |
| Extracted values persist in document text | Medium | Privacy | Explicit token allowlists and static-snapshot semantics | Later revocation cannot retract already inserted text. |

## Phasing

1. **Catalog, CI and setting:** establish source composition, tenant configuration and verified Search record resolution without exposing incomplete generic mutations.
2. **Persistence and all link consumers:** migrate additively and integrate authorization, lifecycle, templates, reverse filters, and historical projections.
3. **Picker replacement and proof:** turn on the completed default behavior, retain the off-mode fallback, and ship documentation, standalone evidence and integration coverage.

Phases describe implementation order within one capability, not separately released user features. Every step keeps existing flows working; the default-on setting reaches users only with generic persistence, verification and UI fully wired in the same implementation change.

## Implementation Plan

### Phase 1 — Effective Catalog, CI and Settings

1. Add the Documents-owned CI type, declared `documents:record-link-types` host and `documentRecordLinkRegistry`; reuse injection-version refresh and collect lazy server contribution factories after registration. Test both module orders, API-first loading, ownership, invalid-source isolation, idempotence, source removal, HMR and Documents-disabled boot. Assert no Documents generator plugin or new discovery convention is introduced.
2. Add optional Search `recordAccess`/strategy capabilities, `searchForRecordLinks` and batch `searchRecordResolver`, then compose the Search/CI/legacy catalog. Test missing policy fails closed, owner-policy parity including shares/ownership, bounded batch calls, ordinary/custom searchable entities with no Documents declaration, wildcard ACLs, disabled owners, repeated UUIDs, exact org reads, separately scoped global/tenant lanes, unsupported strategy lanes, partial/all-strategy failure, verified-empty success and safe presenter/URL mapping. Preserve existing `search()` behavior and existing third-party configuration/strategy types.
3. Add Configs-owned `moduleConfigOverrideService`, coordinate existing writers under its lock protocol, then add the tenant setting command, GET/PUT API, cache invalidation, dedicated settings feature/setup grants and settings form. Test no-row default on, upgrade default, tenant isolation, instance fallback, concurrent first writers, concurrent legacy `setValue`, inherited-version change, stale timestamp/revision, conditional undo to absence, rollback and post-commit refresh. Keep generic assignment unavailable until Phase 2 is complete.

### Phase 2 — Persistence and Existing Flows

4. Add generic columns/constraints/indexes, migration and snapshot. Test legacy rows, partial-pair/both-target rejection, self-link aliases, active uniqueness, soft-delete/revive, source deduplication, and safe rollback refusal.
5. Extend runtime schemas without changing legacy exports; add catalog/search APIs and existing link create/list/delete/relation-filter support. Recheck document access, target scope, eligibility and optimistic lock at command boundaries. Test settings changes during selection, forged labels/hrefs/types, unavailable services, permission revocation and redacted unlink.
6. Integrate templates, token insertion, duplication and undo/redo through the same resolver. Test allowed presentation tokens, CI scalar allowlists, required/optional slot behavior, historical links in off mode, replay eligibility, partial omission reports and parent/child version handling.

### Phase 3 — UI Replacement, Documentation and Standalone Proof

7. Replace the picker with unified search when on, reuse it for toolbar/`@` and template record selection, and retain the built-in-plus-CI picker when off. Integrate `crud-form:*` related cards using registered identity metadata. Test keyboard/focus, debounce cancellation, stale responses, bounded continuation, no raw UUID labels, cold loads, scope changes and create-form inertness.
8. Add an Example searchable record that works without Documents-specific metadata and a separate explicit CI definition/adapter demonstrating off-mode linking. Mirror Example widget/DI changes into the create-app template via `yarn template:sync:fix`; Example is enabled in the monorepo and disabled by default only in the template. Update Documents README, the parent collaborative-editor spec, extension documentation, `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md`.
9. Refresh the standalone harness through `om-refresh-standalone-harness`, including source/surface inventories, knowledge owners, validators, fixture/oracle and knowledge-change manifest. Prove both search-only authoring and explicit CI authoring in a fresh scaffold, including optional Documents/Search absence. Run the configured validation gate and browser evidence before requesting implementation review.

## Integration Coverage

All fixtures are created per test and removed in `finally`/teardown: tenants, organizations, grants, documents, module/custom records, settings overrides and search index entries. Index required records through existing test helpers/queues; do not rely on demo data or live external providers. Reserve unused case IDs at implementation time if the names below have been taken.

| Case | API and key UI path | Assertions |
|---|---|---|
| `TC-DOCUMENTS-023` | Settings GET/PUT and `/backend/settings/documents/record-links` | Default on with no row, persisted off/on, inheritance, tenant isolation, dedicated-feature denial/setup sync, concurrent first/legacy writers, inherited-version changes, timestamp/revision conflicts, conditional undo to absence and post-commit invalidation; no admin Search feature required. |
| `TC-DOCUMENTS-024` | Link catalog/search and document picker/toolbar/`@` | Multiple ordinary/custom `search.ts` types without Documents declarations but with owner policies; missing policy excluded; unified search replaces tabs when on; readable labels, type filter, keyboard, cancellation, bounded batches/results; successful-empty versus partial/all-source failure has distinct UI and API outcomes. |
| `TC-DOCUMENTS-025` | CI contributions, off-mode picker, POST/GET/DELETE links | Contributor before/after Documents and API-first load produce the same catalog; non-searchable records remain searchable/assignable when off and Search absent; adapter query/continuation/failure handling and Search+CI deduplication; save/reload/unlink, version conflicts, disable/re-enable and historical-link preservation. |
| `TC-DOCUMENTS-026` | Relation filter, live resolver and CrudForm related card | Correct reverse relations; repeated UUIDs, sibling/descendant/cross-tenant denial, separate tenant/global strategy predicates, unsupported lanes, missing ACL/policy, owner/share revocation, wildcard grants and explicit owner superadmin policy; no sensitive counts/presenters or mixed-scope query broadening. |
| `TC-DOCUMENTS-027` | Template create/edit/preview/instantiate, field insertion, duplicate, undo/redo | Verified allowlists, generic round-trip, off-mode historical resolution, required/optional behavior, replay eligibility and safe redaction/omission. |
| `TC-DOCUMENTS-028` | Legacy built-in picker/link/template/related paths in both modes | Eight legacy IDs, columns, tokens, hrefs, routes, public schemas and deep imports remain compatible; exact-scope prerequisite proven. |
| `OMH-DOCUMENTS-EXT` | Fresh scaffold with `search.ts` and ordinary CI widget/DI | Search-only entity needs no Documents declaration; explicit CI works off mode; normal generation, focused tests, typecheck/lint/build and optional-module boot pass. |

Add unit/structural coverage for catalog precedence, no new generator outputs, registration retry/versioning, settings invalidation, legacy type compatibility, generic predicates/constraints, mutation guards, authorization and source-only/compiled-package parity. The implementation runs the ordered `.ai/agentic.config.json` gate, targeted Search/Documents integration tests, `yarn template:sync`, frontend boundary checks and browser QA with screenshots. Select Docker/local runner using the repository probe rules once per gate. This spec-only revision needs documentation/diff verification, not runtime builds or migrations.

## Final Compliance Report

| Rule source / concern | Design verdict | Evidence / implementation gate |
|---|---|---|
| Scope cohesion | Independently reviewed | Search and CI are cohesive sources for one end-to-end record-link capability. Independent review found a missing CI candidate-search contract; it was added and rechecked with no remaining blocking scope/consistency findings. |
| Core: widget injection and optional coupling | Designed | Ordinary widget discovery, declared Documents host/registry and lazy owner factories; registration-order/API-first/HMR coverage, no generic framework extension. |
| Shared/Search: ACL and entity discovery | Conditional on additive implementation | Optional live owner policy, fail-closed catalog eligibility, scope-capable strategy lanes, bounded batch resolver and actual source-status reporting; legacy Search contracts unchanged. |
| Configs: atomic setting and undo | Conditional on additive implementation | New Configs-owned override service, coordinated existing writers, inherited-state revision, atomic set/remove and commit-only invalidation; no Documents ORM access or changed legacy signatures. |
| Root: tenant isolation and data integrity | Conditional | Exact org/tenant reads, optimistic versions, atomic uniqueness, recorded default-on UX approval and #7780 legacy prerequisite. |
| Backward compatibility | Designed | Additive schemas/columns/spot/DI/API with legacy union/import bridges and explicit upgrade behavior. |
| UI/backend/design system | Designed | CrudForm/guarded mutations, shared API/dialog/state primitives, translations, semantic tokens and frontend boundary budgets. |
| Encryption | Designed | Live decrypted reads; sensitive existing snapshots covered by module encryption maps, no new raw metadata storage. |
| QA/create-app | Required at implementation | Self-contained API/UI cases, template parity, standalone cases, package discovery and browser evidence. |
| Reversibility | Designed | Settings undo restores inheritance; off mode preserves history; unavailable links redact; schema rollback guards data. |

**Internal consistency:** Setting modes, effective catalog sources, generic identity, legacy projection and command eligibility use the same definitions. This PR changes only the specification; no implementation, migration execution, runtime validation, QA approval or merge readiness is claimed. Request fresh review of the rewritten architecture.

## Changelog

### 2026-10-27 — Close Search, registration and settings review gaps

- Made live owner visibility an explicit additive Search prerequisite with fail-closed omission, bounded batch resolution, separate scope-filtered strategy lanes and real partial/unavailable outcomes; preserved existing global-search contracts.
- Replaced eager optional registry lookup with lazy server contribution factories collected after registration, and required host declarations plus order/API-first/HMR tests.
- Specified a Configs-owned atomic override API with conditional removal, inherited revisions, coordinated legacy writers and commit-only cache invalidation; added settings feature/page metadata and exact snapshot writes.
- Expanded implementation and integration gates for every review finding, and identified default-on UX approval as an explicit implementation gate rather than attributing it to the original issue.

### 2026-10-26 — Search and CI rewrite

- Replaced the generator-plugin proposal with ordinary headless CI widgets, module DI registration and a Documents-owned resolver following #6688.
- Added the default-on Documents setting, automatic inclusion of all authorized `search.ts` entities, unified search replacement, explicit CI fallback and reversible mode changes.
- Reworked generic verification, storage/lifecycle, authorization, settings/versioning, legacy bridges, frontend boundaries and integration/standalone coverage for both sources.

### 2026-10-22 — Earlier review revision

- The previous design used generated custom-entity contributions and preserved legacy contracts; its generator/bootstrap/custom-entity-only decisions are superseded by the 2026-10-26 rewrite.

### 2026-09-29 — Initial proposal

- Opened the record-link extension design for #6730.
