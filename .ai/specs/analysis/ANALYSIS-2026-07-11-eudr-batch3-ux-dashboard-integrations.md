# Pre-Implementation Analysis: EUDR Compliance Batch 3 — World-Class UX, Compliance Cockpit & Cross-Module Integrations

Spec: `.ai/specs/2026-07-11-eudr-batch3-ux-dashboard-integrations.md`
Batches 1–2 (same branch `feat/eudr-compliance-module`; batch 1 committed `9c3dd840a`, batch 2 staged): `packages/core/src/modules/eudr/`
Analysis date: 2026-07-11

## Executive Summary

The spec is architecturally sound — LookupSelect, the sales detail injection spot, the dashboard-widget route's org scoping, search.ts auto-discovery, the sidebar group mechanism, and every raw-UUID fallback site were all verified in code exactly where the spec points. However, the spec was written against a **stale snapshot of the branch**: three of its route-change claims are already implemented in the working tree — `eudr/plots` already has `search` (name/external_id), `eudr/statements` already has `search` (title-only), and **`sales/orders` already supports `?search=` (ilike on `order_number` via the shared documents-factory `listSchema`)** — so the "only sales change in this batch" is a no-op and must be dropped, shrinking batch 3 to a purely eudr-internal change set. Two smaller factual errors: the evidence create page redirects to the **list**, not to the edit view (the redirect must actually be changed, feasible since the create response returns `{ id }`), and `components/EvidenceAdvancedFields` does not exist (the raw `attachmentIds` textarea is inline in both the create and edit pages). One real feasibility gap: the mapping picker's server `search` matches only `commodity`/`hs_code`/`notes` — **not the product name** users will type. Recommendation: **READY-WITH-FIXES** — correct the five stale/false claims and resolve the mapping-picker search decision before dispatch; no architectural rework needed.

## Backward Compatibility

The spec includes a "Migration & Compatibility" section (present). The eudr module ships only on this branch (not on `develop`), so even the UI removals (raw `attachmentIds` textarea) are pre-release. With the sales route change dropped (already exists), **batch 3 touches zero files outside `packages/core/src/modules/eudr/`** — the strongest possible BC posture.

### 13-Surface Audit

| # | Surface | Finding | Severity | Notes / Proposed Fix |
|---|---------|---------|----------|----------------------|
| 1 | Auto-discovery conventions | Additive new files only: `search.ts` (module root — discovered by generator extension `registry.search`, `packages/cli/src/lib/generators/extensions/search.ts`, accepts `default`/`searchConfig`/`config` exports), `backend/eudr/page.tsx` (+ `page.meta.ts`), `widgets/injection/order-compliance/*`. No renames/removals. | OK | — |
| 2 | Type definitions | None removed/narrowed. `AsyncSelectField` is exported from `eudr/components/formConfig.tsx` but consumed **only** inside the eudr module (`formConfig.tsx`, `components/OrderSelectField.tsx`) — repo-wide grep outside `modules/eudr` = 0 hits; core has no barrel re-export of eudr components. Safe to replace/remove pre-release. | OK | — |
| 3 | Function signatures | `lib/completeness.ts` gains new exports (`HARVEST_CUTOFF_DATE`, `computeHarvestCutoffWarning`) — additive; existing `computeCompleteness(input, context)` untouched. | OK | — |
| 4 | Import paths | None moved. | OK | — |
| 5 | Event IDs | No new events; no payload changes. | OK | — |
| 6 | Widget injection spot IDs | Consumes the EXISTING spot: `sales/backend/sales/documents/[id]/page.tsx:1944` builds `` `sales.document.detail.${kind}:details` `` (→ `sales.document.detail.order:details` for orders; rendered at :4891), and `workflows/widgets/injection-table.ts:9` already registers against the literal string with `kind: 'group'`, `column: 2`, `priority: 200` — the exact shape the spec mirrors (priority 210 avoids collision). Adding a consumer to a stable spot is additive. | OK | — |
| 7 | API route URLs | All changes additive **and narrower than spec'd**: statements list gains `orderId` filter + `reference_number` in the search `$or` (the `search` param itself already exists, title-only — `api/statements/route.ts:34,80–85`); dashboard widget response gains `queues` (extend `responseSchema` in the route's openApi too); evidence list items gain computed `warnings`. Plots and sales orders need **no change** (see PROVED FALSE #1/#3). | OK | Fix spec wording (extend, don't add). |
| 8 | Database schema | None. `reference_issued_at` (statements, `data/entities.ts:240`), `validation_warnings` (plots, :90–91), and `EUDR_AMEND_WINDOW_MS`/`isWithinAmendWindow` (`lib/statement-lifecycle.ts:25,32`) already exist — all cockpit queues computable without migrations, as spec claims. | OK | — |
| 9 | DI service names | None. | OK | — |
| 10 | ACL feature IDs | None added; new surfaces reuse `eudr.statements.view` etc. Note (deliberate, low risk): extending the widget route (gated `eudr.statements.view` only) with plot-warning and submission queues exposes plot/submission names to users holding `statements.view` but not `plots.view`/`evidence.view`. Acceptable umbrella for an overview surface, but state it in the spec. | OK | One sentence in spec. |
| 11 | Notification type IDs | None. | OK | — |
| 12 | CLI commands | None; `yarn generate` + search reindex CLI used as-is. | OK | — |
| 13 | Generated file contracts | Additive regeneration (`search.generated.ts`, injection tables/widgets, pages). | OK | — |

## Verified-True Spec Claims (evidence)

- **`LookupSelect` exists with the exact contract** — `packages/ui/src/backend/inputs/LookupSelect.tsx`: `fetchItems?: (query: string) => Promise<LookupSelectItem[]>` (:23), items carry `title`/`subtitle`/`badge` (:9–18), `minQuery` default 2 with `minQuery: 0` triggering an initial unqueried load (`shouldSearch` at :114–115), built-in loading/empty/min-query states; exported from the `@open-mercato/ui/backend/inputs` barrel; precedent: `sales/components/documents/SalesDocumentForm.tsx:632,1133` (customer picker) — exactly the pattern the spec cites.
- **`/api/eudr/product-mappings` supports `search`** — `api/product-mappings/route.ts:76–85` (`commodity`/`hs_code`/`notes` ilike via shared `buildIlikeTerm` from `@open-mercato/shared/lib/db/buildIlikeTerm`). But see Gap #1 — it does NOT match the product name.
- **Statements list lacks `orderId`** — `buildFilters` (`api/statements/route.ts:75–87`) handles only `id`/`commodity`/`status`/`search`; `order_id` is in the projection (:142) and item shape (`orderId`, :105), so the additive filter is trivial.
- **Dashboard widget route is lesson-compliant** — `api/dashboard/widgets/compliance-overview/route.ts` resolves `resolveOrganizationScopeForRequest` (:47), 401/400-fails-closed, GET gated `eudr.statements.view` (:22); existing rollups (deadline/mappingsInScope/submissions/statements/riskReviewsDueSoon) confirm `queues` is a clean additive extension; `EUDR_APPLICATION_DATES` = `2026-12-30`/`2027-06-30` (`lib/reference-data.ts:45–47`) as the spec states.
- **Injection context carries the order id** — the details spot receives `detailInjectionContext = { kind, record, resourceKind: 'sales.order', resourceId: record.id, … }` (page.tsx:1956–1966), so the order-compliance widget can read the order id without touching the sales module. In-module widget precedent already exists (`eudr/widgets/injection/eudr-product-column/`, `widgets/injection-table.ts`).
- **search.ts is generator-discovered** — `packages/cli/src/lib/generators/extensions/search.ts` scans module-root `search.ts` into `search.generated.ts`; entity-id format matches other modules (`sales:sales_order`, `customers:customer_person_profile`) → `eudr:eudr_due_diligence_statement`/`eudr:eudr_plot`/`eudr:eudr_evidence_submission` are correct; `SearchModuleConfig` supports per-entity `aclFeatures` (:290), `formatResult` (:275), `strategies` (:268) (`packages/shared/src/modules/search.ts`).
- **Sidebar group + landing page** — every eudr `page.meta.ts` declares `pageGroup: 'Compliance'` / `pageGroupKey: 'eudr.nav.group'` (+ `pageOrder`); a new `backend/eudr/page.tsx` maps to `/backend/eudr` (auto-discovery `backend/<path>` — all existing eudr pages are deeper, no collision) with group-root landing precedent in `integrations/backend/integrations/page.tsx`, `inbox_ops/backend/inbox-ops/page.tsx`. Give Overview a `pageOrder` below the current minimum (mappings/statements use 10/30).
- **All four raw-UUID fallback sites** — `product-mappings/page.tsx:59` (`?? row.productId`), `evidence-submissions/page.tsx:64` (`?? row.supplierEntityId`), `plots/page.tsx:68` (`|| row.supplierEntityId`), `statements/[id]/page.tsx:171` (`|| row.supplierEntityId`). Raw ISO country codes: `evidence-submissions/page.tsx:228`; the shared `resolveCountryName` (`@open-mercato/shared/lib/location/countries:54`) is already imported by eudr (`PlotMultiSelectField.tsx:6`) — drop-in fix.
- **Product-column sort is UUID-ordered today** — `sortFieldMap` maps `productId: 'product_id'` (`api/product-mappings/route.ts:134`); `enableSorting: false` matches the branch lesson (jsonb sort rejected).
- **Attachments** — edit page renders `<AttachmentInput entityId="eudr:eudr_evidence_submission" recordId={record.id} />` (`[id]/page.tsx:488`); the create POST responds `{ id }` (`api/evidence-submissions/route.ts:206` → factory 201), and `createCrud` returns the parsed result (`packages/ui/src/backend/utils/crud.ts:79`), so redirect-to-edit is implementable — but is NOT the current behavior (see PROVED FALSE #4).
- **i18n baseline healthy** — `i18n/en.json` is flat and codepoint-sorted (649 keys); `eudr.common.recordUnavailable` absent (to add ×4 locales).
- **Evidence route already has `afterList`** (`api/evidence-submissions/route.ts:239`) + `transformItem` (:192) — the computed `warnings` slot in without schema changes; `statementId`/`supplierEntityId` filters already exist (:34–35) for the statement-detail and plot-picker flows.
- **Integration harness** — `__integration__/meta.ts` declares `dependsOnModules: ['eudr']`; TC-EUDR-001…009 are module-local precedents for the three new TCs.

## Spec Claims PROVED FALSE or STALE (against the working tree)

| # | Spec claim | Reality (evidence) |
|---|-----------|--------------------|
| 1 | "`eudr/plots` … add the missing additive `search` query param (name, external_id ilike)" | Already implemented: `api/plots/route.ts:31,91–96` ilikes `name`/`external_id`. The `supplierEntityId` filter the plot typeahead needs also exists (:32,86). **Drop this Phase A item entirely.** |
| 2 | "`eudr/statements` … add the missing `search` param (title, reference_number ilike)" | `search` exists but ilikes **only `title`** (`api/statements/route.ts:80–85`). Actual change: add `reference_number` to the `$or` + add the (genuinely missing) `orderId` filter. Reword from "add param" to "extend filter". |
| 3 | "`sales/orders` list route has no `search` param today → added as optional ilike on `order_number` only. **Only sales change in this batch.**" | FALSE — the shared documents factory already declares `search` (`sales/api/documents/factory.ts:78`) and `buildFilters` ilikes the number column with `buildIlikeTerm` sanitization (:103–105); it serves `/api/sales/orders` via `buildDocumentCrudOptions` (`api/orders/route.ts`). **No sales change at all**; drop the route edit, its unit tests, and the "sanitize ilike input" risk row (already handled). The order picker just passes `?search=`. |
| 4 | "after successful create the page redirects to the edit view (existing CrudForm redirect) where AttachmentInput is available" | The create page redirects to the **list**: `router.push('/backend/eudr/evidence-submissions')` (`create/page.tsx:347`), and the `createCrud` result is discarded (:326–345). The implementation must capture `result.id` and redirect to `/backend/eudr/evidence-submissions/<id>` — feasible (POST returns `{ id }`), but it is a behavior change to write, not existing behavior to lean on. |
| 5 | "The legacy textarea in `components/EvidenceAdvancedFields` (edit) is removed" | No such component exists. The raw `attachmentIds` textarea is inline in **both** pages: `create/page.tsx:102–112` and `[id]/page.tsx:156–166`. Point the spec at those files; remove both (edit page keeps `AttachmentInput` as the only attachment surface). |

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|----------------|
| — (TLDR, Problem, Solution+Decisions+Alternatives, Architecture, Data Models, API Contracts, UI/UX, i18n, Migration & Compatibility, Implementation Plan, Integration Test Coverage, Risks, Final Compliance Check, Changelog all present) | — | — |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|----------------|
| Design Decision 1 (pickers) | **Snapshot plumbing unstated.** Current pickers persist `supplierSnapshot`/`productSnapshot`/`orderSnapshot` via `onSnapshot` (formConfig.tsx:71, OrderSelectField); `LookupSelectItem` carries only id/title/subtitle. If `LookupSelectField` drops `onSnapshot`, snapshots silently stop being written and every name-fallback site regresses to "Record unavailable". | Require `LookupSelectField` to retain raw API items keyed by id and invoke `onSnapshot` on select, preserving the existing contract. |
| Design Decision 1 / Resolved Questions | **Mapping picker search misses product name** (Gap #1 below). "product-mappings already supports search — no changes there" is misleading for the picker UX the spec promises. | Decide and record one option (see Gap #1). |
| Architecture (cockpit ACL) | Widget route gated `eudr.statements.view` only will now return plot/submission queue rows. | Note the umbrella-ACL decision explicitly (or gate queue sub-arrays per feature). |
| API Contracts | Dashboard route has a zod `responseSchema` in its openApi (incl. `z.literal` on the deadline date) — extending the payload requires extending that schema. | Add one line. |
| Integration Test Coverage | "assert no UUID anywhere on page" is brittle (UUIDs legitimately appear in URLs/hrefs/data attributes). | Scope the assertion to visible cell/label text of the affected columns. |

## AGENTS.md Compliance

| Rule | Location in spec | Fix |
|------|------------------|-----|
| Backend `[id]`/page conventions, `page.meta.ts` guards, `pageGroup` | Cockpit + Overview entry | Compliant as written (`requireFeatures: ['eudr.statements.view']`, `pageGroup: 'Compliance'`); pick `pageOrder` < existing entries. |
| `sortField` = `z.string()` + `sortFieldMap` (branch lesson) | New filters | Compliant — existing schemas already follow it; new params are plain `z.string().optional()`/uuid. |
| Custom routes resolve org scope via `resolveOrganizationScopeForRequest` (branch lesson) | Cockpit route | Already compliant in the existing route; queue queries must reuse the same resolved scope. |
| No hardcoded strings; 4 locales; codepoint-sorted flat files | i18n section | Compliant; files verified sorted today — run `yarn i18n:fix` after adding keys. |
| Widget injection for cross-module UI; no sales edits | Order panel | Compliant — and now literally zero sales-module edits (claim #3). |
| Search: `fieldPolicy.excluded` for sensitive fields, `formatResult` mandatory for tokens strategy, `checksumSource` in `buildSource` | Phase E | Spec says "no encrypted fields" but should name the mechanism: `fieldPolicy.excluded` for `producer_name`/`notes` + `checksumSource` + `formatResult` per `packages/search/AGENTS.md` MUSTs. |
| Boy Scout rule | Touched list pages | The fallback-fix lines are the touched lines; no legacy status-color debt observed in those files. |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Snapshot capture dropped during LookupSelect rewire | Supplier/product/order names stop being denormalized on NEW records → name fallbacks ("Record unavailable") everywhere, defeating the batch's own goal | Keep `onSnapshot` in `LookupSelectField`; unit-test that selecting an item writes the snapshot into form values; TC-EUDR-010 asserts the saved list shows the name |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Mapping picker can't find records by product name | Core "pick by name" mandate broken for the evidence form's mapping field | Resolve Gap #1 before dispatch |
| Redirect-to-edit change on create | If `result.id` missing/nullable (`entityId ?? id ?? null`), redirect breaks | Fall back to list redirect when id is null; assert id in TC-EUDR-010 flow |
| Cockpit queue queries multiply route latency (route already runs ~10 parallel counts; queues add ~4 row-fetches) | Slow dashboard widget for large tenants | Keep queue arrays top-5 with `limit`, reuse `Promise.all`, select minimal fields |
| `warnings` computed in both list mapping and command outputs (spec names `commands/evidence-submissions.ts` AND afterList/detail mapping) | Drift between the two computations | Compute in ONE place — the route's `transformItem` (serves list + `?id=` detail); commands need no change; fix the Architecture bullet accordingly |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Plot chips overflow for many-plot submissions | Layout noise | Cap visible chips + "+N" overflow (spec'd) |
| `minQuery: 0` initial load on large tenants | One extra pageSize-20 fetch per picker mount | Acceptable; matches sales customer picker behavior |
| Amend-window queue uses `referenceIssuedAt` (user-editable, per batch-2) | Queue can be gamed by backdating | Advisory surface only; consistent with batch-2 stance |
| i18n key churn ×4 locales | Sorting regressions | `yarn i18n:fix` + `yarn i18n:check` in Phase F (already planned) |

## Gap Analysis

### Critical Gaps (fix spec before implementation)
1. **Stale route-change claims** — rewrite Design Decision 3, "Resolved Questions", Architecture file list, API Contracts, and Phase A to reflect: plots = no change; statements = extend `$or` with `reference_number` + add `orderId`; sales orders = no change (search exists in `sales/api/documents/factory.ts:78,103–105`). This also deletes the spec's only cross-module file touch.
2. **Mapping-picker product-name search** — pick one: (a) extend `product-mappings` `buildFilters` `$or` with a jsonb path on `product_snapshot->>'name'` **only if** the query engine supports it (unproven — the spec itself rejected jsonb *sorting* for exactly this reason; do a spike first); (b) add an additive `productId` filter to the mappings route and have the picker resolve name→product ids via `/api/catalog/products?search=` (2-step fetch, fully supported today — products route searches names via `sanitizeSearchTerm`, `catalog/api/products/route.ts:62,186`); or (c) accept commodity/HS/notes-only search and show product name as the result title (document the limitation). Recommendation: (b) — deterministic, additive, no QE gamble.
3. **Create-flow redirect** — spec must state the redirect is CHANGED from list to `/backend/eudr/evidence-submissions/<createdId>` using the `createCrud` result (`create/page.tsx:347`), with a flash hint pointing at the attachments section.

### Important Gaps (should address)
- **Snapshot plumbing requirement** on `LookupSelectField` (see High Risk).
- **File pointer fix**: replace `components/EvidenceAdvancedFields` with `create/page.tsx:102–112` + `[id]/page.tsx:156–166`.
- **Search MUSTs**: name `fieldPolicy.excluded: ['producer_name', 'notes']`, `checksumSource`, `formatResult`, and `aclFeatures` per entity in Phase E.
- **Warnings single-source**: compute `harvest_before_cutoff` in `transformEvidenceSubmissionItem` only; drop the `commands/evidence-submissions.ts` mention.
- **Dashboard openApi `responseSchema` extension** for `queues`.
- **Cockpit ACL umbrella note** (statements.view sees plot/submission queue names).

### Nice-to-Have Gaps
- Overview `pageOrder`/icon choice; countdown chip should reuse the widget's `deadline` payload rather than recomputing.
- Scope "no UUID" test assertions to column cell text.
- Note `yarn mercato auth sync-role-acls` is NOT needed (no new ACL features) — prevents rote copy-paste from batch 2.
- Statement picker subtitle (`reference_number`) is only useful once the search `$or` covers it — land both together.

## Remediation Plan

### Before Implementation (Must Do — spec edits)
1. Rewrite the three stale route claims (plots/statements/sales) per Critical Gap #1; delete the sales file from the Architecture list and Phase A; delete the sales unit-test bullet and the sanitize-ilike risk row.
2. Decide the mapping-picker search mechanism (Critical Gap #2; recommend option b) and record it in Design Decisions + API Contracts.
3. Correct the attachment-flow description (Critical Gap #3 + EvidenceAdvancedFields pointer).

### During Implementation (honor in code)
1. `LookupSelectField` preserves `onSnapshot`; resolves stored id → label on mount via `?id=`/`?ids=` (per-route: statements/mappings use `?id=`, orders use `?ids=`, matching existing loaders); missing record → `eudr.common.recordUnavailable`.
2. Warnings computed once in route `transformItem`; queues added inside the existing `Promise.all` with top-5 limits and the already-resolved scope; extend the route's zod `responseSchema`.
3. Search config follows `packages/search/AGENTS.md` MUSTs; run `yarn generate` (search/widgets/pages) and verify reindex CLI picks the three entities.
4. i18n keys ×4 locales, `yarn i18n:fix`; product column `enableSorting: false`; country names via shared `resolveCountryName` with locale from `useLocale`.
5. New pages keep reading params from the `params` prop (branch lesson); cockpit page ships `page.meta.ts` with `pageGroup: 'Compliance'`.

### Post-Implementation (Follow Up)
1. TC-EUDR-010/011/012 land with the change (self-contained fixtures, cleanup in finally); API-level assertions updated to the corrected contracts (`?search=` on statements matches reference numbers; `?orderId=` filters; orders `?search=` asserted against the EXISTING route).
2. Verify `/backend/eudr` renders for a `statements.view`-only user and every queue card link honors its target page's ACL.

## Recommendation

**READY-WITH-FIXES** — no BC violations (all touched surfaces additive; after correction the batch is contained entirely within the unreleased eudr module) and no architectural rework. Fix the three Critical spec corrections (stale route claims, mapping-picker search decision, create-redirect behavior) before dispatching implementation packets; the remaining findings are wording and convention alignments.
