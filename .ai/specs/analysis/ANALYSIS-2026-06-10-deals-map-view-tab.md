# Pre-Implementation Readiness Analysis — Deals Map View Tab

- **Spec**: `.ai/specs/2026-06-10-deals-map-view-tab.md`
- **Date**: 2026-06-10
- **Branch**: `feat/deals-map-view-tab` (worktree `cranky-euclid-c7ceec`, off `develop`)
- **Auditor**: om-pre-implement-spec

## Summary Verdict: READY-WITH-NOTES

The spec is implementable as written. No blockers. All load-bearing claims were verified against the actual code; a handful of assumptions need correction (most importantly: the filter builder is **already exported**, `AddressEditorDraft` has cross-module constructors in the sales module, the stage record field is `label` not `name`, and two auxiliary endpoints the map page needs are gated by features other than `customers.deals.view`). Each correction below comes with a concrete resolution.

---

## BC Audit — 13 Contract Surfaces

| # | Surface | Spec claim | Verified status |
|---|---------|-----------|-----------------|
| 1 | Auto-discovery files | New `api/deals/map/route.ts`, `backend/.../map/page.tsx` + `page.meta.ts` follow existing conventions | ✅ ADDITIVE. Sibling sub-route precedent `api/deals/aggregate/route.ts` maps to `/api/customers/deals/aggregate` — same mechanism serves `/api/customers/deals/map`. No convention change. |
| 2 | Types & interfaces | `KanbanView` union widened additively | ✅ ADDITIVE with one caveat. `KanbanView = 'kanban' \| 'list'` (`ViewTabsRow.tsx:8`); only 2 consumers, both pass literals (`deals/page.tsx:922`, `pipeline/page.tsx:2713`); no switch/exhaustiveness checks anywhere. ⚠️ `AddressEditorDraft` is exported and **constructed by the sales module** — new fields MUST be optional (see Correction C5). |
| 3 | Function signatures | One new named export from `api/deals/route.ts` | ✅ Actually a **no-op**: `buildDealListFilters` is already `export async function` (`route.ts:204`). No signature changes anywhere. |
| 4 | Import paths | None moved | ✅ Confirmed. `@open-mercato/ui/backend/detail` re-exports a **different** (UI-package) AddressEditor copy — untouched by this spec (see C5). |
| 5 | Event IDs | None | ✅ Read-only feature; no events. |
| 6 | Widget spot IDs | None | ✅ No spots added/renamed. |
| 7 | API route URLs | One new route | ✅ ADDITIVE. `/api/customers/deals/map` does not exist on develop, `origin/feat/deals-list-redesign`, or this branch. Existing response schemas untouched. |
| 8 | DB schema | No migrations | ✅ Confirmed. `customer_addresses.latitude/longitude` already exist (`data/entities.ts:777-781`, `float, nullable`). |
| 9 | DI service names | None | ✅ Route resolves existing `em` / `queryEngine` registrations only. |
| 10 | ACL feature IDs | Reuses `customers.deals.view` | ✅ Exists (`acl.ts:17`). No new features. ⚠️ Note aux endpoints use other features (Gap G2). |
| 11 | Notification type IDs | None | ✅ |
| 12 | AI agent/tool IDs | None | ✅ |
| 13 | CLI commands | None | ✅ |
| +14 | Generated files | `yarn generate` regenerates registries | ✅ Page/route additions need it; **locale-key additions alone do not** — the registry statically imports whole locale JSON files (`packages/cli/src/lib/generators/module-registry.ts:1742-1765`). |

**One BC trap avoided**: do **not** add `.min(-90).max(90)` bounds to `addressCreateSchema.latitude/longitude` server-side. `data/validators.ts` schemas are a contract surface ("MUST NOT remove or narrow existing schemas" — BACKWARD_COMPATIBILITY.md §1). The spec's client-side-only range validation is the BC-compliant choice; keep it that way.

---

## Verified Claims (file:line evidence)

| Claim | Evidence | Status |
|-------|----------|--------|
| `dealListQuerySchema` exported, importable by siblings | `api/deals/route.ts:35` (`export const`), type `DealListQuery` at `:77`. Already imported by `api/deals/__tests__/route.filters.test.ts:3` — proves no cycle. | ✅ |
| Filter builder exists ~line 204-384 | `export async function buildDealListFilters(query: DealListQuery, ctx?: CrudCtx)` — `route.ts:204-384`. Handles search (token index + encrypted-tenant collapse), status, pipelineStage(Id) incl. `__unassigned`, pipelineId, ownerUserId, valueCurrency, expectedCloseAt range, isOverdue, isStuck, person/company association narrowing (via `fetchDealIdsMatchingAssociations`, pre-pagination), advanced filter tree. Returns query-engine filters (snake_case keys, `$eq/$in/$or`). | ✅ already exported |
| Aggregate sibling route pattern | `api/deals/aggregate/route.ts`: `export const metadata = { GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] } }` (:18), zod `querySchema` + `safeParse` → 400, `getAuthFromRequest(req)` (`@open-mercato/shared/lib/auth/server`), `createRequestContainer()` (`@open-mercato/shared/lib/di/container`), `resolveOrganizationScopeForRequest({ container, auth, request })` (`@open-mercato/core/modules/directory/utils/organizationScope`), manual `CrudCtx` construction `{ container, auth, organizationScope: scope, selectedOrganizationId: orgFilterIds[0], organizationIds: orgFilterIds, request: req }` (GET body, used for the token-search ctx), `openApi` export with `methods.GET { summary, description, query, responses, errors }` (:101-113). Unit-test reference: `api/deals/aggregate/__tests__/route.test.ts`. | ✅ |
| CustomerAddress has no soft delete | Entity `data/entities.ts:730-794` — no `deletedAt` property; addresses CRUD route declares no `softDeleteField` (`api/addresses/route.ts:39-46`). Hard delete confirmed. | ✅ |
| Encryption covers address text fields, not coordinates | `encryption.ts:5-17`: `customers:customer_address` → name, company_name, address_line1/2, city, region, postal_code, country, building_number, flat_number. `latitude`/`longitude` absent → plain floats. | ✅ |
| Links batch-fetch pattern | `afterList` in `api/deals/route.ts:478-515`: `findWithDecryption(em, CustomerDealPersonLink/CustomerDealCompanyLink, { deal: { $in: ids } }, { populate: ['person'/'company'] }, { tenantId, organizationId })`; labels from `displayName`. | ✅ |
| Deal detail route exists | `backend/customers/deals/[id]/page.tsx` + `page.meta.ts` → `/backend/customers/deals/{id}`. | ✅ |
| Leaflet-style dep precedent | `packages/core/package.json:233` — `"@xyflow/react": "^12.11.0"` in `dependencies`. CSS import precedent: `packages/core/src/modules/workflows/components/WorkflowGraphImpl.tsx:3` — `import '@xyflow/react/dist/style.css'` inside a `'use client'` impl; shell `WorkflowGraph.tsx:21` — `dynamic(() => import('./WorkflowGraphImpl'), { ssr: false, ... })`, itself `'use client'`. Next `16.2.7`, Yarn `4.12.0` (node-modules linker, npmjs registry); `.yarnrc.yml` has packageExtensions but nothing blocking new deps. | ✅ |
| Optimistic-lock guard unaffected | `packages/core/src/__tests__/optimistic-lock-ui-coverage.test.ts:24` — scans `modules/**/{backend,components}/**/*.tsx` for `MUTATION = /\b(deleteCrud|updateCrud)\s*\(|method:\s*['"](PUT|PATCH|DELETE)['"]/`. New map UI is GET-only → never matches. `AddressEditor.tsx`/`AddressTiles.tsx` contain no mutating calls today (writes go through parent `onCreate`/`onUpdate` callbacks, `AddressTiles.tsx:54-55`) → still unmatched after the lat/lng change. | ✅ |
| TC-CRM-084/085 free | Local develop tops out at `TC-CRM-081` (+ `TC-CRM-080-company-domain-clear`); `origin/feat/deals-list-redesign` (PR #2903) adds exactly `TC-CRM-082.spec.ts` + `TC-CRM-083.spec.ts`. 084/085 unused everywhere visible. | ✅ |
| i18n mechanics | `useT()` returns `t(key, fallbackOrParams?, params?)` (`packages/shared/src/lib/i18n/context.tsx:52-74`); deals components use `translateWithFallback(t, key, fallback, params)` from `@open-mercato/shared/lib/i18n/translate`. 4 locale files exist (`customers/i18n/{en,pl,de,es}.json`). `yarn i18n:check-sync` (root `package.json:77`) enforces flat dot-notation, **alphabetical key order**, and cross-locale parity. `{located}`/`{total}` interpolation supported by `format()`. No key registry to regenerate for additions to existing files. | ✅ |
| Existing tab keys | `customers.deals.kanban.view.kanban` / `.list` at `en.json:1138-1139`; `customers.deals.kanban.view.map` / `customers.nav.deals.map` free in all locales. | ✅ |
| crmFixtures | `packages/core/src/helpers/integration/crmFixtures.ts`: `createCompanyFixture(request, token, displayName)` (:47), `createPersonFixture(request, token, { firstName, lastName, displayName, companyEntityId? })` (:55), `createDealFixture(request, token, { title, companyIds?, personIds?, pipelineId?, pipelineStageId?, valueAmount?, valueCurrency? })` (:71) — deal↔company/person links go through `companyIds`/`personIds` on the create payload. Also `createPipelineFixture` (:86), `createPipelineStageFixture` (:96), `deleteEntityByBody`/`deleteEntityIfExists` (:106/:120). **No address fixture helper exists.** | ✅ (gap G6) |
| authFixtures | `getAuthToken`, `apiRequestWithSelectedOrg(request, method, path, { token, selectedOrgId, data? })` (sets `Cookie: om_selected_org=`), `createRoleFixture`, `deleteRoleIfExists`, `createUserFixture({ email, password, organizationId, roles[], name? })`, `deleteUserIfExists`, `createOrganizationFixture`, `deleteOrganizationIfExists`, `setRoleAclFeatures({ roleId, features, organizations? })`, `setUserAclVisibility`. UI login: `login(page, 'admin')` from `@open-mercato/core/modules/core/__integration__/helpers/auth` (used by `TC-UX-001.spec.ts:11,25`). | ✅ |
| Map payload shape helper | Factory builds `{ items, total, page, pageSize, totalPages: Math.ceil(res.total / pageSize) }` (`packages/shared/src/lib/crud/factory.ts:1789-1795`) — the map route mirrors this. | ✅ |
| pageOrder 122 free | deals list = 120, create = 121, pipeline = 121 (shared, pre-existing). 122 unused. | ✅ |

---

## Corrections to Spec Assumptions

**C1 — Phase 1 step 1 is a no-op; drop the `api/deals/route.ts` row from the File Manifest.**
`buildDealListFilters` (`route.ts:204`), `dealListQuerySchema` (`:35`), and `DealListQuery` (`:77`) are all already exported. The map route just imports them (`import { buildDealListFilters, dealListQuerySchema, type DealListQuery } from '../route'` — exactly what `route.filters.test.ts:3` already does). No modification to `api/deals/route.ts` → the #2903 coexistence story gets even cleaner.

**C2 — Stage record field is `label`, not `name`; tones need the kanban's positional fallback.**
`GET /api/customers/pipeline-stages` returns `{ id, pipelineId, label, order, color, icon, organizationId, tenantId, createdAt, updatedAt }` (`api/pipeline-stages/route.ts:80-93`). `color` is a canonical tone identifier post-2026-05-19 (`'success' | 'warning' | ...`). **`pipelineId` is optional** — a param-free call returns ALL stages across all pipelines, org/tenant-scoped, ordered by `order ASC` (`:58-64`) — exactly what the multi-pipeline map needs (one call, no per-pipeline loop). Replicate kanban's tone resolution (`pipeline/page.tsx:295-317`): `stage.color` if in `KNOWN_STAGE_TONES` (success/error/warning/info/neutral/brand/pink) else `FALLBACK_TONES[index % 6]` where `index` is the stage's position **within its own pipeline's order-sorted stage list** — compute the rotation per pipeline so map tones match kanban tones for the same stage.

**C3 — `formatCurrency` exists but is not what the kanban card uses.**
A shared helper exists at `packages/core/src/modules/customers/components/detail/utils.ts:151` (`formatCurrency(amount: number, currency?: string | null)`). The kanban `DealCard` itself uses an inline `Intl.NumberFormat(undefined, { style: 'decimal', maximumFractionDigits: 0, useGrouping: true })` + separate currency code (`DealCard.tsx:98-110`, `splitCurrencyAmount`). Either is acceptable; pick `formatCurrency` from `components/detail/utils.ts` for the panel/preview card and reference it explicitly.

**C4 — Owner-name resolution mechanism (spec deferred to "kanban's approach") — pinned:**
`fetchAssignableStaffMembers('', { pageSize: 100 })` from `packages/core/src/modules/customers/components/detail/assignableStaff.ts:119`, cached in a `useQuery` and reduced to `Map<userId, displayName>` (`pipeline/page.tsx:479-491`). Import path from the map page: `../../../../components/detail/assignableStaff`. ⚠️ The backing endpoint `/api/customers/assignable-staff` requires `customers.roles.view` (`api/assignable-staff/route.ts:40`) — see Gap G2.

**C5 — `AddressEditorDraft` has cross-module constructors; new fields MUST be optional and the inputs SHOULD be opt-in.**
There are **two** parallel AddressEditor implementations: the core one (`packages/core/src/modules/customers/components/AddressEditor.tsx` — the spec's target, used by customers `formConfig.tsx` via `AddressTiles`) and a separate UI-package copy (`packages/ui/src/backend/detail/AddressEditor.tsx`, re-exported from `@open-mercato/ui/backend/detail` — NOT in scope; don't touch it, don't confuse them). The **sales module constructs the core type**: `AddressesSection.tsx:60` (`const emptyDraft: AddressEditorDraft = {...}`), `:98` (`draftFromSnapshot(...): AddressEditorDraft`), and `SalesDocumentForm.tsx:59-63`. Declaring `latitude: string` (required) breaks their compilation; and unconditionally rendering the inputs would show them in sales document dialogs where `normalizeAddressDraft` (`AddressesSection.tsx:75-96`) silently drops the values. **Resolution**: `latitude?: string; longitude?: string` on the draft, add `'latitude' | 'longitude'` to `AddressEditorField`, and gate rendering behind a new optional prop (e.g. `showCoordinateFields?: boolean`, default `false`); only customers' `AddressTiles` passes `true`. AddressEditor props today: `{ value, onChange, format, t, disabled?, errors?, hidePrimaryToggle?, showFormatHint? }` (`AddressEditor.tsx:60-69`) — no field-list prop exists.

**C6 — "#2903 disjoint file sets" is not literally true.**
Verified `git diff --name-only develop...origin/feat/deals-list-redesign` (22 files): #2903 does NOT touch `ViewTabsRow.tsx` or `api/deals/route.ts` ✅, and this spec avoids `deals/page.tsx`/`pipeline/page.tsx` ✅. But **both PRs edit `customers/i18n/{en,pl,de,es}.json`, and #2903 also edits `crmFixtures.ts`**. Conflicts are trivially additive (sorted flat keys; fixture appends) but expect textual merge conflicts in those five files. If the implementer adds an address fixture helper to `crmFixtures.ts`, append at the end to minimize conflict surface.

**C7 — Deals list API returns snake_case items; the spec's map response example is camelCase.**
The deals list has no `transformItem` — query-engine rows pass through with snake_case keys (`pipeline_stage_id`, `value_amount`; cf. `DealApiRecord`, `pipeline/page.tsx:136-144`). The spec's `/deals/map` example shows camelCase (`pipelineStageId`, `valueAmount`, `updatedAt`). A new endpoint may define either, but this must be a **deliberate projection step** in the map route (recommended: keep the spec's camelCase, map explicitly from the QE row), and the map UI typing must match. Don't assume reusing the list's row shape gives camelCase.

**C8 — Sort plumbing details.**
`resolveSortParams`/`normalizeSortFieldSelector` are factory-internal (NOT exported; `factory.ts:79,88`) — hand-map the six `sortField` values using the same literal map as `route.ts:427-434` (`createdAt→created_at`, `updatedAt→updated_at`, `title`, `value→value_amount`, `probability`, `expectedCloseAt→expected_close_at`). Also: `SortByPopover`'s `SortOption` includes **`owner_asc`, which has no API mapping** — kanban maps it to `null` → falls back to `updatedAt desc` API sort + client-side re-sort (`pipeline/page.tsx:331-356`, `:866`). The map page must client-sort for `owner_asc` (it has the owner-names map) or document the fallback.

**C9 — `pageSize` default.** `dealListQuerySchema` defaults `pageSize` to 50 (max 100, `route.ts:36-37`). The map spec wants default 100: either derive via `dealListQuerySchema.extend({ pageSize: z.coerce.number().min(1).max(100).default(100) })` (keeps `DealListQuery` compatibility — call `buildDealListFilters` with the parsed object; omitted optionals are fine) or have the client always send `pageSize=100`. Keep `.max(100)` so TC-CRM-084 §5 (`pageSize=101 → 400`) holds.

**C10 — Addresses API ACL is NOT addresses- or deals-scoped.**
`/api/customers/addresses` metadata: GET requires `customers.activities.view`, POST/PUT/DELETE require `customers.activities.manage` (`api/addresses/route.ts:29-34`). Payload (`addressCreateSchema`, `validators.ts:237-253`): `entityId` (uuid, required), `addressLine1` (required min 1), optional name/purpose/companyName/addressLine2/buildingNumber/flatNumber/city/region/postalCode/country/`latitude: z.coerce.number().optional()`/`longitude: z.coerce.number().optional()`/`isPrimary`. The `'' → 0` coercion risk the spec flags is real (no server bounds, no `.min/.max`). TC-CRM-084 creates addresses with the admin token (has `customers.activities.manage`); list filter is `?entityId=`.

---

## Gaps & Required Clarifications (each with resolution)

**G1 — How the map route actually executes the deals query (spec says "scoped deal page query" without mechanics).**
Resolution: mirror the factory's QE path (`factory.ts:1596-1682`): resolve `queryEngine` from the container, build the scope via the aggregate scaffold (`getAuthFromRequest` → 401 guard → `createRequestContainer` → `resolveOrganizationScopeForRequest`; `effectiveTenantId = scope.tenantId ?? auth.tenantId`, `orgFilterIds = scope.filterIds?.length ? ... : [auth.orgId]`, return 401 if empty — `aggregate/route.ts` GET head), then:

```ts
const ctx = { container, auth, organizationScope: scope, selectedOrganizationId: orgFilterIds[0], organizationIds: orgFilterIds, request: req }
const filters = await buildDealListFilters(parsedQuery, ctx)
const res = await qe.query(E.customers.customer_deal, {
  fields: [...],            // copy from api/deals/route.ts:402-423 (subset OK; include updated_at)
  sort: [{ field: mappedSortField, dir }],
  page: { page, pageSize },
  filters,
  tenantId: effectiveTenantId,
  organizationId: orgFilterIds[0],
  organizationIds: orgFilterIds,
})
```

`E` import: `#generated/entities.ids.generated` (as both sibling routes do). Skip `includeCustomFields` (map response carries none). Soft-deleted rows are excluded by default. The factory-level `mergeAdvancedFilters`/`mergeIdFilter` extras (`factory.ts:1610-1613`) only matter for query-param styles the map UI never sends — acceptable, note it in a route comment.

**G2 — Auxiliary fetches are gated by features the page metadata doesn't require (and `apiCall` hard-redirects on 403).**
The map page (gate: `customers.deals.view`) calls `/api/customers/pipelines` + `/api/customers/pipeline-stages` (both `customers.pipelines.view`, `api/pipeline-stages/route.ts:24`) and `/api/customers/assignable-staff` (`customers.roles.view`). Per lessons.md ("Optional chrome fetches must suppress auth redirects", :903-911), `apiCall` redirects the whole browser to `/login?requireFeature=...` on 403. Resolution: pass `x-om-forbidden-redirect: 0` (and usually `x-om-unauthorized-redirect: 0`) on these three fetches and degrade gracefully — neutral pin tones + hidden legend when stages are unavailable; omit owner chip when staff lookup fails. (Kanban hard-depends on pipelines so it never codified this; on the map these calls are decorative, so it must.)

**G3 — Deriving the map query schema.**
Resolution: reuse `dealListQuerySchema` (or `.extend()` per C9). Don't `.omit()` fields consumed by `buildDealListFilters` (`isStuck`/`isOverdue`/deprecated aliases are optional and harmless via passthrough); a parsed result of the extended schema satisfies `DealListQuery` structurally.

**G4 — Location resolution inputs.**
Resolution: after the deal page query, batch the two link tables with `findWithDecryption(..., { deal: { $in: ids } }, { populate: [...] }, { tenantId, organizationId })` mirroring `afterList` (`route.ts:498-515`), then one `findWithDecryption(em, CustomerAddress, { entity: { $in: entityIds }, latitude: { $ne: null }, longitude: { $ne: null }, organizationId: { $in: orgFilterIds }, tenantId }, ...)`. CustomerAddress has no `deletedAt` — do NOT add a soft-delete filter. `CustomerAddress.entity` is a ManyToOne to `CustomerEntity` (`entities.ts:792-793`); the precedence rule (`isPrimary desc, createdAt asc`, company group before person group) lives in the pure `resolveDealLocations` helper as specced.

**G5 — Marker/cluster test selector (TC-CRM-085 §2-3, tile-network-independent).**
Resolution: pass a stable class/test id via `L.divIcon({ className: ..., html: ... })` (put `data-deal-id` on the inner HTML) — Leaflet inserts marker DOM regardless of tile fetch success, so assertions hold offline. Keep `domcontentloaded` + explicit visibility waits (lessons.md:301-315 bans `networkidle`).

**G6 — No address fixture helper.**
Resolution: TC-CRM-084/085 create addresses via raw `apiRequest(request, 'POST', '/api/customers/addresses', { token, data: { entityId, addressLine1, city, latitude, longitude, isPrimary } })` (admin token carries `customers.activities.manage`). Cleanup: `deleteEntityByBody(request, token, '/api/customers/addresses', addressId)` — note hard delete. Optionally add `createAddressFixture` to `crmFixtures.ts` (append at end — C6 conflict note). Use `node:crypto` randomness for fixture uniqueness (lessons.md:965-971).

**G7 — Leaflet specifics not in the spec.**
(a) `leaflet.markercluster` ships **two** stylesheets — import both `leaflet.markercluster/dist/MarkerCluster.css` and `MarkerCluster.Default.css` (plus `leaflet/dist/leaflet.css`) inside `DealsMapCanvasImpl.tsx`, mirroring `WorkflowGraphImpl.tsx:3`. (b) The markercluster plugin augments the global `L` — import order matters (`import L from 'leaflet'` then `import 'leaflet.markercluster'`). (c) Default-icon PNG path issues don't apply (divIcon only) — don't add the classic `L.Icon.Default` hack. (d) `NEXT_PUBLIC_*` envs are inlined at build time — fine for the documented self-hosting story, just don't promise runtime configurability.

**G8 — `page.meta.ts` shape.**
Resolution: copy `pipeline/page.meta.ts` exactly (it also shows the inline `React.createElement` SVG icon pattern and `breadcrumb: [{ label, labelKey, href }, ...]`); use `pageTitleKey: 'customers.nav.deals.map'`, `pageGroupKey: 'customers.nav.group'`, `pageOrder: 122` (120/121 taken).

**G9 — Filter components: confirmed reusable, data each needs.**
All are prop-driven, no context/page coupling; import via `../pipeline/components/*`:
- `FilterBarRow { leadingChips: ReactNode, chips: KanbanFilterChip[], sortNode, onChipClick }` (`FilterBarRow.tsx:14-22`) — pass popovers as `leadingChips`, `chips: []`.
- `StatusFilterPopover { values: string[], onApply }` — options static internal (open/closed/win/loose, DS tone dots).
- `PipelineFilterPopover { pipelines: PipelineFilterOption[] ({id,name,dealCount?}), selectedPipelineId, onApply }` — supply from `/api/customers/pipelines` (`{ items: [{ id, name, isDefault }] }`, cf. `pipeline/page.tsx:452-469`).
- `EntityFilterPopover { label, values, onApply, loadOptions(query, signal), labelById?, anyLabel?, initialOptions?, title? }` — replicate kanban's `loadOwnerOptions` (assignable-staff), `loadPeopleOptions` (`/api/customers/people?...sortField=displayName`), `loadCompanyOptions` (`/api/customers/companies?...sortField=display_name`) (`pipeline/page.tsx:2393-2467`).
- `CloseDateFilterPopover { value: CloseDateRange {from,to}, onApply }` — self-contained presets.
- `SortByPopover { value: SortOption, onApply }` — see C8 for `owner_asc`.

**G10 — Empty-org-scope and error parity.** The factory returns an empty page when org scope resolves empty (`factory.ts:1616-1656`); the aggregate returns 401. For the map route pick the aggregate behavior (401) — simpler, already the sibling precedent.

---

## Pitfalls from lessons.md (applicable)

1. **No `networkidle` waits** in TC-CRM-085 — backend pages keep SSE streams open; use `domcontentloaded` + explicit UI assertions, user-facing selectors (lessons.md:301-315).
2. **Optional chrome fetches must send `x-om-forbidden-redirect: 0`** — directly applicable to pipelines/stages/staff fetches on the map page (lessons.md:903-911) — see G2.
3. **Use `node:crypto` (`randomUUID`/`randomInt`) for fixture values** that flow through authenticated requests — CodeQL flags `Math.random()` (lessons.md:965-971).
4. **Keep integration tests module-local** (`packages/core/src/modules/customers/__integration__/`) and self-contained with best-effort `finally` cleanup (`.catch(() => {})`) so teardown can't mask the real failure (lessons.md:843, :923-929).
5. **Test timeout budgets**: login+nav specs conventionally use 60-120s, not 30s (lessons.md:927-929).
6. **Use `ErrorMessage`/`LoadingMessage` from `@open-mercato/ui/backend/detail`** for load failures — don't hand-roll centered divs (lessons.md:13).
7. **Feature gating**: never compare role names; rely on `requireFeatures` metadata (already specced) (lessons.md:915-921).
8. **Prefer `data-crud-field-id` selectors** for form controls in Playwright when testing the address editor inputs (lessons.md:313).

---

## Test-Plan Sanity Check

**TC-CRM-084 (API)** — all six steps implementable with verified fixtures:
- §1 401/403: no-token `apiRequest`; restricted user = `createRoleFixture` + `setRoleAclFeatures` (features without `customers.deals.view`) + `createUserFixture` (password must satisfy policy: upper+digit+special) + `getAuthToken`.
- §2-4: `createCompanyFixture`/`createPersonFixture`/`createDealFixture` (links via `companyIds`/`personIds` at create) + raw addresses POST (G6; admin token). Primary-vs-secondary via `isPrimary` on the address payload.
- §5: `status` filter passthrough works because `buildDealListFilters` is reused verbatim; `pageSize=101 → 400` holds if the derived schema keeps `.max(100)` (C9).
- §6: org isolation via `createOrganizationFixture` + `apiRequestWithSelectedOrg` (second-org deal invisible; `total` unaffected) — matches the established second-home-org pattern.
- Unit-test references: `api/deals/__tests__/route.filters.test.ts` (mocked `CrudCtx`: `{ auth: { tenantId, orgId }, request, container.resolve('em') }`) and `api/deals/aggregate/__tests__/route.test.ts` (custom-GET route harness).

**TC-CRM-085 (UI)** — feasible: `login(page, 'admin')` helper exists; the Map tab will render on `/backend/customers/deals` because the list page already mounts `ViewTabsRow` (`deals/page.tsx:922`); marker assertions via divIcon test selectors (G5); "only with address" toggle test needs one coordless deal — covered by §2 fixtures. `role=tab` + `aria-selected` are already emitted by `ViewTabsRow`, so the spec's §1 assertion works as written.

**Unit tests** — `resolveDealLocations` precedence table + the `'' → 0` normalizer test are pure-function tests; no harness concerns.

---

## Notes for the Implementer (quick map)

| Need | Where |
|------|-------|
| Custom GET scaffold to copy | `packages/core/src/modules/customers/api/deals/aggregate/route.ts` |
| Filter builder + schema (already exported) | `packages/core/src/modules/customers/api/deals/route.ts:35,77,204` |
| QE call shape + payload math | `packages/shared/src/lib/crud/factory.ts:1657-1682,1789-1795` |
| Link batch fetch to mirror | `api/deals/route.ts:478-515` (`afterList`) |
| Stage fetch (param-free = all pipelines) | `api/pipeline-stages/route.ts:51-96` |
| Tone resolution to mirror | `backend/customers/deals/pipeline/page.tsx:295-317` |
| Owner names | `components/detail/assignableStaff.ts:119` + `pipeline/page.tsx:479-491` |
| Currency formatting | `components/detail/utils.ts:151` (`formatCurrency`) |
| Dynamic-import + CSS precedent | `modules/workflows/components/WorkflowGraph.tsx:21` + `WorkflowGraphImpl.tsx:3` |
| Tab component to extend | `backend/customers/deals/pipeline/components/ViewTabsRow.tsx` (no switch; add third span/Link pair + widen union) |
| Address editor target (NOT the ui-package copy) | `packages/core/src/modules/customers/components/AddressEditor.tsx` / `AddressTiles.tsx` (payload mapping at `AddressTiles.tsx:312-342`) |
