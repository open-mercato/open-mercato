# Pre-Implementation Analysis: EUDR Compliance Batch 2 — Risk Assessment, Plot Registry, DDS Lifecycle & Ecosystem Integration

Spec: `.ai/specs/2026-07-06-eudr-batch2-risk-plots-dds-lifecycle.md`
Batch 1 (implemented, same branch): `.ai/specs/2026-07-06-eudr-compliance-module.md` → `packages/core/src/modules/eudr/`
Analysis date: 2026-07-06

## Executive Summary

The spec is architecturally sound and unusually well-grounded: entity additions collide with nothing, the statements command structure hosts transition guards as described, the completeness-v2 change is additive to the pure function's signature, `afterList` / enricher / injected-column / dashboard-widget / AI-tool mechanisms all exist as claimed, and `AsyncSelectField`, `GET /api/sales/orders` (`orderNumber` + `customerSnapshot`), leaflet `^1.9.4`, and the deals-map dynamic-import pattern were all verified in code. However, **two load-bearing spec claims are factually false against the code** — the attachments event payload does not carry `entityId`/`recordId` (and attachment DELETE is a hard delete, so the subscriber cannot re-load the record), and the catalog products route has no response-enricher opt-in (so the proposed enricher would never run) — both requiring small **additive changes to released platform modules that the spec currently does not declare**. Recommendation: **READY-WITH-FIXES** — fix the three Critical items in the spec before implementation; no architectural rework needed.

## Backward Compatibility

The spec includes a "Migration & Compatibility" section (present). Batch-1 surfaces are unreleased on this branch, so tightening statement write semantics breaks no external consumer — verified: `eudr` ships only on this branch (`apps/mercato/src/modules.ts:116`), and the tightened PUT semantics are covered by the spec's documented batch-1 test updates.

### 13-Surface Audit

| # | Surface | Finding | Severity | Notes / Proposed Fix |
|---|---------|---------|----------|----------------------|
| 1 | Auto-discovery conventions | Additive new convention files only (`ai-tools.ts`, `ai-agents.ts`, `data/enrichers.ts`, `subscribers/*`, `widgets/*`). No renames/removals. **But**: spec mis-states the dashboard-widget registration mechanism and the subscriber-per-event convention (see Violations #2, #3). | Warning | Fix spec text; mechanisms themselves are additive. |
| 2 | Type definitions | None removed/narrowed. | OK | — |
| 3 | Function signatures | `computeSubmissionCompleteness(input)` takes one options object (`lib/completeness.ts:54`) — v2 extends `CompletenessInput` with optional fields; additive. Module-internal anyway. | OK | — |
| 4 | Import paths | None moved. | OK | — |
| 5 | Event IDs | New `eudr.plot.*`, `eudr.risk_assessment.*`, `eudr.mitigation_action.*` are additive and naming-consistent with existing `events.ts`. **Attachments payload extension needed** (Critical #1): adding `entityId`/`recordId` to `attachments.attachment.*` payloads is explicitly allowed ("MAY add new optional fields to event payloads") but MUST be declared in the spec. | Warning | Declare the additive payload change; keep fields optional/nullable. |
| 6 | Widget injection spot IDs | Uses the existing `data-table:catalog.products` spot (declared at `catalog/components/products/ProductsDataTable.tsx:699`) with the `:columns` surface. No renames. Column injection is a supported mechanism (`packages/ui/src/backend/DataTable.tsx:1255–1286`, `InjectionColumnDefinition`). | OK | Pin exact spot id `data-table:catalog.products:columns` in the spec (removes the spec's "if no column spot exists" hedge — it exists). |
| 7 | API route URLs | All new routes additive. `/api/eudr/statements` gains optional response fields + `latestRisk` via existing `afterList` hook (factory `packages/shared/src/lib/crud/factory.ts:134`, precedent in eudr `evidence-submissions/route.ts:237`) — allowed. Export v2 = additive keys + new `?format=` param — allowed. Catalog products list gains `_eudr` namespace (feature-gated, additive) — allowed. | OK | — |
| 8 | Database schema | 3 new tables; new nullable/defaulted columns on 2 eudr tables. Verified against `data/entities.ts`: **no column collisions** (`plot_ids`, `activity_type`, `actor_role`, `referenced_statements`, `supplementary_unit`, `supplementary_quantity`, `submitted_at`, `reference_issued_at`, `order_snapshot` all new). Batch-1 migration `Migration20260706102002_eudr.ts` creates only the 3 v1 tables — no duplicate-DDL risk if the new migration is generated fresh (lesson honored by spec). | OK | — |
| 9 | DI service names | None renamed; none added. | OK | — |
| 10 | ACL feature IDs | New `eudr.plots.view|manage`, `eudr.risk.view|manage` only; existing 6 features untouched (`acl.ts`). Style note: existing manage features declare `dependsOn: [<view>]` — spec should mirror that. `eudr.risk.*` covers two entities (assessments + mitigation actions) and is not plural-resource style; acceptable (new IDs, frozen once shipped) but note deliberately. | OK | Add `dependsOn` to the new manage features. |
| 11 | Notification type IDs | None. | OK | — |
| 12 | AI agent/tool IDs | New agent `eudr.compliance_assistant` + 5 new tool names; additive. Contracts verified: `mutationPolicy: 'read-only'` and `requiredFeatures` exist (`ai-assistant/.../ai-agent-definition.ts:244–246, 382`); handler ctx carries `container`, `tenantId`, `organizationId`, `userFeatures` (`.../lib/types.ts:8–27`); `ai-tools.ts` aggregating an `ai-tools/<pack>.ts` subdirectory is the exact customers precedent (`customers/ai-tools.ts` imports `./ai-tools/people-pack`). | OK | — |
| 13 | CLI commands / generated contracts | No CLI changes; registries regenerated additively via `yarn generate`. | OK | — |

### Released-platform files the spec touches but does not declare (must be added to spec)
1. `packages/core/src/modules/attachments/lib/crud.ts` — additive `buildPayload` extension (Critical #1).
2. `packages/core/src/modules/catalog/api/products/route.ts` — additive `enrichers: { entityId: … }` opt-in (Critical #2).

Both are additive and BC-clean, but per BACKWARD_COMPATIBILITY.md §5/§7 any contract-surface change must be spec-referenced.

## Verified-True Spec Claims (evidence)

- **Additive columns don't collide** — `eudr/data/entities.ts` (statements have only batch-1 columns; submissions have `attachment_ids` but no `plot_ids`).
- **Transition guards fit the update command** — `eudr/commands/statements.ts:314–415`: `prepare` loads a before-snapshot, `execute` loads the record and runs `runCrudCommandWrite` phases; `CrudHttpError` already used (404 at :330), so 400 + `details.reasons[]` guards slot in naturally.
- **Completeness v2 is additive** — single-object input `CompletenessInput` (`lib/completeness.ts:6–14`); dimensions are named `geolocation` and `documents` exactly as the spec extends them.
- **`afterList` exists** and is already used by eudr (`evidence-submissions/route.ts:237`); enrichers run after it (factory :459, :1560).
- **AttachmentInput contract** — `attachments/fields/attachment.tsx:48–58`: props `{ entityId?, recordId?, def?, disabled? }`; renders "Save the record before uploading files" without both ids (:134–137) → edit-page-only embed, as spec'd; uploads POST directly to `/api/attachments` (:109–114), bypassing the host form.
- **Injected DataTable columns are real** — `data-table:<tableId>:columns` surface; `InjectionColumnDefinition` merged via `insertByInjectionPlacement` (`DataTable.tsx:1255–1286, 1351`); ProductsDataTable passes raw API items through (`ProductsDataTable.tsx:595–596` filters only, no field whitelist) so `_eudr` namespace fields survive to the injected column.
- **Dashboard widget contract** — `DashboardWidgetMetadata` has `id`, `title`, `features`, `defaultSize: 'sm'|'md'|'lg'` (`shared/modules/dashboard/widgets.ts:5–18`); `new-customers` precedent uses `widget.ts` (metadata + `lazyDashboardWidget(() => import('./widget.client'))`) + `widget.client.tsx`.
- **Order picker** — `GET /api/sales/orders` exists (`sales/api/orders/route.ts`, built by `buildDocumentCrudOptions({ kind: 'order', numberField: 'orderNumber', … })`, `sales/api/documents/factory.ts:280`); list items expose `orderNumber` and `customerSnapshot` (nested customer `displayName`) — the `${orderNumber} — ${customer}` label is buildable. Batch-1 `AsyncSelectField` exists (`eudr/components/formConfig.tsx:190`) with `loadOptions`/`loadSelectedOption`/`onSnapshot` — reusable as spec'd.
- **Leaflet** — `packages/core/package.json:239` `"leaflet": "^1.9.4"` (+ `@types/leaflet` dev-dep). Deals-map dynamic pattern confirmed: `DealsMapCanvas.tsx:61` dynamically `import('./DealsMapCanvasImpl')` (which statically imports leaflet + `NEXT_PUBLIC_OM_DEALS_MAP_TILE_URL` with OSM fallback). Spec's PlotMapPreview should mirror that wrapper/impl split.
- **DataTable exports** — formats `csv|json|xml|markdown` (`DataTable.tsx:176, 355–361`; `buildCrudExportUrl` in `ui/backend/utils/crud.ts:70`).
- **Catalog product has `hs_code`** (`catalog/data/entities.ts:174`) — suggestions matcher feasible.
- **Guard-test maps** exist with eudr entries to extend (`optimistic-lock-editable-entities.test.ts:59`, `record-locks-coverage.test.ts:109–112`).
- **`resolveOrganizationScopeForRequest`** already used by the batch-1 export route (`statements/[id]/export/route.ts:9`) — v2/geojson can follow the shipped pattern.

## Spec Claims PROVED FALSE (against code)

| # | Spec claim | Reality (evidence) |
|---|-----------|--------------------|
| 1 | Subscriber on `attachments.attachment.created\|deleted` filters by "payload entityId `eudr:eudr_evidence_submission`" | The emitted payload is only `{ id, organizationId, tenantId }` — `attachments/lib/crud.ts:5–14` `buildPayload`; no `entityId`/`recordId`. Additionally `DELETE /api/attachments` **hard-deletes** (`attachments/api/route.ts:542` `em.remove(record).flush()`), so a subscriber cannot re-load the attachment on `deleted` to discover linkage. |
| 2 | "Catalog enricher … targeting the catalog product entity" runs on the products list (fail-open; "if the products table exposes no column spot, ship enricher only") | Enrichers only run when the serving route opts in (`factory.ts:459` `enrichers?: { entityId }`); customers routes do (`deals/route.ts:447` `enrichers: { entityId: 'customers.deal' }`) but **no catalog route declares `enrichers`** (grep of `catalog/api/` = 0 hits). Even the spec's "enricher-only" fallback would run nothing. (Conversely the column-spot hedge is unnecessary — the spot exists.) |
| 3 | Dashboard widget "registered via `dashboardWidgets` entries in module `index.ts`" (also arch tree: "index.ts # + dashboardWidgets entries") | Registration is by auto-discovery of `widgets/dashboard/<key>/widget.ts` (exporting metadata + `lazyDashboardWidget` loader) with `widget.client.tsx` beside it; the generator populates `Module.dashboardWidgets` (`shared/modules/registry.ts:212–217, 248`). `customers/index.ts` contains no widget entries; eudr `index.ts` needs none. |
| 4 | Spec's new `lib/countries.ts` ("exports the ISO-3166 alpha-2 code list") + UI building `Intl.DisplayNames` options | This already exists platform-wide: `@open-mercato/shared/lib/location/countries` exports `ISO_COUNTRIES`, `resolveCountryName(code, { locale })` (cached `Intl.DisplayNames`, code fallback) and `buildCountryOptions` — consumed by `ui/backend/detail/AddressEditor.tsx:25`. A new eudr copy would be duplication. A searchable combobox primitive also exists: `packages/ui/src/backend/inputs/ComboboxInput.tsx` (options/suggestions/`loadSuggestions`/`resolveLabel`/`clearable`), already used by CrudForm + FilterOverlay. |

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|----------------|
| — (all skill-required sections present: TLDR, Problem, Solution+Decisions+Alternatives, Architecture, Data Models, API Contracts, UI/UX, i18n, Migration & Compatibility, Phasing/Implementation Plan, Integration Test Coverage, Final Compliance Check, Changelog) | — | — |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|----------------|
| Architecture / Design Decisions | No `ce.ts` update listed for the 3 new entities; batch 1 declared every entity there (custom-entity capability), and the batch-1 command pattern (`parseWithCustomFields`, `loadCustomFieldSnapshot`) assumes it | Add `ce.ts` entries for `eudr:eudr_plot`, `eudr:eudr_risk_assessment`, `eudr:eudr_mitigation_action` (or state explicitly they are not custom-field capable and strip the custom-field plumbing from their commands) |
| Design Decisions (attachments subscriber) | One subscriber file for two events; subscriber `metadata.event` is a single string (`shared/modules/registry.ts:182`) | Two subscriber files (`…-on-attachment-created.ts`, `…-on-attachment-deleted.ts`) or one event id each; also document delivery semantics: attachments events are emitted `persistent: false`, and the bus delivers ephemeral emits inline to all subscribers (`events/src/bus.ts:202–216` — `skipPersistent` only on persistent emits), so delivery is at-most-once/inline, no worker retry — consistent with the spec's fail-open stance, but "persistent/retried" wording should be corrected |
| API Contracts (custom write routes) | `POST /api/eudr/plots/import` and `POST …/suggestions/apply` don't mention the mutation-guard registry required for custom write routes (AGENTS: map route to `create`/`update`, `runMutationGuards` + `bridgeLegacyGuard`, merge `modifiedPayload`, run `afterSuccessCallbacks`); precedent `sales/api/quotes/send/route.ts` | Add one line per custom write route committing to the guard-registry pattern |
| Final Compliance Check | Condensed vs batch-1's full matrix (no AGENTS-files-reviewed list) | Optional: expand to the standard matrix for parity |
| Ecosystem (AI) | Phase G cites om-create-ai-agent §1–7.5 but omits the §7 post-deploy step | Document `yarn mercato configs cache structural --all-tenants` in the PR notes alongside `sync-role-acls` |

## AGENTS.md Compliance

| Rule | Location in spec | Fix |
|------|------------------|-----|
| Custom write routes use the mutation-guard registry | API Contracts — plots/import, suggestions/apply | Add guard-registry wiring commitment (see above) |
| Boy Scout rule on touched lines | Export route v2 touches `statements/[id]/export/route.ts`, whose `isSuperAdminAuth` (:27–32) falls back to a role-NAME check (`roles.some(role => … === 'superadmin')`) — contradicts the lesson "Determine super-admin via the immutable `isSuperAdmin` flag, never by role name" | Remove the role-name fallback in-change (keep `auth.isSuperAdmin === true`) |
| Reuse shared primitives, no DIY substitutes | `lib/countries.ts` + `CountrySelectField` from scratch | Reuse `@open-mercato/shared/lib/location/countries` + `ComboboxInput`; keep only eudr-specific glue (risk-tier badge decoration) |
| Everything else checked | zod + `z.infer`, `findWithDecryption` (encryption maps additive, same shape as existing `encryption.ts`), tenant scoping via CRUD factory + `resolveOrganizationScopeForRequest`, `CrudForm`/`DataTable`, semantic tokens, i18n ×4 with `[internal]` rule, events singular past-tense, undoable commands, additive module-scoped migration | Compliant as written |

Implementation note (convention, not violation): the statement submission gate reads linked submissions inside the command — use `findWithDecryption` (5-arg) even though only `status`/`completeness_score` are needed, per the "decryption-aware find helpers for all entity reads" lesson and the batch-1 changelog precedent.

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Attachments payload extension omitted → subscriber silently never matches eudr records; `documents` dimension drifts stale after uploads via AttachmentInput | Completeness scores wrong until next manual submission write; feature appears broken | Critical fix #1: additive `buildPayload` fields sourced from `ctx.entity` (fields exist on `Attachment` — `api/route.ts:428–429`); integration-test the recompute path |
| Catalog enricher never runs (no route opt-in) → injected column renders empty for everyone | Ecosystem surface (Phase F) dead on arrival | Critical fix #2: additive `enrichers: { entityId: 'catalog.product' }` (or chosen canonical string) on the products route; pin the same string in the eudr enricher's `targetEntity`; assert in TC-EUDR-008 |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Reference-data drift (benchmarking tiers / Annex-I HS) | Wrong risk tiers after a delegated-act change | Single lib file with source/effective-date header (spec'd); PR checklist note |
| 72h window vs EU-IS truth; user-editable `referenceIssuedAt` | Advisory lock bypassable by backdating | Audited via commands (spec'd); UI copy states EU IS governs |
| Subscriber delivery is inline/at-most-once (ephemeral emit) | Missed recompute on process crash between upload and handler | Fail-open by design; score refreshes on next submission write (spec'd); correct the "persistent/retried" wording |
| Gate/lifecycle logic concentrated in `eudr.statements.update` | Regression risk for batch-1 update paths | `lib/statement-lifecycle.ts` pure helpers + unit-test matrix (spec'd); TC-EUDR-007 |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Geodesic-area approximation | <0.5% error at plot scale vs 4-ha threshold | Documented in lib header (spec'd) |
| Leaflet in a form page | Bundle/SSR issues | Mirror `DealsMapCanvas` dynamic wrapper + `Impl` split exactly |
| `Intl.DisplayNames` coverage | Older runtimes | Shared lib already caches + falls back to code |
| Plot deletion dangling `plot_ids` | Readiness gaps | Skip-and-report convention (spec'd) |

## Gap Analysis

### Critical Gaps (Block Implementation — fix spec first)
1. **Attachments event payload**: spec must add the additive `entityId`/`recordId` payload extension in `packages/core/src/modules/attachments/lib/crud.ts` (payload claim currently false; hard delete forecloses the load-by-id fallback for `deleted`).
2. **Catalog products enricher opt-in**: spec must add the additive `enrichers: { entityId: … }` one-liner to `packages/core/src/modules/catalog/api/products/route.ts` and pin the matching `targetEntity` string + the `data-table:catalog.products:columns` spot id.
3. **Dashboard widget registration**: replace "dashboardWidgets entries in module index.ts" with the real convention — `widgets/dashboard/compliance-overview/widget.ts` (metadata incl. `defaultSize` + `lazyDashboardWidget`) + `widget.client.tsx`, picked up by `yarn generate`.

### Important Gaps (Should Address)
- Two subscriber files (one event id each) + corrected delivery-semantics wording.
- Reuse `@open-mercato/shared/lib/location/countries` + `ComboboxInput` instead of a new `lib/countries.ts`/from-scratch combobox.
- Mutation-guard registry on `plots/import` and `suggestions/apply`.
- `ce.ts` entries (or explicit opt-out) for the 3 new entities.
- `dependsOn` on the new manage features; Boy-Scout the export route's role-name super-admin fallback.
- AI §7 structural-cache command in PR notes.

### Nice-to-Have Gaps
- Expand Final Compliance Check to batch-1's full matrix format.
- Note the exact generated entity ids (`eudr:eudr_plot`, `eudr:eudr_risk_assessment`, `eudr:eudr_mitigation_action`) for indexer/ce/encryption wiring.
- State that the ComboboxInput country select should seed from `buildCountryOptions`, and note the eudr picker's existing `loadSelectedOption` hydration pattern satisfies the async-select lessons.

## Remediation Plan

### Before Implementation (Must Do — spec edits)
1. **Attachments payload**: add a Design Decision + file touch: extend `attachmentCrudEvents.buildPayload` to `{ id, organizationId, tenantId, entityId: ctx.entity?.entityId ?? null, recordId: ctx.entity?.recordId ?? null }`; note BC-allowed (additive payload fields) and add a classification row to the spec's Migration section.
2. **Catalog enricher opt-in**: add the `enrichers: { entityId: 'catalog.product' }` route change to Phase F + Migration section; set the eudr enricher's `targetEntity` to the same string; drop the "no column spot" hedge and name `data-table:catalog.products:columns`.
3. **Dashboard widget registration**: correct the architecture tree (`widget.ts` + `widget.client.tsx`, no `index.ts` change) and the Design Decision row.

### During Implementation (Add to Spec / honor in code)
1. Split the subscriber into two files; keep it idempotent, org/tenant-scoped, fail-open; emit `query_index.upsert_one` (lesson).
2. Reuse shared countries lib + `ComboboxInput`; mutation-guard registry on the two custom POST routes; `findWithDecryption` for gate reads; `ce.ts` entries; `dependsOn` on new manage features; Boy-Scout `isSuperAdminAuth`; mirror `DealsMapCanvas`/`Impl` dynamic split for `PlotMapPreview`; backend `[id]` pages read `params` prop (lesson); list routes use `sortFieldMap` (lesson, batch-1 precedent in place).

### Post-Implementation (Follow Up)
1. Document `yarn mercato auth sync-role-acls` AND `yarn mercato configs cache structural --all-tenants` in the PR.
2. Duplicate-DDL check of the generated migration against `Migration20260706102002_eudr.ts`.
3. Verify standalone parity is unaffected (no bootstrap wiring changes expected; enricher entries already flow through generated registries).

## Recommendation

**READY-WITH-FIXES** — implement after applying the three Critical spec corrections (attachments payload extension, catalog enricher opt-in, dashboard-widget registration mechanism). No BC violations: every touched released surface is additive and explicitly permitted; the remaining findings are spec-text corrections and convention alignments, not design changes.
