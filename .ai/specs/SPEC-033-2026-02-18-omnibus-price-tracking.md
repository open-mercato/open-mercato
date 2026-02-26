# SPEC-033: Omnibus Price Tracking

## TLDR

**Key Points:**
- Append-only price history log in the catalog module, capturing every price mutation with full context and source attribution
- Omnibus resolution service computes the lowest presented price in a configurable lookback window (default: 30 days)
- EU Omnibus Directive compliance: exposes `omnibus.lowestPriceNet/Gross` alongside the resolved price in API responses, per channel
- Full seven-gap compliance coverage across five phases: history → resolution → admin UI → member-state extensions → storefront

**Scope:**
- `CatalogPriceHistoryEntry` entity + migration + composite indexes + `is_announced` + `idempotency_key`
- Capture helper wired into existing price commands (create, update, delete, undo) in the same DB transaction
- `catalogOmnibusService` for lookback MIN query + presented price resolution via existing `catalogPricingService`
- Omnibus config via `module-config-service` (lookback days, presented price kind per channel, per-market compliance rules)
- API: extend price resolution response with `omnibus` block + `isPersonalized` flag; add `GET /api/catalog/prices/history`
- Admin UI: Omnibus settings panel + lowest-price indicator in the price editor + per-market config
- Member-state compliance: progressive reductions, perishable goods exemption, new arrivals shorter lookback, per-market rule set

**Concerns:**
- History table grows without bound — retention/archival policy is deferred but must be planned before production scale
- Lookback queries span time ranges — composite indexes are mandatory, not optional
- Cold-start: for EU deployments, backfill of existing price rows is a **mandatory** pre-launch step, not optional
- Baseline gap: `MIN(recorded_at in window)` is incorrect — must also include the last entry before the window as "price in effect at window start"
- Channel scope: lookback must be filtered by `channel_id` when context has one; cross-channel MIN gives legally incorrect reference prices
- `MIN(net)` + `MIN(gross)` independently may combine values from different rows — must return both fields from the same record
- **Sliding window (Critical)**: `windowStart = now() - lookbackDays` shifts forward daily — for promotion-linked prices the window MUST be anchored to `starts_at` (the promotion's start date); `starts_at` is already captured in history entries and is used as the fixed `windowEnd` anchor in Phase 2
- **Tax-rate noise**: the `applicable` catch-all `presentedGross < previousPriceGross` incorrectly fires when only the tax rate changes (net price unchanged); resolved in Phase 2 by removing the gross-comparison trigger entirely
- **Silent repricing**: the directive applies only to *announced* price reductions; the gross-comparison catch-all triggers Omnibus for routine silent repricing — incorrect per Commission Guidance; Phase 2 restricts `applicable` to structurally-announced promotions only (promotion-linked via `starts_at`, `offer_id`, or `priceKind.isPromotion`)
- **EU-scope**: Omnibus is an EU-market obligation; global `enabled: true` over-triggers for non-EU channels; Phase 2 adds `enabledCountryCodes` config to gate resolution per channel/country
- Seven compliance gaps identified in external review (2026-02-19) — critical gaps addressed in Phase 2; medium/low gaps in Phase 3+; see **Compliance Gap Analysis** section

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
| `applicable` driven by promotion detection, not price comparison | The directive applies only to *announced* price reductions, not routine repricing. The previous `presentedGross < previousPriceGross` catch-all incorrectly fires on tax-rate-only changes (same net, different gross) and on silent repricings the directive does not cover. Phase 2 replaces it with structural promotion detection: `applicable = (entry.starts_at IS NOT NULL) OR (entry.offer_id IS NOT NULL) OR (priceKind.isPromotion === true)`. A tax-rate-only adjustment sets none of these; a promotional sale sets at least one. Merchants who do silent repricing without any promotional structure correctly get `applicable = false`. |
| Promotion detection via existing catalog structures, not a manual flag | `CatalogPriceKind.isPromotion`, `CatalogProductPrice.starts_at`, and `CatalogProductPrice.offer_id` are already present — and `starts_at` and `offer_id` are already snapshotted in history entries. No new columns needed. `isPromotion` on the price kind is retained as an explicit override fallback. |
| Anchored (frozen) window for promotion-linked prices | For promotions running >30 days, `windowStart = now() - lookbackDays` shifts forward daily and eventually excludes the pre-promotion baseline — legally incorrect (Commission Guidance: *"the reference price stays consistent until the end"*). Fix: when the presented price entry has `starts_at IS NOT NULL`, use `windowEnd = entry.starts_at` (fixed) and `windowStart = entry.starts_at - lookbackDays`. This field is already in every history entry. Falls back to `windowEnd = now()` (sliding) when `starts_at` is null. |
| EU country-scope via `enabledCountryCodes` config | Omnibus is an EU-market obligation. A global `enabled: true` runs resolution for all channels including non-EU. Phase 2 adds `enabledCountryCodes: string[]` (ISO 3166-1 alpha-2) to `OmnibusConfig`; each channel config gains an optional `countryCode` field. Resolution returns `not_in_eu_market` when the channel's country is not listed, skipping the lookback query. |
| `recorded_at` for window boundaries; `starts_at` for window anchor only | Window boundary queries (`recorded_at > windowStart AND recorded_at <= windowEnd`) always use `recorded_at` — never `starts_at`/`ends_at`. However, `starts_at` from the presented price history entry is used in Phase 2 as the **anchor** to compute `windowEnd` (i.e., to freeze the window at the promotion's start date rather than `now()`). This is a one-time computation at resolution time, not a row-level filter in the lookback query. Effective-date semantics for history entry validity (using `starts_at`/`ends_at` as range filters on the history table itself) remain deferred. |
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
| `is_announced` | boolean? | Phase 2: explicit announcement flag. Three-value semantics: `null` = legacy row written before Phase 2 migration (column did not exist; `buildHistoryEntry` did not populate it — treat the same as `false` in applicability checks); `false` = system evaluated at capture time and found no announcement signals (no `starts_at`, no `offer_id`, no `announce: true` param); `true` = announced reduction confirmed. **Auto-set to `true`** in `buildHistoryEntry` when `starts_at IS NOT NULL` or `offer_id IS NOT NULL` (structural signals). **Set to `true` via caller** when the price API receives `announce: true` in the request body (for merchants who announce reductions externally — email campaigns, paid ads — without catalog promotion structures). The `announce?: boolean` param is exposed on `POST /api/catalog/prices` and `PATCH /api/catalog/prices/:id`. When `announce` is absent/false and no structural signals exist, `is_announced` is stored as `false` (not `null`). |
| `idempotency_key` | string? | Phase 2: deterministic hash for deduplication on command retry. Hash formula: `sha256(price_id + '|' + change_type + '|' + recorded_at.toISOString())` where `recorded_at` carries **millisecond precision** (e.g. `"2025-01-19T12:34:56.789Z"`). Millisecond precision ensures two distinct writes in the same second produce different keys — avoids the collision case where `floor(recorded_at, second)` would alias two legitimately separate updates. The `recorded_at` value used in the hash is the same value stored in the row (set once by `buildHistoryEntry` at the start of the write, before hashing). UNIQUE constraint declared as a **partial unique index** on `(tenant_id, organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. On unique constraint violation: catch `UniqueViolationError`, treat as idempotent success (the entry already exists from the prior attempt); do not propagate the error. `null` when the calling context provides no command/request identifier (e.g. bulk import scripts). |
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
  enabled: boolean                          // default: false; master switch — still gated per-channel by enabledCountryCodes
  enabledCountryCodes: string[]             // ISO 3166-1 alpha-2 list (e.g. ['DE','FR','PL','IT','ES']).
                                            // SEMANTICS (canonical): empty array = Omnibus disabled for ALL channels (no country is EU-enabled);
                                            // non-empty = only channels whose countryCode is in this list are EU-enabled.
                                            // EU27 must be listed explicitly — 'EU' is not a valid entry.
  noChannelMode: 'best_effort' | 'require_channel'
                                            // default: 'best_effort'; when 'require_channel', resolution with no channelId returns
                                            // applicabilityReason: 'missing_channel_context' instead of blending all channels.
                                            // STOREFRONT ENFORCEMENT: EU storefront API handlers (identified by context.isStorefront = true)
                                            // MUST treat noChannelMode as 'require_channel' programmatically regardless of this config value.
                                            // This fails closed on EU paths if the admin accidentally leaves config as 'best_effort'.
                                            // config 'best_effort' only applies to non-storefront contexts (admin, internal API calls).
  lookbackDays: number                      // default: 30; min 1, max 365; directive minimum — states may require longer
  minimizationAxis: 'gross' | 'net'         // default: 'gross' (B2C EU); use 'net' for B2B channels
  defaultPresentedPriceKindId: string       // UUID — used when no channel override matches
  backfillCoverage: Record<string, {        // per-channel backfill status (key = channelId; '' = global/unscoped)
    completedAt: string                    // ISO 8601 UTC timestamp when backfill last ran for this channel
    lookbackDays: number                   // lookbackDays used during that backfill — alerts UI when config diverges
  }>
  channels: Record<string, {               // per-channel overrides AND per-market compliance rules (channel id as key)
    presentedPriceKindId: string           // MUST be a valid CatalogPriceKind UUID
    countryCode?: string                   // ISO 3166-1 alpha-2; maps channel to a country for enablement check;
                                           // if omitted and enabledCountryCodes is non-empty, this channel is treated as non-EU (no Omnibus)
    lookbackDays?: number                  // overrides global lookbackDays for this channel
    minimizationAxis?: 'gross' | 'net'    // overrides global axis for this channel
    // Phase 4 — Member State derogations (all optional, inherit global defaults when omitted):
    progressiveReductionRule?: boolean     // default false; enable Art. 6a(5) progressive-reduction derogation for this market
    perishableGoodsRule?: 'standard' | 'exempt' | 'last_price'
                                           // 'standard' = normal 30-day lookback (default)
                                           // 'exempt'   = no Omnibus obligation for perishable products (member-state may fully exempt)
                                           // 'last_price' = reference is the immediately preceding price, not rolling MIN
    perishableLookbackDays?: number        // only used when perishableGoodsRule = 'last_price' and a custom window is required
    newArrivalRule?: 'standard' | 'shorter_window'
                                           // 'standard' = full lookbackDays window (default)
                                           // 'shorter_window' = use newArrivalsLookbackDays for products on market < lookbackDays
    newArrivalsLookbackDays?: number | null // positive = shorter window in days; null = trader's discretion (use actual availability)
  }>
}
```

**Validation rules (enforced by Zod schema on PATCH):**
- `channels[*].presentedPriceKindId` must be a valid UUID (existence checked against `CatalogPriceKind` at save time)
- `defaultPresentedPriceKindId` must be a valid `CatalogPriceKind` UUID
- `lookbackDays` and per-channel `lookbackDays` are integers in [1, 365]
- `minimizationAxis` defaults to `'gross'` if omitted
- `enabledCountryCodes` entries must be valid ISO 3166-1 alpha-2 codes; `'EU'` is rejected (must list member states explicitly)
- `channels[*].countryCode` must be a valid ISO 3166-1 alpha-2 code if provided
- `channels[*].perishableLookbackDays` is a positive integer; only meaningful when `perishableGoodsRule = 'last_price'`
- `channels[*].newArrivalsLookbackDays` must be a positive integer or `null`; only meaningful when `newArrivalRule = 'shorter_window'`
- `noChannelMode` defaults to `'best_effort'` if omitted

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
  "isPersonalized": false,
  "personalizationReason": null,
  "omnibus": {
    "presentedPriceKindId": "uuid-regular",
    "lookbackDays": 30,
    "minimizationAxis": "gross",
    "promotionAnchorAt": "2025-03-01T00:00:00.000Z",
    "windowStart": "2025-01-30T00:00:00.000Z",
    "windowEnd": "2025-03-01T00:00:00.000Z",
    "coverageStartAt": null,
    "lowestPriceNet": "99.00",
    "lowestPriceGross": "121.77",
    "previousPriceNet": "119.00",
    "previousPriceGross": "146.37",
    "currencyCode": "EUR",
    "applicable": true,
    "applicabilityReason": "announced_promotion"
  }
}
```

**Field semantics:**

| Field | Type | Description |
|-------|------|-------------|
| `promotionAnchorAt` | ISO timestamp \| null | Frozen window anchor. Source priority: (1) `presentedPriceEntry.starts_at` if set; (2) `recorded_at` of the first history entry for the same `offer_id` when `starts_at` is null; (3) `null` = no anchor, sliding window applies. Storefronts may render this as "this offer started on {date}" |
| `windowStart` | ISO timestamp | Start of the evaluated lookback window. When `promotionAnchorAt` is set: `promotionAnchorAt - lookbackDays` (fixed). Otherwise: `now() - lookbackDays` (sliding). |
| `windowEnd` | ISO timestamp | End of the evaluated lookback window. When `promotionAnchorAt` is set: equals `promotionAnchorAt` (fixed, not `now()`). Otherwise: `now()`. |
| `coverageStartAt` | ISO timestamp \| null | Only non-null when `applicabilityReason = 'insufficient_history'`: the `recorded_at` of the oldest available history entry (`previousRow.recorded_at`). Storefronts MUST use this field to avoid claiming "lowest in 30 days" when actual coverage is shorter — render as "lowest price since {coverageStartAt}" instead. |
| `minimizationAxis` | `'gross' \| 'net'` | Which axis was used to select the lowest row |
| `lowestPriceNet` | string (decimal) | Net price from the single history row with the lowest axis value in the window+baseline candidate set |
| `lowestPriceGross` | string (decimal) | Gross price from that same row (consistent pair with `lowestPriceNet`) |
| `previousPriceNet` | string (decimal) \| null | Net price from the **baseline entry** (last history entry ≤ windowStart); represents the "price in effect at the start of the window"; `null` when no baseline exists |
| `previousPriceGross` | string (decimal) \| null | Gross price from the baseline entry (consistent pair) |
| `applicable` | boolean | `true` when Omnibus reference must be displayed; see applicability rules below |
| `applicabilityReason` | enum | Reason for `applicable` value; storefronts SHOULD suppress the block when `applicable = false` |

**Top-level pricing response fields (outside `omnibus` block):**

| Field | Type | Description |
|-------|------|-------------|
| `isPersonalized` | boolean | Phase 5: `true` when the resolved price was influenced by customer-specific rules. Triggers mandatory disclosure per Article 6(1)(ea) of the amended Consumer Rights Directive. |
| `personalizationReason` | string \| null | Phase 5: machine-readable reason for personalization. `null` when `isPersonalized = false`. See signal sources below. |

**Personalization signal sources** (evaluated in `catalogPricingService` at resolution time; first matching signal wins):

| Signal | `personalizationReason` value | Description |
|--------|-------------------------------|-------------|
| Customer-group price kind | `'customer_group'` | The resolved price kind is tagged as customer-group-specific (e.g. `CatalogPriceKind.scope = 'customer_group'`); price differs per customer group. |
| Loyalty tier price kind | `'loyalty_tier'` | The resolved price kind is tagged as a loyalty/membership tier benefit. |
| B2B negotiated / contract price | `'negotiated_price'` | The resolved price is linked to a specific B2B negotiated contract (e.g. via a customer-scoped `CatalogOffer`). |
| Rule-based / algorithmic pricing | `'algorithmic_rule'` | The resolved price was selected by a pricing rule engine that uses customer profile signals (purchase history, location, device). |

Detection is implemented in `catalogPricingService`: when `resolvePrice` selects a row, it inspects the price kind metadata and offer scope to determine whether personalization applies. The detection result is returned alongside the resolved price so `resolveOmnibus` can include it in the top-level response without a second resolution pass.

**Required tests (Phase 5):**
- Customer-group price kind resolved → `isPersonalized = true`, `personalizationReason = 'customer_group'`
- Standard list price resolved → `isPersonalized = false`, `personalizationReason = null`
- B2B negotiated offer resolved → `isPersonalized = true`, `personalizationReason = 'negotiated_price'`
- Non-personalized result → `catalog.pricing.personalizedDisclosure` i18n key NOT rendered on storefront

**`omnibus` field nullability:**
- `null` only when: Omnibus is disabled for the organization, or resolution throws unexpectedly (error logged server-side)
- When Omnibus is enabled and no data exists, return the block with `applicable = false` and `applicabilityReason: 'no_history'` — do NOT return `null`, so consumers can distinguish "disabled" from "enabled but no data"

**Applicability rule (Phase 2+):**

```
applicable =
  (presentedPriceEntry.starts_at IS NOT NULL)     // time-limited price = announced promotion (structural)
  OR (presentedPriceEntry.offer_id IS NOT NULL)   // offer-linked price = announced promotion (structural)
  OR (presentedPriceEntry.is_announced === true)  // explicitly-announced price change (Phase 2)
  OR (presentedPriceKind.isPromotion === true)    // price kind override — legacy fallback only
```

Per Commission Guidance (2021/C 526/02): *"Article 6a does not deal with, and does not restrict in any way, price fluctuations and price decreases that do not involve a price reduction announcement."* The directive applies only to **announced** reductions. The four conditions above are the signals that an announced reduction is in progress (priority order):

- **`starts_at IS NOT NULL`**: the price has a validity window start date — set up as a time-limited promotional price; also determines the window anchor
- **`offer_id IS NOT NULL`**: the price is linked to a `CatalogOffer` (promotional catalog offering); offer's first history entry also anchors the window when `starts_at` is absent
- **`is_announced = true`**: the price change was explicitly marked as an announced reduction at capture time — enables Omnibus for merchants who announce externally (email, ad campaigns) without using `starts_at` or offers; set via price API `announce: true` param
- **`priceKind.isPromotion === true`**: legacy override for price kinds not yet migrated to offer/announcement patterns; SHOULD be replaced by explicit `is_announced` or offer linkage in new integrations

**Why not compare net or gross prices**: a gross price comparison (`presentedGross < previousPriceGross`) incorrectly fires when only the tax rate changes (same net price, different gross). Removing the price-comparison trigger means tax-rate adjustments, market repricing, and other silent changes correctly produce `applicable = false`.

**`applicabilityReason` values:**
- `announced_promotion`: applicable because `starts_at IS NOT NULL`, `offer_id IS NOT NULL`, `is_announced = true`, or `priceKind.isPromotion = true` — the price is structurally identified as an announced promotional price
- `not_in_eu_market`: channel's `countryCode` is not in `enabledCountryCodes` — Omnibus resolution was skipped; `applicable = false`; storefronts in non-EU markets MUST suppress the block
- `missing_channel_context`: `noChannelMode = 'require_channel'` but no `channelId` was provided — Omnibus cannot be computed without a channel context; `applicable = false`; callers MUST pass `channelId` for compliant EU resolution
- `not_announced`: no structural promotion signals detected (`starts_at` null, `offer_id` null, `is_announced` null/false, `priceKind.isPromotion = false`) — the price change is treated as a silent repricing; `applicable = false`
- `perishable_exempt`: product/variant is exempt from Omnibus under the market's `perishableGoodsRule = 'exempt'` rule; `applicable = false`; storefront may render a market-specific explanation
- `perishable_last_price`: market `perishableGoodsRule = 'last_price'`; reference is the immediately preceding price (not rolling MIN); `lowestRow` = last price entry before this one; `applicable = true`
- `new_arrival_reduced_window`: product has been on market fewer than `lookbackDays` days; shorter lookback applied per `newArrivalRule = 'shorter_window'`; `applicable = true`; `lookbackDays` in response reflects the REDUCED window, not the configured global value; `coverageStartAt` reflects actual first entry
- `progressive_reduction_frozen`: price is part of a progressive campaign (Art. 6a(5) derogation); reference price frozen to pre-campaign baseline; `lowestRow` = lowest price before the first reduction in the campaign (not within-campaign sliding MIN); `applicable = true`
- `no_history`: no history entries found at all — cannot compute any reference (`applicable = false`)
- `insufficient_history`: baseline entry missing (no entry ≤ windowStart) but in-window entries exist; `lowestRow` IS populated (MIN over in-window entries); `previousRow` is the oldest in-window entry as best-effort fallback; `applicable` is computed using this fallback. `coverageStartAt` is set to `previousRow.recorded_at`. The `lookbackDays` field reflects the **configured** value — it does NOT reflect actual data coverage. **Storefronts MUST use `coverageStartAt`** to render "Lowest price since {date}" rather than "in last 30 days", to avoid a legally incorrect 30-day claim. Storefronts that cannot add a qualifier SHOULD suppress the block.

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
| `catalog.omnibus.settings.enabledCountryCodes` | "Active in EU markets" |
| `catalog.omnibus.settings.noChannelMode` | "Channels without context" |
| `catalog.omnibus.settings.noChannelMode.bestEffort` | "Best effort (blend all channels)" |
| `catalog.omnibus.settings.noChannelMode.requireChannel` | "Require channel (fail closed)" |
| `catalog.omnibus.settings.noPromotionSignalWarning` | "Prices of this kind will not trigger Omnibus unless the price has a start date, is linked to an offer, or this price kind has 'Promotional' enabled." |
| `catalog.omnibus.settings.backfillCoverage` | "Backfill coverage" |
| `catalog.omnibus.settings.backfillCoverageWarning` | "Lookback days increased since last backfill — consider rerunning backfill for channel {channel}." |
| `catalog.omnibus.settings.progressiveReductionRule` | "Progressive reduction rule (Art. 6a(5))" |
| `catalog.omnibus.settings.perishableGoodsRule` | "Perishable goods rule" |
| `catalog.omnibus.settings.newArrivalRule` | "New arrivals rule" |
| `catalog.omnibus.settings.newArrivalsLookbackDays` | "New arrival window (days)" |
| `catalog.omnibus.priceEditor.lowestPriceLabel` | "Lowest price in last {days} days" |
| `catalog.omnibus.priceEditor.lowestPriceSince` | "Lowest price since {date}" |
| `catalog.omnibus.priceEditor.anchoredWindow` | "Reference window anchored to promotion start: {date}" |
| `catalog.omnibus.priceEditor.noHistory` | "No price history recorded yet" |
| `catalog.omnibus.priceEditor.coldStart` | "Omnibus data available from {date}" |
| `catalog.omnibus.priceEditor.insufficientHistory` | "Coverage starts {date} — display as 'lowest since {date}', not 'lowest in 30 days'" |
| `catalog.omnibus.reason.perishableExempt` | "Exempt product — perishable goods rule applies" |
| `catalog.omnibus.reason.perishableLastPrice` | "Reference price: immediately preceding price (perishable goods rule)" |
| `catalog.omnibus.reason.newArrivalReducedWindow` | "New product — shorter lookback window applied ({days} days)" |
| `catalog.omnibus.reason.missingChannel` | "No channel context — Omnibus cannot be computed" |
| `catalog.pricing.personalizedDisclosure` | "This price is personalized based on your profile." |

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
yarn omnibus:backfill [--organization-id <id>] [--channel-id <id>] [--batch-size 500]
```

**Without `--channel-id`** (Phase 1): for every current `CatalogProductPrice` row the CLI inserts one `CatalogPriceHistoryEntry` with:
- `change_type = create`, `source = system`
- `recorded_at = windowStart - ε` where `ε = 1ms` and `windowStart = now() - lookbackDays` (computed at CLI run time)

**With `--channel-id`** (Phase 3+): only processes price rows scoped to that channel; uses the channel's configured `lookbackDays` (not the global default); writes `backfillCoverage[channelId] = { completedAt, lookbackDays }` to config on completion. When backfilling all channels (no `--channel-id`): iterates EU channels in `enabledCountryCodes`, runs each with its channel-specific `lookbackDays`, then backfills unscoped prices (where `channel_id IS NULL`) using `max(lookbackDays)` across all enabled channels.

**Important — unscoped prices are NOT EU compliance sources**: price rows with `channel_id IS NULL` are admin/import entries without channel context. Their backfill entries (key `''` in `backfillCoverage`) exist for completeness only. An EU storefront that resolves prices with `noChannelMode = 'require_channel'` (the mandatory EU mode) will never reach these entries. Merchants MUST ensure EU-visible prices have a `channel_id` and are covered by the per-channel backfill. The CLI SHOULD emit a warning when unscoped price rows exist for an organization that has EU channels enabled, reminding the operator to verify channel assignment.

The `recorded_at = windowStart - ε` placement is deliberate: strictly before `windowStart` ensures the entry satisfies the baseline condition (`recorded_at ≤ windowStart`) from the first moment Omnibus is enabled. Using `now()` would fail — the baseline query requires `recorded_at ≤ windowStart = now() - lookbackDays`, so an entry recorded at `now()` would not be found as a baseline for the next 30 days.

The entry is still a valid baseline snapshot — it captures the price at the time of backfill, clearly labeled `source = system` for audit purposes.

**Why not inside the migration transaction**: migrations run in a single transaction and must complete quickly. Inserting baseline entries for >100k price rows inside a migration transaction holds table locks for minutes and blocks all catalog writes during that window. The CLI command runs outside a migration, in batches, with pauses between chunks to avoid I/O saturation.

**Deployment runbook for EU launches**:
1. `yarn db:migrate` — creates table + indexes + DB immutability trigger
2. `yarn omnibus:backfill --batch-size 500` — seeds baseline per price row (can be run during low-traffic window); use `--channel-id` for per-channel lookback accuracy
3. Enable Omnibus in admin settings (`enabled: true`, `enabledCountryCodes: [...]`, `noChannelMode: 'require_channel'` for EU storefronts)

Step 3 MUST NOT happen before step 2 completes; admin UI reads `backfillCoverage` and blocks enabling Omnibus for a channel when that channel's `backfillCoverage` entry is missing.

Tenants that opt in to Omnibus *after* going live will have a natural cold-start gap equal to the time since the first post-launch price change. The admin UI must display `catalog.omnibus.priceEditor.coldStart` with the earliest `recorded_at` for each price kind until the full lookback window is covered.

**Increasing `lookbackDays` after initial backfill**: if a merchant increases the configured `lookbackDays` (e.g. from 30 to 60), the new `windowStart` will be further in the past. The existing backfill entry was recorded at `(original windowStart - ε)` — it will be outside the new window and `insufficient_history` will be returned until enough organic history accumulates or `yarn omnibus:backfill` is re-run with the new `lookbackDays` value. The admin UI detects this by comparing `channels[channelId].lookbackDays` to `backfillCoverage[channelId].lookbackDays` and SHOULD warn: *"Existing coverage may be insufficient for the new window; consider rerunning backfill."*

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
   - `getLowestPrice(em, filter, presentedPriceEntry)` — **baseline + window algorithm**:
     ```
     // EU country scope check (before any DB query):
     // enabledCountryCodes = [] → Omnibus disabled globally; return not_in_eu_market immediately.
     // enabledCountryCodes = [...] → only listed countries are EU-enabled; all others → not_in_eu_market.
     // A channel with no countryCode is always treated as non-EU when enabledCountryCodes is non-empty.
     channelConfig = config.channels[filter.channelId]
     countryCode   = channelConfig?.countryCode ?? null
     if config.enabledCountryCodes.length === 0
        OR countryCode is null
        OR countryCode not in config.enabledCountryCodes:
       return { lowestRow: null, previousRow: null, insufficientHistory: false,
                applicabilityReason: 'not_in_eu_market' }

     // No-channel mode check:
     // Storefront contexts (context.isStorefront = true) always enforce require_channel,
     // regardless of config.noChannelMode, to fail closed on legally regulated paths.
     if filter.channelId is null:
       effectiveMode = (context.isStorefront === true) ? 'require_channel' : (config.noChannelMode ?? 'best_effort')
       if effectiveMode === 'require_channel':
         return { lowestRow: null, previousRow: null, insufficientHistory: false,
                  applicabilityReason: 'missing_channel_context' }
       // else 'best_effort' → continue with no channel filter (all channels blended)

     // Window anchor (priority: starts_at → offer first-entry → null/sliding):
     // Directive requires the reference price to be fixed at the moment the promotion was
     // first applied — not computed fresh on each resolution call.
     if presentedPriceEntry.starts_at IS NOT NULL:
       promotionAnchorAt = presentedPriceEntry.starts_at         // explicit scheduled start
     else if presentedPriceEntry.offer_id IS NOT NULL:
       // Derive anchor from the first history entry for this offer (cached with main result).
       // This covers promotions that use offers but no starts_at, ensuring the window is
       // frozen to when the offer's pricing was first introduced, not today.
       // SCOPE FILTERS ARE MANDATORY: must match the exact resolution context to avoid
       // anchoring the window to a different channel's or currency's first-offer entry.
       firstOfferEntry = SELECT * FROM catalog_price_history_entries
         WHERE tenant_id      = $tenantId
           AND organization_id = $organizationId
           AND offer_id        = $presentedPriceEntry.offer_id
           AND price_kind_id   = $priceKindId        // same price kind as resolution context
           AND currency_code   = $currencyCode        // same currency as resolution context
           AND (                                      // same channel scope as resolution context:
                 ($channelId IS NOT NULL AND channel_id = $channelId)
                 OR ($channelId IS NULL AND channel_id IS NULL)
               )
         ORDER BY recorded_at ASC, id ASC LIMIT 1
       promotionAnchorAt = firstOfferEntry?.recorded_at ?? null
     else:
       promotionAnchorAt = null

     if promotionAnchorAt IS NOT NULL:
       windowEnd   = promotionAnchorAt                           // fixed anchor
       windowStart = windowEnd - lookbackDays                    // fixed
     else:
       windowEnd   = now()                                       // sliding (no promotion)
       windowStart = windowEnd - lookbackDays

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
     Returns `{ lowestRow, previousRow, insufficientHistory, promotionAnchorAt, applicabilityReason?, coverageStartAt }`:
     - `applicabilityReason: 'not_in_eu_market'` or `'missing_channel_context'` → skip rendering; `lowestRow = null`
     - `lowestRow = null` (and no early-exit reason) → `applicabilityReason: 'no_history'`
     - `lowestRow` present + `insufficientHistory = true` → `coverageStartAt = previousRow.recorded_at`; `applicabilityReason` may be `'insufficient_history'`
     - `lowestRow` present + `insufficientHistory = false` → `coverageStartAt = null`; normal path
   - `resolveOmnibus(em, context, priceRows)` — calls `catalogPricingService` for presented price, then `getLowestPrice`; computes `applicable` using promotion-detection rule: `applicable = presentedEntry.starts_at !== null || presentedEntry.offer_id !== null || presentedEntry.is_announced === true || presentedPriceKind.isPromotion === true`; returns full block (including `promotionAnchorAt`, `coverageStartAt`) or `null`
2. Register in `di.ts` under token `catalogOmnibusService`
3. Extend pricing response builder to include `omnibus` block (call service; guard with `enabled` flag)
4. **Channel scope + EU scope + noChannelMode**: apply `channel_id = $channelId` only when `context.channelId` is present. When absent, check `config.noChannelMode`: `'require_channel'` returns `missing_channel_context` immediately; `'best_effort'` (default) proceeds with no channel filter (blended result). Before any DB query, check `enabledCountryCodes` vs `channels[channelId].countryCode`; return `not_in_eu_market` when the check fails. When `enabledCountryCodes` is empty, return `not_in_eu_market` immediately for all channels (Omnibus is disabled globally — no country is EU-enabled). A channel with no `countryCode` is always treated as non-EU when the list is non-empty.
5. **Anchored window (extended)**: in `getLowestPrice`, derive `promotionAnchorAt` via priority chain: (1) `presentedPriceEntry.starts_at` if non-null; (2) `recorded_at` of the first history entry for `presentedPriceEntry.offer_id` (additional query, included in cache); (3) `null` → sliding window. When anchor is set: `windowEnd = promotionAnchorAt`, `windowStart = promotionAnchorAt - lookbackDays` (fixed for promotion lifetime).
6. **`is_announced` capture**: in `buildHistoryEntry`, auto-set `is_announced = true` when `starts_at IS NOT NULL || offer_id IS NOT NULL` (structural signals are sufficient). For explicit announcements, expose `announce?: boolean` parameter on the price create/update API; when `announce = true`, set `is_announced = true` in the captured entry. This enables Omnibus for merchants who announce externally (email, ad campaign) without catalog promotion structure.
7. **Idempotency key**: compute `idempotency_key = sha256(price_id + '|' + change_type + '|' + recorded_at.toISOString())` in `buildHistoryEntry`, where `recorded_at` carries **millisecond precision** (set once before hashing, same value stored in the row). Declare a **partial unique index** on `(tenant_id, organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL` in migration. When a duplicate insert is attempted (retried command), catch `UniqueViolationError` and treat as idempotent success — the entry already exists from the prior attempt. Two legitimate updates in the same second cannot collide because `recorded_at` carries ms precision.
8. Add short-TTL (5-minute) tenant-scoped cache for `getLowestPrice` results. Cache key:
   ```
   (tenantId, organizationId, scopeKey, channelId|null, priceKindId, currencyCode, axis, windowStartDay, anchorDay)
   ```
   where:
   - `windowStartDay = floorToDay(windowStart, UTC)` — a `YYYY-MM-DD` UTC date string (e.g. `"2025-01-19"`)
   - `anchorDay = promotionAnchorAt ? floorToDay(promotionAnchorAt, UTC) : 'none'` — separates anchored from sliding results with the same `windowStartDay`
   - `scopeKey` is built deterministically from the resolved scope level:
     - `"offer:<offerId>"` — when `filter.offerId` is set
     - `"variant:<variantId>"` — when `filter.variantId` is set (and no offerId)
     - `"product:<productId>"` — otherwise

   **Why `anchorDay` is required**: without it, two requests that compute the same `windowStartDay` via different paths (one sliding from `now()`, one frozen at `promotionAnchorAt`) would return the same cache entry even though they represent different legal windows. For example: a sliding window computing `windowStart = 2025-01-31` and a promotion anchored at `2025-03-02` producing the same `windowStart` would collide and serve a legally incorrect result. Adding `anchorDay` as a distinct cache dimension eliminates this class of collision entirely.

   **Why floor to day, not exact timestamp**: `windowStart = now() - lookbackDays` changes every second, making the exact value a unique key per request and reducing cache hit rate to effectively zero. For a 30-day lookback window, the reference day is what matters; results computed on the same UTC day are equivalent. The 5-minute TTL handles intra-day price changes.

   Invalidate the cache on any history entry creation for the same `(tenantId, organizationId, scopeKey, channelId, priceKindId, currencyCode)` — tag: `omnibus:{tenantId}:{organizationId}:{scopeKey}:{channelId}:{priceKindId}:{currencyCode}`

   **Cache key for anchored windows**: when `promotionAnchorAt` is set, `windowStartDay = floorToDay(promotionAnchorAt - lookbackDays)` (stable for promotion lifetime). **Cache includes the offer first-entry query**: the `firstOfferEntry` lookup is included as part of the cached payload to avoid a separate uncached query on every resolution.
9. Unit tests:
   - Stable price (baseline before window, no in-window entries) → `lowestRow = baseline`, `previousRow = baseline`
   - Multiple in-window entries → row with lowest axis value selected; net from same row
   - No baseline, no window entries → both null → `no_history`
   - Channel-scoped context (`channelId` set) → only matching channel entries included
   - No `channelId` in context → no channel filter; entries from all channels included
   - Channel country code not in `enabledCountryCodes` → `applicabilityReason = 'not_in_eu_market'`, no DB query
   - Channel country code in `enabledCountryCodes` → resolution proceeds normally
   - `enabledCountryCodes` empty → `applicabilityReason = 'not_in_eu_market'` for ALL channels; no DB query executed (Omnibus disabled globally)
   - `isPromotion = true` on price kind (no `starts_at`, no `offer_id`) → `applicable = true`, reason `announced_promotion`
   - `starts_at IS NOT NULL` on presented entry → `applicable = true`, reason `announced_promotion`; `promotionAnchorAt` set to `starts_at`
   - `offer_id IS NOT NULL` on presented entry → `applicable = true`, reason `announced_promotion`
   - All three null (`starts_at = null`, `offer_id = null`, `isPromotion = false`) → `applicable = false`, reason `not_announced`
   - Tax-rate change only (same net price, `starts_at = null`, `offer_id = null`, `isPromotion = false`) → `applicable = false`, reason `not_announced` (correct: not an announced reduction)
   - Promotion with `starts_at` set: window anchored to `starts_at`, not `now()` → `windowEnd = starts_at`, `windowStart = starts_at - lookbackDays`; oldest baseline entry before `starts_at` used as `previousRow`
   - Promotion running 45 days (`starts_at` 45 days ago): window still anchored to `starts_at` — reference price does NOT shift on day 40
   - Offer-linked price with no `starts_at`: `promotionAnchorAt` derived from first history entry for that `offer_id`; window frozen to that date
   - `is_announced = true`, no `starts_at`, no `offer_id`: `applicable = true`, reason `announced_promotion`
   - `noChannelMode = 'require_channel'`, no `channelId`: immediate `missing_channel_context`; no DB query
   - `noChannelMode = 'best_effort'`, no `channelId`: proceeds with blended channel result (existing behavior)
   - 80→100→90 sequence where 90 has `isPromotion = true`: `applicable = true`, reason `announced_promotion` ✓
   - No baseline (backfill not run), in-window entries exist → `applicabilityReason = 'insufficient_history'`; `coverageStartAt = previousRow.recorded_at`
   - Duplicate history entry insert (retry): unique constraint catches duplicate `idempotency_key`; treated as success; no duplicate entry created
   - `minimizationAxis = 'net'` → selection by `unit_price_net`; returned pair still consistent from same row
10. Integration tests: `GET /api/catalog/products/:id/pricing` includes correct `omnibus` block after price history accumulates; `omnibus` is NOT `null` but contains `applicabilityReason: 'no_history'` when enabled and no history; stable-price-then-promotion (with `starts_at`) returns correct `previousPriceGross` from backfill entry; promotion price (with `starts_at`) returns `promotionAnchorAt = starts_at`, `windowEnd = starts_at`; offer-linked price (no `starts_at`) returns `promotionAnchorAt = firstOfferEntry.recorded_at`; non-EU channel returns `not_in_eu_market`; `require_channel` mode without channelId returns `missing_channel_context`; tax-rate-only change returns `applicable: false`, `applicabilityReason: 'not_announced'`; `insufficient_history` result includes non-null `coverageStartAt`

### Phase 3: Admin UI + Backfill + DB Hardening

Goal: merchants configure Omnibus; price editors show live lowest-price reference; DB-level immutability enforced; backfill is per-channel accurate.

1. Add `GET /api/catalog/config/omnibus` and `PATCH /api/catalog/config/omnibus` routes with `openApi`
2. Add `catalog.settings.view` and `catalog.settings.edit` guard requirements
3. Add "Omnibus" tab to catalog configuration backend page
4. Wire settings form using `CrudForm` — toggle, lookback days, default price kind selector, EU country codes multi-select (tag input; auto-populated with EU27 countries), no-channel mode selector, channel overrides table (each row includes: channel name, presented price kind override, country code input, lookback days override)
5. Add `GET /api/catalog/prices/omnibus-preview` route with `openApi`; reuses `catalogOmnibusService.getLowestPrice`
6. Add read-only Omnibus info row to the price editor backend component (fetch from `/omnibus-preview`); display `coverageStartAt` warning when `applicabilityReason = 'insufficient_history'`
7. Add i18n keys to catalog locale file
8. **DB-level immutability (G)**: hand-append the following DDL to the Phase 1 migration file after the generated `CREATE TABLE` block. This is an explicit exception to the "never hand-write migrations" rule (same precedent as composite indexes). Mark the block with `-- MANUAL DDL: immutability trigger and role restriction`.
   ```sql
   -- MANUAL DDL: immutability trigger (not generated by MikroORM)
   CREATE FUNCTION prevent_history_modification()
   RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION 'catalog_price_history_entries is immutable';
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER history_immutable
     BEFORE UPDATE OR DELETE
     ON catalog_price_history_entries
     FOR EACH ROW EXECUTE FUNCTION prevent_history_modification();

   -- Runtime DB role: restrict to SELECT + INSERT only (apply to the app DB role, not superuser)
   -- REVOKE UPDATE, DELETE ON catalog_price_history_entries FROM app_role;
   ```
   The `REVOKE` line is a deployment runbook step, not migration DDL (it must reference the correct role name for the environment). Document in the deployment runbook: the application DB role must have `INSERT, SELECT` only on `catalog_price_history_entries`.
9. **Per-channel backfill (E)**: update `omnibus:backfill` CLI:
   - Add `--channel-id` param: when provided, backfill only that channel's scoped price rows using that channel's configured `lookbackDays`
   - Without `--channel-id`: iterate all enabled EU channels (from `enabledCountryCodes` intersection with `channels[*].countryCode`), run per-channel backfill using each channel's `lookbackDays`; also backfill unscoped prices using `max(lookbackDays)` across all enabled channels
   - After completing each channel, write `backfillCoverage[channelId] = { completedAt: now(), lookbackDays: usedLookbackDays }` to config; admin UI reads `backfillCoverage` to display per-channel status and warn when `config.lookbackDays` has been increased since last backfill
10. **Admin UI backfill gate (Task 4)**: the `enabled: true` toggle for a channel MUST be blocked in the settings form until `backfillCoverage[channelId]` exists in config. Show a non-dismissable banner: *"Run `yarn omnibus:backfill --channel-id {id}` before enabling Omnibus for this channel."* When a merchant tries to save with `enabled: true` and backfill is missing for any configured EU channel, the PATCH handler MUST return a validation error: `{ field: 'enabled', error: 'backfill_required_before_enable', channels: [...] }`. The admin cannot enable Omnibus by bypassing the UI.
11. **Monthly table partitioning (Task 12)**: before Phase 3 goes to production, `catalog_price_history_entries` MUST be declared as a partitioned table `PARTITION BY RANGE (recorded_at)`. This is a prerequisite for the retention/archival plan. Steps:
    - The Phase 1 migration creates the table WITHOUT partitioning (unpartitioned for simplicity in Phase 1)
    - A dedicated Phase 3 migration converts the table to partitioned: `CREATE TABLE catalog_price_history_entries_partitioned (LIKE catalog_price_history_entries) PARTITION BY RANGE (recorded_at)`, copy data, swap names. This is a one-time data migration; run during a maintenance window.
    - Add a scheduled job (cron or queue worker) that creates the next month's partition 7 days before month end: `CREATE TABLE catalog_price_history_entries_YYYY_MM PARTITION OF catalog_price_history_entries FOR VALUES FROM (...) TO (...)`
    - Retention floor: never `DETACH` or drop a partition where `upper bound > now() - (max(lookbackDays) + 30 days)`
12. Integration tests: save settings → config persists; price editor shows correct `lowestPriceGross` from preview endpoint; `insufficient_history` shows `coverageStartAt` warning in price editor; per-channel backfill updates `backfillCoverage` for each channel; DB trigger prevents `UPDATE`/`DELETE` on history table; enabling Omnibus without backfill returns `backfill_required_before_enable` validation error

### Phase 4: Member State Compliance Extensions

Goal: full compliance for all seven directive gaps in EU member states with active derogations.

**New Data Model additions (requires ORM entity change + migration):**

`CatalogProduct` entity additions:
| Column | Type | Notes |
|--------|------|-------|
| `omnibus_exempt` | boolean | Default `false`; when `true`, product is exempt from Omnibus in all markets; can be set at product level or propagated from category in admin bulk actions |
| `first_listed_at` | timestamp? | Product's first availability date (set to `created_at` by default; admin may override for products migrated from legacy systems); used for new-arrivals shorter lookback |

`CatalogProductVariant` additions:
| Column | Type | Notes |
|--------|------|-------|
| `omnibus_exempt` | boolean? | `null` = inherit from parent product; `true` = variant-level override exempt |

**Phase 4 Implementation Steps:**

1. Add `omnibus_exempt` and `first_listed_at` to `CatalogProduct` ORM entity; add `omnibus_exempt` to `CatalogProductVariant`; run `yarn db:generate`
2. Expose `omnibusExempt` and `firstListedAt` via existing product edit API and admin product form (Phase 3 settings tab for product-level overrides)
3. **Perishable goods (Gap 3)**: in `resolveOmnibus`, before lookback query, check `config.channels[channelId].perishableGoodsRule`:
   - `'exempt'` AND product/variant `omnibusExempt = true` → return `applicabilityReason: 'perishable_exempt'`, `applicable: false`
   - `'last_price'` AND product `omnibusExempt = true` → use the immediately preceding price entry as reference. **Exact query (all scope filters required)**:
     ```
     precedingEntry = SELECT * FROM catalog_price_history_entries
       WHERE tenant_id      = $tenantId
         AND organization_id = $organizationId
         AND {scopeFilter}                             // same scope level (offer/variant/product) as presented entry
         AND price_kind_id   = $priceKindId            // same price kind
         AND currency_code   = $currencyCode           // same currency
         AND (($channelId IS NOT NULL AND channel_id = $channelId)
              OR ($channelId IS NULL AND channel_id IS NULL))  // same channel scope
         AND recorded_at < $presentedEntry.recorded_at // strictly before the current entry
       ORDER BY recorded_at DESC, id DESC              // DESC to get the immediately preceding entry
       LIMIT 1
     ```
     If `precedingEntry` is null (no prior entry exists for this scope): return `applicabilityReason: 'no_history'` — cannot compute reference. Otherwise: set `lowestRow = precedingEntry`, `previousRow = precedingEntry`; return `applicabilityReason: 'perishable_last_price'`.
   - Note: `omnibusExempt = false` means product is NOT perishable/exempt regardless of market rule
4. **New arrivals (Gap 4)**: in `resolveOmnibus`, check `config.channels[channelId].newArrivalRule`:
   - When `'shorter_window'` AND product `firstListedAt` is available AND `(now - firstListedAt) < lookbackDays`:
     - If `newArrivalsLookbackDays` is set: use it as the window size (reduced lookback)
     - If `newArrivalsLookbackDays = null`: use `(now - firstListedAt)` as window (trader's discretion)
   - Return `applicabilityReason: 'new_arrival_reduced_window'` with actual `lookbackDays` in response reflecting the reduced window
5. **Progressive reductions (Gap 2)**: in `resolveOmnibus`, when `config.channels[channelId].progressiveReductionRule = true` AND `presentedPriceEntry.offer_id IS NOT NULL`:

   **Formal detection algorithm:**
   ```
   // Step A: fetch all history entries for the offer, scoped to the exact resolution context
   // (same scope level, channel, currency, price kind as the presented entry):
   offerEntries = SELECT * FROM catalog_price_history_entries
     WHERE tenant_id      = $tenantId
       AND organization_id = $organizationId
       AND offer_id        = $offerId
       AND price_kind_id   = $priceKindId
       AND currency_code   = $currencyCode
       AND (($channelId IS NOT NULL AND channel_id = $channelId)
            OR ($channelId IS NULL AND channel_id IS NULL))
     ORDER BY recorded_at ASC, id ASC

   // Step B: verify the campaign is a monotonically non-increasing price sequence.
   // An interruption is: any entry where price on the minimization axis is HIGHER than
   // the previous entry, OR a time gap > 7 days between consecutive entries
   // (prevents two separate promotions on the same offer from being treated as one campaign).
   TIME_GAP_THRESHOLD = 7 days
   isProgressiveCampaign = len(offerEntries) >= 2   // single entry is not "progressive"
   for i in range(1, len(offerEntries)):
     if offerEntries[i].unit_price_{axis} > offerEntries[i-1].unit_price_{axis}:
       isProgressiveCampaign = false; break          // price went up → campaign interrupted
     delta = offerEntries[i].recorded_at - offerEntries[i-1].recorded_at
     if delta > TIME_GAP_THRESHOLD:
       isProgressiveCampaign = false; break          // campaign paused > 7 days → not continuous

   // Step C: if progressive, freeze reference to the last price BEFORE the campaign started.
   // This is the price entry immediately before firstOfferEntry (already computed, scoped).
   if isProgressiveCampaign:
     preCampaignBaseline = SELECT * FROM catalog_price_history_entries
       WHERE tenant_id      = $tenantId
         AND organization_id = $organizationId
         AND {scopeFilter}                           // same scope level (not offer-scoped)
         AND offer_id IS NULL                        // pre-campaign entry (not part of any offer)
         AND price_kind_id  = $priceKindId
         AND currency_code  = $currencyCode
         AND (($channelId IS NOT NULL AND channel_id = $channelId)
              OR ($channelId IS NULL AND channel_id IS NULL))
         AND recorded_at < firstOfferEntry.recorded_at
       ORDER BY recorded_at DESC, id DESC LIMIT 1
   ```
   - If `isProgressiveCampaign = true` and `preCampaignBaseline` is found: set `lowestRow = preCampaignBaseline`, `previousRow = preCampaignBaseline`; return `applicabilityReason: 'progressive_reduction_frozen'`
   - If `isProgressiveCampaign = true` but `preCampaignBaseline` is null: fall through to standard rolling-MIN (no pre-campaign history available; cannot freeze reference)
   - If `isProgressiveCampaign = false` (interrupted or single-entry): fall through to standard rolling-MIN algorithm
6. **Per-market config UI expansion**: add per-channel compliance rule fields to channel override rows in admin Omnibus settings: `progressiveReductionRule` toggle, `perishableGoodsRule` select, `newArrivalRule` select + `newArrivalsLookbackDays` number input
7. Add new i18n keys for Phase 4 reasons and admin labels
8. Integration tests: exempt product returns `perishable_exempt`; `'last_price'` market returns reference = immediate predecessor; new product (age < lookbackDays) uses reduced window; progressive campaign (10%→20%→30%) returns pre-campaign baseline as reference, not mid-campaign MIN

### Phase 5: Storefront, Order Line Snapshot & Personalized Pricing

Goal: complete the compliance picture for storefronts and order records; add personalized pricing disclosure.

Deferred from earlier phases:
- Pass `omnibus` block through storefront-facing pricing API endpoints (currently only admin/backend endpoints)
- Add `isPersonalized: boolean` and `personalizationReason?: string` to the pricing API response:
  - Extend `catalogPricingService.resolvePrice` to return a `personalizationMeta: { isPersonalized, reason }` alongside the resolved price row
  - Detection rules (in priority order): customer-group price kind → `'customer_group'`; loyalty tier → `'loyalty_tier'`; B2B negotiated offer → `'negotiated_price'`; algorithmic rule → `'algorithmic_rule'`; otherwise `isPersonalized = false`
  - `resolveOmnibus` propagates the meta from `catalogPricingService` into the top-level response (no separate resolution pass)
- Add i18n key for personalized pricing disclosure (`catalog.pricing.personalizedDisclosure`) — storefronts render this when `isPersonalized = true`
- Store the following fields on order/quote line snapshots at order creation time (requires sales module change — tracked as dependency). The snapshot must be immutable — these values must never be updated after order creation even if prices change afterward:
  - `omnibusReferenceNet` — Omnibus `lowestPriceNet` at time of order
  - `omnibusReferenceGross` — Omnibus `lowestPriceGross` at time of order
  - `omnibusPromotionAnchorAt` — the `promotionAnchorAt` anchor date (required for legal audit: proves which window was used)
  - `omnibusApplicabilityReason` — the `applicabilityReason` at time of order (documents why Omnibus was or was not shown)
  - `isPersonalized` — whether the price was personalized
  - `personalizationReason` — which signal drove personalization
- `coverageStartAt` must be passed through storefront pricing responses for storefronts rendering `insufficient_history` disclosures

### File Manifest

| File | Action | Phase | Purpose |
|------|--------|-------|---------|
| `packages/core/src/modules/catalog/data/entities.ts` | Modify | 1 | Add `CatalogPriceHistoryEntry` ORM entity |
| `packages/core/src/modules/catalog/data/validators.ts` | Modify | 1 | Add history entry + OmnibusConfig Zod schemas |
| `packages/core/src/modules/catalog/lib/omnibus.ts` | Create | 1 | `buildHistoryEntry`, `recordPriceHistoryEntry`, `getLowestPrice` |
| `packages/core/src/modules/catalog/commands/prices.ts` | Modify | 1 | Wire history capture + `is_announced` + `idempotency_key` |
| `packages/core/src/modules/catalog/services/catalogOmnibusService.ts` | Create | 2 | Omnibus resolution service |
| `packages/core/src/modules/catalog/di.ts` | Modify | 2 | Register `catalogOmnibusService` |
| `packages/core/src/modules/catalog/acl.ts` | Modify | 1 | Add `catalog.price_history.view` feature |
| `packages/core/src/modules/catalog/setup.ts` | Modify | 1 | Declare `catalog.price_history.view` in `defaultRoleFeatures` |
| `packages/core/src/modules/catalog/api/get/catalog/prices/history.ts` | Create | 1 | History list endpoint |
| `packages/core/src/modules/catalog/api/get/catalog/prices/omnibus-preview.ts` | Create | 3 | Lightweight Omnibus resolution for price editor UI |
| `packages/core/src/modules/catalog/api/get/catalog/config/omnibus.ts` | Create | 3 | Config read endpoint |
| `packages/core/src/modules/catalog/api/patch/catalog/config/omnibus.ts` | Create | 3 | Config write endpoint |
| `packages/core/src/modules/catalog/backend/catalog/config/omnibus.tsx` | Create | 3 | Omnibus settings UI tab (with per-market config in Phase 4) |
| `packages/core/src/modules/catalog/cli.ts` | Modify | 3 | Add `omnibus:backfill` CLI command (per-channel in Phase 3) |
| `packages/core/src/modules/catalog/data/entities.ts` | Modify | 4 | Add `omnibus_exempt` + `first_listed_at` to `CatalogProduct`/`Variant` |
| `packages/core/src/modules/catalog/lib/omnibus.market.ts` | Create | 4 | `resolvePerishableRule`, `resolveNewArrivalRule`, `resolveProgressiveRule` |
| `packages/core/src/modules/sales/data/entities.ts` | Modify | 5 | Add `omnibusReferenceNet/Gross`, `omnibusPromotionAnchorAt`, `omnibusApplicabilityReason`, `isPersonalized`, `personalizationReason` to order line snapshot |

### Testing Strategy

#### Unit Tests — `lib/omnibus.ts` (baseline + window algorithm)

| Scenario | Expected result |
|----------|----------------|
| Stable price (baseline before window, no in-window entries) | `lowestRow = baseline`, `previousRow = baseline`, `applicabilityReason = 'not_announced'` |
| Multiple in-window entries | Row with lowest axis value selected; `lowestPriceNet` and `lowestPriceGross` from **same row** |
| Independent `MIN(net)` / `MIN(gross)` trap | If entries have different tax rates: only one row's net+gross pair is returned, not independent minima |
| No baseline + no in-window entries | `lowestRow = null`, `applicabilityReason = 'no_history'` |
| Channel-scoped context (`channelId` present) | Only `channel_id`-matching rows included; entries from other channels excluded |
| No `channelId` (best_effort mode, non-storefront) | No channel filter; all channel entries blended |
| `context.isStorefront = true`, no `channelId` | Always returns `missing_channel_context` regardless of `noChannelMode` config |
| Channel country code not in `enabledCountryCodes` | `applicabilityReason = 'not_in_eu_market'`; no DB query |
| `enabledCountryCodes = []` | `applicabilityReason = 'not_in_eu_market'` for ALL channels; no DB query |
| `noChannelMode = 'require_channel'`, no `channelId` | Immediate `missing_channel_context`; no DB query |
| Tax-rate-only change (same net, no promotion signals) | `applicable = false`, `applicabilityReason = 'not_announced'` — directive not triggered |
| `starts_at IS NOT NULL` | `applicable = true`, `applicabilityReason = 'announced_promotion'`; `promotionAnchorAt = starts_at`; `windowEnd = starts_at` |
| `offer_id IS NOT NULL`, no `starts_at` | `applicable = true`; `promotionAnchorAt = firstOfferEntry.recorded_at`; `windowEnd = firstOfferEntry.recorded_at` |
| `is_announced = true`, no `starts_at`, no `offer_id` | `applicable = true`, `applicabilityReason = 'announced_promotion'` |
| `priceKind.isPromotion = true` only | `applicable = true`, `applicabilityReason = 'announced_promotion'` |
| All signals absent | `applicable = false`, `applicabilityReason = 'not_announced'` |
| Promotion lasting 45 days (`starts_at` 45 days ago) | Window anchored to `starts_at` — reference price does NOT shift on day 31; `windowStart = starts_at - lookbackDays` |
| No baseline, in-window entries exist | `applicabilityReason = 'insufficient_history'`; `coverageStartAt = previousRow.recorded_at`; non-null |
| Cache key: sliding vs anchored window, same `windowStartDay` | Different `anchorDay` values → distinct cache entries (no collision) |
| Idempotency: duplicate insert with same `idempotency_key` | `UniqueViolationError` caught; treated as success; no duplicate row |
| `minimizationAxis = 'net'` | Selection by `unit_price_net`; returned pair consistent from same row |

#### Unit Tests — `catalogOmnibusService.resolveOmnibus`

- `enabled = false` → `omnibus: null`
- `enabled = true`, no history → `applicable: false`, `applicabilityReason: 'no_history'`
- Channel override `lookbackDays` → resolution uses channel-specific window
- `is_announced` capture: `buildHistoryEntry` with `starts_at` set → `is_announced = true`; without structural signals → `is_announced = false`

#### Unit Tests — Price Command Handlers

- `createPriceCommand` → history entry with `change_type = 'create'`, `tenant_id` and `organization_id` always populated
- `updatePriceCommand` → history entry with `change_type = 'update'`
- `deletePriceCommand` → history entry with `change_type = 'delete'`
- Undo → history entry with `change_type = 'undo'`; original entries NOT deleted

#### Compliance Test Suite (Integration)

These tests MUST pass before any EU production deployment:

| # | Scenario | Assertion |
|---|----------|-----------|
| C1 | Promotion lasting > 30 days (`starts_at` = 40 days ago) | `windowEnd = starts_at`; reference price = baseline at `starts_at - lookbackDays`, not recalculated at day 40 |
| C2 | Tax-only change (tax rate 20% → 23%, net unchanged) | `applicable = false`, `applicabilityReason = 'not_announced'`; `omnibus.lowestPriceGross` not rendered on storefront |
| C3 | Progressive reduction: 100→90→80→70 under same `offer_id` | `applicabilityReason = 'progressive_reduction_frozen'`; `lowestRow = pre-campaign baseline (100)` |
| C4 | Progressive interrupted: 100→90→95→80 under same `offer_id` | Falls through to standard rolling-MIN; `applicabilityReason = 'announced_promotion'` |
| C5 | Perishable exemption (`omnibusExempt = true`, `perishableGoodsRule = 'exempt'`) | `applicable = false`, `applicabilityReason = 'perishable_exempt'` |
| C6 | Perishable last-price (`omnibusExempt = true`, `perishableGoodsRule = 'last_price'`) | `lowestRow = immediately preceding entry`; `applicabilityReason = 'perishable_last_price'` |
| C7 | New arrival (product age < lookbackDays, `newArrivalRule = 'shorter_window'`) | `lookbackDays` in response = reduced window; `applicabilityReason = 'new_arrival_reduced_window'` |
| C8 | Insufficient history (no baseline entry, in-window entries exist) | `applicabilityReason = 'insufficient_history'`; `coverageStartAt` non-null; `lowestRow` populated from in-window entries |
| C9 | Per-channel isolation: two channels, different prices | Channel A's Omnibus reference does NOT appear in Channel B's resolution; `lowestRow` different per channel |
| C10 | Offer anchor fallback (offer-linked price, no `starts_at`) | `promotionAnchorAt = firstOfferEntry.recorded_at` using scoped query (channel + kind + currency) |
| C11 | Backfill baseline correctness | After `omnibus:backfill`, `recorded_at = windowStart - 1ms` for baseline entries; `getLowestPrice` returns `previousRow` from backfill entry |
| C12 | DB immutability | Direct `UPDATE` or `DELETE` on `catalog_price_history_entries` raises exception; no row modified |
| C13 | Enabling Omnibus without backfill | `PATCH /api/catalog/config/omnibus` with `enabled: true` and missing `backfillCoverage` returns 422 with `backfill_required_before_enable` |
| C14 | Order snapshot persistence | Order creation with active Omnibus stores `omnibusReferenceNet`, `omnibusReferenceGross`, `omnibusPromotionAnchorAt`, `omnibusApplicabilityReason`, `isPersonalized`; these fields remain unchanged if prices change afterward |
| C15 | Cross-org isolation | Two organizations with same product prices; `GET /api/catalog/prices/history` for org A returns only org A's entries |

#### Integration Tests (General)

- `POST /api/catalog/prices` → `GET /api/catalog/prices/history` returns entry with correct `change_type`
- Stable price + promotional update (`starts_at` set) → `omnibus.applicable = true`; `lowestPriceGross` reflects stable price (baseline), not promo price
- `GET /api/catalog/prices/history` with `includeTotal=true` returns `total`; without it, `total` absent
- `PATCH /api/catalog/config/omnibus` persists config; subsequent resolution reflects new lookback window and presented price kind

### Open Questions

- **Retention policy — minimum plan required before production scale**: The history table must never drop entries within the legal retention window. The following is the minimum acceptable plan before EU production rollout at high volume:
  1. **Monthly partitioning (Phase 3 prerequisite)**: declare `PARTITION BY RANGE (recorded_at)` on `catalog_price_history_entries` before Phase 3 production deployment. New month partitions are auto-created by a scheduled task. Partitioned tables enable `DETACH PARTITION` for archival without locking live data.
  2. **Retention floor**: `max(lookbackDays across all enabled EU channels) + 30 days` is the minimum retention boundary. Never drop or archive entries within this window. The 30-day buffer absorbs config changes (e.g. a lookback increase from 30→60 days requires the last 60+30 days to remain available immediately).
  3. **Archival of expired partitions**: partitions older than the retention floor may be detached and exported to cold storage (e.g. S3 Parquet). A detached partition is no longer queryable via the main table — compliance export queries against archived data require a separate restore step. The deployment runbook MUST document the archive location and restore procedure.
  4. **UI warning**: the admin Omnibus settings page MUST display a warning when the oldest retained entry in `backfillCoverage` is within 7 days of the current retention boundary (i.e. archival is imminent and the lookback window may become uncoverable without backfill).
  5. **Phase 3 deployment gate**: Phase 3 MUST NOT be deployed to production without either (a) partitioning in place, or (b) a storage capacity alert configured that fires before the table exceeds 80% of the storage budget.
- **Immediate-previous-price tracking**: Full "did the price just decrease from its immediately preceding value?" requires a 3rd query (last entry before the latest one). Currently approximated via promotion-detection rule. Decide whether to implement in Phase 3 or defer.
- **Category-level omnibusExempt**: `omnibusExempt` is product-level in Phase 4. For merchants with thousands of perishable products, setting it per-product is operationally burdensome. A future phase could propagate `omnibusExempt = true` from a category to all its products automatically. Evaluate whether this needs to be in Phase 4 or can follow as an enhancement.
- **firstListedAt precision (resolved)**: The directive's "on the market" (Art. 6a(4)) refers to when the product became available for purchase, not internal creation. **Decision**: `CatalogProduct.first_listed_at` defaults to `created_at` for backwards compatibility. Merchants with draft-then-publish workflows MUST manually override `first_listed_at` on the product form to reflect the first public availability date. A per-channel `firstPublishedAt` timestamp (tracking first channel activation per channel) is **deferred** — the overhead is not justified for Phase 4 since most EU merchants activate products across all channels simultaneously. If per-channel new-arrivals accuracy becomes a business requirement, it should be addressed as a follow-on spec adding a `catalog_channel_activations` table. Until then, `first_listed_at` is the single source of truth at product level.
- **Market entity (Option B, deferred)**: The per-channel approach (channel == market) works for most cases, but merchants with multiple channels per country (B2B + B2C same country) must configure compliance rules on each channel independently. A first-class `Market` entity mapping channels → market would DRY this up. Evaluate in a future spec if demand arises.
- **Progressive reduction member state list**: Which EU member states have adopted Article 6a(5)? A built-in pre-populated list of per-country defaults would help merchants avoid misconfiguration. Evaluate as a follow-up enhancement to Phase 4.

---

## Compliance Gap Analysis

External review against Directive (EU) 2019/2161 and Commission Guidance (2021/C 526/02) identified seven gaps. This section documents each gap, its severity, and its disposition in this spec.

| # | Gap | Severity | Phase | Status |
|---|-----|----------|-------|--------|
| 1 | Fixed reference price for promotion duration (sliding window) | **Critical** | Phase 2 | **Addressed** — `starts_at`-anchored window + offer first-entry fallback |
| 2 | Progressive (stacked) price reductions | **High** | Phase 4 | **Addressed** — `progressiveReductionRule` + offer-grouped detection |
| 3 | Perishable goods exception | Medium | Phase 4 | **Addressed** — `omnibusExempt` flag + `perishableGoodsRule` per market |
| 4 | New arrivals shorter lookback | Medium | Phase 4 | **Addressed** — `firstListedAt` + `newArrivalRule` per market |
| 5 | Member state rule variations | Medium | Phase 4 | **Addressed** — per-channel market rule fields in OmnibusConfig |
| 6 | Announced vs. silent price change | Medium | Phase 2 | **Addressed** — promotion-detection `applicable` rule + `is_announced` |
| 7 | Personalized pricing disclosure | Low–Medium | Phase 5 | **Addressed** — `isPersonalized` + `personalizationReason` in pricing response |

### Gap 1 — Fixed Reference Price (Addressed in Phase 2)

**Directive requirement**: the prior price is the lowest price in the 30 days *before* the promotion started. For promotions running longer than 30 days the window does not slide forward.

**Resolution**: `CatalogPriceHistoryEntry.starts_at` (already captured from `CatalogProductPrice.starts_at`) is used as the window anchor. When `starts_at IS NOT NULL`, `windowEnd = starts_at` and `windowStart = starts_at - lookbackDays` — fixed for the promotion's entire lifetime. The `promotionAnchorAt` field in the API response exposes the anchor date to storefronts.

### Gap 2 — Progressive Price Reductions (Phase 4)

**Directive requirement** (optional member-state derogation, Article 6a(5)): for progressively increasing discounts (10% → 20% → 30%), the prior price is the pre-campaign price — not a recalculated rolling MIN. Only applies in member states that adopted this derogation.

**Resolution**: uses `offer_id` as the campaign grouping key (no new column needed). When `progressiveReductionRule = true` for the market AND the presented price has `offer_id` set: the resolver queries all history entries for that offer sorted by time, detects an uninterrupted downward price sequence, and freezes the reference to the last price BEFORE the first reduction. Returns `applicabilityReason: 'progressive_reduction_frozen'`. Non-progressive or interrupted campaigns fall through to standard rolling-MIN algorithm.

### Gap 3 — Perishable Goods Exception (Phase 4)

**Directive requirement** (optional member-state derogation, Article 6a(3)): fresh food, flowers, and similar perishables may be fully exempt or subject to a shorter lookback.

**Resolution**: `CatalogProduct.omnibusExempt: boolean` (default `false`) + `CatalogProductVariant.omnibusExempt: boolean?` (inherits from product when null). Per-market `perishableGoodsRule: 'standard' | 'exempt' | 'last_price'`. When a product is exempt AND the market rule is `'exempt'`: `applicabilityReason: 'perishable_exempt'`. When `'last_price'`: reference is the immediately preceding price entry; `applicabilityReason: 'perishable_last_price'`.

### Gap 4 — New Arrivals Shorter Lookback (Phase 4)

**Directive requirement** (optional member-state derogation, Article 6a(4)): products on market fewer than 30 days may use a shorter window (Latvia: 7 days; Netherlands: trader's discretion).

**Resolution**: `CatalogProduct.firstListedAt` (defaults to `created_at`). Per-market `newArrivalRule: 'standard' | 'shorter_window'` + `newArrivalsLookbackDays?: number | null`. When a product's age is below the configured lookback AND the rule is `'shorter_window'`: uses the reduced window (or actual availability when `newArrivalsLookbackDays = null`); `applicabilityReason: 'new_arrival_reduced_window'`; `lookbackDays` in response reflects the actual reduced window used.

### Gap 5 — Member State Rule Variations (Phase 4)

**Directive requirement**: states may require longer lookback periods, adopt or skip derogations, and set different penalty thresholds.

**Resolution**: per-channel OmnibusConfig entries serve as per-market rule sets (Option A: channel == market, explicitly documented). Each channel config now carries: `lookbackDays`, `progressiveReductionRule`, `perishableGoodsRule`, `newArrivalRule`, `newArrivalsLookbackDays`, `countryCode`. The `countryCode` field maps the channel to the correct member state. Merchants with multiple channels per country must configure each channel independently; the spec recommends creating one channel per country for EU compliance (or using a first-class Market entity in a future evolution — Option B, deferred).

### Gap 6 — Announced vs. Silent Price Change (Addressed in Phase 2)

**Directive requirement**: the directive applies only to *announcements* of price reductions, not to routine silent repricing (Commission Guidance: *"Article 6a does not deal with … price fluctuations that do not involve a price reduction announcement"*).

**Resolution**: the `applicable` rule is now driven exclusively by structural promotion detection (`starts_at`, `offer_id`, `priceKind.isPromotion`). Silent repricing produces `applicabilityReason: 'not_announced'`. The gross-price catch-all (`presentedGross < previousPriceGross`) is removed. Tax-rate-only adjustments no longer trigger Omnibus.

### Gap 7 — Personalized Pricing Disclosure (Phase 5)

**Directive requirement**: the Omnibus Directive amends the Consumer Rights Directive to require disclosure when prices are personalized via automated profiling (Article 6(1)(ea)).

**Resolution**: `isPersonalized: boolean` + `personalizationReason?: string` added to the pricing API response (outside the `omnibus` block). Detection logic in Phase 5: when price resolution selects a customer-group-specific price kind, loyalty-tier price, or any price kind with algorithmic pricing signals → `isPersonalized = true`. Storefronts render the `catalog.pricing.personalizedDisclosure` i18n key when this flag is set. Persisted on order/quote line snapshots alongside `omnibusReferenceNet`/`Gross`.

---

## Monitoring & Alerting

Omnibus compliance failures are legal failures. The following observability requirements are **mandatory** — not suggestions — for any EU production deployment.

### Required Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `omnibus.resolution.error_rate` | Counter | Incremented whenever `resolveOmnibus` catches an exception (returns `null`). Alert at `> 0` per 5-minute window — any error means a storefront may be non-compliant. |
| `omnibus.resolution.not_in_eu_market` | Counter | Incremented for each `not_in_eu_market` return. Monitor to detect misconfigured channels (unexpected spike = a EU channel lost its `countryCode`). |
| `omnibus.resolution.insufficient_history` | Counter | Incremented for each `insufficient_history` result. Alert if `> N%` of EU requests return this reason — indicates stale backfill or missing coverage. |
| `omnibus.resolution.no_history` | Counter | Incremented for each `no_history` result. Alert if nonzero after Omnibus has been enabled and backfill completed for a channel. |
| `omnibus.backfill.coverage_gap` | Gauge | Seconds between `backfillCoverage[channelId].completedAt` and `now()`. Alert when `> 24h` for any EU channel (backfill has not been run since yesterday). |
| `omnibus.history.oldest_entry_age_days` | Gauge | Per channel: `now() - MIN(recorded_at)` in days. Alert when `< max(lookbackDays)` — retention floor is at risk. |

### Logging Requirements

1. **`resolveOmnibus` exception**: log at `ERROR` level with `{ tenantId, organizationId, channelId, priceKindId, currencyCode, error.message, error.stack }`. Do NOT log price values at `ERROR` level (GDPR).
2. **`insufficient_history` result**: log at `WARN` level with `{ tenantId, organizationId, channelId, coverageStartAt, lookbackDays }` — enables ops team to identify which channel needs backfill.
3. **Omnibus enabled without backfill**: when `enabled = true` is saved to config and `backfillCoverage[channelId]` is absent for any EU channel, log at `WARN` level (this should be caught by the admin UI gate first, but the service layer is the last line of defence).
4. **DB trigger violation**: PostgreSQL raises an exception on any `UPDATE`/`DELETE` attempt; this MUST be caught by the application layer and logged at `ERROR` level — it means a code path bypassed the application-layer immutability guarantee.

### Alerting Thresholds (recommended defaults)

| Alert | Condition | Severity |
|-------|-----------|----------|
| Omnibus resolution errors | `error_rate > 0` in any 5-minute window | **P1** |
| No-history on live EU channel | `no_history > 0` after backfill completed | **P2** |
| Insufficient history above threshold | `insufficient_history > 1%` of EU requests | **P2** |
| Backfill coverage gap | Any EU channel not backfilled in >24h | **P3** |
| Retention floor at risk | `oldest_entry_age_days < max(lookbackDays)` | **P2** |

---

## Risks & Impact Review

### Data Integrity Failures

#### Incorrect lowest price due to missing baseline

- **Scenario**: A price has been stable for 90 days with no changes. A promotion is applied today. The lookback window (30 days) contains only the new promotional entry — no prior entry exists in the window. `MIN` over window alone returns the promotional price itself, suppressing the Omnibus reference that the directive requires.
- **Severity**: Critical
- **Affected area**: Legal compliance — the directive is violated for all products with infrequently-changing prices (common for long-catalogue merchants)
- **Mitigation**: `getLowestPrice` ALWAYS fetches a baseline entry (`recorded_at ≤ windowStart ORDER BY DESC LIMIT 1`) and includes it in the candidate set alongside in-window entries. The mandatory CLI backfill before enabling Omnibus ensures baseline entries exist for all pre-existing prices.
- **Residual risk**: If both baseline and in-window sets are empty (price created after backfill, changed for first time within window), `no_history` is returned. This is a legitimate state surfaced clearly via `applicabilityReason`.

#### `applicable` false-negative for silent repricing with a lower historical baseline

- **Scenario**: Price sequence: 80→100→90 (silent repricing, no promotion signals). Baseline = 80. `presentedGross = 90`. Old spec's gross-comparison check `90 < 80 → false` — correct under the new rule. The directive does NOT apply to silent repricing, so `applicable = false` is the legally correct result.
- **Severity**: Low (was Medium — now correctly resolved)
- **Affected area**: Storefronts will not display Omnibus reference for silent price changes; this is directive-compliant behavior.
- **Mitigation**: If a merchant is running a genuine announced reduction (e.g. "Sale: was €100, now €90") and the pre-sale baseline happens to be lower than the current sale price, they MUST set `starts_at` on the promotional price row, link it to a `CatalogOffer`, or use a price kind with `isPromotion = true`. All three signal that the reduction is announced.
- **Residual risk**: Merchants who announce reductions externally (e.g. via email campaigns) without using any catalog promotion structure will produce `applicable = false`. This is a training/documentation issue — the admin UI MUST communicate clearly that Omnibus display requires a structural promotion signal.

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
- **Mitigation**: Application layer has no `UPDATE`/`DELETE` code paths for this entity. Phase 3 adds a PostgreSQL `RULE` or `BEFORE UPDATE OR DELETE` trigger in the migration DDL that raises an exception for any modification attempt. The DB runtime role is restricted to `SELECT, INSERT` on the table (documented in deployment runbook and enforced via DB role grant).
- **Residual risk**: Superuser/admin DB access can always bypass application constraints; covered by standard DB access control policy, not by this spec.

#### Cross-channel blending with incorrect reference price

- **Scenario**: `noChannelMode = 'best_effort'` (default) and a storefront resolves pricing without passing `channelId`. The Omnibus reference is computed from blended entries across all channels — channel A's lower promotional history enters the reference price for channel B's customer.
- **Severity**: Medium
- **Affected area**: Legal compliance — reference price may be lower than the legally required minimum for that channel; storefront displays incorrect Omnibus label
- **Mitigation**: EU storefronts MUST set `noChannelMode = 'require_channel'` in config; the storefront must pass `channelId` on all Omnibus-enabled pricing requests. `'require_channel'` returns `missing_channel_context` when `channelId` is absent — the storefront receives a clear error rather than a silently blended result.
- **Residual risk**: Merchants who use `'best_effort'` mode for EU storefronts may be non-compliant. The admin UI SHOULD display a warning when EU channels are configured but `noChannelMode = 'best_effort'`.

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

## Final Compliance Report — 2026-02-19

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
| root AGENTS.md | Never hand-write migrations | **Exception documented** | `yarn db:generate` generates the `CREATE TABLE` and FK columns. Composite indexes and the immutability DB trigger are **hand-written DDL appended to the same migration file** after generation — this is the established exception for structural DDL that the ORM generator cannot produce (same pattern as composite indexes documented in `packages/core/AGENTS.md`). The migration file header MUST include a comment marking the manually-added block: `-- MANUAL DDL: composite indexes and immutability trigger (not generated by MikroORM)`. |
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

| Phase 2 design | `applicable` uses promotion-detection not gross comparison | Compliant | Directive applies to announced reductions only; gross comparison removed |
| Phase 2 design | `applicable` does not fire on tax-rate-only changes | Compliant | Net price unchanged → no promotion signals → `not_announced` |
| Phase 2 design | Window anchored to `starts_at` + offer-first-entry fallback | Compliant | Directive: reference price fixed at start of reduction period; both paths covered |
| Phase 2 design | `is_announced` field enables explicit announcement marking | Compliant | Covers merchants who announce externally without catalog promotion structures |
| Phase 2 design | Idempotency key prevents duplicate history entries on retry | Compliant | Data integrity; DB unique constraint enforced |
| Phase 2 design | `noChannelMode: 'require_channel'` for EU storefronts | Compliant | Prevents cross-channel blending; storefronts fail closed when channel absent |
| Phase 2 design | EU country scope via `enabledCountryCodes` | Compliant | Non-EU channels return `not_in_eu_market`; skip computation |
| Phase 3 design | DB-level immutability trigger + runtime role restriction | Compliant | History records cannot be modified; second line of defence beyond application layer |
| Phase 3 design | Per-channel backfill with `backfillCoverage` map | Compliant | Backfill uses correct per-channel `lookbackDays`; UI detects coverage gaps |
| Phase 4 design | Progressive reduction via offer grouping + market rule | Partial | Art. 6a(5) is optional per member state; gate behind `progressiveReductionRule` |
| Phase 4 design | Perishable goods `omnibusExempt` + `perishableGoodsRule` | Partial | Art. 6a(3) is optional; properly gated behind market rule |
| Phase 4 design | New arrivals `firstListedAt` + `newArrivalRule` | Partial | Art. 6a(4) is optional; properly gated behind market rule |
| Phase 5 design | `isPersonalized` disclosure in pricing response | Compliant | Art. 6(1)(ea) amended Consumer Rights Directive requirement covered |

### Verdict

**Approved for all phases** — Phase 1 foundation; Phase 2 critical compliance gaps resolved; Phase 3 hardening + backfill accuracy; Phase 4 member-state derogations; Phase 5 storefront + personalized pricing. All seven directive gaps are addressed across the five-phase delivery. Phase 4 derogation features (progressive, perishable, new arrivals) are correctly gated behind per-market config so they only activate in member states that adopted the optional derogations.

---

## Changelog

### 2026-02-26 (rev 13)
- **Bug fix — `resolveOmnibusBlock` applicabilityReason loss**: when `lowestRow` was null (no prior history), `applicabilityReason` pre-set to `'insufficient_history'` was silently overwritten by the `applicable` branch. Fix moves the `insufficientHistory` check before the `applicable` branch so the reason propagates correctly.
- **Bug fix — `previousRow` derivation**: was using `inWindow[inWindow.length - 1]` (last element of a DESC-ordered list, i.e., the oldest), which is semantically correct but fragile. Replaced with an explicit ASC `ORDER BY recorded_at, id LIMIT 1` query via `fetchOldestInWindow()` per spec §Phase 2 Step 6.
- **DRY refactor — duplicate `PriceSnapshot` type eliminated**: `commands/prices.ts` had a local 28-field type duplicating `omnibusTypes.ts`. Renamed the minimal 19-field type to `PriceHistorySnapshot` (used by `buildHistoryEntry`); `PriceSnapshot` is now `PriceHistorySnapshot & { kind, userId, userGroupId, customerId, customerGroupId, metadata, createdAt, updatedAt, custom }`. `commands/prices.ts` imports from `lib/omnibus`.
- **DRY refactor — `MS_PER_DAY` constant**: exported from `lib/omnibus.ts` and used across `catalogOmnibusService.ts` and `cli.ts` in place of inline `24 * 60 * 60 * 1000` literals.
- **DRY refactor — `subtractDays` / `getPriceValue` helpers**: private module-level functions in `catalogOmnibusService.ts` eliminate 4× repeated window-date arithmetic and 6× repeated unsafe `priceField` casts.
- **DRY refactor — double `getConfig()` eliminated**: extracted `_computeLowestPrice(em, ctx, config, …)` private method so `resolveOmnibusBlock` loads config once and passes it through, avoiding a second DB read inside `getLowestPrice`.
- **Security fix — `findOneWithDecryption` in omnibus-preview route**: `api/prices/omnibus-preview/route.ts` was using raw `em.findOne` for `CatalogProduct`; replaced with `findOneWithDecryption` per architecture rules.
- **DRY refactor — CLI backfill uses `buildHistoryEntry()`**: CLI was manually assembling 26-field history entry objects; now calls `buildHistoryEntry({ snapshot, changeType: 'create', source: 'system' })` and overrides `recordedAt` / `idempotencyKey: null` for backfill semantics.
- **Phase 5 — `SalesQuoteLine` omnibus snapshot fields**: 6 nullable columns added to `SalesQuoteLine` entity matching the `SalesOrderLine` schema: `omnibusReferenceNet`, `omnibusReferenceGross`, `omnibusPromotionAnchorAt`, `omnibusApplicabilityReason`, `isPersonalized`, `personalizationReason`. Migration generated.
- **Phase 5 — Quote line omnibus capture wired**: `applyQuoteLineResults` and `replaceQuoteLines` in `sales/commands/documents.ts` now resolve `catalogOmnibusService` from DI and capture the omnibus block + personalization meta for new lines, matching the pattern already in `applyOrderLineResults`.

### 2026-02-19 (rev 12)
- **Task 10 — Cache key collision fix**: added `anchorDay` as a distinct cache dimension (`promotionAnchorAt ? floorToDay(promotionAnchorAt) : 'none'`). Prevents collision between sliding-window results and promotion-anchored results that happen to share the same computed `windowStartDay`. Documented why this collision is a real legal risk.
- **Task 11 — Order snapshot expanded**: Phase 5 now explicitly lists all fields to persist on order line snapshots: `omnibusReferenceNet/Gross`, `omnibusPromotionAnchorAt`, `omnibusApplicabilityReason`, `isPersonalized`, `personalizationReason`. Snapshot immutability requirement stated. `packages/core/src/modules/sales/data/entities.ts` added to File Manifest.
- **Task 3 — DB trigger DDL shown explicitly**: Phase 3 step 8 now contains the actual `CREATE FUNCTION` / `CREATE TRIGGER` SQL with the `REVOKE` deployment runbook step.
- **Task 4 — Admin UI backfill gate**: Phase 3 step 10 (new) requires the `enabled` toggle to be blocked in the UI until `backfillCoverage[channelId]` is present; the PATCH handler returns `backfill_required_before_enable` validation error if bypassed.
- **Task 12 — Table partitioning as concrete Phase 3 step**: Phase 3 step 11 (new) details the two-migration plan (unpartitioned in Phase 1, converted in Phase 3), the partition creation worker, and the retention floor rule. Elevated from Open Questions.
- **Task 14 — Monitoring & Alerting section added**: new first-class section with required metrics, logging requirements, and alerting thresholds. All EU deployments must implement these before go-live.
- **Task 15 — Compliance test suite added**: Testing Strategy restructured into four tables. New "Compliance Test Suite (Integration)" with 15 numbered scenarios covering all directive-critical paths: >30-day promotions, tax-only changes, progressive reductions, perishable exemptions, new arrivals, insufficient history, per-channel isolation, offer anchor fallback, backfill baseline, DB immutability, admin backfill gate, order snapshot, cross-org isolation.

### 2026-02-19 (rev 11)
- **Fix 1 — `enabledCountryCodes` semantic consistency**: resolved conflict between config comment ("empty = disabled globally") and algorithm ("empty = skip check"). Canonical semantics now uniformly applied: `[] → not_in_eu_market` for ALL channels; algorithm updated from `length > 0` guard to `length === 0 → return not_in_eu_market` first. Phase 2 step 4 text, unit test case, and config comment all aligned.
- **Fix 2 — Anchor fallback scope filters**: `firstOfferEntry` query now includes mandatory scope filters: `price_kind_id`, `currency_code`, and `channel_id` (null-safe equality). Cross-channel / cross-currency anchor contamination eliminated.
- **Fix 3 — `is_announced` three-value semantics**: `null` = legacy row (pre-Phase 2); `false` = evaluated, not announced; `true` = announced. `announce?: boolean` API param documented on `POST` and `PATCH /api/catalog/prices`. `buildHistoryEntry` stores `false` (not `null`) when no signals exist.
- **Fix 4 — `idempotency_key` millisecond precision**: hash uses `recorded_at.toISOString()` with ms precision (same `recorded_at` stored in the row). Two writes in the same second cannot collide. Partial unique index (`WHERE idempotency_key IS NOT NULL`) documented.
- **Fix 5 — Storefront `require_channel` enforcement**: `noChannelMode` config updated to document that `context.isStorefront = true` programmatically overrides config to `require_channel`, regardless of configured value. `getLowestPrice` algorithm updated with `effectiveMode` derivation.
- **Fix 6 — Progressive reduction formal algorithm**: Step A (scoped offer entries query), Step B (continuity check: price increase or >7-day gap breaks campaign), Step C (pre-campaign baseline query with `offer_id IS NULL` guard). All queries include full scope filters.
- **Fix 7 — `perishable_last_price` query precision**: Phase 4 Step 3 now contains the exact SQL for `precedingEntry` query with full scope filters (`scopeFilter`, `price_kind_id`, `currency_code`, channel null-safe equality, `recorded_at < presentedEntry.recorded_at`). Null-result behavior (`no_history`) explicitly defined.
- **Fix 8 — `firstListedAt` decision**: open question resolved. `first_listed_at` defaults to `created_at`; manual override available; per-channel `firstPublishedAt` deferred with documented rationale.
- **Fix 9 — Unscoped backfill legal status**: explicit note added that `channel_id IS NULL` price rows are NOT EU compliance sources; EU storefront paths with `require_channel` never reach them; CLI should warn when unscoped rows exist alongside EU-enabled channels.
- **Fix 10 — Minimum retention plan**: open question replaced with a concrete 5-point minimum plan: monthly partitioning (Phase 3 gate), retention floor = max(lookbackDays)+30d, archival of expired partitions, admin UI warning at 7-day boundary, Phase 3 deployment gate.
- **Fix 11 — Migration trigger DDL exception documented**: compliance matrix updated to "Exception documented"; Phase 3 step 8 updated with instruction to hand-append the trigger DDL with `-- MANUAL DDL` comment.
- **Fix 12 — Personalized pricing signal sources**: four signal sources defined (`customer_group`, `loyalty_tier`, `negotiated_price`, `algorithmic_rule`) with detection contract in `catalogPricingService`; required Phase 5 tests listed.

### 2026-02-19 (rev 10)
- **Phase structure expanded to 5 phases**: Phase 1 (history) → Phase 2 (resolution + hardening) → Phase 3 (admin UI + backfill + DB) → Phase 4 (member-state compliance) → Phase 5 (storefront + personalized pricing)
- **All 7 compliance gaps now addressed**: Gaps 1 and 6 in Phase 2; Gaps 2–5 in Phase 4; Gap 7 in Phase 5. Compliance Gap Analysis table updated from "Deferred/Out of scope" to phase assignments with resolution details.
- **A — Member-state compliance (Gaps 2–5)**: progressive reduction via `offer_id` grouping + `progressiveReductionRule` per market; perishable goods `omnibusExempt` on product/variant + `perishableGoodsRule` per market; new arrivals `firstListedAt` + `newArrivalRule`/`newArrivalsLookbackDays` per market; per-channel config formalised as per-market rule set (channel == market, Option A).
- **B — Anchor fallback via offer first-entry**: when `starts_at` is null but `offer_id` is set, `promotionAnchorAt = recorded_at` of the first history entry for that offer; window frozen to that date. `promotionAnchorAt` description updated to document priority chain.
- **C — `is_announced` column**: explicit announcement flag on `CatalogPriceHistoryEntry`; auto-set when `starts_at`/`offer_id` present; set via `announce: true` price API param for external announcements. `priceKind.isPromotion` demoted to legacy fallback only.
- **D — Personalized pricing disclosure**: `isPersonalized: boolean` + `personalizationReason?: string` added to pricing response (outside omnibus block); gap 7 resolved in Phase 5.
- **E — Per-channel backfill**: `omnibus:backfill` updated with `--channel-id` param; iterates EU channels using each channel's `lookbackDays`; writes `backfillCoverage` map to config; admin UI warns when coverage diverges from current config.
- **F — `noChannelMode` config**: `'best_effort' | 'require_channel'`; default `'best_effort'`; EU storefronts SHOULD use `'require_channel'`; returns `missing_channel_context` applicabilityReason when required but absent.
- **G — DB immutability hardening**: PostgreSQL `BEFORE UPDATE OR DELETE` trigger in Phase 3 migration; runtime DB role restricted to `INSERT, SELECT`; `idempotency_key` column with unique constraint for deduplication on command retry.
- **H — `coverageStartAt` field**: added to `omnibus` block; non-null when `applicabilityReason = 'insufficient_history'`; set to `previousRow.recorded_at`; storefronts MUST use it to display "lowest since {date}" instead of "lowest in 30 days".
- **New applicabilityReason values**: `missing_channel_context`, `perishable_exempt`, `perishable_last_price`, `new_arrival_reduced_window`, `progressive_reduction_frozen`.
- **OmnibusConfig expanded**: `noChannelMode`, `backfillCoverage`, per-channel `progressiveReductionRule`/`perishableGoodsRule`/`perishableLookbackDays`/`newArrivalRule`/`newArrivalsLookbackDays`.
- **`CatalogPriceHistoryEntry` additions**: `is_announced`, `idempotency_key`.
- **Open Questions updated**: removed answered gap questions; added category-level `omnibusExempt`, `firstListedAt` precision, Market entity (Option B), progressive member-state list.
- **i18n**: all new applicabilityReason keys, `noChannelMode`, backfill coverage warning, storefront disclosure key.

### 2026-02-19 (rev 9)
- **Critical: Anchored window for promotion-linked prices**: `getLowestPrice` now reads `starts_at` from the presented price history entry; when set, `windowEnd = starts_at` and `windowStart = starts_at - lookbackDays` (fixed for the promotion's lifetime). Resolves sliding-window compliance gap (Gap 1). `promotionAnchorAt` field added to the API response block.
- **Critical: `applicable` rule rewritten — promotion detection replaces gross comparison**: the `presentedGross < previousPriceGross` catch-all is removed. `applicable` is now `true` only when the price has structural promotion signals: `starts_at IS NOT NULL`, `offer_id IS NOT NULL`, or `priceKind.isPromotion === true`. Resolves announced-vs-silent gap (Gap 6) and eliminates tax-rate-noise false positives (Q1).
- **`applicabilityReason` updated**: `is_promotion` renamed to `announced_promotion`; `price_reduction` and `no_reduction` removed; `not_announced` added (silent repricing); `not_in_eu_market` added (channel outside `enabledCountryCodes`).
- **EU country scope**: `enabledCountryCodes: string[]` added to `OmnibusConfig`; `countryCode` added to per-channel config; resolution returns `not_in_eu_market` for channels not in the list (Q3).
- **Compliance Gap Analysis section added**: documents all 7 gaps from external review (2026-02-19) with severity, phase disposition, and resolution notes.
- **Open Questions expanded**: Gaps 2–5 and Gap 7 added as future phase questions; retention policy and immediate-previous-price tracking retained.
- **i18n keys**: added `catalog.omnibus.settings.enabledCountryCodes`, `catalog.omnibus.settings.noPromotionSignalWarning`, `catalog.omnibus.priceEditor.anchoredWindow`.
- **Cache key for anchored windows**: when `promotionAnchorAt` is set, `windowStartDay` is derived from `promotionAnchorAt - lookbackDays` (stable for promotion lifetime) instead of `now() - lookbackDays`.
- **Risk section updated**: `applicable` false-negative risk severity downgraded from Medium to Low; scenario reframed as correct behavior per directive.

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
