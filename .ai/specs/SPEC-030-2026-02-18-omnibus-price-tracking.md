# SPEC-030: Omnibus Price Tracking

## TLDR

**Key Points:**
- Append-only price history log in the catalog module, capturing every price mutation with full context and source attribution
- Omnibus resolution service computes the lowest presented price in a configurable lookback window (default: 30 days)
- EU Omnibus Directive compliance: exposes `omnibus.lowestPriceNet/Gross` alongside the resolved price in API responses, per channel

**Scope:**
- `CatalogPriceHistoryEntry` entity + migration + composite indexes
- Capture helper wired into existing price commands (create, update, delete, undo) in the same DB transaction
- `catalogOmnibusService` for lookback MIN query + presented price resolution via existing `catalogPricingService`
- Omnibus config via `module-config-service` (lookback days, presented price kind per channel)
- API: extend price resolution response with `omnibus` block; add `GET /api/catalog/prices/history`
- Admin UI: Omnibus settings panel + lowest-price indicator in the price editor

**Concerns:**
- History table grows without bound — retention/archival policy is deferred but must be planned before production scale
- Lookback queries span time ranges — composite indexes are mandatory, not optional
- Cold-start: for EU deployments, backfill of existing price rows is a **mandatory** pre-launch step, not optional
- Baseline gap: `MIN(recorded_at in window)` is incorrect — must also include the last entry before the window as "price in effect at window start"
- Channel scope: lookback must be filtered by `channel_id` when context has one; cross-channel MIN gives legally incorrect reference prices
- `MIN(net)` + `MIN(gross)` independently may combine values from different rows — must return both fields from the same record

---

## Overview

The EU Omnibus Directive (2019/2161) requires retailers to display the lowest price a product had in the 30 days prior to any promotional price reduction. Open Mercato already supports multi-tier pricing with price kinds, channel scoping, and a resolver pipeline. This spec adds an **immutable price history layer** inside the catalog module and a lightweight **Omnibus resolution service** that sits beside (not inside) the existing resolver, returning both the presented price and the 30-day reference price.

> **Market Reference**: WooCommerce's Omnibus compliance plugin appends a "lowest prior price" meta field to products; Magento 2's Omnibus extension uses a `price_index` history table. Both record every price change and query the `MIN` across a date range. We adopt the same immutable append-log pattern but keep history strictly inside the catalog module boundary, use no cross-module ORM, and make the lookback window and presented price kind tenant-configurable per channel.

---

## Problem Statement

Open Mercato currently has no mechanism to:

1. Record a durable, auditable history of price changes per product/variant/offer
2. Query the lowest price within a rolling time window for compliance reporting
3. Expose the "Omnibus reference price" to storefronts and order lines

Without this, merchants operating in EU markets cannot legally display promotional prices.

---

## Proposed Solution

Add an immutable `catalog_price_history_entries` table. Wire a `recordPriceHistoryEntry` helper directly into the existing price command handlers (create, update, delete, undo) so history is written in the same ORM transaction. Introduce a `catalogOmnibusService` that resolves both the presented price (via existing `catalogPricingService`) and the Omnibus reference price (MIN query on history). Extend price API responses with an optional `omnibus` block and add a history endpoint for compliance exports.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Capture in command handlers, not event subscribers | Guarantees durability even if the event bus is down; price and history share the same transaction boundary |
| History entity lives inside the catalog module | Avoids cross-module ORM; catalog owns all pricing data |
| Separate `catalogOmnibusService`, not a resolver plugin | The Omnibus reference is a historical MIN query, not a "best price" selection — mixing it into the resolver pipeline would violate SRP |
| Config via `module-config-service` | Consistent with existing catalog config storage; no schema migration for config updates |
| `omnibus` block optional/nullable in API responses | Only included when Omnibus is enabled; backward-compatible with all existing consumers |
| Baseline + window lookback, not plain MIN in window | `MIN(recorded_at in window)` returns `null` when price was stable — must include the last entry ≤ windowStart as the "price in effect" baseline; see `getLowestPrice` algorithm |
| Return both price fields from the single lowest-gross row | Independent `MIN(net)` + `MIN(gross)` can originate from different rows (e.g. tax-rate change between entries), producing legally incorrect net/gross combinations; resolve by identifying the row with lowest gross first, then reading its net |
| Channel-scoped lookback when `channelId` is present; no filter when absent | B2B and B2C channels may have different price histories; cross-channel MIN leaks lower prices from an unrelated channel into the Omnibus reference. When `context.channelId` is absent (e.g. admin context), do NOT restrict to `channel_id IS NULL` — include all entries regardless of channel, to avoid silent `no_history` on catalogues where all prices are channel-scoped |
| Deterministic scope selection for lookup (no OR) | `WHERE (product_id = X OR variant_id = Y)` degrades index selectivity and may return entries from a different scope level. Selection follows a strict priority: if `offerId` → filter by `offer_id` only; else if `variantId` → filter by `variant_id` only; else → filter by `product_id` only |
| Single `defaultPresentedPriceKindId` + per-channel override (no list) | A whitelist array `presentedPriceKindIds` is redundant with per-channel config; consolidating to one default + channel map eliminates the ambiguity of "which kind is presented when the list has multiple entries" |
| `applicable` based on `isPromotion` flag OR reduction vs. pre-window baseline | `presentedGross < lowestGross` is incorrect as a reduction gate — it returns false when the window contained a historically lower price (e.g. 80→100→90 promo sequence). Correct definition: `applicable = presentedPriceKind.isPromotion === true OR presentedGross < previousPriceGross`, where `previousPriceGross` is the baseline entry's gross (last entry ≤ windowStart). This correctly handles: (1) explicit promotional price kinds, (2) prices that are reduced vs. the start-of-window price. Known limitation documented in risks. |
| `recorded_at` semantics only for Omnibus computation (Phase 1–2) | `starts_at` / `ends_at` on history entries are informational snapshots of the source row's validity window. They are NOT used in lookback queries — all window boundaries are evaluated against `recorded_at`. Effective-date semantics (price validity intervals) are deferred to a future phase. |
| `minimizationAxis` in config, default `gross` | Per-channel config declares whether Omnibus minimizes by gross (B2C EU default) or net (B2B). Avoids a breaking API change later if net-axis is needed. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Event subscriber writes history | Non-durable (event bus failure loses entries); introduces ordering dependency |
| Shared audit log across modules | Cross-module coupling; breaks module isolation |
| Derive history from existing audit snapshots | Audit format is not optimized for MIN/range queries; would require ETL on every read |

---

## User Stories / Use Cases

- **Merchant** wants to **enable Omnibus compliance per organization** so that their storefront displays the 30-day lowest price next to promotional prices.
- **Store admin** wants to **configure which price kind is the presented price per channel** so that B2B and B2C channels have independent Omnibus reference computation.
- **Store admin** wants to **see the current lowest price in the lookback window while editing a product price** so they know what the Omnibus reference will be before publishing a sale.
- **Compliance officer** wants to **export price history for a product over a date range** so they can prove regulatory compliance.
- **Storefront** wants to **receive both the presented price and the Omnibus reference price from the API** so the UI can render "Was €X, now €Y (lowest price in 30 days: €Z)".

---

## Architecture

```
Price Command (create/update/delete/undo)
    │
    ├── writes CatalogProductPrice  (existing, unchanged)
    └── writes CatalogPriceHistoryEntry (new, same ORM transaction)
                │
                ▼
    catalog_price_history_entries table (append-only, never updated)
                │
                ▼
    catalogOmnibusService.resolveOmnibus(context)
        ├── catalogPricingService.resolvePrice(rows, context) → presented price
        ├── omnibusConfig (from module-config-service)        → presented price kind + lookback window
        └── MIN query on history (scoped by org/product/kind/currency/date range)
                │
                ▼
    API response: { pricing: {...}, omnibus: { lowestPriceNet, lowestPriceGross, ... } | null }
```

### Commands & Events

Internal helper (not a user-facing command, not undoable — history is immutable):
- `recordPriceHistoryEntry` — called inline within price commands after successful price write

Events emitted by existing price commands (naming per `module.entity.action` convention, singular past tense):
- `catalog.price.created` → history capture with `change_type = create`
- `catalog.price.updated` → history capture with `change_type = update`
- `catalog.price.deleted` → history capture with `change_type = delete`

History capture is wired directly in command handlers; events are listed for documentation completeness only.

---

## Data Models

### CatalogPriceHistoryEntry (Singular)

Immutable snapshot of a `CatalogProductPrice` row at the moment of change. Rows are never updated or deleted.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `tenant_id` | UUID | Tenant isolation — required |
| `organization_id` | UUID | Required; all queries filter on this |
| `price_id` | UUID | FK id to `CatalogProductPrice` (no ORM relation) |
| `product_id` | UUID | Denormalized for efficient lookback queries |
| `variant_id` | UUID? | Null if price is product-level |
| `offer_id` | UUID? | Null if not offer-scoped |
| `channel_id` | UUID? | Null if not channel-scoped |
| `price_kind_id` | UUID | FK id to `CatalogPriceKind` (no ORM relation) |
| `price_kind_code` | string | Denormalized snapshot — survives price kind rename |
| `currency_code` | string(3) | ISO 4217 |
| `unit_price_net` | decimal(14,4) | Price excluding tax |
| `unit_price_gross` | decimal(14,4) | Price including tax |
| `tax_rate` | decimal(6,4)? | Applied tax rate at capture time |
| `tax_amount` | decimal(14,4)? | Tax amount at capture time |
| `min_quantity` | int? | Quantity tier lower bound |
| `max_quantity` | int? | Quantity tier upper bound |
| `starts_at` | timestamp? | Price validity start (from source row) |
| `ends_at` | timestamp? | Price validity end (from source row) |
| `recorded_at` | timestamp (UTC) | Application-layer UTC timestamp set **explicitly** at write time; never uses a DB-level default (e.g. `NOW()` trigger or column default); immutable after insert. Using an explicit application timestamp ensures all window computations (`windowStart = now() - lookbackDays`) use the same clock source, avoiding baseline drift when DB and application servers are in different time zones or have clock skew. |
| `change_type` | enum | `create`, `update`, `delete`, `undo` |
| `source` | enum | `manual`, `import`, `api`, `rule`, `system` |
| `metadata` | jsonb? | Optional caller-provided context |

**Required indexes (must be declared explicitly in migration):**

All lookback indexes are prefixed with `(tenant_id, organization_id, ...)` because the isolation boundary enforces both columns in every query. The leading `tenant_id` keeps the index tight when a single PostgreSQL cluster hosts multiple tenants sharing the same `organization_id` space.

The trailing `recorded_at` column is declared `DESC` in the index definition. The baseline query (`ORDER BY recorded_at DESC LIMIT 1`) benefits directly — the index scan returns the latest matching entry without a sort. Window range scans (`recorded_at > windowStart AND recorded_at <= windowEnd`) are direction-agnostic in PostgreSQL (the planner can scan an index in either direction), so `DESC` is neutral for them but does not hurt. All timestamps are stored and compared as **UTC**; `now()` in all queries uses server UTC time from the application layer, not the DB server clock, to ensure consistency when replicas are in different time zones.

| Index | Columns | Purpose |
|-------|---------|---------|
| Product lookback (channel-agnostic) | `(tenant_id, organization_id, product_id, price_kind_id, currency_code, recorded_at DESC)` | Baseline + window query for no-channel context |
| Product lookback (channel-scoped) | `(tenant_id, organization_id, product_id, channel_id, price_kind_id, currency_code, recorded_at DESC)` | Baseline + window query when channelId is present |
| Variant lookback (channel-agnostic) | `(tenant_id, organization_id, variant_id, price_kind_id, currency_code, recorded_at DESC)` | Variant-level lookback without channel |
| Variant lookback (channel-scoped) | `(tenant_id, organization_id, variant_id, channel_id, price_kind_id, currency_code, recorded_at DESC)` | Variant-level lookback with channel |
| Offer lookback | `(tenant_id, organization_id, offer_id, price_kind_id, currency_code, recorded_at DESC)` | Offer-scoped lookback |
| By price id | `(tenant_id, organization_id, price_id)` | Audit: find all history entries for a given price row |

**Performance note — "no channel filter" mode**: when `context.channelId` is absent, the query uses the channel-agnostic indexes and scans rows from all channels. In catalogues where every price is channel-scoped this is still efficient (the index is used; extra rows are the only overhead), but the result may blend entries from multiple channels. This is a deliberate trade-off to avoid silent `no_history`. For performance-critical, high-cardinality catalogues accessed without a channelId, callers SHOULD pass an explicit channelId or accept that the no-channel result is best-effort.

### OmnibusConfig (stored in `module-config-service`, key: `catalog.omnibus`)

```ts
{
  enabled: boolean                          // default: false
  lookbackDays: number                      // default: 30; min 1, max 365
  minimizationAxis: 'gross' | 'net'         // default: 'gross' (B2C EU); use 'net' for B2B channels
  defaultPresentedPriceKindId: string       // UUID — used when no channel override matches
  channels: Record<string, {               // per-channel overrides (channel id as key)
    presentedPriceKindId: string           // MUST be a valid CatalogPriceKind UUID
    lookbackDays?: number                  // overrides global lookbackDays for this channel
    minimizationAxis?: 'gross' | 'net'    // overrides global axis for this channel
  }>
}
```

**Validation rules (enforced by Zod schema on PATCH):**
- `channels[*].presentedPriceKindId` must be a valid UUID (existence checked against `CatalogPriceKind` at save time)
- `defaultPresentedPriceKindId` must be a valid `CatalogPriceKind` UUID
- `lookbackDays` and per-channel `lookbackDays` are integers in [1, 365]
- `minimizationAxis` defaults to `'gross'` if omitted

History is captured for **all** price kinds, regardless of config. The presented kind config controls only which kind's history is queried for the Omnibus reference — not what gets recorded.

---

## API Contracts

**Timestamp convention (applies to all endpoints in this spec):**
All timestamps (`recorded_at`, `windowStart`, `windowEnd`, `from`, `to`) are **UTC ISO 8601** strings (e.g. `"2025-01-19T00:00:00.000Z"`). The application layer is the authoritative source for `now()` — DB server time is not used for window computation to ensure consistency across replicas and time zones. Backfill records use `recorded_at = windowStart - 1ms` (ε), where `windowStart` is computed at the time the CLI command runs.

### Extended: Price Resolution Response

All existing price resolution endpoints that return a `pricing` block are extended with an optional `omnibus` block when Omnibus is enabled for the organization:

```json
{
  "pricing": { "...": "resolved price row" },
  "omnibus": {
    "presentedPriceKindId": "uuid-regular",
    "lookbackDays": 30,
    "minimizationAxis": "gross",
    "windowStart": "2025-01-19T00:00:00.000Z",
    "windowEnd": "2025-02-18T00:00:00.000Z",
    "lowestPriceNet": "99.00",
    "lowestPriceGross": "121.77",
    "previousPriceNet": "119.00",
    "previousPriceGross": "146.37",
    "currencyCode": "EUR",
    "applicable": true,
    "applicabilityReason": "price_reduction"
  }
}
```

**Field semantics:**

| Field | Type | Description |
|-------|------|-------------|
| `windowStart` | ISO timestamp | `now() - lookbackDays`; start of the evaluated period |
| `windowEnd` | ISO timestamp | `now()`; end of the evaluated period (server time at resolution) |
| `minimizationAxis` | `'gross' \| 'net'` | Which axis was used to select the lowest row |
| `lowestPriceNet` | string (decimal) | Net price from the single history row with the lowest axis value in the window+baseline candidate set |
| `lowestPriceGross` | string (decimal) | Gross price from that same row (consistent pair with `lowestPriceNet`) |
| `previousPriceNet` | string (decimal) \| null | Net price from the **baseline entry** (last history entry ≤ windowStart); represents the "price in effect at the start of the window"; `null` when no baseline exists |
| `previousPriceGross` | string (decimal) \| null | Gross price from the baseline entry (consistent pair) |
| `applicable` | boolean | `true` when Omnibus reference must be displayed; see applicability rules below |
| `applicabilityReason` | enum | Reason for `applicable` value; storefronts SHOULD suppress the block when `applicable = false` |

**`omnibus` field nullability:**
- `null` only when: Omnibus is disabled for the organization, or resolution throws unexpectedly (error logged server-side)
- When Omnibus is enabled and no data exists, return the block with `applicable = false` and `applicabilityReason: 'no_history'` — do NOT return `null`, so consumers can distinguish "disabled" from "enabled but no data"

**Applicability rule:**

```
applicable =
  (presentedPriceKind.isPromotion === true)
  OR
  (previousPriceGross !== null AND presentedGross < previousPriceGross)
```

- **`isPromotion = true`**: the merchant explicitly flagged this price kind as promotional — the directive applies regardless of price comparison
- **`presentedGross < previousPriceGross`**: the current price is lower than the price in effect at the start of the lookback window — the directive applies

**Known limitation**: if a price went up then down within the window (e.g. 80→100→90), and the price kind is not flagged as promotional, `applicable` will be false (90 ≥ 80) even though the merchant is advertising a reduction from 100 to 90. Merchants in this scenario MUST mark the relevant price kind with `isPromotion = true` to ensure compliance. The admin UI SHOULD display a warning on non-promotional price kinds used in channel overrides: *"Prices of this kind may suppress Omnibus if the price was previously lower in the lookback window. Consider enabling the 'promotional' flag."* Full "immediate-previous-price" tracking is deferred to a future phase.

**`applicabilityReason` values:**
- `price_reduction`: applicable because `presentedGross < previousPriceGross`
- `is_promotion`: applicable because `presentedPriceKind.isPromotion = true`
- `no_reduction`: presented price ≥ previous price AND price kind is not promotional (`applicable = false`)
- `no_history`: no history entries found at all — cannot compute any reference (`applicable = false`)
- `insufficient_history`: baseline entry missing (no entry ≤ windowStart) but in-window entries exist; `lowestRow` IS populated (MIN over in-window entries); `previousRow` is set to the oldest in-window entry as best-effort fallback; `applicable` is still computed using this fallback `previousRow`. The `lookbackDays` field in the response still reflects the **configured** value (e.g. 30) — it does NOT reflect actual data coverage, which begins at `previousRow.recorded_at`. **Recommended storefront behavior**: display the Omnibus reference with a temporal qualifier, e.g. "Lowest price since {previousRow.recorded_at}" rather than "in last 30 days", to avoid a legally incorrect 30-day claim. Storefronts that cannot add a qualifier SHOULD suppress the block entirely when `applicabilityReason = 'insufficient_history'`

### GET /api/catalog/prices/history

Compliance export and audit endpoint.

**Request (Zod-validated query params):**

```ts
{
  productId?: string        // UUID
  variantId?: string        // UUID
  offerId?: string          // UUID
  priceKindId?: string      // UUID
  channelId?: string        // UUID
  currencyCode?: string     // ISO 4217
  changeType?: 'create' | 'update' | 'delete' | 'undo'
  from?: string             // ISO 8601 UTC date-time (inclusive, e.g. "2025-01-01T00:00:00Z")
  to?: string               // ISO 8601 UTC date-time (inclusive)
  pageSize?: number         // max 100, default 50
  cursor?: string           // keyset cursor (opaque, based on recorded_at + id)
  includeTotal?: boolean    // default false; triggers COUNT query — use only for compliance exports, not real-time UI
}
```

**Response:**

```json
{
  "items": [CatalogPriceHistoryEntry],
  "nextCursor": "string | null"
}
```

When `includeTotal=true`:
```json
{
  "items": [CatalogPriceHistoryEntry],
  "nextCursor": "string | null",
  "total": number
}
```

`total` is omitted by default because a `COUNT(*)` over a filtered time-range on a large history table is expensive. Real-time admin UI uses keyset pagination without total; compliance exports request `includeTotal=true` explicitly.

Requires feature: `catalog.price_history.view`.
Must export `openApi`.

### GET /api/catalog/prices/omnibus-preview

Lightweight Omnibus resolution for the admin price editor. Runs the `getLowestPrice` baseline+window algorithm for a specific scope without returning raw history entries.

**Request (Zod-validated query params):**

```ts
{
  productId?: string     // at least one of productId/variantId/offerId required
  variantId?: string
  offerId?: string
  priceKindId: string    // required
  currencyCode: string   // required, ISO 4217
  channelId?: string
}
```

**Response:** same shape as the `omnibus` block in the pricing response.
- `null` only when Omnibus is disabled for the organization or an unexpected exception occurs (logged server-side)
- When enabled but no history data found: returns the block with `applicable: false` and `applicabilityReason: 'no_history'` — NOT `null` (consistent with the main pricing endpoint behavior)

Requires feature: `catalog.price_history.view`. Must export `openApi`.

### GET /api/catalog/config/omnibus

Returns current Omnibus config for the organization. Requires `catalog.settings.view`.

### PATCH /api/catalog/config/omnibus

Updates Omnibus config. Body: partial `OmnibusConfig`. Requires `catalog.settings.edit`.

---

## Internationalization (i18n)

New keys in the catalog locale file:

| Key | Default (en) |
|-----|-------------|
| `catalog.omnibus.settings.title` | "Omnibus Price Tracking" |
| `catalog.omnibus.settings.enabled` | "Enable Omnibus compliance" |
| `catalog.omnibus.settings.lookbackDays` | "Lookback window (days)" |
| `catalog.omnibus.settings.presentedPriceKind` | "Default presented price kind" |
| `catalog.omnibus.settings.channelOverrides` | "Per-channel overrides" |
| `catalog.omnibus.priceEditor.lowestPriceLabel` | "Lowest price in last {days} days" |
| `catalog.omnibus.priceEditor.noHistory` | "No price history recorded yet" |
| `catalog.omnibus.priceEditor.coldStart` | "Omnibus data available from {date}" |

---

## UI/UX

### Omnibus Settings Panel (Admin)

Location: catalog configuration page → "Omnibus" tab

- Toggle: Enable Omnibus compliance
- Number input: Lookback days (default 30, min 1, max 365)
- Select: Default presented price kind (dropdown of active `CatalogPriceKind` records)
- Table: Per-channel overrides — channel name, presented price kind override, lookback days override; inline add/remove rows

Form uses `CrudForm`. Save via `PATCH /api/catalog/config/omnibus`. `Cmd/Ctrl+Enter` submits.

### Price Editor Enhancement (Admin)

When editing a `CatalogProductPrice`, if Omnibus is enabled for the organization:

- Below the price input fields, render a read-only info row: _"Lowest price in last 30 days: €99.00"_
- Data loaded from `GET /api/catalog/prices/omnibus-preview?productId=&variantId=&offerId=&priceKindId=&channelId=&currencyCode=` — a dedicated lightweight endpoint that runs the baseline+window query and returns the resolved `omnibus` block without requiring the caller to paginate through history entries
- Shows `LoadingMessage` while fetching, `catalog.omnibus.priceEditor.noHistory` if `applicabilityReason = 'no_history'`

**Why not `/prices/history`**: the history list endpoint returns raw entries; the UI would need to paginate through potentially many pages to find the minimum — which is expensive and fragile. The preview endpoint runs the same `getLowestPrice` service method used for pricing resolution.

**Channel context in the price editor**: when the price being edited is scoped to a specific channel (i.e. `CatalogProductPrice.channelId` is set), the price editor MUST pass `channelId` in the preview request. When `channelId` is absent from the price row, the editor calls the endpoint without `channelId` (no-channel mode) and SHOULD label the result as _"Across all channels"_ rather than implying it is channel-specific. This prevents channel-blended results from being presented as authoritative for a specific channel.

### Storefront

No backend-mandated UI copy or compliance wording. The `omnibus` block in the pricing API gives storefronts everything needed to render compliant displays per locale.

---

## Migration & Compatibility

- New table `catalog_price_history_entries` is purely additive — no existing tables modified.
- `omnibus` field in API responses is nullable — no breaking change for existing consumers.
- Undo behavior: history entries are never deleted. An `undo` operation appends a new row with `change_type = undo` and the state at the time of reversal.

**Backfill — mandatory for EU production deployments:**

Enabling Omnibus without a baseline history entry for existing prices means every lookback query returns `applicabilityReason: 'no_history'` for up to 30 days. For merchants already selling in EU markets, this is a legal compliance gap.

**The migration creates the table and indexes only. Backfill is a separate, mandatory CLI step run after migration:**

```
yarn omnibus:backfill [--organization-id <id>] [--batch-size 500]
```

For every current `CatalogProductPrice` row, the CLI inserts one `CatalogPriceHistoryEntry` with:
- `change_type = create`, `source = system`
- `recorded_at = windowStart - ε` where `ε = 1ms` and `windowStart = now() - lookbackDays` (computed at CLI run time) — deliberately placed **just before** `windowStart` so the entry immediately satisfies the baseline condition (`recorded_at ≤ windowStart`) from the first moment Omnibus is enabled. Using `now()` (current timestamp) would fail: the baseline query requires `recorded_at ≤ windowStart = now() - lookbackDays`, so a backfill entry recorded at `now()` would not be found as a baseline for the next 30 days, leaving `previousPrice* = null` and `applicable = false` for an entire lookback period.

The entry is still a valid baseline snapshot — it captures the price at the time of backfill, which is the current price, and is clearly labeled `source = system` for audit purposes.

**Why not inside the migration transaction**: migrations run in a single transaction and must complete quickly. Inserting baseline entries for >100k price rows inside a migration transaction holds table locks for minutes and blocks all catalog writes during that window. The CLI command runs outside a migration, in batches, with pauses between chunks to avoid I/O saturation.

**Deployment runbook for EU launches**:
1. `yarn db:migrate` — creates table + indexes
2. `yarn omnibus:backfill --batch-size 500` — seeds baseline per price row (can be run during low-traffic window)
3. Enable Omnibus in admin settings (`enabled: true`)

Step 3 MUST NOT happen before step 2 completes; admin UI should prevent enabling Omnibus when `backfillCompletedAt` is null (a field set by the CLI on the config record).

Tenants that opt in to Omnibus *after* going live will have a natural cold-start gap equal to the time since the first post-launch price change. The admin UI must display `catalog.omnibus.priceEditor.coldStart` with the earliest `recorded_at` for each price kind until the full lookback window is covered.

**Increasing `lookbackDays` after initial backfill**: if a merchant increases the configured `lookbackDays` (e.g. from 30 to 60), the new `windowStart` will be further in the past. The existing backfill entry was recorded at `(original windowStart - ε)` — it will be outside the new window and `insufficient_history` will be returned until enough organic history accumulates or `yarn omnibus:backfill` is re-run with the new `lookbackDays` value. The admin UI SHOULD warn when `lookbackDays` is increased: *"Existing coverage may be insufficient for the new window; consider rerunning backfill."*

---

## Implementation Plan

### Phase 1: History Foundation

Goal: every price change is durably recorded; history is queryable via API.

1. Define `CatalogPriceHistoryEntry` ORM entity in `data/entities.ts`
2. Add Zod validation schemas (history entry, OmnibusConfig) in `data/validators.ts`
3. Create `lib/omnibus.ts` with:
   - `buildHistoryEntry(price, changeType, source, metadata?)` — constructs entity from price snapshot
   - `recordPriceHistoryEntry(em, price, changeType, source)` — persists via the passed `EntityManager` (same transaction as price write)
4. Wire `recordPriceHistoryEntry` into `commands/prices.ts`: call after flush in `createPriceCommand`, `updatePriceCommand`, `deletePriceCommand`, and each undo handler
5. Run `yarn db:generate` to produce migration; add composite indexes explicitly in the migration file
6. Add `GET /api/catalog/prices/history` route with `openApi` export and `requireFeatures(['catalog.price_history.view'])`
7. Add `catalog.price_history.view` to `acl.ts`; declare in `defaultRoleFeatures` in `setup.ts`
8. Unit tests: history insert on create / update / delete / undo; scoping (organization_id, tenant_id); immutability (no update path)
9. Integration tests: price create → history entry exists; price delete → entry with `change_type = delete`; GET /api/catalog/prices/history returns correct entries

### Phase 2: Omnibus Resolution

Goal: API returns the Omnibus reference price alongside the presented price.

1. Create `services/catalogOmnibusService.ts`:
   - `getConfig(organizationId)` — reads from `module-config-service` with `catalog.omnibus` key
   - `getLowestPrice(em, filter)` — **baseline + window algorithm**:
     ```
     windowStart = now() - lookbackDays
     windowEnd   = now()
     axis        = config.minimizationAxis ?? 'gross'   // 'gross' | 'net'
     priceField  = axis === 'gross' ? 'unit_price_gross' : 'unit_price_net'

     // Scope filter — deterministic, no OR, hits the correct index:
     // Priority: offerId → variantId → productId (exactly one branch executes)
     // IMPORTANT: lookup is strictly scope-specific; variant-scoped resolution
     // does NOT fall back to product-level history, even if no variant-level entries exist.
     // This is a deliberate business decision: a variant's price history is independent
     // of the product's price history. A caller that wants product-level Omnibus
     // must explicitly resolve at product scope.
     scopeFilter =
       if filter.offerId   → offer_id   = $offerId
       else if filter.variantId → variant_id = $variantId
       else                → product_id = $productId

     // Channel filter:
     //   context has channelId  → restrict to that channel (channel_id = $channelId)
     //   context has no channelId → no channel filter (include all entries, channel-scoped or not)
     //   rationale: restricting to IS NULL when no channelId causes silent no_history
     //              when the catalogue uses channel-scoped prices exclusively
     channelFilter =
       if filter.channelId → AND channel_id = $channelId
       else                → (no filter on channel_id)

     // Step 1: baseline — last entry recorded AT OR BEFORE windowStart
     //         represents the price in effect at window start
     baseline = SELECT * FROM catalog_price_history_entries
       WHERE tenant_id = $tenantId
         AND organization_id = $organizationId
         AND {scopeFilter}
         AND {channelFilter}
         AND price_kind_id = $priceKindId
         AND currency_code = $currencyCode
         AND recorded_at <= windowStart
       ORDER BY recorded_at DESC, id DESC   -- id DESC as tie-breaker for identical recorded_at
       LIMIT 1

     // Step 2: entries within the window
     inWindow = SELECT * FROM catalog_price_history_entries
       WHERE tenant_id = $tenantId
         AND organization_id = $organizationId
         AND {scopeFilter}
         AND {channelFilter}
         AND price_kind_id = $priceKindId
         AND currency_code = $currencyCode
         AND recorded_at > windowStart
         AND recorded_at <= windowEnd
       ORDER BY recorded_at DESC

     // Step 3: from the combined set {baseline} ∪ {inWindow},
     //         find the single row with the lowest value on the minimization axis.
     //         Return that row's full price fields to guarantee a consistent pair.
     candidates = [baseline, ...inWindow].filter(Boolean)
     lowestRow  = min_by(priceField, candidates)

     // Step 4: previousRow = baseline (price in effect at window start)
     //   Fallback: if no baseline exists but inWindow is not empty
     //   (backfill not run, or price was created inside the window and never existed before),
     //   use the oldest inWindow entry as previousRow and signal insufficient_history.
     //   This prevents a hard null when data exists but coverage is incomplete.
     if baseline:
       previousRow          = baseline
       insufficientHistory  = false
     else if inWindow is not empty:
       // "oldest" = separate query: SELECT * ... ORDER BY recorded_at ASC, id ASC LIMIT 1
       // Do NOT derive by reversing the DESC list — use an explicit ASC query for clarity.
       previousRow          = first(inWindow ordered by recorded_at ASC, id ASC)
       insufficientHistory  = true
     else:
       previousRow          = null
       insufficientHistory  = false            // → no_history
     ```
     Returns `{ lowestRow, previousRow, insufficientHistory }`:
     - `lowestRow = null` → `applicabilityReason: 'no_history'`
     - `lowestRow` present + `insufficientHistory = true` → `applicabilityReason` may be `'insufficient_history'` (applicable computed but coverage incomplete — storefront can decide whether to display with a caveat)
     - `lowestRow` present + `insufficientHistory = false` → normal path
   - `resolveOmnibus(em, context, priceRows)` — calls `catalogPricingService` for presented price, then `getLowestPrice`; computes `applicable` per applicability rule (see API Contracts); returns full block or `null`
2. Register in `di.ts` under token `catalogOmnibusService`
3. Extend pricing response builder to include `omnibus` block (call service; guard with `enabled` flag)
4. **Channel scope**: apply `channel_id = $channelId` only when `context.channelId` is present; otherwise apply no channel filter. Rationale: admin/import/job contexts often resolve without a channel — restricting to `IS NULL` would cause `no_history` for catalogues where all prices are channel-scoped. In the no-channel case the result is best-effort and may blend entries from multiple channels (see performance note in Data Models → indexes).
5. Add short-TTL (5-minute) tenant-scoped cache for `getLowestPrice` results. Cache key:
   ```
   (tenantId, organizationId, scopeKey, channelId|null, priceKindId, currencyCode, axis, windowStartDay)
   ```
   where `windowStartDay = floorToDay(windowStart, UTC)` — a `YYYY-MM-DD` UTC date string (e.g. `"2025-01-19"`),
   and `scopeKey` is built deterministically from the resolved scope level:
   - `"offer:<offerId>"` — when `filter.offerId` is set
   - `"variant:<variantId>"` — when `filter.variantId` is set (and no offerId)
   - `"product:<productId>"` — otherwise

   **Why floor to day, not exact timestamp**: `windowStart = now() - lookbackDays` changes every second, making the exact value a unique key per request and reducing cache hit rate to effectively zero. For a 30-day lookback window, the reference day is what matters; results computed on the same UTC day are equivalent. The 5-minute TTL handles intra-day price changes. Invalidate the cache on any history entry creation for the same `(tenantId, organizationId, scopeKey, channelId, priceKindId, currencyCode)` — tag: `omnibus:{tenantId}:{organizationId}:{scopeKey}:{channelId}:{priceKindId}:{currencyCode}`
6. Unit tests:
   - Stable price (baseline before window, no in-window entries) → `lowestRow = baseline`, `previousRow = baseline`
   - Multiple in-window entries → row with lowest axis value selected; net from same row
   - No baseline, no window entries → both null → `no_history`
   - Channel-scoped context (`channelId` set) → only matching channel entries included
   - No `channelId` in context → no channel filter; entries from all channels included
   - `isPromotion = true` on price kind → `applicable = true` regardless of price comparison; reason `is_promotion`
   - Price kind not promotional AND `presentedGross < previousPriceGross` → `applicable = true`, reason `price_reduction`
   - Price kind not promotional AND `presentedGross ≥ previousPriceGross` → `applicable = false`, reason `no_reduction`
   - 80→100→90 sequence, `isPromotion = false`: baseline = 80, presented = 90, `90 ≥ 80` → `applicable = false`, reason `no_reduction` (documented known limitation, not a bug)
   - 80→100→90 sequence, `isPromotion = true`: baseline = 80, presented = 90 → `applicable = true`, reason `is_promotion` ✓
   - No baseline (backfill not run), in-window entries exist → `applicabilityReason = 'insufficient_history'`; `previousRow` is oldest in-window entry
   - `minimizationAxis = 'net'` → selection by `unit_price_net`; returned pair still consistent from same row
7. Integration tests: `GET /api/catalog/products/:id/pricing` includes correct `omnibus` block after price history accumulates; `omnibus` is NOT `null` but contains `applicabilityReason: 'no_history'` when enabled and no history; stable-price-then-promotion returns correct `previousPriceGross` from backfill entry

### Phase 3: Admin UI

Goal: merchants configure Omnibus; price editors show live lowest-price reference.

1. Add `GET /api/catalog/config/omnibus` and `PATCH /api/catalog/config/omnibus` routes with `openApi`
2. Add `catalog.settings.view` and `catalog.settings.edit` guard requirements
3. Add "Omnibus" tab to catalog configuration backend page
4. Wire settings form using `CrudForm` — toggle, lookback days, default price kind selector, channel overrides table
5. Add `GET /api/catalog/prices/omnibus-preview` route with `openApi`; reuses `catalogOmnibusService.getLowestPrice`
6. Add read-only Omnibus info row to the price editor backend component (fetch from `/omnibus-preview`)
7. Add i18n keys to catalog locale file
8. Integration tests: save settings → config persists; price editor shows correct `lowestPriceGross` from preview endpoint

### Phase 4: Storefront & Order Line Snapshot (Future — Separate Spec)

Deferred:
- Pass `omnibus` block through storefront-facing pricing API endpoints
- Store `omnibusReferenceNet`/`omnibusReferenceGross` on order/quote line snapshots at order creation time (requires sales module change)

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/catalog/data/entities.ts` | Modify | Add `CatalogPriceHistoryEntry` ORM entity |
| `packages/core/src/modules/catalog/data/validators.ts` | Modify | Add history entry + OmnibusConfig Zod schemas |
| `packages/core/src/modules/catalog/lib/omnibus.ts` | Create | `buildHistoryEntry`, `recordPriceHistoryEntry`, `getLowestPrice` |
| `packages/core/src/modules/catalog/commands/prices.ts` | Modify | Wire history capture into create/update/delete/undo handlers |
| `packages/core/src/modules/catalog/services/catalogOmnibusService.ts` | Create | Omnibus resolution service |
| `packages/core/src/modules/catalog/di.ts` | Modify | Register `catalogOmnibusService` |
| `packages/core/src/modules/catalog/acl.ts` | Modify | Add `catalog.price_history.view` feature |
| `packages/core/src/modules/catalog/setup.ts` | Modify | Declare `catalog.price_history.view` in `defaultRoleFeatures` |
| `packages/core/src/modules/catalog/api/get/catalog/prices/history.ts` | Create | History list endpoint |
| `packages/core/src/modules/catalog/api/get/catalog/prices/omnibus-preview.ts` | Create | Lightweight Omnibus resolution for price editor UI |
| `packages/core/src/modules/catalog/api/get/catalog/config/omnibus.ts` | Create | Config read endpoint |
| `packages/core/src/modules/catalog/api/patch/catalog/config/omnibus.ts` | Create | Config write endpoint |
| `packages/core/src/modules/catalog/backend/catalog/config/omnibus.tsx` | Create | Omnibus settings UI tab |
| `packages/core/src/modules/catalog/cli.ts` | Modify | Add `omnibus:backfill` CLI command |

### Testing Strategy

- Unit: `lib/omnibus.ts` baseline+window algorithm:
  - Stable price (baseline before window, no in-window entries) → baseline row returned as lowest
  - Multiple in-window entries → row with lowest `unit_price_gross` returned; net from same row
  - No baseline + no window entries → `no_history`
  - Channel-scoped context → only `channel_id`-matching rows included
  - `applicable` computation: `(isPromotion === true) OR (presentedGross < previousPriceGross)` → `price_reduction` or `is_promotion`; neither condition met → `no_reduction`
- Unit: `catalogOmnibusService.resolveOmnibus` — enabled/disabled/no-history/channel-override paths
- Unit: price command handlers produce correct history entry shape on create/update/delete/undo; `tenant_id` and `organization_id` always populated
- Integration: `POST /api/catalog/prices` → `GET /api/catalog/prices/history` returns entry with correct `change_type`
- Integration: stable price + promotional update → `omnibus.applicable = true`, `lowestPriceGross` reflects the stable price (baseline), not the promo price
- Integration: `GET /api/catalog/prices/history` with `includeTotal=true` returns `total`; without it, `total` is absent
- Integration: two organizations — history from org A not visible in org B's `/prices/history` response
- Integration: `PATCH /api/catalog/config/omnibus` persists config; subsequent resolution reflects new lookback window and presented price kind

### Open Questions

- **Retention policy**: Target max table size and archival strategy (partition by month? move to cold storage after N days beyond lookback window?). Must be decided before high-volume production deployments.
- **Immediate-previous-price tracking**: Full "did the price just decrease from its immediately preceding value?" requires a 3rd query (last entry before the latest one). Currently approximated via `isPromotion` flag + baseline comparison. Decide whether to implement in Phase 3.

---

## Risks & Impact Review

### Data Integrity Failures

#### Incorrect lowest price due to missing baseline

- **Scenario**: A price has been stable for 90 days with no changes. A promotion is applied today. The lookback window (30 days) contains only the new promotional entry — no prior entry exists in the window. `MIN` over window alone returns the promotional price itself, suppressing the Omnibus reference that the directive requires.
- **Severity**: Critical
- **Affected area**: Legal compliance — the directive is violated for all products with infrequently-changing prices (common for long-catalogue merchants)
- **Mitigation**: `getLowestPrice` ALWAYS fetches a baseline entry (`recorded_at ≤ windowStart ORDER BY DESC LIMIT 1`) and includes it in the candidate set alongside in-window entries. The mandatory CLI backfill before enabling Omnibus ensures baseline entries exist for all pre-existing prices.
- **Residual risk**: If both baseline and in-window sets are empty (price created after backfill, changed for first time within window), `no_history` is returned. This is a legitimate state surfaced clearly via `applicabilityReason`.

#### `applicable` false-negative when price went up then down within window

- **Scenario**: Price sequence: 80→100→90 promo. Baseline (≤ windowStart) = 80. In-window entries = [100, 90]. `lowestRow.gross = 80` (baseline). `previousPriceGross = 80` (baseline). `presentedGross = 90`. Check: `90 < 80 → false`. Price kind is not promotional. Result: `applicable = false` — but the merchant IS reducing from 100 to 90, so the directive applies.
- **Severity**: Medium
- **Affected area**: Legal compliance — Omnibus reference suppressed for a genuine promotional reduction when there was a lower historical price at the start of the window
- **Mitigation**: For this edge case, merchants MUST flag the price kind as `isPromotion = true`. The `isPromotion` check overrides the price-comparison gate and forces `applicable = true`. This is documented in the admin UI and in the "Known limitation" note on the omnibus response.
- **Residual risk**: Merchants who do not flag promotional price kinds correctly may be non-compliant for this specific edge case. Full "immediate-previous-price" tracking (comparing against the entry immediately before the current promotional entry, not the window-start baseline) is deferred to a future phase as it requires an additional query.

#### Inconsistent net/gross pair in response

- **Scenario**: Two history entries in the window have different tax rates (e.g. a tax-rate change occurred). Running `MIN(unit_price_net)` and `MIN(unit_price_gross)` independently selects different rows. The response shows net from entry A (low-tax era) and gross from entry B (high-price, high-tax era), producing a mathematically inconsistent pair.
- **Severity**: High
- **Affected area**: Storefront rendering — incorrect price display; potential legal exposure
- **Mitigation**: `getLowestPrice` identifies the single row with the lowest value on the configured `minimizationAxis` (default: `unit_price_gross`), then reads the complete price fields (`unit_price_net`, `unit_price_gross`, `tax_rate`, `tax_amount`) from **that same row**. Net and gross are always from the same record.
- **Residual risk**: When `minimizationAxis = 'gross'` on a B2B channel, the selected row minimizes gross but may not minimize net (if tax rates differ between entries). Merchants with variable-rate B2B channels should configure `minimizationAxis = 'net'` per-channel. When `minimizationAxis = 'net'`, the complementary gross field from the same row may not be the absolute lowest gross — but it is always consistent with that net, which is the correct pair.

#### History entry missing on crash

- **Scenario**: DB write succeeds for `CatalogProductPrice` but the server crashes before `CatalogPriceHistoryEntry` is committed; or vice versa.
- **Severity**: High
- **Affected area**: Omnibus compliance data; lookback MIN may return a stale or too-high reference price
- **Mitigation**: Both writes are flushed inside the same ORM `EntityManager` transaction in the command handler (single `flush` call after both entities are persisted). A crash before commit rolls back both.
- **Residual risk**: Acceptable — single-transaction guarantee is standard ORM practice.

#### Duplicate history entries on retry

- **Scenario**: A command is retried after a partial failure; a history entry is written twice for the same price event.
- **Severity**: Medium
- **Affected area**: The baseline+window algorithm selects a single candidate row per position, so a duplicate in-window entry does not affect `lowestRow` selection (MIN is idempotent). However, it may cause a `baseline` query to return the duplicate instead of the true original entry if both have identical `recorded_at`.
- **Mitigation**: History table is append-only by design; a duplicate row with the same `unit_price_gross` does not change the result. An idempotency key (hash of `price_id + change_type + truncate(recorded_at, second)`) can be added as a unique constraint in a follow-up if needed.
- **Residual risk**: Low — result correctness unaffected; idempotency constraint deferred.

#### History table unbounded growth

- **Scenario**: High-volume merchant changes prices hundreds of times per day; table grows to hundreds of millions of rows within a year.
- **Severity**: Medium
- **Affected area**: Lookback query performance; storage costs
- **Mitigation**: Composite indexes ensure lookback queries use index range scans (not full table scans). A retention policy is declared as future scope.
- **Residual risk**: No archival in Phase 1; storage grows linearly. Acceptable for MVP; must be addressed before large-scale production use.

### Cascading Failures & Side Effects

#### Omnibus block silently absent

- **Scenario**: `catalogOmnibusService` throws internally; API falls back to `omnibus: null` without surfacing the error.
- **Severity**: Medium
- **Affected area**: Storefront displays no Omnibus reference; merchant may be non-compliant
- **Mitigation**: `resolveOmnibus` wraps the lookback query in a try/catch and logs the error before returning `null`. Monitoring on null-rate for enabled tenants is flagged for Phase 2.
- **Residual risk**: Silent failure without alerting remains until observability is added.

### Tenant & Data Isolation Risks

#### Cross-tenant history leak

- **Scenario**: A history query omits the `organization_id` or `tenant_id` filter; entries from other tenants are exposed.
- **Severity**: Critical
- **Affected area**: Compliance data exposure; GDPR violation
- **Mitigation**: Every query in `lib/omnibus.ts` and all API route handlers require both `{ tenant_id, organization_id }` as mandatory non-optional filter arguments (function signature enforces this). All lookback indexes are prefixed with `(tenant_id, organization_id, ...)` so partial filters without `tenant_id` hit a different index path and are caught in query plan review.
- **Residual risk**: None if filter is consistently enforced and covered by integration tests.

#### Missing DB-level immutability enforcement

- **Scenario**: A future developer adds an update or delete path to `CatalogPriceHistoryEntry` (e.g. a data cleanup tool), bypassing the application-layer guarantee. History entries are silently modified, corrupting compliance records.
- **Severity**: High
- **Affected area**: Audit integrity; legal compliance
- **Mitigation**: Application layer has no `UPDATE`/`DELETE` code paths for this entity. Additionally: (a) the DB user used by the application runtime MUST be granted only `SELECT`, `INSERT` on `catalog_price_history_entries` — no `UPDATE` or `DELETE`; (b) a PostgreSQL `RULE` or trigger `BEFORE UPDATE OR DELETE` that raises an exception is recommended for production deployments as a second line of defence. This DB-level restriction must be applied as part of the migration or documented in the deployment runbook.
- **Residual risk**: Superuser/admin DB access can always bypass application constraints; covered by standard DB access control policy, not by this spec.

### Migration & Deployment Risks

#### Cold-start period with no history

- **Scenario**: After migration, all lookback queries return `applicabilityReason: 'no_history'` because no history predates the migration and no backfill was run. EU merchants are non-compliant during this period.
- **Severity**: High (for EU deployments), Low (for non-EU or new installations with no existing catalogue)
- **Affected area**: Omnibus compliance display is blank or suppressed for all existing products
- **Mitigation**: The mandatory CLI backfill step (see Migration & Compatibility section) seeds one baseline entry per existing price row before Omnibus is enabled. The `recorded_at` is set to `windowStart - ε (1 millisecond)` — strictly before `windowStart` — so the entry immediately satisfies the baseline condition (`recorded_at ≤ windowStart`) from the first moment Omnibus is active. Using the literal current timestamp would place the entry inside or after the window, causing baseline to return null for the entire lookback period.
- **Residual risk**: For tenants enabling Omnibus long after initial deployment (no backfill was run), the gap exists until manually backfilled with `yarn omnibus:backfill`. The admin UI shows the warm-up message until sufficient history accumulates.

#### Migration rollback

- **Scenario**: The new table migration needs to be rolled back.
- **Severity**: Low
- **Affected area**: New table only; all existing catalog tables are untouched
- **Mitigation**: Table is purely additive; rollback drops the new table cleanly.
- **Residual risk**: None.

---

## Final Compliance Report — 2026-02-18

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/cache/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | History entity in catalog; cross-entity refs use FK ids only |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | All history queries and API routes filter on `organization_id` |
| root AGENTS.md | Never expose cross-tenant data from API handlers | Compliant | Guards + explicit org/tenant scoping on all reads |
| root AGENTS.md | Validate all inputs with Zod | Compliant | Schemas added to `data/validators.ts` |
| root AGENTS.md | API routes MUST export `openApi` | Compliant | Declared for all three new routes |
| root AGENTS.md | `setup.ts` must declare `defaultRoleFeatures` | Compliant | `catalog.price_history.view` declared in `setup.ts` |
| root AGENTS.md | No `any` types | Compliant | All types derived from Zod via `z.infer` |
| root AGENTS.md | Never hand-write migrations | Compliant | `yarn db:generate` after entity change; indexes declared in migration |
| root AGENTS.md | `pageSize` at or below 100 | Compliant | History endpoint: default 50, max 100 |
| root AGENTS.md | Event IDs: `module.entity.action` singular past tense | Compliant | No new event IDs; existing `catalog.price.created/updated/deleted` referenced |
| catalog AGENTS.md | MUST NOT reimplement pricing logic | Compliant | `catalogOmnibusService` delegates to `catalogPricingService`; resolver pipeline untouched |
| catalog AGENTS.md | MUST use `catalogPricingService` DI token for price resolution | Compliant | `resolveOmnibus` resolves service via Awilix DI |
| catalog AGENTS.md | MUST register in `di.ts` | Compliant | `catalogOmnibusService` registered in `di.ts` |
| cache AGENTS.md | Tag-based invalidation, tenant-scoped | Partial | Phase 2 adds cache with tenant-scoped tags; Phase 1 queries DB directly |
| cache AGENTS.md | Every write path lists cache tag invalidations | Partial | Declared for Phase 2; history entry creation invalidates lookback cache |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `CatalogPriceHistoryEntry` shape matches GET /history response |
| API contracts match UI/UX section | Pass | Settings endpoints align with admin form; price editor uses history endpoint |
| Risks cover all write operations | Pass | Create/update/delete/undo all documented in risks section |
| Commands defined for all mutations | Pass | `recordPriceHistoryEntry` is internal helper; documented as non-user-facing |
| Cache strategy covers all read APIs | Partial | Phase 1 has no cache on lookback query; addressed in Phase 2 |

### Non-Compliant Items

- **Cache coverage gap (Phase 1)**: The `getLowestPrice` lookback query is a baseline+window query and runs uncached in Phase 1.
  - **Rule**: Read-heavy endpoints declare caching strategy (`packages/cache/AGENTS.md`)
  - **Source**: `packages/cache/AGENTS.md`
  - **Gap**: No cache layer on the internal lookback in Phase 1
  - **Recommendation**: Phase 2 adds a 5-minute tenant-scoped cache keyed on `(tenantId, organizationId, productId|variantId, channelId, priceKindId, currencyCode, windowStart)` with invalidation on any history entry creation for the same product+channel+kind. Must be in place before production rollout of the Omnibus resolution endpoint at scale.

### Verdict

**Partially compliant** — approved for Phase 1 implementation. Cache strategy declared as a mandatory Phase 2 deliverable before the Omnibus resolution endpoint is enabled for production traffic at scale.

---

## Changelog

### 2026-02-18 (rev 8) — final
- **`windowStartDay` format named explicitly**: cache key section now states `YYYY-MM-DD UTC date string` by name, not just by example; removes any ambiguity about locale or timezone formatting
- **No-channel best-effort note in step 4**: channel scope step now explicitly states that the no-channel result is best-effort and may blend channels, with a cross-reference to the performance note in the Data Models → indexes section

### 2026-02-18 (rev 7)
- **Backfill timestamp unified**: all occurrences of `now() - lookbackDays - 1 second` replaced with canonical form `windowStart - ε (ε = 1ms, windowStart = now() - lookbackDays)`; single definition in API Contracts preamble is now the sole source of truth
- **"Oldest inWindow" — explicit query direction**: algorithm now specifies `ORDER BY recorded_at ASC, id ASC LIMIT 1` as a separate query (not `last()` of a DESC list), removing implementation ambiguity
- **`scopeKey` format defined**: `"offer:<id>" | "variant:<id>" | "product:<id>"` — mirrors the deterministic scope selection logic; cache key and tag are now fully unambiguous

### 2026-02-18 (rev 6)
- **Cache key normalization**: `windowStart` (exact UTC timestamp, unique per second) replaced with `windowStartDay = floorToDay(windowStart, UTC)` — prevents cache key churn that would make the 5-minute TTL effectively useless; added cache tag format for invalidation
- **`recorded_at` — explicit application-layer timestamp**: entity description updated to clarify that `recorded_at` MUST be set by the application, never via DB-level default/trigger; prevents clock-skew drift between DB replicas and application when computing window boundaries
- **`insufficient_history` — `lookbackDays` semantics**: added note that `lookbackDays` in the response always reflects the configured value; actual data coverage begins at `previousRow.recorded_at`; storefront must use `previousRow.recorded_at` for the temporal qualifier, not `lookbackDays`
- **Deterministic scope — no product fallback**: added explicit comment in algorithm that variant-scoped lookup does NOT fall back to product-level history; this is a business decision, documented to prevent ambiguity during implementation
- **`ORDER BY id DESC` tie-breaker**: added to baseline query (`ORDER BY recorded_at DESC, id DESC`) and oldest-in-window fallback (`ASC, id ASC`) for deterministic result when multiple entries share the same `recorded_at`
- **`lookbackDays` change after backfill**: documented edge case in Migration section — increasing `lookbackDays` makes the backfill entry fall outside the new window, triggering `insufficient_history`; admin UI should warn and prompt to re-run backfill

### 2026-02-18 (rev 5)
- Added UTC timestamp convention note in API Contracts preamble; `from`/`to` params in `/prices/history` changed from "ISO date string" to "ISO 8601 UTC date-time"; `now()` explicitly defined as application-layer UTC, not DB server time
- Fixed `/omnibus-preview` response description: returns block with `applicabilityReason: 'no_history'` (not `null`) when enabled but no data — consistent with main pricing endpoint
- Clarified `insufficient_history` semantics: `lowestRow` IS populated (MIN over in-window entries); `previousRow` is oldest in-window entry as fallback; recommended storefront behavior documented (show with temporal qualifier "since {date}" or suppress if qualifier cannot be added)
- Fixed stale unit test assertion in Testing Strategy: "presented gross < lowest gross" corrected to `(isPromotion === true) OR (presentedGross < previousPriceGross)`
- Fixed cold-start risk: "recorded_at = migration timestamp" corrected to "recorded_at = windowStart − ε (1 ms)" with explicit explanation of why current-timestamp would break baseline for 30 days
- Index section: expanded `recorded_at DESC` note — clarified it primarily benefits baseline query; range scans are direction-agnostic; added UTC + application-layer `now()` rule
- UI/UX price editor: added requirement that `channelId` MUST be passed when editing a channel-scoped price; no-channel mode SHOULD label result as "Across all channels"

### 2026-02-18 (rev 4)
- **CRITICAL FIX — backfill timestamp**: changed `recorded_at = now()` to `recorded_at = windowStart - ε` (where `ε = 1ms`, `windowStart = now() - lookbackDays`); previous value caused baseline query (`recorded_at ≤ windowStart`) to find nothing for the first 30 days after backfill, leaving `previousPrice* = null` and `applicable = false` throughout the warmup period despite mandatory backfill having run
- Added `insufficient_history` applicability reason and fallback in `getLowestPrice`: when no baseline entry ≤ windowStart exists but in-window entries do, the oldest in-window entry is used as `previousRow` and `applicabilityReason = 'insufficient_history'` is returned; prevents hard null when data exists but coverage is incomplete
- Unified null vs no_history: `omnibus` is `null` only when disabled or on exception; when enabled + no data, returns block with `applicable = false` and `applicabilityReason: 'no_history'`; fixes inconsistency in `/omnibus-preview` description
- Added admin UI warning requirement for non-promotional price kinds used in channel overrides (applicable false-negative mitigation — merchants must see the `isPromotion` flag guidance)
- Added integration test for 80→100→90 scenario with `isPromotion = false` (expect `applicable = false`, `no_reduction`) and `isPromotion = true` (expect `applicable = true`, `is_promotion`) — documents the known limitation as an explicit, tested behavior
- Updated "Inconsistent net/gross pair" risk to reference `minimizationAxis` config; described per-axis residual risk correctly
- Added `recorded_at DESC` to all lookback index definitions; added performance note for "no channel filter" mode
- Fixed unit test assertions: replaced stale `presentedGross < lowestGross` with actual applicability rule (`isPromotion OR presentedGross < previousPriceGross`)

### 2026-02-18 (rev 3)
- Fixed channel scope rule: "no channelId → IS NULL" replaced with "no channelId → no channel filter"; prevents silent `no_history` in channel-scoped catalogues accessed without a channel context
- Fixed `getLowestPrice` SQL: removed `OR (product_id = X OR variant_id = Y)` — scope selection is now deterministic (offerId → variant_id → product_id), one branch only, preserving index selectivity
- Added `minimizationAxis: 'gross' | 'net'` to OmnibusConfig (global + per-channel); default `'gross'`; removes B2B net-axis as an open question
- Added `previousPriceNet` / `previousPriceGross` to omnibus API response block (from baseline entry); storefronts can now display "was €X" without a separate query
- Fixed `applicable` semantics: replaced `presentedGross < lowestGross` (incorrect — suppresses Omnibus for genuine promotions) with `isPromotion || presentedGross < previousPriceGross`; documented known false-negative edge case (80→100→90) and mitigation via `isPromotion` flag
- Added `applicabilityReason: 'is_promotion'` for the new gate; updated risk section with `applicable` false-negative scenario
- Separated backfill from migration: migration creates table+indexes only; backfill is a separate `yarn omnibus:backfill` CLI step; added `backfillCompletedAt` guard to prevent enabling Omnibus before backfill completes
- Added `GET /api/catalog/prices/omnibus-preview` endpoint for admin price editor (was: fetching raw `/prices/history` and computing client-side); added to API contracts and file manifest
- Updated Phase 3 to wire price editor info row to the new `/omnibus-preview` endpoint
- Updated duplicate-entry risk: removed stale `recordCount` reference; documented impact on baseline query
- Closed minimizationAxis open question (now in config); remaining open question: immediate-previous-price tracking

### 2026-02-18 (rev 2)
- Fixed `getLowestPrice` algorithm: replaced plain `MIN(recorded_at in window)` with baseline+window approach — fetches last entry ≤ windowStart as baseline, then takes MIN across {baseline} ∪ {inWindow}; eliminates incorrect null for stable prices
- Fixed MIN consistency: net/gross pair now always returned from the single row with lowest `unit_price_gross` (was: independent `MIN(net)` + `MIN(gross)` could combine different rows)
- Added `applicable` and `applicabilityReason` fields to omnibus response block; storefronts must not show Omnibus reference when `applicable = false`
- Renamed `asOf` → `windowStart` + `windowEnd` (explicit ISO timestamps for both window boundaries)
- Added channel scope rule: lookback always filters `channel_id` matching the resolution context; added channel-scoped composite indexes
- Made backfill mandatory for EU deployments (was: optional open question); added `yarn omnibus:backfill` CLI command to file manifest; updated cold-start risk severity to High for EU
- Simplified OmnibusConfig: removed ambiguous `presentedPriceKindIds[]` array; single source of truth is `defaultPresentedPriceKindId` + per-channel override map
- Added DB-level immutability risk: application runtime DB user must be granted only INSERT/SELECT on `catalog_price_history_entries`; trigger recommended as second line of defence
- Replaced `total` (always returned) with `includeTotal?: boolean` query param; `total` omitted by default to avoid expensive COUNT on large history tables
- All lookback indexes now prefixed with `(tenant_id, organization_id, ...)` to match mandatory dual-column isolation filter
- Expanded testing strategy with baseline, channel-scope, cross-org isolation, and `includeTotal` integration tests
- Remaining open questions: retention policy; B2B net vs. gross minimization axis

### 2026-02-18
- Initial specification
