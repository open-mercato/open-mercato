# Deals Map View Tab

## TLDR
**Key Points:**
- Add a third **Map** view tab to the backend Deals area (`Kanban | List | Map`) that plots filtered deals on an interactive map, per the SPEC-048 Figma mockup (`node 1004-4277`).
- Deals are located through their linked company/person addresses — `customer_addresses.latitude/longitude` columns already exist; a new read-only endpoint resolves them in batch. The address editor gains optional latitude/longitude inputs so users can populate coordinates manually (no geocoding service in v1).

**Scope:**
- `GET /api/customers/deals/map` — **located-only**, paginated, filter-compatible with the deals list. It returns only deals that resolve to a coordinate-bearing linked company/person address, so every item carries a non-null `location`; pagination and `total` operate on the located set (resolved in a light id-only pass + a page-bounded heavy decrypted fetch).
- `/backend/customers/deals/map` page: shared `ViewTabsRow` (+ `map` entry), kanban-style filter bar, left "deals with location" panel, right Leaflet map (stage-tone pins, marker clustering, selected-deal preview card, legend, zoom controls).
- Latitude/longitude inputs in `AddressEditor` (people/companies address dialogs).
- New production dependencies in `@open-mercato/core`: `leaflet` (BSD-2-Clause) + `leaflet.markercluster` (MIT), lazy-loaded only on the map route.

**Concerns:**
- Coordinate coverage starts near zero for existing tenants (nothing populated lat/lng until now) — mitigated by the manual inputs, a helpful empty state, and the API/import path that already accepts coordinates.
- Public OSM raster tiles have a fair-use policy — tile URL/attribution are env-configurable so self-hosted tiles can be swapped in.

## Overview
CRM users working geographically (field sales, regional account management, logistics-heavy verticals) need to see where their open deals are. This feature adds a map view to the existing Deals area: the same filterable data set as the List/Kanban views, rendered as stage-colored pins with clustering, a side panel listing located deals, and a per-deal preview card that links to the deal detail page.

> **Market Reference**: HubSpot/Dynamics field-sales mapping add-ons (Mapsly, Maptive) and the OSS standard **Leaflet** ecosystem. Adopted: Leaflet + markercluster + OSM raster tiles (the de-facto OSS stack; permissive licenses; tiny bundle), split list+map layout, cluster-on-zoom. Rejected: `react-leaflet` (Hippocratic License 2.1 — not a standard permissive license, conflicts with "free for commercial use" requirement); MapLibre GL (BSD-3 but ~220 KB gz + vector style/tile sourcing complexity with no benefit for this raster mockup); automatic geocoding (external service dependency + OSM Nominatim usage policy — deferred, see Out of Scope).

## Problem Statement
- Deals carry no visual geographic context; users cannot answer "what's open near Gdańsk?" without exporting data.
- The platform already stores `latitude`/`longitude` on `customer_addresses` (entity line 729–793) and accepts them through the addresses API (`addressCreateSchema` lines 250–251), but **no UI exposes them** and nothing consumes them.
- The deals list API enriches linked companies/people labels but not addresses, so there is no efficient way to resolve deal coordinates client-side (N+1).

## Proposed Solution
1. **Read-only map endpoint** `GET /api/customers/deals/map` (custom sibling route next to `api/deals/aggregate`) that:
   - validates query params by **reusing** the deal list filter surface (`dealListQuerySchema`, `DealListQuery`, and `buildDealListFilters(query, ctx)` are **already exported** from `api/deals/route.ts` — `route.filters.test.ts` imports them today; no changes to that file),
   - executes via the query engine mirroring `api/deals/aggregate/route.ts` scaffolding (`getAuthFromRequest` → `createRequestContainer` → `resolveOrganizationScopeForRequest` → manual ctx → `queryEngine.query(E.customers.customer_deal, …)`); query-engine rows come back **snake_case** and MUST be explicitly projected to the camelCase response fields,
   - fetches one page of deals (pageSize ≤ 100), then **batch**-loads `CustomerDealCompanyLink`/`CustomerDealPersonLink` (with `populate` for labels) and `CustomerAddress` rows for the involved entity ids via `findWithDecryption` (addresses are in the module encryption map; coordinates are plain floats),
   - resolves one location per deal with deterministic precedence (company primary → company first-created → person primary → person first-created; only addresses where both `latitude` and `longitude` are non-null),
   - responds with the paged list shape (`items`, `total`, …) where each item carries `location | null`.
2. **Map page** `/backend/customers/deals/map` mirroring the kanban page scaffold: `ViewTabsRow` (extended with `map`), `FilterBarRow` + the existing filter popovers (status, pipeline, owner, people, companies, close date, sort), then a split layout: left location panel, right lazy-loaded Leaflet canvas. The client pages through the map endpoint (pageSize 100) until exhausted or a 500-deal cap, then renders.
3. **Manual coordinates**: `AddressEditor` gains optional Latitude/Longitude numeric inputs with client-side range validation; empty inputs are **omitted** from the payload (never sent as `''`, which `z.coerce.number()` would turn into `0`).

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Leaflet `1.9.x` + `leaflet.markercluster` `1.5.x`, no React wrapper | BSD-2-Clause + MIT (free for commercial use); react-leaflet's Hippocratic license excluded; direct Leaflet via a ref keeps the wrapper ~1 small component |
| Dependencies live in `packages/core` | Precedent: `@xyflow/react` in core for the workflows graph page; the map is used only by a core module page |
| Lazy `next/dynamic` (`ssr: false`) import of the Leaflet impl | Leaflet touches `window` at import time; keeps ~55 KB gz + CSS out of every other backend route (mirrors `WorkflowGraph` pattern) |
| New endpoint instead of expanding the deals list response | Address resolution costs 2–3 extra batched queries; list/kanban must not pay it. Mirrors the existing `api/deals/aggregate` and (incoming #2903) `api/deals/summary` custom sub-route precedent |
| Server resolves location; client never joins addresses | Avoids N+1 API calls, keeps encryption handling (`findWithDecryption`) server-side, single tested precedence rule |
| Location source = linked company/person addresses (no deal-level address) | No schema change; matches mockup (cards show company + city); deal-level address fields rejected as new contract surface with no requirement |
| Stage tone → DS status tokens for pins/legend/badges | Stage dictionary entries store canonical tones post 2026-05-19 migration; map mirrors `Lane.tsx` tone-class maps (`bg-status-*-icon` etc.), no hex |
| **Located-only endpoint** (resolved in a light id-only pass + page-bounded heavy fetch), no client "only with address" toggle | A map view only ever plots located deals, so paging over the located set spends the 500-deal client cap on pin-able deals instead of diluting it with unlocated rows; the heavy decrypted/populated fetch stays page-bounded. The panel lists exactly what the map shows; the panel count is a single located count and the empty state guides tenants with no coordinates yet. Client-side panel proximity sort remains (operates on the already-fetched located set) |
| Marker selection opens an in-map React preview card (absolute overlay), not a native Leaflet popup | Keeps the card a normal DS-styled React component (no portal/HTML-string hacks), matches the mockup's floating card |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| `react-leaflet` | Hippocratic License 2.1 — not OSI-approved/permissive; user constraint is "free use in commercial projects" |
| MapLibre GL JS | Heavier (~220 KB gz), needs style/tile-source story; mockup is a raster map with circular pins — no payoff |
| Automatic geocoding on address save | External provider + queue/rate limits + failure modes; OSM Nominatim policy disallows heavy use. Deferred to a follow-up spec |
| Returning ALL deals (located + unlocated) with a client-side "only with address" toggle | Originally the chosen design; **reversed during implementation** to the located-only endpoint above. A map view never plots unlocated deals, so returning them wastes the 500-deal client cap and the panel's space, and forces a misleading "{located} of {total}" count where the toggle would otherwise hide most rows. Located-only keeps the cap, panel, and count all about pin-able deals |
| Showing "N days in stage" in the preview card (mockup detail) | No stage-transition timestamp exists on the deal; needs stage-history tracking — out of scope |

## User Stories / Use Cases
- A **field sales rep** wants to **see open deals near a city on a map** so that **they can plan visits**.
- A **sales manager** wants to **filter the map by pipeline/stage/owner** so that **they can review regional coverage per team member**.
- A **CRM admin** wants to **enter coordinates on a company address** so that **its deals appear on the map even without a geocoding service**.
- A **user clicking a pin** wants to **preview the deal and jump to its detail page** so that **they can act on it immediately**.

## Architecture
```
/backend/customers/deals/map (client page)
  ├─ ViewTabsRow (active="map")                     [shared, extended]
  ├─ FilterBarRow + existing filter popovers        [reused from pipeline/components]
  ├─ DealsMapView (state: filters, deals, selection)
  │    ├─ pages through GET /api/customers/deals/map (readApiResultOrThrow, ≤5 pages × 100; located-only)
  │    ├─ DealsLocationPanel (left: located cards, single located count, panel proximity sort)
  │    └─ DealsMapCanvas (next/dynamic ssr:false → DealsMapCanvasImpl)
  │         ├─ Leaflet map + tile layer (env-configurable URL/attribution)
  │         ├─ leaflet.markercluster group; divIcon pins (stage tone classes)
  │         ├─ stage legend overlay; DealMapPreviewCard overlay on selection
  │         └─ selection sync: pin click ↔ panel card click (flyTo)
  └─ /api/customers/deals/map (custom GET route)
       ├─ zod query schema derived from dealListQuerySchema
       ├─ reuses exported deal filter builder from api/deals/route.ts
       ├─ deals page → batched links (findWithDecryption + populate)
       ├─ batched CustomerAddress fetch (findWithDecryption; org/tenant scoped;
       │    latitude/longitude non-null)
       └─ resolveDealLocations() precedence → items[].location | null
```
- **Server/Client boundary**: the page and all map components are client components (matching every other deals backend page). The only server-side addition is the API route.
- **`"use client"` ledger**: `map/page.tsx` (page interactivity — same as list/pipeline pages), `DealsMapView.tsx`/`DealsLocationPanel.tsx` (filter + selection state), `DealsMapCanvas.tsx` (dynamic import shell), `DealsMapCanvasImpl.tsx` (Leaflet, browser-only). No provider/bootstrap changes; no shared-shell changes.
- **Bundle guardrail**: `leaflet` + `leaflet.markercluster` + their CSS load **only** when the map route mounts (dynamic chunk, `ssr: false`). Other routes' bundles are unchanged. No new global CSS except the two stylesheet imports inside the lazy impl chunk.
- **Events/Commands**: none — strictly read-only feature; address edits ride the existing address update command (undo behavior unchanged).

## Data Models
No new entities, no migrations.

### Used as-is
- `CustomerDeal` (`customer_deals`) — id, title, status, pipelineId, pipelineStageId, pipelineStage, valueAmount, valueCurrency, probability, expectedCloseAt, ownerUserId, updatedAt (+ org/tenant scope, soft-delete).
- `CustomerDealCompanyLink` (`customer_deal_companies`), `CustomerDealPersonLink` (`customer_deal_people`) — junction tables to `CustomerEntity`.
- `CustomerAddress` (`customer_addresses`) — `entity` FK, `isPrimary`, **`latitude: float | null`**, **`longitude: float | null`**, `city`, `region`, `country`, … (org/tenant scoped, **no soft-delete**). Encrypted fields per `customers/encryption.ts` (`city`, `region`, address lines, …) — reads MUST use `findWithDecryption`. `latitude`/`longitude` are not encrypted.

### Location resolution rule (server)
For each deal: candidate addresses = addresses of linked **company** entities, then linked **person** entities (only rows with both coordinates present, org/tenant scoped). Within each group order by `isPrimary desc, createdAt asc`; first hit wins. Result: `location: { latitude, longitude, city, region, country, source: 'company' | 'person', entityId, addressId } | null`.

### `AddressEditorDraft` extension (client type only)
- `latitude?: string`, `longitude?: string` — **optional** (the sales module also constructs `AddressEditorDraft` in `AddressesSection.tsx`/`SalesDocumentForm.tsx`; optional fields keep those callers compiling and unchanged). Inputs render only when the new opt-in `showCoordinateFields` prop is set (enabled by the customers people/companies address tiles). Normalized to `number | undefined` at payload build; range −90..90 / −180..180 validated client-side; empty → field omitted (never `''`, which `z.coerce.number()` would turn into `0`). Target component: `packages/core/src/modules/customers/components/AddressEditor.tsx` (NOT the separate `packages/ui` AddressEditor).

## API Contracts
### Deals map list
- `GET /api/customers/deals/map`
- Metadata: `{ GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] } }`
- Query (zod; derived from `dealListQuerySchema`): `page` (≥1, default 1), `pageSize` (1–100, default 100), `search`, `status[]`, `pipelineId[]`, `pipelineStageId`, `ownerUserId[]`, `personId[]`, `companyId[]`, `expectedCloseAtFrom/To`, `valueCurrency[]`, `sortField` (`createdAt|updatedAt|title|value|probability|expectedCloseAt`), `sortDir`.
- Response `200`:
```jsonc
{
  "items": [{
    "id": "uuid", "title": "...", "status": "open",
    "pipelineId": "uuid|null", "pipelineStageId": "uuid|null", "pipelineStage": "Contract|null",
    "valueAmount": 540000, "valueCurrency": "PLN", "probability": 85,
    "expectedCloseAt": "2026-05-12", "ownerUserId": "uuid|null", "updatedAt": "...",
    "companies": [{ "id": "uuid", "label": "Volt Energia SA" }],
    "people": [{ "id": "uuid", "label": "..." }],
    "location": {
      "latitude": 52.19, "longitude": 21.0, "city": "Warszawa", "region": "Mazowieckie",
      "country": "PL", "source": "company", "entityId": "uuid", "addressId": "uuid"
    } // always present — the endpoint is located-only, so deals without a coordinate-bearing
      // linked address are excluded entirely (never returned with location: null)
  }],
  "total": 38, "page": 1, "pageSize": 100, "totalPages": 1   // total = count of LOCATED deals matching the filters
}
```
- Errors: `400` invalid query (zod), `401` unauthenticated, `403` missing `customers.deals.view`. Org/tenant scoping identical to the deals list (all sub-queries scoped; association and address fetches filter by the auth org set + tenant).
- Exports `openApi` documentation mirroring `api/deals/aggregate`/list conventions (paged response schema helper).

## Internationalization (i18n)
All four locales (`en`, `pl`, `de`, `es`) in `packages/core/src/modules/customers/i18n/*.json`:
- `customers.deals.kanban.view.map` — tab label ("Map").
- `customers.nav.deals.map` — page title/breadcrumb ("Deals Map").
- `customers.deals.map.*` — `panel.title`, `panel.hint` (click-a-pin hint), `panel.count` ("{count} located" — single located count, no denominator), `panel.sort.proximity`, `panel.sort.listOrder`, `panel.noAddress` (fallback when a located deal has no city/region/country), `panel.empty.title`, `panel.empty.description` (mentions adding coordinates on company/person addresses; reused as the on-canvas empty overlay), `legend.title`, `preview.openDeal`, `preview.probabilityShort`, `preview.closeShort`, `loadError`, `truncated` ("Showing first {count} of {total} located deals — refine filters…"), `canvas.loading`, `canvas.label` (aria), etc. (The `panel.onlyWithAddress` and `panel.noDeals.*` keys from the original toggle design were removed when the located-only decision landed.)
- `customers.addresses.fields.latitude` / `.longitude` (+ validation message key for range errors) for the address editor — follow the editor's existing label key prefix.
No hard-coded user-facing strings; `useT()` in all components.

## UI/UX
Figma: `SPEC-048-CRM-Detail-Pages-UX-Mockup`, node `1004-4277` ("Mapa" tab). Implement with DS tokens — the mockup's literal colors map to semantic tones.
- **Tabs**: `ViewTabsRow` gains `map` (`/backend/customers/deals/map`), same active-span/inactive-link pattern. (Mockup's "Aktywności"/"Kalendarz" tabs are **out of scope** — context only.)
- **Filter bar**: `FilterBarRow` with the same chips as kanban (Status, Pipeline, Owner, People, Companies, Close date) + `SortByPopover` on the right; search input consistent with the kanban page header.
- **Left panel** (~340 px at `lg`, `rounded-xl border bg-card`): header (title + single located count + hint), panel sort select (proximity | list order), scrollable located deal cards: company label (medium), deal title (muted), value (`formatCurrency`, semibold, right), city/region with pin icon (lucide `MapPin`, muted; `panel.noAddress` fallback when a located deal has no city/region/country), stage badge using `COUNT_BADGE_TONE_CLASS`-style tone classes. Each card carries a composed `aria-label` (company, title, value, stage, location) for screen readers. Card click selects + `flyTo`. Selected card: `bg-muted` highlight. **Mobile:** the panel is capped (`max-h-[60vh] lg:max-h-none`) so its card list scrolls within a bounded region instead of stacking the full set above the map (the row only has a real height at `lg`, where `overflow-y-auto` can resolve). No "only with address" switch — the endpoint is located-only.
- **Map canvas**: fills remaining width (`rounded-xl border` container, min-height ~ `calc(100vh - …)` consistent with kanban lane heights); zoom controls **top-left** (Leaflet default repositioned so they never overlap the top-right selection preview card), stage legend bottom-left (`bg-card/95 rounded-lg border p-3`, tone dots via `ACCENT_TONE_CLASS`-style map), attribution bottom-right (Leaflet default, configured text). When there are no located deals, a centered on-canvas overlay (reusing `panel.empty.*`) explains the empty map in addition to the panel empty state.
- **Pins**: `L.divIcon` circular markers (~14 px, white ring, tone background class per deal stage; neutral tone when stage unknown). Selected pin scales up. Clusters: `iconCreateFunction` divIcon with count, brand tone (`bg-brand-violet text-white`-equivalent token classes). Initial view: `fitBounds` of located pins (padding 32); 1 pin → zoom 12; none → world view + empty state overlay on the panel.
- **Preview card** (on selection): absolute overlay top-right inside the map container (`bg-popover rounded-xl border shadow-lg p-4 w-80`): company label + address line, deal title, value · probability (`preview.probabilityShort`) · close date, stage badge + owner chip (owner names via `fetchAssignableStaffMembers('', { pageSize: 100 })` from `components/detail/assignableStaff.ts`, building a `Map<userId, displayName>` exactly like `pipeline/page.tsx`; omit chip if unresolvable), value formatting via the shared `formatCurrency` from `components/detail/utils.ts`, primary button `preview.openDeal` → `Link` to `/backend/customers/deals/{id}`, close (×) button with `aria-label`. `Escape` clears selection via a **document-level** key listener (registered only while a deal is selected) so it fires regardless of whether focus is on the map, a panel card, or the preview card.
- **Aux-data degradation**: pipeline-stage metadata comes from the param-free `GET /api/customers/pipeline-stages` (fields `{ id, pipelineId, label, order, color }`; `color` is a tone id, fallback = positional tone rotation per pipeline) which is gated by `customers.pipelines.view`, and staff names by `customers.roles.view` — both aux fetches MUST send the `x-om-forbidden-redirect: 0` header and degrade gracefully (neutral pin tone / no owner chip) when 403, mirroring the kanban page and `.ai/lessons.md` guidance. The `owner_asc` sort option has no API mapping — like kanban, fetch by `updatedAt desc` and client-sort.
- **States**: loading → `LoadingMessage`/`Spinner` (canvas placeholder while the dynamic chunk loads); error → `ErrorMessage` with retry; truncation notice (>500 deals) as a muted banner above the panel list.
- Icon-only buttons get `aria-label`s; lucide-react icons only; no inline `<svg>`; no arbitrary text sizes; no `dark:` overrides on tokens.
- **Page meta** (`map/page.meta.ts`): mirrors pipeline meta — `requireAuth`, `requireFeatures: ['customers.deals.view']`, `pageTitleKey: 'customers.nav.deals.map'`, group Customers, `pageOrder: 122`, breadcrumb `Deals → Deals Map`.

## Configuration
- `NEXT_PUBLIC_OM_DEALS_MAP_TILE_URL` — tile template, default `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- `NEXT_PUBLIC_OM_DEALS_MAP_TILE_ATTRIBUTION` — attribution HTML, default `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors`.
- Deployments with real traffic should point these at a self-hosted/commercial tile service (OSM public tiles fair-use policy); documented in the env example if one exists.
- Whenever the **effective** tile URL targets OSM's public CDN (the unset default OR an env value pointed back at the same `tile.openstreetmap.org` host), the lazy map impl logs a one-time `console.warn` on mount noting the production/commercial usage restriction, so the public-CDN risk is visible at runtime rather than silently shipped.

## Migration & Compatibility
- **No DB migrations.** No entity changes.
- **Additive contract surfaces only**: new API route (`/api/customers/deals/map`), new backend page route, new i18n keys, `KanbanView` union widened (`'kanban' | 'list' | 'map'` — verified additive: both consumers pass literals, no exhaustive switches), new **optional** `AddressEditorDraft` fields behind an opt-in `showCoordinateFields` prop (the sales module also constructs this draft type — optionality keeps it compiling and visually unchanged). Server-side coordinate **range bounds** (`±90` / `±180`, reusing `COORDINATE_RANGES`) are now enforced on `addressCreateSchema` lat/lng (and propagate to `addressUpdateSchema` via its `.partial()` merge), so non-UI callers can no longer persist a garbage coordinate (e.g. `latitude: 9999`) that would plot at a junk position. This is a deliberate narrowing whose only rejected inputs are out-of-range values that are not valid coordinates — no legitimate caller sends them — so it is treated as a hardening fix, not a breaking change; `null`/omitted coordinates (clear-on-edit and the common case) still pass. No deprecations.
- **New dependencies**: `leaflet@^1.9.4` (BSD-2-Clause), `leaflet.markercluster@^1.5.3` (MIT) → `packages/core` `dependencies`; `@types/leaflet`, `@types/leaflet.markercluster` → `devDependencies`. Both licenses are permissive and commercial-use friendly (user requirement).
- **PR #2903 coexistence** (`feat: deals list redesign`): #2903 touches `deals/page.tsx`, `deals/pipeline/page.tsx`, adds `api/deals/summary` + KPI components; it does **not** modify `ViewTabsRow.tsx`, `api/deals/route.ts`, or any file this spec adds, and this spec does **not** modify the two page files #2903 rewrites. Shared-file overlap is limited to the four `i18n/*.json` locale files and (for integration fixtures) `helpers/integration/crmFixtures.ts` — both sides only add disjoint keys/helpers, so any conflict is a trivial additive union. Merge order is irrelevant. The map page intentionally does not adopt the KPI strip (not in the map mockup).
- `yarn generate` required after adding the page/route (auto-discovery registries).

## Implementation Plan

### Phase 1 — Map API + location resolution
1. `lib/dealsMapLocation.ts`: pure `resolveDealLocations(deals, links, addresses)` implementing the precedence rule + types. Unit tests (`__tests__/dealsMapLocation.test.ts`): precedence, coordless skipped, person fallback, no-links → null.
2. `api/deals/map/route.ts`: metadata, zod schema (derived from the already-exported `dealListQuerySchema`; `pageSize` default 100, max 100), scoped deal page query reusing the already-exported `buildDealListFilters` + the aggregate-route container/auth scaffold, explicit snake_case→camelCase projection, batched link fetch (`findWithDecryption` + populate, mirroring the list `afterList`), batched address fetch (`findWithDecryption`, org/tenant scope, non-null coords), response assembly, `openApi` export. Route unit test (`api/deals/map/__tests__/route.test.ts`) following `api/deals/__tests__` conventions.

### Phase 2 — Map UI + address coordinates
4. Add deps to `packages/core/package.json`; run install.
5. Extend `ViewTabsRow.tsx` (`map` entry + i18n key) — all three labels render, active-state behavior preserved.
6. `backend/customers/deals/map/page.meta.ts` + `page.tsx` + components (`DealsMapView`, `DealsLocationPanel`, `DealsMapCanvas` [dynamic shell], `DealsMapCanvasImpl` [Leaflet + markercluster + CSS imports], `DealMapPreviewCard`), reusing `FilterBarRow` + popovers + `readApiResultOrThrow` paging loop (cap 500, truncation notice), stage tone maps mirroring `Lane.tsx`, stage metadata via the same pipeline-stages fetch the kanban uses.
7. `AddressEditor.tsx`: latitude/longitude inputs + numeric normalization helper (empty → omitted; range validation via `createCrudFormError`-compatible inline error), payload mapping in `AddressTiles.tsx`; i18n labels.
8. i18n keys in all four locales; `yarn generate`.

### Phase 3 — Integration tests + gates
9. `__integration__/TC-CRM-084.spec.ts` (API) + `TC-CRM-085.spec.ts` (UI) — see Integration Test Coverage.
10. DS guardian pass on touched UI; full verification gate; spec changelog + Implementation Status update.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/customers/api/deals/map/route.ts` | Create | Map endpoint (reuses exports from `api/deals/route.ts` unchanged) |
| `packages/core/src/modules/customers/api/deals/map/__tests__/route.test.ts` | Create | Route unit tests |
| `packages/core/src/modules/customers/lib/dealsMapLocation.ts` (+ `__tests__`) | Create | Location precedence |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/ViewTabsRow.tsx` | Modify | `map` tab |
| `packages/core/src/modules/customers/backend/customers/deals/map/page.meta.ts` | Create | Page metadata |
| `packages/core/src/modules/customers/backend/customers/deals/map/page.tsx` | Create | Map page |
| `packages/core/src/modules/customers/backend/customers/deals/map/components/*` | Create | View, panel, canvas (lazy), preview card |
| `packages/core/src/modules/customers/components/AddressEditor.tsx` | Modify | Lat/lng inputs |
| `packages/core/src/modules/customers/components/AddressTiles.tsx` | Modify | Payload mapping |
| `packages/core/src/modules/customers/i18n/{en,pl,de,es}.json` | Modify | New keys |
| `packages/core/package.json` | Modify | leaflet deps |
| `packages/core/src/modules/customers/__integration__/TC-CRM-084.spec.ts` | Create | API integration |
| `packages/core/src/modules/customers/__integration__/TC-CRM-085.spec.ts` | Create | UI integration |

### Testing Strategy
- **Unit**: location precedence (`dealsMapLocation`), map route (auth/scope/shape/located resolution with mocked em/queryEngine per existing deals route tests), address numeric normalizer (empty string never becomes `0`).
- **Integration**: below.
- **Manual/preview**: load map page with seeded located deal; pin renders without tile network; popup → deal detail navigation.

## Integration Test Coverage
Self-contained Playwright specs (API fixtures via `packages/core/src/helpers/integration/crmFixtures.ts` + `authFixtures`; cleanup in `finally`; no seeded-data reliance). PR #2903 occupies TC-CRM-082/083 → this spec uses **084/085**. No address fixture helper exists — create addresses via `POST /api/customers/addresses` (`{ entityId, addressLine1, latitude, longitude, isPrimary }`); note that route is gated by `customers.activities.manage` (admin token covers it).

**TC-CRM-084 — `GET /api/customers/deals/map` (API)**
1. `401` without token; `403` for a user whose role lacks `customers.deals.view`.
2. Company + primary address with coordinates + linked deal → item `location.source === 'company'`, correct lat/lng/city; a deal with no coordinate-bearing linked address is **excluded** server-side (located-only); `total` counts only the located deal.
3. Person-only deal with person address coordinates → `location.source === 'person'`.
4. Two company addresses with coordinates (primary + non-primary) → primary wins.
5. Filter passthrough: `status` filter excludes non-matching located deal; multi-select `status=open&status=win` matches both; invalid query (`pageSize=101`, unknown `sortField`) → `400`.
6. Org isolation: deal in another organization (second home org pattern) is absent; counts unaffected.
7. Out-of-range coordinates: `POST /api/customers/addresses` with `latitude: 9999` → `400` (server-side bounds); an in-range coordinate still persists.
8. Multi-org path, split across two deterministic unit surfaces (a genuine multi-org `filterIds` is not reliably reproducible through the org-scope selector in integration tests):
   - **Route contract** (`api/deals/map/__tests__/route.test.ts`): a resolved scope spanning two orgs queries `organizationId: { $in: [orgA, orgB] }` for deals and both address fetches, and passes `orgFilterIds[0]` as the decryption fallback scope.
   - **Per-row decryption safety** (`packages/shared/src/lib/encryption/__tests__/subscriber.test.ts`): `decryptEntitiesWithFallbackScope` decrypts each row with the row's OWN organization, using the passed fallback org only for a row that carries no org — which is exactly what makes the route's single `orgFilterIds[0]` fallback correct across a multi-org page.

**TC-CRM-085 — Map page (UI)**
1. Login → `/backend/customers/deals` → Map tab visible → click → URL `/backend/customers/deals/map`, tab active (`role=tab` selected).
2. With a fixture located deal: left panel shows the deal card (company label + value + stage badge) and the located/total count; a map marker element renders (deterministic test selector, tile-network-independent).
3. Click marker → preview card shows deal title + "Open deal" link with `/backend/customers/deals/{id}` href.
4. A fixture deal whose linked company has no coordinate-bearing address is **excluded** from the located-only panel (a located fixture deal renders; the coordless one has zero panel cards) — there is no client-side toggle.
5. Address-coordinate UI path: company detail → addresses → add/edit address with latitude/longitude through the editor dialog → values persist (verified via the addresses API readback), proving the manual-coordinates loop that feeds the map.

## Risks & Impact Review

### Data Integrity Failures
Read-only endpoint — no writes, no partial-write risk. Address edits reuse the existing command path (optimistic locking + undo unchanged). Deleted/unlinked entities mid-request simply drop out of batch results (deal renders without location).

### Cascading Failures & Side Effects
No events emitted; no subscribers. Tile-server outage degrades to a blank basemap — markers, panel, and navigation still work (divIcon markers don't depend on tiles). The map endpoint failing affects only the map route (`ErrorMessage` + retry).

### Tenant & Data Isolation Risks
All three batch queries (deals, links, addresses) are tenant+org scoped server-side, mirroring the deals list. Addresses additionally never leave the resolved single `location` projection. Covered by TC-CRM-084 §6.

### Migration & Deployment Risks
No migrations; additive routes/exports only; deploy/rollback trivial. `yarn generate` regenerates discovery registries deterministically.

### Operational Risks
Public OSM tiles rate-limit heavy use → env-configurable tile URL; documented. Pin volume bounded (≤500 + clustering). Endpoint cost bounded: ≤3 batched queries per page of 100.

### Risk Register

#### Empty map on existing tenants
- **Scenario**: No addresses have coordinates yet; users open the tab and see nothing.
- **Severity**: Medium
- **Affected area**: Map page UX only.
- **Mitigation**: When no deals resolve to a location, BOTH the panel empty state AND a centered on-canvas overlay explain how to add coordinates (the address editor now exposes them); the panel header shows the located count ("0 located") to make the populated set explicit; API/import path already accepts coordinates for bulk backfill. (The located-only endpoint no longer surfaces an all-deals denominator — the empty state is the onboarding signal.)
- **Residual risk**: Tenants must populate data manually until a geocoding follow-up ships — accepted (explicit v1 decision).

#### Encrypted address fields read without decryption
- **Scenario**: Address fetch bypasses `findWithDecryption`, leaking ciphertext into city labels (or failing).
- **Severity**: High
- **Affected area**: Map endpoint response quality; encryption contract.
- **Mitigation**: Spec mandates `findWithDecryption` for links and addresses (same helper the deals list uses); route unit test asserts decrypted labels; code review checkpoint.
- **Residual risk**: None beyond normal review discipline.

#### Coordinate junk via form (`'' → 0`)
- **Scenario**: Empty lat/lng inputs submitted as `''`; `z.coerce.number()` coerces to `0` → deals pinned at "null island" (0,0).
- **Severity**: Medium
- **Affected area**: Address data quality, map accuracy.
- **Mitigation**: Numeric normalizer omits empty values from payloads; client range validation; **server-side `±90`/`±180` bounds on `addressCreateSchema`/`addressUpdateSchema`** so out-of-range values from any caller are rejected with a 400; unit test for the normalizer + schema-bounds unit test + an integration test asserting the addresses API rejects `latitude: 9999`.
- **Residual risk**: API consumers can still send literal `0,0` — valid coordinates in principle; accepted. (`z.coerce.number()` also coerces `''→0`, but the UI omits empty inputs; documented and accepted.)

#### Bundle/perf regression on backend routes
- **Scenario**: Leaflet CSS/JS leaks into shared chunks, slowing all backend pages.
- **Severity**: Medium
- **Affected area**: Backend shell performance.
- **Mitigation**: `next/dynamic` `ssr:false` impl module owns all leaflet imports (JS + CSS); only the map route requests the chunk; `build:app` verifies compilation.
- **Residual risk**: Negligible.

#### PR #2903 interaction
- **Scenario**: Merge conflicts or behavioral clash with the deals list redesign.
- **Severity**: Low
- **Affected area**: Deals pages.
- **Mitigation**: Disjoint file sets (verified against the PR's 22-file manifest); `ViewTabsRow` untouched by #2903; this spec avoids `deals/page.tsx`/`pipeline/page.tsx` entirely.
- **Residual risk**: If #2903 restyles `ViewTabsRow` later, the map entry restyles with it — desired.

## Final Compliance Report — 2026-06-10

### AGENTS.md Files Reviewed
- `AGENTS.md` (root) — Task Router rows: Module Development/API Routes, Widget patterns, UI/DataTable, Design System, Testing
- `packages/core/AGENTS.md` — API routes, ACL, encryption
- `packages/core/src/modules/customers/AGENTS.md` — module reference patterns
- `packages/ui/AGENTS.md` + `packages/ui/src/backend/AGENTS.md` — apiCall, LoadingMessage/ErrorMessage, page patterns
- `.ai/ds-rules.md`, `.ai/qa/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Stays within customers module; FK ids only |
| root AGENTS.md | Tenant/org scoping on all queries | Compliant | All three batch queries scoped; integration-tested |
| root AGENTS.md | Validate inputs with zod | Compliant | Query schema derived from `dealListQuerySchema` |
| root AGENTS.md | Never raw `fetch` in backend UI | Compliant | `readApiResultOrThrow` |
| root AGENTS.md | No hard-coded user-facing strings | Compliant | i18n keys ×4 locales |
| root AGENTS.md | Optimistic locking on editable entities | Compliant (N/A new) | No new editable entity; address edits ride existing flow |
| core AGENTS.md | Routes export `metadata` (+ `openApi`) | Compliant | Specified for the map route |
| core AGENTS.md | Encryption: `findWithDecryption` for mapped entities | Compliant | Mandated for links + addresses |
| DS rules | Status colors via `*-status-*` tokens; no arbitrary values; no `dark:` overrides | Compliant | Tone-class maps mirror `Lane.tsx` |
| specs AGENTS.md | Integration coverage for all affected API/UI paths in-spec | Compliant | TC-CRM-084/085 defined; ship in same change |
| root AGENTS.md | Ask before adding production dependencies | Compliant | User approved Leaflet stack (2026-06-10) |
| BACKWARD_COMPATIBILITY.md | Contract changes additive or deprecation protocol | Compliant | Additive only |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Location projection ⊆ CustomerAddress fields |
| API contracts match UI/UX section | Pass | Item fields cover card/preview/pin needs |
| Risks cover all write operations | Pass | Only write = existing address command |
| Commands defined for all mutations | Pass (N/A) | Read-only feature |
| Cache strategy covers read APIs | Pass (N/A) | No caching v1; bounded query cost; consistent with list/aggregate |

### Non-Compliant Items
None.

### Verdict
- **Fully compliant**: Approved — ready for implementation.

## Implementation Status
- [x] Phase 1 — Map API + location resolution (route + lib + 14 unit tests green)
- [x] Phase 2 — Map UI + address coordinates (tab, page, lazy Leaflet canvas, i18n ×4, deps; coordinate inputs in BOTH address-editor families — core `components/` + shared `ui/backend/detail` — opt-in, enabled for customers create+detail surfaces; normalizer helper moved to `@open-mercato/shared/lib/location/coordinates`)
- [x] Phase 3 — Integration tests + gates (TC-CRM-084/085 — 11/11 green on the ephemeral env; DS guardian 0 blockers / 5 precedent-backed advisories; full gate green: build:packages → generate → build:packages → i18n:check-sync → typecheck → test [5798 core] → build:app; fresh adversarial review PASS / 0 blockers; map verified live via Playwright)

## Changelog
### 2026-06-10
- Initial specification (map view tab, map endpoint, manual address coordinates; Leaflet stack approved by maintainer; geocoding explicitly deferred).
- Pre-implement audit corrections applied (see `.ai/specs/analysis/ANALYSIS-2026-06-10-deals-map-view-tab.md`): filter builder already exported, snake_case projection, gated aux fetches with `x-om-forbidden-redirect: 0`, optional `AddressEditorDraft` fields + `showCoordinateFields` opt-in, i18n/crmFixtures additive overlap with #2903.
- Post-merge QA fixes (manual testing at scale, 1000 seeded deals):
  - **Multi-select filters dropped all but the last value.** `GET /api/customers/deals/map` parsed the query with `Object.fromEntries(searchParams)`, which collapses repeated params — so `?status=open&status=win` filtered by `win` only (and the same for owner/people/companies/currency). Replaced with explicit `searchParams.get`/`getAll` parsing mirroring `api/deals/aggregate`'s `readArrayParam` (handles repeated **and** comma-joined values). Added unit regression (`route.test.ts`) + integration regression (`TC-CRM-084`: open+win matches both, excludes loose).
  - **Leaflet `_leaflet_pos` crash on zoom.** Data-driven `fitBounds`/`setView` ran animated; with the list paging in over several updates, overlapping zoom transitions raced Leaflet's pane bookkeeping and threw on `_onZoomTransitionEnd`. Made data-driven view changes non-animated (`animate: false`) and `map.stop()` before new selection animations and before teardown. Verified: 0 console errors through cluster-zoom stress + 1000-deal load.

### 2026-06-13 — PR #3028 review response
- **Decision recorded: the endpoint is located-only.** The original "return all deals + client toggle" design was reversed during implementation; this spec now documents located-only as the chosen design (Design Decisions + Alternatives + Architecture + API Contracts all updated). The dead toggle code, the unused `panel.onlyWithAddress` / `panel.noDeals.*` i18n keys, and the misleading "{located} of {total}" count were removed — the panel now shows a single located count (`{count} located`).
- **Blocker — mobile panel scroll:** `DealsLocationPanel` is capped with `max-h-[60vh] lg:max-h-none` so its card list scrolls within a bounded region on small screens instead of stacking the full set (up to the 500 cap) above the map.
- **Blocker — server-side coordinate bounds:** `addressCreateSchema` lat/lng now enforce `±90`/`±180` (via `COORDINATE_RANGES`), propagating to `addressUpdateSchema` through its `.partial()` merge. Covered by a schema-bounds unit test + a TC-CRM-084 integration assertion (`latitude: 9999` → 400). `null`/omitted still pass (clear-on-edit).
- **OSM public tiles:** the lazy map impl emits a one-time `console.warn` whenever the effective tile URL targets OSM's public CDN (unset default OR an env value pointed back at the `tile.openstreetmap.org` host), surfacing the production/commercial usage restriction at runtime.
- **Multi-org decryption confirmed safe** (per-row `resolveScope` governs decryption; `orgFilterIds[0]` is only a fallback) and now covered on two surfaces: a route unit test asserting the `$in` multi-org fetch + `orgFilterIds[0]` fallback scope, and a shared `decryptEntitiesWithFallbackScope` unit test proving each row decrypts with its OWN org (fallback only for a scope-less row).
- **Polish:** zoom control moved top-left (no longer overlaps the top-right preview card); centered on-canvas empty overlay when no deals are located; `Escape` now clears selection via a document-level listener (works from any focus); panel cards carry a composed `aria-label`.
- **page.meta icon:** left as a raw `React.createElement('svg', …)` — this matches the existing convention for `deals/page.meta.ts` and `deals/pipeline/page.meta.ts` (neither imports from `lucide-react`).
- **Known limitations (non-blocking, documented):** `owner_asc` panel sort is client-side over the rendered ≤500 cap (so on >500 located deals it orders only the first 500 by `updatedAt`); the light-pass located-id allowlist is not page-bounded (fine at the tested ~1000, noted ceiling); `@open-mercato/ui` `AddressEditor` gained the opt-in `showCoordinateFields` prop (default-off, a noted scope deviation from "don't touch the ui AddressEditor"); owner names depend on `customers.roles.view` and degrade to empty gracefully when missing.

### 2026-06-13 — manual-QA follow-ups
- **Mobile filter alignment.** `FilterBarRow` (shared with the kanban/pipeline view) used `flex flex-wrap justify-between`, which spread the chip group and the sort control raggedly when wrapped on narrow screens. Changed to a clean column stack on mobile (`flex flex-col` + full-width `Filter:` label) that reverts to the row/`justify-between` layout at `sm` and up (`sm:ml-auto` on the sort control). Desktop layout unchanged.
- **Map search now matches the linked company/person name.** The deal-field token search reused from the list (`buildDealListFilters`) covers deal title/description/status/… but NOT the linked company/person name — which is the headline on every map card — so searching a company name a user could plainly see returned 0. The map route now, when a search term is present, also resolves located deals whose linked **`customer_entity`** name matches (via `findMatchingEntityIdsBySearchTokensAcrossSources` over `display_name`/email/phone/description) and unions them with the deal-field matches. Implementation note: `restrictedDealIds` (located ∩ deal-field ∪ name) is the final set, so `filters.id` is cleared before `applyEntityIdRestriction` — otherwise it would re-intersect the name matches against the deal-field "no-match" sentinel and drop them. Map search is intentionally broader than List/Kanban here (company-centric cards); covered by two route unit tests (name-match surfaces the located deal; no name search when no term). List/Kanban search scope is unchanged.
