# Omnibus Price Tracking (EU Directive 2019/2161)

> **Implementation-grade spec.** This document is written so an engineer or an AI agent can implement the feature with no further design decisions. It contains the regulatory basis, exact data shapes, full request/response examples, the resolution algorithm in pseudocode, worked numeric examples, and an exhaustive edge-case matrix. Where the law allows member-state variation, the behavior is **configuration-driven** and the configuration is specified precisely.
>
> **Legal disclaimer (informative):** the Regulatory Background section paraphrases EU law for engineering context; it is **not legal advice**. Final country-by-country parameters (lookback length, adopted derogations) MUST be confirmed with counsel and entered as per-channel configuration — the code does not hard-code any member-state rule.

## TLDR

**Key Points:**
- Add an append-only, immutable **price-history log** (`CatalogPriceHistoryEntry`) plus an application-layer **resolution service** (`catalogOmnibusService`) that computes the EU "Omnibus" reference price — the lowest price applied in the prior *N* days — for any announced price reduction.
- Compliance-grade: history is tamper-evident at the database layer (immutability trigger + role `REVOKE`); resolution is scoped per `tenant_id` / `organization_id` / channel, with promotion-anchored windows, EU-market gating, and member-state derogations.

**Scope:**
- Price-history capture on every price `create` / `update` / `delete` / `undo` (catalog module, command layer).
- Reference resolution with same-row net/gross selection, promotion anchoring, EU gating, and derogations (progressive reduction, perishable goods, new arrivals).
- Read APIs (`prices/history`, `prices/omnibus-preview`), config API (`config/omnibus`), products-list enrichment with an `omnibus` block + personalization flags.
- Admin UI (settings panel + price-editor reference row), i18n (en/pl/de/es), CLI backfill, immutable order/quote-line snapshot in sales.

**Concerns:**
- This is a **legal/compliance** feature — an incorrect reference price is a regulatory failure subject to fines. The history log MUST be immutable; resolution MUST take net **and** gross from the *same* historical row.
- The history table grows monotonically; a retention/partitioning plan is required before high-volume EU production (see Future / Known Gaps).

## Regulatory Background (informative)

Directive (EU) **2019/2161** ("Omnibus", in force 28 May 2022) amended Directive **98/6/EC** (Price Indication) by inserting **Article 6a**, and Directive **2011/83/EU** (Consumer Rights, "CRD") by adding **Article 6(1)(ea)**.

**Article 6a of 98/6/EC — prior reference price:**
1. **6a(1)** — Any announcement of a price reduction must state the **prior price**.
2. **6a(2)** — The "prior price" is the **lowest price applied by the trader during a period of not less than 30 days** before the price reduction.
3. **6a(3)** — Member States may set **different rules for goods liable to deteriorate or expire rapidly** (perishables) — e.g. full exemption or a "last price" rule.
4. **6a(4)** — Where a product has been **on the market for less than 30 days**, Member States may provide for a **shorter reference period**.
5. **6a(5)** — Where the price reduction is **progressively increased** (a continuous campaign of deepening discounts), the prior price is the price **before the first** reduction (not a recalculated rolling minimum).

**Commission Notice 2021/C 526/02** (guidance) clarifies: the rule applies to *announcements* of reductions, not to routine/silent price fluctuations; "generic" reduction announcements ("up to 50%") must still respect the prior-price rule for each item; loyalty-program and individualized discounts not addressed to the general public are out of scope of 6a but the personalization disclosure (below) may apply.

**Article 6(1)(ea) of the CRD — personalized pricing disclosure:** the trader must inform the consumer when the **price was personalized on the basis of automated decision-making** (profiling).

**Member-state variation (illustrative — confirm with counsel, configure per channel):** the base period is "at least 30 days" but some states require longer; derogations 6a(3)–(5) are optional and adopted differently per state (e.g. some states set a 7-day window for new goods, some leave new-goods/perishables to the trader's discretion, some did not adopt the progressive-reduction derogation). **The code hard-codes none of this** — every parameter is per-channel configuration (`lookbackDays`, `enabledCountryCodes`, `progressiveReductionRule`, `perishableGoodsRule`, `newArrivalRule`, …).

**Mapping to this feature:**

| Legal requirement | Mechanism in this spec |
|-------------------|------------------------|
| 6a(2) lowest price in ≥30 days | `CatalogPriceHistoryEntry` log + `lookbackDays` window, `MIN` by axis |
| reference fixed for the campaign | `starts_at`-anchored window (frozen `windowEnd`) |
| announced reductions only | `applicable` rule (`starts_at` ∨ `offer_id` ∨ `is_announced` ∨ promotion kind) |
| 6a(3) perishables | product `omnibus_exempt` + channel `perishableGoodsRule` |
| 6a(4) new arrivals | product `first_listed_at` + channel `newArrivalRule` / `newArrivalsLookbackDays` |
| 6a(5) progressive reduction | channel `progressiveReductionRule` + offer-grouped detection (freeze to pre-campaign baseline) |
| member-state variation | per-channel config; `enabledCountryCodes` gating |
| 6(1)(ea) personalization | `isPersonalized` / `personalizationReason` in response + order/quote snapshot |
| audit/proof | append-only log + DB immutability trigger + `REVOKE` |

## Overview

This feature gives Open Mercato a first-class, tenant-scoped mechanism to **record** every price change and **compute** the Omnibus reference price deterministically and provably. It lives entirely inside the existing **catalog** module (history, resolution, API, UI, CLI), with a thin, optional read-side touchpoint in the **sales** module (an immutable order/quote-line snapshot). No new module; no cross-module ORM relationships.

> **Market Reference:** studied Medusa's price-list model and Shopware 6's Omnibus implementation. **Adopted:** an append-only history table as the single source of truth, and a separate "lowest reference price" computation rather than a denormalized field. **Rejected:** storing the reference on the price row (no provenance, breaks under multi-channel/tax variance, mutable) and ORM lifecycle hooks for immutability (bypassable by `nativeUpdate`/raw SQL — a DB trigger is used instead).

## Prerequisites & Cross-Spec Dependencies

- **Relationship to `SPEC-033-2026-02-18-omnibus-price-tracking.md`:** this spec **supersedes the intent** of the legacy SPEC-033 (which was authored against an older `develop`). SPEC-033 remains in the repo as the historical design record until intentionally normalized; this `{date}-{title}` document is the current source of truth (the project deprecated `SPEC-NNN-` filename prefixes). No content from SPEC-033 is dropped — all seven compliance gaps are carried forward here.
- **Runtime dependencies (existing platform services):**
  - `ModuleConfigService` (`configs` module) — tenant-scoped config storage (`catalog.omnibus` key).
  - `@open-mercato/cache` (DI key `cache`) — resolution result cache.
  - `eventBus` / catalog command bus — price writes that produce history.
  - `findWithDecryption` / `findOneWithDecryption` (`@open-mercato/shared`) — scoped reads.
  - Mutation-guard registry (`@open-mercato/shared/lib/crud/mutation-guard-registry`) — config PATCH.
- **Optional peer:** `sales` module consumes `catalogOmnibusService` defensively (snapshot capture); omnibus does **not** depend on sales.
- **Non-goals (out of scope for this spec):** storefront customer-facing display of the reference price (deferred — see Future / Known Gaps); a first-class `Market` entity (per-channel config is used instead); price *selection* logic (handled by `catalogPricingService`; this feature only reads history and computes a reference).

## Problem Statement

- **No price history** → "lowest price in 30 days" cannot be computed or audited.
- **No provable reference** → a naïve "previous price" is wrong (sliding window) and unprovable (mutable).
- **Tax/channel variance trap** → independent `MIN(net)`/`MIN(gross)` yields a price pair that never existed.
- **EU-only, member-state-variable** → a global toggle over-triggers; rules differ per state.
- **Announced vs. silent** → the directive covers *announced* reductions only.

## Proposed Solution

1. **Record** an immutable `CatalogPriceHistoryEntry` on every price mutation through the catalog command layer. Writes are best-effort and isolated (forked `EntityManager`, after `flush`, in `try/catch`) so a history failure never aborts the price write.
2. **Resolve** the reference in `catalogOmnibusService`: baseline (last entry before the window) + all in-window entries → select the single row with the lowest value on the configured axis (`gross` default) → return that row's net **and** gross.
3. **Anchor** the window to the promotion's `starts_at` (or the offer's first entry) so the reference does not drift during a long promotion.
4. **Gate** to *announced* reductions and EU channels (`enabledCountryCodes`).
5. **Protect** the log with a DB immutability trigger + partial-unique idempotency index + a `REVOKE UPDATE/DELETE` deploy step.
6. **Surface** via read APIs, an admin settings panel, a price-editor reference row, and an immutable sales-line snapshot.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Append-only history as single source of truth | Provenance + auditability; the reference must be reconstructable and tamper-evident. |
| DB immutability **trigger** (not ORM `beforeSave`) + `REVOKE` | A legal log must be immutable regardless of access path. ORM hooks are bypassed by `nativeUpdate`/QueryBuilder/raw SQL. |
| Reference computed in the **application layer** | Config-driven, multi-branch logic; testable service code, not SQL. |
| net + gross from the **same** row | Independent `MIN(net)`/`MIN(gross)` across mixed tax rates yields a non-existent pair. |
| Applicability from **announcement signals**, not price comparison | `applicable = startsAt ∨ offerId ∨ isAnnounced ∨ priceKind.isPromotion`; tax-only change does not trigger. |
| Window **anchored** to `starts_at` | A sliding window would shift the reference on day 31 of a 45-day promotion. |
| `recorded_at` = app-set UTC, ms precision, no DB default | One clock source for all window math; avoids skew-induced drift. |
| `idempotency_key = sha256(price_id ∣ change_type ∣ recorded_at.toISOString())` | Dedup on retry; a recurring sale returning to a prior price still records a fresh timestamped row. |
| EU gating via `enabledCountryCodes` + per-channel `countryCode` | Non-EU channels must not over-trigger. Empty list ⇒ `not_in_eu_market`, no query. |
| Storefront forces `require_channel` | An EU storefront with no channel must not blend channels. |
| Progressive reduction freezes to **pre-campaign baseline** | Art. 6a(5). |
| Sales snapshot **immutable** after line creation | The reference at purchase time is legal evidence. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Denormalize "reference price" onto `CatalogProductPrice` | No provenance, mutable, breaks under channel/tax variance. |
| ORM `@BeforeUpdate`/onFlush immutability | Bypassed by `nativeUpdate`/QueryBuilder/raw SQL. |
| Compute reference in a SQL view/trigger | Config-driven multi-branch logic not maintainable/testable in SQL. |
| Content-based idempotency key | Collides on legitimately-repeated prices → silent loss. |
| First-class `Market` entity | Deferred; per-channel config (channel == market) covers current needs. |

## User Stories / Use Cases

- **A merchant** wants the admin/storefront to show the correct "lowest price in 30 days" next to a promotion **so that** the shop is EU-Omnibus compliant.
- **A compliance auditor** wants an immutable, tenant-scoped price-history log **so that** any displayed reference can be reconstructed and proven.
- **A catalog operator** wants to configure lookback, EU countries, and per-channel/market rules **so that** Omnibus behaves correctly per member state.
- **An operator enabling Omnibus** wants the system to refuse activation until history is backfilled **so that** the first promotions are not computed against an empty window.
- **A B2B operator** wants to minimize on `net` **so that** the reference matches the channel's pricing convention.
- **A storefront developer** wants `promotionAnchorAt` + `applicabilityReason` in the API **so that** the UI can render the correct disclosure text.

## Architecture

```
price write (create/update/delete/undo) ── catalog command layer
        │  after em.flush(), forked EM, try/catch — best-effort; NEVER aborts the price write
        ▼
recordPriceHistoryEntry ──► catalog_price_history_entries  (append-only; DB-immutable trigger)
        ▲                                   │
        │ backfill (CLI)                    │ read (findWithDecryption; tenant_id + organization_id)
        │                                   ▼
                 catalogOmnibusService.resolveOmnibusBlock / getLowestPrice
                 (baseline + in-window → lowest by axis; same-row net/gross; promotion anchor;
                  EU gating; progressive / perishable / new-arrival; 5-min TTL cache incl. anchor day)
        │                         │                         │
        ▼                         ▼                         ▼
 products list API        prices/omnibus-preview      sales order/quote line
 (afterList enrich)       (price-editor row)          (immutable snapshot; optional peer)
```

- **Tenant isolation:** every history query filters `tenant_id` **and** `organization_id`; resolution context carries both; routes use feature guards.
- **Module isolation:** catalog owns history + resolution. Sales is the **optional consumer** — resolves `catalogOmnibusService` via DI in `try/catch` (degrades to `null` if absent), references prices by FK id + denormalized snapshot. No cross-module ORM relations; verified by `packages/core/src/__tests__/module-decoupling.test.ts`.
- **DI:** `catalogOmnibusService` registered in `catalog/di.ts` via `asFunction(({ moduleConfigService, cache }) => new DefaultCatalogOmnibusService(moduleConfigService, cache)).scoped()`.
- **Caching:** DI-resolved `@open-mercato/cache` (5-min TTL; cache key is tenant/org/scope-specific and includes the promotion anchor day so sliding vs. anchored windows never collide). **Cache-miss behavior:** compute via the resolution algorithm, then `set`. **Invalidation (MUST):** every price write (`catalog.prices.create|update|delete` and their undos) MUST invalidate the omnibus cache tag for the affected `(tenant, org, product/variant, channel)` scope, **after the DB write commits** (never inside the write transaction — same rule as command side-effects, `packages/core/AGENTS.md` → withAtomicFlush / cache consistency). If a write path cannot invalidate precisely, the result is bounded-stale up to the 5-min TTL — an accepted fallback for admin reads, **not** a correctness guarantee for a storefront reference (see Known Gaps; for storefront use, precise post-commit invalidation is mandatory).

### Commands & Events

- **Commands** (existing catalog price commands, extended): `catalog.prices.create` / `update` / `delete`. Each records a history entry; **all** undo paths record `change_type='undo'`. Undo uses `extractUndoPayload` (standard contract).
- **Events:** **no new event IDs.** History recording is a synchronous side effect of the existing price commands; `catalog.price.created|updated|deleted` unchanged. (Intentionally not event-driven — recording stays in the same logical operation as the price write, while failure-isolated.)

## Data Models

### CatalogPriceHistoryEntry (singular) — `catalog_price_history_entries`

Immutable snapshot of a `CatalogProductPrice` at the moment of change. Never updated/deleted. **No** `created_at` / `updated_at` / `deleted_at` (append-only log — exempt from optimistic-lock and soft-delete conventions).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `tenant_id` | UUID | Required; in every query |
| `organization_id` | UUID | Required; in every query |
| `price_id` | UUID | FK id to `CatalogProductPrice` (no ORM relation) |
| `product_id` | UUID | Denormalized for lookback |
| `variant_id` | UUID? | Null if product-level |
| `offer_id` | UUID? | Null if not offer-scoped |
| `channel_id` | UUID? | Null if not channel-scoped |
| `price_kind_id` | UUID | FK id to `CatalogPriceKind` |
| `price_kind_code` | string | Denormalized — survives rename |
| `currency_code` | string(3) | ISO 4217 |
| `unit_price_net` | numeric(16,4)? | Excl. tax (matches `CatalogProductPrice`) |
| `unit_price_gross` | numeric(16,4)? | Incl. tax |
| `tax_rate` | numeric(7,4)? | Rate at capture |
| `tax_amount` | numeric(16,4)? | Tax amount at capture |
| `min_quantity` | int? | Tier lower bound |
| `max_quantity` | int? | Tier upper bound |
| `starts_at` | timestamptz? | Validity start (from source) — promotion anchor |
| `ends_at` | timestamptz? | Validity end |
| `recorded_at` | timestamptz (UTC) | **App-set, ms precision, no DB default**; immutable |
| `change_type` | enum | `create` \| `update` \| `delete` \| `undo` |
| `source` | enum | Capture origin (`api`, `system`) |
| `is_announced` | boolean? | `true` if `starts_at ∨ offer_id ∨ announce`; `false` if no signal; `null` only legacy (treat as `false`) |
| `idempotency_key` | string? | `sha256(price_id∣change_type∣recorded_at.toISOString())`; `null` for backfill/system rows |
| `metadata` | jsonb? | Optional caller context |

**Indexes** (explicit in migration; prefixed `(tenant_id, organization_id, …)`, trailing `recorded_at DESC`; UTC):

| Index | Columns | Purpose |
|-------|---------|---------|
| Product lookback (channel-agnostic) | `(tenant_id, organization_id, product_id, price_kind_id, currency_code, recorded_at DESC)` | Baseline + window, no channel |
| Product lookback (channel-scoped) | `(tenant_id, organization_id, product_id, channel_id, price_kind_id, currency_code, recorded_at DESC)` | With channel |
| Variant lookback (channel-agnostic) | `(tenant_id, organization_id, variant_id, price_kind_id, currency_code, recorded_at DESC)` | Variant, no channel |
| Variant lookback (channel-scoped) | `(tenant_id, organization_id, variant_id, channel_id, price_kind_id, currency_code, recorded_at DESC)` | Variant, with channel |
| Offer lookback | `(tenant_id, organization_id, offer_id, price_kind_id, currency_code, recorded_at DESC)` | Offer / progressive |
| By price id | `(tenant_id, organization_id, price_id)` | Audit |
| **Idempotency (partial unique)** | `(tenant_id, organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL` | Retry dedup |

**Immutability — MANUAL DDL appended to the migration** (exception to the "never hand-write migrations" rule; mark the block `-- MANUAL DDL: immutability trigger and role restriction`):

```sql
-- MANUAL DDL: immutability trigger and role restriction
CREATE OR REPLACE FUNCTION prevent_history_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'catalog_price_history_entries is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER history_immutable
  BEFORE UPDATE OR DELETE ON catalog_price_history_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_history_modification();

-- DEPLOY RUNBOOK (production): grant the app role INSERT/SELECT only.
-- REVOKE UPDATE, DELETE ON catalog_price_history_entries FROM <app_db_role>;
```

`CREATE OR REPLACE TRIGGER` requires PG14+ (platform targets PostgreSQL 17). The trigger, partial-unique index, and `DESC` ordering are intentionally **not** reflected in `.snapshot-open-mercato.json` so `yarn db:generate` does not re-diff them. `down()` drops trigger → function → table.

**"No channel filter" mode:** when `channelId` is absent, channel-agnostic indexes are used and rows from all channels blend — a deliberate trade-off to avoid silent `no_history`. Storefront contexts are forced to require a channel.

### CatalogProduct / CatalogProductVariant (extensions)

| Column | Type | Notes |
|--------|------|-------|
| `CatalogProduct.omnibus_exempt` | boolean (default `false`) | Perishable/exempt goods |
| `CatalogProduct.first_listed_at` | timestamptz? | "On the market" anchor (6a(4)); **defaults to `created_at`** on create |
| `CatalogProductVariant.omnibus_exempt` | boolean? | Nullable = inherit from product |

### SalesOrderLine and SalesQuoteLine (snapshot — both entities)

Six **immutable** columns captured at line creation, never recomputed on edit (the `numeric(18,4)` precision matches the sales line-amount columns, intentionally wider than the history table's `numeric(16,4)`): `omnibus_reference_net` / `omnibus_reference_gross` (numeric(18,4)?), `omnibus_promotion_anchor_at` (timestamptz?), `omnibus_applicability_reason` (string?), `is_personalized` (boolean?), `personalization_reason` (string?).

### OmnibusConfig (`module-config-service`, key `catalog.omnibus`, tenant-scoped)

```ts
{
  enabled: boolean                  // default false; master switch, gated per-channel by enabledCountryCodes
  enabledCountryCodes: string[]     // ISO 3166-1 alpha-2; EMPTY = disabled for ALL channels; 'EU' rejected
  noChannelMode: 'best_effort' | 'require_channel'  // default 'best_effort'; storefront forced to 'require_channel'
  lookbackDays: number              // default 30; integer [1,365]
  minimizationAxis: 'gross' | 'net' // default 'gross' (B2C); 'net' for B2B
  defaultPresentedPriceKindId?: string // UUID; used when no channel override matches. REQUIRED only when enabled=true (GET returns {} for an unset config, so the field is absent until first configured)
  backfillCoverage: Record<string, { completedAt: string; lookbackDays: number }>  // key = channelId; '' = global/unscoped
  channels: Record<string, {
    presentedPriceKindId: string
    countryCode?: string            // ISO alpha-2; maps channel to a member state; omitted while enabledCountryCodes non-empty ⇒ non-EU
    lookbackDays?: number
    minimizationAxis?: 'gross' | 'net'
    progressiveReductionRule?: boolean                 // Art. 6a(5)
    progressiveMaxGapDays?: number                     // default 7; max days BETWEEN CONSECUTIVE offer entries for the sequence to count as one continuous campaign
    perishableGoodsRule?: 'standard' | 'exempt' | 'last_price'   // Art. 6a(3); 'standard' uses the normal lookback, no extra param
    newArrivalRule?: 'standard' | 'shorter_window'     // Art. 6a(4)
    newArrivalsLookbackDays?: number | null            // null = trader's discretion
  }>
}
```

**Zod validation (PATCH):** UUIDs for `presentedPriceKindId`/`defaultPresentedPriceKindId`; `lookbackDays` integer [1,365]; `minimizationAxis` defaults `'gross'`; `enabledCountryCodes` valid alpha-2 (`'EU'` rejected); `channels[*].countryCode` valid alpha-2 if present; `noChannelMode` defaults `'best_effort'`; `progressiveMaxGapDays` defaults `7`. **Conditional requirement:** when `enabled = true`, a presented price kind MUST be resolvable for every in-scope EU channel — i.e. `defaultPresentedPriceKindId` is set, or each such channel sets its own `presentedPriceKindId`; the PATCH rejects (400) an `enabled:true` config that leaves any in-scope channel without one. History is captured for **all** price kinds; the presented-kind config controls only which kind is *queried* for the reference.

> **Encryption:** history columns are commercial pricing data, not PII/GDPR-relevant → no `encryption.ts` entry required. Reads still route through `findWithDecryption` so the feature stays correct if the catalog entity later adopts encrypted fields. No new PII introduced.

## API Contracts

All routes export `openApi`, declare `metadata.requireFeatures`, authenticate via `getAuthFromRequest`, and scope every query by `tenant_id` + `organization_id`. All examples are illustrative but field-accurate. **Wire format for money:** all price fields are serialized as **fixed 4-decimal strings** (e.g. `"100.0000"`); the Worked Examples may abbreviate (`"100"`) for readability — the API always emits 4 decimals.

> **Canonical-mechanism note:** `prices/history` and `prices/omnibus-preview` are intentionally **custom read-only routes** (not `makeCrudRoute`) — they are computed read endpoints, not CRUD over an entity, so the CRUD factory does not apply. `config/omnibus` is a **custom write route** and therefore wires the mutation-guard registry (below). The underlying price writes that *produce* history go through the existing `makeCrudRoute`/command path for `CatalogProductPrice`, which is where the canonical CRUD + command + undo contract lives.

### GET /api/catalog/prices/history
- **Auth:** `catalog.price_history.view`
- **Query:** `productId | variantId | priceKindId | channelId | currencyCode`; `from` / `to` (inclusive on `recorded_at`); `pageSize` (≤100); `cursor` (base64 keyset `{recordedAt,id}`); `includeTotal?`.
- **Order:** `recorded_at DESC, id DESC`; `limit pageSize+1` → `hasMore`. `total` omitted unless `includeTotal=true`. Reads via `findWithDecryption`. Invalid cursor → first page.

Request: `GET /api/catalog/prices/history?productId=PRD&priceKindId=PK&pageSize=2&includeTotal=true`

```json
{
  "items": [
    { "id": "h2", "priceId": "PRC", "productId": "PRD", "priceKindId": "PK",
      "currencyCode": "PLN", "unitPriceNet": "65.0407", "unitPriceGross": "80.0000",
      "taxRate": "23.0000", "changeType": "update", "isAnnounced": true,
      "startsAt": "2026-06-01T00:00:00.000Z", "recordedAt": "2026-06-01T08:30:00.123Z" },
    { "id": "h1", "priceId": "PRC", "productId": "PRD", "priceKindId": "PK",
      "currencyCode": "PLN", "unitPriceNet": "81.3008", "unitPriceGross": "100.0000",
      "taxRate": "23.0000", "changeType": "create", "isAnnounced": false,
      "startsAt": null, "recordedAt": "2026-05-01T09:00:00.456Z" }
  ],
  "nextCursor": null,
  "total": 2
}
```
(`nextCursor` is `null` here because `pageSize=2` returned the full set — `hasMore=false`. A non-final page returns a base64-encoded `{recordedAt,id}` cursor, e.g. `eyJyZWNvcmRlZEF0IjoiMjAyNi0wNS0wMVQwOTowMDowMC40NTZaIiwiaWQiOiJoMSJ9`.)

Errors: `401 {"error":"Unauthorized"}`; `400 {"error":"Invalid query","details":{...}}`.

### GET /api/catalog/prices/omnibus-preview
- **Auth:** `catalog.price_history.view`
- **Query:** `priceKindId` + `currencyCode` (required) + at least one of `productId | variantId | offerId` (+ optional `channelId`).
- **Presented entry:** the route resolves the *presented entry* (the current active `CatalogProductPrice` of the requested `priceKindId` for the scope, mapped to its latest history entry, + `priceKindIsPromotion = kind.isPromotion`) and passes it to `resolveOmnibusBlock` — so the preview applies the same anchoring + EC-7 exclusion as the authoritative products-list path. (Known Gap: as-built passes `null`.)
- **Response:** `OmnibusBlock | null` (null only when Omnibus disabled). Product read via `findOneWithDecryption`. `safeParse` → 400.

Request: `GET /api/catalog/prices/omnibus-preview?priceKindId=PK&currencyCode=PLN&productId=PRD`

```json
{
  "presentedPriceKindId": "PK",
  "lookbackDays": 30,
  "minimizationAxis": "gross",
  "promotionAnchorAt": "2026-06-01T00:00:00.000Z",
  "windowStart": "2026-05-02T00:00:00.000Z",
  "windowEnd": "2026-06-01T00:00:00.000Z",
  "coverageStartAt": null,
  "lowestPriceNet": "81.3008",
  "lowestPriceGross": "100.0000",
  "previousPriceNet": "81.3008",
  "previousPriceGross": "100.0000",
  "currencyCode": "PLN",
  "applicable": true,
  "applicabilityReason": "announced_promotion"
}
```

### GET | PATCH /api/catalog/config/omnibus
- **GET auth:** `catalog.settings.view`; **PATCH auth:** `catalog.settings.manage`. (Follows the module's `<resource>.view` / `<resource>.manage` convention and reuses the pre-existing `catalog.settings.manage`; do **not** introduce a parallel `catalog.settings.edit`.)
- **GET:** returns the resolved tenant-scoped `OmnibusConfig` (`{}` when unset).
- **PATCH:** validates with zod, persists via `ModuleConfigService.setValue(..., scope)`. As a custom write route it follows the full 4-step mutation-guard contract (`packages/core/AGENTS.md` → API Routes): map to registry operation **`update`**; collect `getAllMutationGuardInstances()` and append `bridgeLegacyGuard(container)` when present; call `runMutationGuards(allGuards, input, { userFeatures })` before persisting; on block return `guardResult.errorBody`/`errorStatus`; merge `modifiedPayload`; run each `afterSuccessCallbacks` item after success (catching/logging callback failures). PATCH is `optimistic-lock-exempt` (single tenant config blob).
- **422 gate:** enabling with an in-scope EU channel lacking coverage → 422.

PATCH request:
```json
{ "enabled": true, "enabledCountryCodes": ["PL","DE"], "lookbackDays": 30,
  "channels": { "ch-pl": { "presentedPriceKindId": "PK", "countryCode": "PL" } } }
```
422 response (no backfill yet):
```json
{ "field": "enabled", "error": "backfill_required_before_enable", "channels": ["ch-pl"] }
```
200 response: the merged `OmnibusConfig`. Errors: `401`; `400 {"error":"Invalid config","details":{...}}` / `{"error":"Invalid JSON body"}`.

### Extended price-resolution response (products list — `GET /api/catalog/products`)
An `afterList` hook (`decorateProductsAfterList`) enriches each item — tenant/org scoped, resolved in parallel (no N+1). The products route's exported `openApi` MUST be updated to document these additive response fields (`omnibus` block + top-level `isPersonalized`/`personalizationReason`):

| Field | Type | Notes |
|-------|------|-------|
| `omnibus.lowestPriceNet` / `lowestPriceGross` | string\|null | Reference price (same row) |
| `omnibus.previousPriceNet` / `previousPriceGross` | string\|null | Price **in effect at window start** (the baseline row, `recorded_at <= windowStart`); when no baseline exists it is the oldest in-window candidate (`insufficient_history`). Informational — **not** the legal reference (that is `lowestPrice*`). |
| `omnibus.lookbackDays` | number | Effective window (post new-arrival) |
| `omnibus.windowStart` / `windowEnd` | string | ISO bounds |
| `omnibus.promotionAnchorAt` | string\|null | Anchor |
| `omnibus.coverageStartAt` | string\|null | Set on `insufficient_history` |
| `omnibus.applicable` | boolean | Announced gate |
| `omnibus.applicabilityReason` | enum | see below |
| `isPersonalized` | boolean | 6(1)(ea) disclosure trigger |
| `personalizationReason` | string\|null | machine-readable reason |

`applicabilityReason ∈ { no_history, not_in_eu_market, missing_channel_context, insufficient_history, announced_promotion, not_announced, progressive_reduction_frozen, perishable_exempt, perishable_last_price, new_arrival_reduced_window }`.

## Resolution Algorithm (pseudocode — `computeLowestPrice` → `resolveOmnibusBlock`)

```
function resolveOmnibusBlock(em, ctx, presentedEntry, priceKindIsPromotion):
  config = getConfig(ctx.tenantId, ctx.organizationId)
  if config.enabled != true: return null
  result = computeLowestPrice(em, ctx, config, presentedEntry)
  if result.reason in {not_in_eu_market, missing_channel_context}: return emptyBlock(result)
  if result.lowestRow == null: return emptyBlock(result.reason ?? 'no_history')
  applicable = presentedEntry.startsAt? ∨ presentedEntry.offerId? ∨ presentedEntry.isAnnounced==true ∨ priceKindIsPromotion
  reason = result.reason ?? (result.insufficientHistory ? 'insufficient_history'
                            : applicable ? 'announced_promotion' : 'not_announced')
  return block(presentedKind, result, applicable, reason)

function computeLowestPrice(em, ctx, config, presentedEntry):
  if !config.enabled: return early('no_history')                                  # (also short-circuited above)
  codes = config.enabledCountryCodes ?? []
  if codes is empty: return early('not_in_eu_market')                            # NO DB query
  channelConfig = ctx.channelId ? config.channels[ctx.channelId] : undefined
  if ctx.channelId == null:
      mode = ctx.isStorefront ? 'require_channel' : (config.noChannelMode ?? 'best_effort')
      if mode == 'require_channel': return early('missing_channel_context')       # NO DB query
  else:
      cc = channelConfig?.countryCode
      if cc == null or cc not in codes: return early('not_in_eu_market')          # NO DB query
  lookbackDays = channelConfig?.lookbackDays ?? config.lookbackDays ?? 30
  axis = channelConfig?.minimizationAxis ?? config.minimizationAxis ?? 'gross'
  offerId = ctx.offerId ?? presentedEntry?.offerId
  firstOffer = offerId ? fetchFirstOfferEntry(offerId) : null
  if offerId and firstOffer and channelConfig?.progressiveReductionRule:           # M6: gate on the derived offerId (ctx OR presented)
      r = resolveProgressive(em, ctx, firstOffer, axis, lookbackDays); if r: return r   # else fall through
  p = resolvePerishable(em, ctx, channelConfig, lookbackDays, axis); if p: return p
  newArr = resolveNewArrival(channelConfig, ctx, lookbackDays); effLookback = newArr?.lookbackDays ?? lookbackDays
  anchor = presentedEntry?.startsAt ?? firstOffer?.recordedAt ?? null
  windowEnd = anchor ?? now();  windowStart = windowEnd - effLookback days
  anchorDay = anchor ? truncToUtcDay(anchor) : 'none'                            # cache dimension: keeps anchored vs sliding windows distinct
  cached = cache.get(key(ctx, axis, truncToUtcDay(windowStart), anchorDay)); if cached: return cached
  baseline = fetchBaseline(recorded_at <= windowStart, DESC, 1)                  # newest row at/before windowStart = the price in effect at window start
  inWindow = fetchInWindow(windowStart < recorded_at <= windowEnd, DESC, 1000)   # INCLUSIVE upper bound

  # --- EC-7 (MUST): exclude the presented reduction from its own reference set ---
  # Identify the presented reduction by EXACT identity; and never count rows recorded at/after the promo anchor.
  isPresentedReduction(r) := presentedEntry != null
        AND r.price_id   == presentedEntry.price_id
        AND r.change_type == presentedEntry.change_type
        AND r.recorded_at == presentedEntry.recorded_at
  candidates = ([baseline?] ++ inWindow).filter(r ->
        not isPresentedReduction(r)
        AND (anchor == null OR r.recorded_at < anchor))                         # rows at/after the anchor are not "prior" prices

  if candidates is empty: lowestRow = null; previousRow = null; insufficient = false        # → reason 'no_history' upstream
  else:
    lowestRow = argmin(candidates, by getPriceValue(·, axis))                   # getPriceValue: null axis value → +Infinity
                # TIE-BREAK (deterministic): lowest axis value, then earliest recorded_at, then smallest id
    if getPriceValue(lowestRow, axis) == +Infinity: lowestRow = null            # all candidates null on axis → 'no_history'
    baselineKept = (baseline != null AND baseline ∈ candidates)
    if baselineKept: previousRow = baseline; insufficient = false; coverageStartAt = null    # baseline = price at window start
    else:            previousRow = oldest(candidates by recorded_at, then id); insufficient = true; coverageStartAt = previousRow.recorded_at
  result = {lowestRow, previousRow, insufficient, promotionAnchorAt: anchor, coverageStartAt, windowStart, windowEnd, effLookback, axis}
  cache.set(...); return result
```

`resolveProgressive`: fetch the offer's entries ASC by `recorded_at`; the sequence qualifies when it is monotonically non-increasing on `axis` **and** every gap **between consecutive entries** is `<= channel.progressiveMaxGapDays` (default 7). On qualify → `lowestRow = pre-campaign baseline` (the last entry strictly before the offer's first entry — the price before the first reduction), `previousRow = deepest campaign price` (the last/lowest offer entry), reason `progressive_reduction_frozen`; **if no pre-campaign baseline exists → return null (fall through to standard)**. `resolvePerishable`: `exempt` → `perishable_exempt`; `last_price` → reference = the **immediately-preceding entry** = the newest history entry strictly before the current/presented price (deterministic; ties broken by `id`), reason `perishable_last_price`. `resolveNewArrival`: product age (`now − first_listed_at`) `< lookbackDays` and `newArrivalRule = 'shorter_window'` → `effLookback = newArrivalsLookbackDays` (or, when `null`, the product's actual age), reason `new_arrival_reduced_window`. Idempotency on write: `23505` on `idempotency_key` swallowed as success.

## Worked Examples (numeric)

All examples: tenant `T`, org `O`, product `PRD`, price kind `PK` (`isPromotion=false` unless noted), currency `PLN`, `lookbackDays=30`, `axis='gross'`, channel `ch-pl` (`countryCode='PL'`), `enabledCountryCodes=['PL']`, "today" = 2026-06-10.

**E1 — Standard announced reduction (happy path).**
- History (gross): `100.00` recorded 2026-05-01 (`create`, not announced); `80.00` recorded 2026-06-01 (`update`, `starts_at=2026-06-01`, announced — this is the promotion being displayed).
- **Required legal outcome:** the reference price = lowest price in the 30 days **before** the reduction = **`100.00`**. The promo price (`80.00`) is what the customer pays now; it is **not** its own reference.
- **How the algorithm must achieve it:** when resolving for the presented promo entry, `windowEnd = starts_at = 2026-06-01`, `windowStart = 2026-05-02`. The candidate set is the baseline + in-window entries **excluding the presented promo entry itself**. Baseline (`100.00` @ 05-01, the last row `≤ windowStart`) is the only candidate ⇒ `lowestPriceGross="100.0000"`, `applicable=true`, `announced_promotion`, `promotionAnchorAt="2026-06-01..."`.
- **Implementation constraint (critical, enforced by the algorithm):** the presented reduction is excluded from its own reference set. The Resolution Algorithm does this with a single unambiguous rule (identical in pseudocode, EC-7, and test C16): candidates use an **inclusive** `recorded_at <= windowEnd` window, then drop (i) the exact presented entry via `isPresentedReduction` (`price_id` + `change_type` + `recorded_at` identity) **and** (ii) any row with `recorded_at >= anchor` when an anchor exists. With `anchor = starts_at = 2026-06-01`, the promo row (recorded at 06-01) is dropped by rule (ii) (`recorded_at >= anchor`), leaving baseline `100.00` as the only candidate. Without this the lowest would collapse to the promo price (`80.00`) — a compliance bug.
- **Presented entry (both paths):** the products-list enrichment **and** the `omnibus-preview` route resolve the *presented entry* the same way — the current active `CatalogProductPrice` of the resolved presented price kind (`channel.presentedPriceKindId ?? defaultPresentedPriceKindId ?? ctx.priceKindId`), mapped to its latest history entry, with `priceKindIsPromotion = that kind.isPromotion`. (Known Gap: the as-built preview currently passes `null` — fix it to derive the presented entry so the preview matches the authoritative result. Storefront, when built, MUST also pass it.)

**E2 — Tax-only change (must NOT trigger).** History: net 81.30 / gross 100.00 @ 23% on 2026-05-01; net 81.30 / gross 102.44 @ 26% on 2026-06-05 (VAT change, net unchanged, no `starts_at`/`offer`). Preview: `applicable=false`, `not_announced`; storefront does not render an Omnibus reference.

**E3 — Same-row net/gross (mixed tax trap).** In-window rows: A = net 85 / gross 90 (@~5.9%), B = net 70 / gross 95. Lowest by `gross` = A (90). Reference = A's pair → `lowestPriceNet="85"`, `lowestPriceGross="90"` — **not** net 70 (B) + gross 90 (A).

**E4 — Anchored window, 45-day promo.** `starts_at=2026-05-01`, today 2026-06-15 (day 45). Window = 2026-04-01 … 2026-05-01 (frozen). The reference does **not** shift to a later 30-day window on day 31+. `promotionAnchorAt="2026-05-01..."`.

**E5 — Progressive reduction (6a(5)).** Offer `OF`, `progressiveReductionRule=true`. Pre-campaign baseline 100 (@2026-04-20). Offer entries: 90 (05-01), 80 (05-05), 70 (05-09) — consecutive gaps ≤ `progressiveMaxGapDays` (7) and monotonically non-increasing. Result: `progressive_reduction_frozen`; `lowestPriceGross="100"` (frozen baseline), `previousPriceGross="70"` (current deepest). If pre-campaign baseline missing → falls through to standard.

**E6 — Insufficient history.** No baseline before the window; in-window rows exist, e.g. 95 @ 06-02 and 90 @ 06-05. `applicabilityReason="insufficient_history"`. `lowestPriceGross="90"` (the **lowest-valued** candidate via `argmin`, here the 90 row), while `previousPrice`/`coverageStartAt` come from the **oldest** in-window row (95 @ 06-02 → `coverageStartAt="2026-06-02..."`). (Lowest ≠ oldest — they coincide only with a single in-window row.)

**E7 — EU gating.** `enabledCountryCodes=[]` → `not_in_eu_market` (no DB query). Or channel `ch-us` with `countryCode='US'` not in `['PL']` → `not_in_eu_market`.

**E8 — Missing channel on storefront.** `isStorefront=true`, no `channelId` → `missing_channel_context` (no DB query), regardless of `noChannelMode`.

## Edge Cases (exhaustive)

| # | Edge case | Expected behavior |
|---|-----------|-------------------|
| EC-1 | `enabled=false` | `resolveOmnibusBlock` → `null`; no history query |
| EC-2 | `enabledCountryCodes=[]` | `not_in_eu_market`, no DB query |
| EC-3 | Channel `countryCode` missing while `enabledCountryCodes` non-empty | treated as non-EU → `not_in_eu_market` |
| EC-4 | No channel + admin context + `best_effort` | proceed, blend all channels (best-effort) |
| EC-5 | No channel + storefront | `missing_channel_context` (forced require_channel), no query |
| EC-6 | No baseline, no in-window rows | `no_history`, empty block (`lowestPrice*` null) |
| EC-7 | Presented reduction at/inside the window | **RULE (MUST), identical to the algorithm:** in-window uses an inclusive `recorded_at <= windowEnd`; then candidates drop (i) the exact presented entry — `isPresentedReduction(r) := price_id == p.price_id ∧ change_type == p.change_type ∧ recorded_at == p.recorded_at` — **and** (ii) any row with `recorded_at >= anchor` when `anchor != null`. The reference is the lowest of the remaining candidates. Without this the reference collapses to the promo price. Covers anchored, scheduled (`recorded_at < starts_at`), and non-anchored (`priceKindIsPromotion`, `anchor = null` so `windowEnd = now`; rule (i) drops the presented entry) promos. Test **C16**. |
| EC-8 | Recurring sale: 100→80→100→80 (same values) | each write records a distinct entry (time-based idempotency key); no silent drop |
| EC-9 | Command retried with identical `(price_id, change_type, recorded_at)` | `23505` swallowed → idempotent success, single row |
| EC-10 | History write throws (DB down) | logged `[internal]`; price write **succeeds**; entry retried on next mutation |
| EC-11 | Mixed tax rates in window | net+gross from the same lowest-axis row (EC-3 trap avoided) |
| EC-12 | Null `unit_price_gross` on a row, axis=`gross` | treated as `+Infinity` → never selected as lowest |
| EC-13 | `> 1000` in-window entries | `fetchInWindow` caps at 1000 (DESC) — documented bound; revisit for ultra-high-churn prices |
| EC-14 | Progressive sequence interrupted (100→90→95→80) | not progressive → standard rolling-MIN, `announced_promotion` |
| EC-15 | Progressive with no pre-campaign baseline | fall through to standard (no frozen reference invented) |
| EC-16 | Perishable `omnibus_exempt=true`, rule `exempt` | `perishable_exempt` |
| EC-17 | Variant `omnibus_exempt=null` | inherit product-level exemption |
| EC-18 | New product (`first_listed_at` 5 days ago), `shorter_window` 7d | reduced window; `new_arrival_reduced_window`; `lookbackDays` in response = reduced |
| EC-19 | `first_listed_at` null (legacy) | treat as not-new (new-arrival rule does not fire) — default-to-`created_at` on new rows prevents this going forward |
| EC-20 | Enabling Omnibus with EU channel lacking backfill | PATCH → 422 `backfill_required_before_enable` |
| EC-21 | Backfill re-run | idempotent (existing-id skip); baseline `recorded_at = windowStart − 1ms` |
| EC-22 | Direct SQL `UPDATE`/`DELETE` on history | DB trigger raises; no row changed |
| EC-23 | Cross-org read attempt | every query filters `tenant_id`+`organization_id`; returns only caller-scoped rows; unknown product → empty |
| EC-24 | Sales line edited after creation | omnibus snapshot **not** recomputed (immutable) |
| EC-25 | catalog/omnibus module absent (sales side) | `catalogOmnibusService` resolves to `null`; order/quote creation proceeds without snapshot |
| EC-26 | Clock skew between app and DB | `recorded_at` is app-set UTC → window math consistent |
| EC-27 | `lookbackDays` increased after backfill | admin UI warns (coverage `lookbackDays` < configured); resolution may report `insufficient_history` until re-backfill |

## Internationalization (i18n)

Keys under `catalog.omnibus.*` (settings panel, price-editor row, applicability reasons) in **en / pl / de / es** (full parity, `yarn i18n:check-sync`). All user-facing strings via `useT()` (client) / `resolveTranslations()` (server); no hard-coded labels. The storefront disclosure key `catalog.pricing.personalizedDisclosure` is deferred with the storefront phase. Example keys: `catalog.omnibus.settings.enabled`, `catalog.omnibus.settings.lookbackDays`, `catalog.omnibus.priceEditor.lowestInDays`, `catalog.omnibus.priceEditor.progressiveRef`, `catalog.omnibus.reason.notInEuMarket`.

## UI/UX

- **Omnibus Settings panel** (`OmnibusSettings`) on `/backend/config/catalog`: enable toggle, lookback, `enabledCountryCodes`, no-channel mode, default presented price kind, per-channel overrides (lookback, country, progressive/perishable/new-arrival), and a backfill-coverage warning when lookback increased since the last backfill. As a non-`CrudForm` host, the settings save MUST run through `useGuardedMutation(...).runMutation({ operation: 'update', ... })` (with `retryLastMutation` in the injection context) — it uses `apiCall*` under the hood (never raw `fetch`) and keeps the inline `optimistic-lock-exempt` marker (single tenant config blob, no per-record version). DS status tokens only.
- **Accessibility / keyboard (DS canon):** icon-only controls carry `aria-label`; any modal/dialog introduced submits on `Cmd/Ctrl+Enter` and cancels on `Escape`; status is conveyed by semantic tokens + text, not color alone. The UI embeds into existing backend pages (no new heavy client bundle), so a full Frontend Architecture Contract is not required; if a future iteration adds a dedicated dialog/route, add the `"use client"` ledger + boundary map then.
- **Price-editor reference row** (`PriceEditorOmnibusRow`) in the variant price editor: fetches `omnibus-preview`; renders the reference; handles `progressive_reduction_frozen` (reference = `lowestPrice`, current = `previousPrice`), `insufficient_history`, `not_in_eu_market`, `missing_channel_context`, default lowest-price. Tri-state (loading/none/block); `text-status-warning-text` for warnings.
- **Storefront display:** deferred (Future / Known Gaps).

## Configuration

- Per-tenant `OmnibusConfig` (above); no env vars for behavior.
- `OM_OPTIMISTIC_LOCK` unrelated except the config PATCH is exempt by design.

## Migration & Compatibility

- New table + columns + indexes + manual immutability trigger (catalog migrations); six sales line columns (sales migration); snapshots updated. All additive → backward compatible.
- **Backfill** — `mercato catalog omnibus:backfill --org <id> --tenant <id> [--channel-id <id>] [--batch-size N]`: per existing price row, insert one baseline entry with `recorded_at = windowStart − 1ms`, `change_type='create'`, `source='system'`, `idempotency_key=null`; batched, idempotent re-run.
  - Single channel: uses the channel's `lookbackDays`; writes `backfillCoverage[channelId]`.
  - All channels: iterate EU channels in `enabledCountryCodes` (each own `lookbackDays`), then unscoped prices with `max(lookbackDays)` → `backfillCoverage['']`.

## Backward Compatibility & Contract Surfaces

All changes are **additive-only** → no deprecation protocol required (per `BACKWARD_COMPATIBILITY.md`). New surfaces become STABLE contracts once shipped and must follow the deprecation protocol for any *future* change.

| Contract surface (BC category) | New / changed | Classification |
|--------------------------------|---------------|----------------|
| **DB schema** (§8) | New table `catalog_price_history_entries`; new columns `catalog_product.omnibus_exempt`/`first_listed_at`, `catalog_product_variant.omnibus_exempt`, 6 nullable columns on `sales_order_lines` + `sales_quote_lines` | Additive (defaults/nullable; new indexes + immutability trigger) |
| **API routes** (§7) | New `GET /api/catalog/prices/history`, `GET /api/catalog/prices/omnibus-preview`, `GET|PATCH /api/catalog/config/omnibus`; extended `GET /api/catalog/products` response (optional `omnibus` block + `isPersonalized`/`personalizationReason`) | Additive (new routes; only optional response fields added to an existing route) |
| **DI keys** (§9) | New `catalogOmnibusService` | Additive |
| **ACL features** (§10) | New `catalog.price_history.view`, `catalog.settings.view`; **reuse** existing `catalog.settings.manage` | Additive (no rename/removal) |
| **CLI commands** (§12) | New `mercato catalog omnibus:backfill` | Additive |
| **Public types/signatures** (§2/§3) | New exported types `OmnibusBlock`, `OmnibusConfig`, `OmnibusResolutionContext`, `OmnibusApplicabilityReason` enum (10 members) | Additive; STABLE once published — extend the enum only additively |
| **Event IDs** (§5) | None new (history is an in-command side effect) | No change |
| **Generated files** (§13) | `yarn generate` registers the new routes + CLI; no hand-edited generated files | Additive |
| **Config blob** | `catalog.omnibus` key in `module_configs`; no `version` field (acceptable — additive optional keys only; if a breaking shape change is ever needed, add a `version` discriminator then) | Additive |

**Remaining contract surfaces (the other 4 of the 13 `BACKWARD_COMPATIBILITY.md` categories) — no change:** Auto-discovery file conventions (only **new** `route.ts`/`di.ts`/`acl.ts`/`cli.ts`/`components` files are added; none renamed/removed) · Import paths (new exports from `catalog/lib`/`services` are additive; nothing moved) · Widget injection spot IDs (none touched — no widget injection) · Notification type IDs (none — no notifications). All 13 categories are therefore additive or N/A.

**No FROZEN/STABLE surface is removed or renamed.** Migrations ship as additive files + updated `.snapshot-open-mercato.json`; `db:migrate` is not run as part of the PR.

## Implementation Plan

**MVP = Phases 1–3** (history log + resolution + admin UI/backfill/ACL) — the minimum that makes the lowest-price-in-30-days reference correct and operable for EU channels. **Phases 4–5** (member-state derogations, sales snapshot + personalization) are additive enhancements deliverable independently afterward. Each phase leaves the application in a working, testable state.

### Phase 1 — History foundation
1. `CatalogPriceHistoryEntry` entity + migration (table, 6 lookback indexes, partial-unique idempotency index, **manual** immutability trigger + REVOKE runbook; update `.snapshot-open-mercato.json` excluding the manual DDL).
2. `lib/omnibus.ts` (`buildHistoryEntry`, `recordPriceHistoryEntry`, idempotency key, `is_announced`) + `lib/omnibusTypes.ts`. Wire into price create/update/delete and **all** undo paths (after `flush`, forked EM, `try/catch`, `[internal]`-prefixed error log).
3. `GET /api/catalog/prices/history` (keyset cursor, `includeTotal`, `findWithDecryption`).

### Phase 2 — Resolution service + preview + config
1. `catalogOmnibusService` (baseline+window, same-row net/gross, anchoring, EU gating, `noChannelMode`, TTL cache w/ anchor-day key) + DI registration (`.scoped()`).
2. `GET /api/catalog/prices/omnibus-preview`; products-list `afterList` enrichment (parallel, scoped).
3. `GET|PATCH /api/catalog/config/omnibus` (zod, mutation-guard wiring, 422 backfill gate).

### Phase 3 — Admin UI + backfill + ACL/setup
1. `OmnibusSettings` + `PriceEditorOmnibusRow` (+ wire into `VariantBuilder`/variant pages); i18n en/pl/de/es.
2. `omnibus:backfill` CLI (single + all-channel + unscoped).
3. `acl.ts`: add **`catalog.price_history.view`** and **`catalog.settings.view`**, and **reuse the existing `catalog.settings.manage`** for the config PATCH (do not add `catalog.settings.edit` — it breaks the `view`/`manage` convention and overlaps `manage`). Sync into `setup.ts` `defaultRoleFeatures` (admin gets `catalog.*`; employee gets the two `view` features) and run `yarn mercato auth sync-role-acls`.

### Phase 4 — Member-state derogations
1. Product/variant `omnibus_exempt`; product `first_listed_at` (defaults to `created_at`).
2. Progressive (6a(5)), perishable (`exempt`/`last_price`, 6a(3)), new-arrival reduced window (6a(4)); per-channel rule fields + validation.

### Phase 5 — Sales snapshot + personalization
1. Six immutable omnibus snapshot columns on `SalesOrderLine` **and** `SalesQuoteLine`; capture on line creation (forked EM, optional `catalogOmnibusService`, never recomputed on edit; gate `if (!existing && service && sourceLine.productId)`).
2. `isPersonalized` / `personalizationReason` (6(1)(ea)) on resolution + snapshot.

### File Manifest (indicative)
| File | Action | Purpose |
|------|--------|---------|
| `catalog/data/entities.ts` | Modify | History entity + product/variant omnibus columns |
| `catalog/data/validators.ts` | Modify | `omnibusConfigSchema`, product/variant fields |
| `catalog/lib/omnibus.ts`, `lib/omnibusTypes.ts` | Create | History builder, idempotency, types |
| `catalog/services/catalogOmnibusService.ts` | Create | Resolution + backfill |
| `catalog/api/prices/history`, `prices/omnibus-preview`, `config/omnibus` | Create | Read + config routes |
| `catalog/api/products/route.ts` | Modify | `afterList` enrichment |
| `catalog/commands/prices.ts`, `products.ts`, `variants.ts` | Modify | History recording, omnibus fields, undo/redo |
| `catalog/cli.ts`, `acl.ts`, `setup.ts`, `di.ts` | Modify | Backfill CLI, features, grants, DI |
| `catalog/components/OmnibusSettings.tsx`, `PriceEditorOmnibusRow.tsx` | Create | Admin UI |
| `catalog/components/products/VariantBuilder.tsx` + variant pages | Modify | Wire the reference row |
| `catalog/i18n/{en,pl,de,es}.json` | Modify | `catalog.omnibus.*` keys |
| `sales/data/entities.ts`, `sales/commands/documents.ts` | Modify | Snapshot columns + capture |
| migrations + `.snapshot-open-mercato.json` (catalog, sales) | Create/Modify | Schema |

## Testing Strategy

### Unit — `lib/omnibus.ts`
| Scenario | Expected |
|----------|----------|
| Field mapping | All snapshot fields mapped; `recorded_at` is a `Date` |
| `is_announced` (`starts_at`/`offer_id`/`announce`) | `true` |
| `is_announced` no signal | `false` (never `null`) |
| Idempotency formula | `sha256(price_id∣change_type∣recorded_at.toISOString())` |
| Idempotency independent of price | same time + diff price ⇒ same key |
| Idempotency no collision | same price + later time ⇒ diff key |
| Null `productId` | throws |

### Unit — `catalogOmnibusService.resolveOmnibusBlock` (mock `findWithDecryption`)
| Scenario | Expected |
|----------|----------|
| `enabled=false` | `null`, no query |
| `enabledCountryCodes=[]` | `not_in_eu_market`, no query |
| Channel country not enabled | `not_in_eu_market`, no query |
| Storefront + no channel | `missing_channel_context`, no query |
| Same-row net/gross | lowest by gross; net from that row |
| Promotion kind | `applicable=true`, `announced_promotion` |
| Non-promotional repricing | `applicable=false`, `not_announced` |
| No baseline, in-window | `insufficient_history`, `coverageStartAt` non-null |
| Progressive 100→90→80→70 | `progressive_reduction_frozen`; `lowestPrice=100`, `previousPrice=70` |

### Compliance suite (integration/E2E) — MUST pass before EU production
| # | Scenario | Assertion |
|---|----------|-----------|
| C1 | Promotion > 30 days | `windowEnd=starts_at`; reference = baseline at `starts_at−lookback`, not day-40 recalculated |
| C2 | Tax-only change | `not_announced`; reference not rendered |
| C3 | Progressive same offer | `progressive_reduction_frozen`; reference = pre-campaign baseline |
| C4 | Progressive interrupted | standard rolling-MIN; `announced_promotion` |
| C5 | Perishable exempt | `perishable_exempt` |
| C6 | Perishable last-price | reference = immediately-preceding; `perishable_last_price` |
| C7 | New arrival | reduced window; `new_arrival_reduced_window` |
| C8 | Insufficient history | `insufficient_history`; `coverageStartAt` non-null |
| C9 | Per-channel isolation | A's reference ≠ B's |
| C10 | Offer-anchor fallback | `promotionAnchorAt=firstOfferEntry.recorded_at` |
| C11 | Backfill baseline | `recorded_at=windowStart−1ms` |
| C12 | DB immutability | `UPDATE`/`DELETE` raises; no row changed |
| C13 | Enable without backfill | PATCH → 422 `backfill_required_before_enable` |
| C14 | Order snapshot persistence/immutability | 6 fields stored; unchanged after later price change |
| C15 | Cross-org isolation | org A returns only org A entries |
| C16 | Presented promo excluded from its own window (EC-7) | promo recorded at `starts_at`; reference = pre-reduction price (100), NOT the promo price (80) |

### Integration tests (shipped)
- `TC-CAT-035` — `isPersonalized` present in products response.
- `TC-CAT-036` — price-history coverage: announced `is_announced=true`, idempotency (single entry), org isolation, cursor pagination, undo entry (`change_type='undo'`).

## Compliance Gap Analysis

External review vs Directive (EU) 2019/2161 + Commission Guidance (2021/C 526/02) identified seven gaps; all implemented.

| # | Gap | Severity | Phase | Status |
|---|-----|----------|-------|--------|
| 1 | Fixed reference (sliding window) | **Critical** | 2 | **Implemented** — `starts_at`-anchored window + offer first-entry fallback |
| 2 | Progressive reductions | **High** | 4 | **Implemented** — `progressiveReductionRule` + freeze-to-baseline |
| 3 | Perishable goods | Medium | 4 | **Implemented** — `omnibus_exempt` + `perishableGoodsRule` |
| 4 | New-arrivals shorter lookback | Medium | 4 | **Implemented** — `first_listed_at` + `newArrivalRule` |
| 5 | Member-state variations | Medium | 4 | **Implemented** — per-channel rules + `countryCode` |
| 6 | Announced vs. silent | Medium | 2 | **Implemented** — promotion-detection `applicable` + `is_announced` |
| 7 | Personalized disclosure | Low–Med | 5 | **Implemented (data)** — `isPersonalized`/`personalizationReason`; storefront rendering deferred |

- **Gap 1:** `starts_at ⇒ windowEnd=starts_at`, `windowStart=starts_at−lookback`, fixed for the promotion's life; `promotionAnchorAt` exposed.
- **Gap 2:** `offer_id` is the campaign key; uninterrupted downward sequence freezes to the pre-first-reduction price; interrupted/non-progressive → rolling-MIN.
- **Gap 3:** product/variant `omnibus_exempt` + per-market `perishableGoodsRule` (`exempt`/`last_price`).
- **Gap 4:** `first_listed_at` (defaults `created_at`) + per-market `newArrivalRule`/`newArrivalsLookbackDays`.
- **Gap 5:** per-channel config = per-market rule set; `countryCode` maps the channel to a state.
- **Gap 6:** structural detection only; tax-rate-only adjustments → `not_announced`.
- **Gap 7:** `isPersonalized`/`personalizationReason` on the pricing response + order/quote snapshots; storefront `catalog.pricing.personalizedDisclosure` deferred.

## Monitoring & Alerting

Compliance failures are legal failures. **Implementation status:** structured logging is in place; the metrics/alerts below are **specified, not yet instrumented** (see Future / Known Gaps).

| Metric | Type | Alert |
|--------|------|-------|
| `omnibus.resolution.error_rate` | Counter | `> 0` / 5 min → P1 |
| `omnibus.resolution.not_in_eu_market` | Counter | spike ⇒ channel lost `countryCode` |
| `omnibus.resolution.insufficient_history` | Counter | `> 1%` of EU requests → P2 |
| `omnibus.resolution.no_history` | Counter | `> 0` after enable+backfill → P2 |
| `omnibus.backfill.coverage_gap` | Gauge | `> 24h` → P3 |
| `omnibus.history.oldest_entry_age_days` | Gauge | `< max(lookbackDays)` → P2 |

**Logging:** resolution exception → `ERROR` `{tenantId, organizationId, channelId, priceKindId, currencyCode, error}` (no price values at ERROR — GDPR caution); `insufficient_history` → `WARN` `{…, coverageStartAt, lookbackDays}`; enable-without-backfill → `WARN`; DB trigger violation surfaced → `ERROR`.

## Risks & Impact Review

### Risk Register
| # | Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|----------|----------|---------------|------------|---------------|
| R1 | History write fails after the price write commits | High | Compliance log completeness | best-effort forked-EM write logged `[internal]`; next mutation + `omnibus:backfill` re-create entries; `no_history`/`insufficient_history` alerts | transient log gap until next mutation/backfill (accepted to never block price writes) |
| R2 | Presented promo included in its own window | **High** | Legal correctness (wrong reference) | algorithm excludes presented entry (inclusive `<= windowEnd` window, then drop the exact presented entry by identity + any row with `recorded_at >= anchor`); EC-7 + test C16 | none if implemented per algorithm; storefront path must pass the presented entry |
| R3 | Stale cached reference after a price change | Medium | Storefront accuracy | post-commit cache-tag invalidation on price writes; 5-min TTL fallback | up to TTL staleness if precise invalidation not wired (Known Gap) |
| R4 | Mixed-tax `MIN(net)`/`MIN(gross)` mismatch | High | Legal correctness | net+gross taken from the same lowest-axis row | none |
| R5 | Cross-tenant/org data exposure | High | Security/isolation | every query filters `tenant_id`+`organization_id`; routes feature-guarded; tests C9/C15/EC-23 | none identified |
| R6 | History tampering via raw SQL | High | Audit integrity | DB immutability trigger + `REVOKE UPDATE/DELETE` runbook | residual until `REVOKE` applied in prod (trigger active meanwhile) |
| R7 | Enable Omnibus before backfill | Medium | First-promotion correctness | 422 `backfill_required_before_enable` gate (C13) | none if gate enforced |
| R8 | Unbounded history growth | Medium | DB size/perf | indexes + 5-min cache; retention/partitioning planned | deferred — must land before high-volume EU prod |
| R9 | Member-state misconfiguration (wrong lookback/derogation) | Medium | Compliance per market | per-channel config + validation; legal-review caveat; `not_in_eu_market` for unlisted countries | operator responsibility (config), surfaced via Monitoring |

### Data Integrity
- **History write fails mid-price-write:** recorded after `em.flush()` on a forked EM in `try/catch` → logged, never aborts the price write (best-effort; deliberate divergence from same-transaction recording).
- **Partial writes:** price and history writes are independent; a history failure leaves the price intact, retried on next mutation.
- **Concurrency:** partial-unique idempotency index + `23505`-swallow make retries idempotent; the time-based key avoids false collisions on recurring prices.
- **Tampering:** DB trigger blocks `UPDATE`/`DELETE`; role `REVOKE` is the second line.
- **Residual risk (history atomicity):** because history is recorded best-effort *outside* the price-write transaction, a committed price change whose history write then fails leaves the compliance log missing that entry. **Mitigation:** the next mutation on the same price records a fresh entry; the periodic `omnibus:backfill` re-creates a baseline; `omnibus.resolution.no_history` / `insufficient_history` alerts surface the gap. **Residual:** a transient gap between the failed write and the next mutation/backfill — accepted in exchange for never blocking the price write. (Making history transactional with the price write is a possible future hardening.)

### Concurrency / Conflicts
- Config: single tenant blob; PATCH optimistic-lock-exempt but mutation-guard-wired.
- Price edits: standard catalog optimistic locking (default ON) unaffected.

### Tenant / Security
- Every query filters `tenant_id`+`organization_id`; routes feature-guarded; no cross-tenant read path; price values kept out of ERROR logs; no new PII/secrets.
- **Injection:** all queries go through MikroORM (parameterized); no string interpolation of user input into SQL. The only hand-written SQL is the static immutability DDL (no user input). **XSS:** n/a — no raw/unescaped HTML is rendered; all UI strings go through React + `useT()`.

### Compliance (regulatory)
- Wrong reference = legal failure. Mitigated by same-row net/gross, anchored windows, announced-only applicability, EU gating, immutability, and the C1–C16 suite.

### Performance / Scale
- Lookback indexes prefixed `(tenant_id, organization_id, …)` + trailing `recorded_at DESC`; 5-min TTL cache; `fetchInWindow` capped at 1000 (EC-13). Monotonic growth → retention/partitioning required before high volume (deferred).

### Cascading Failures & Side Effects
- The only cross-module side effect is the optional sales-line snapshot, captured on a forked EM in `try/catch` — a failure logs and proceeds, never blocking order/quote creation (EC-25). History recording cannot cascade into the price write (isolated). No external network calls.

### Migration & Deployment
- Migrations are additive (new table/columns/indexes) + the manual immutability DDL; `down()` cleanly reverses. **Deploy order:** apply migrations → (optionally) run `omnibus:backfill` per channel → only then enable Omnibus (the 422 gate enforces this). **`REVOKE UPDATE/DELETE`** on the app DB role is a required production deploy step (trigger is the active guard until then). Rollback = `down()` drops trigger/function/table; the feature is dark while `enabled=false`.

### Operational
- Detection/observability via Monitoring & Alerting (resolution error rate, no-history/insufficient-history, backfill coverage gap, retention floor). Operator runbook: backfill-before-enable; re-backfill after increasing `lookbackDays`; watch the coverage-gap alert. Blast radius if misconfigured is bounded by `enabled` + `enabledCountryCodes` (a bad config affects only listed EU channels; non-EU channels are unaffected).

## Future / Known Gaps (deferred)

- **Storefront display** (Phase 5 UI) + `catalog.pricing.personalizedDisclosure` key — data captured, storefront UI not built.
- **Monitoring instrumentation** — metrics/alerts specified, not yet emitted (logging in place).
- **Retention / monthly partitioning** (`PARTITION BY RANGE (recorded_at)`) before high-volume EU production.
- **`REVOKE UPDATE/DELETE`** on the app DB role as a production deploy step.
- **`omnibus-preview` at-least-one-scope** zod refinement (currently all three optional, no `.refine()`).
- **`isPersonalized` placement/signals** — the **authoritative contract is top-level camelCase** `isPersonalized` / `personalizationReason` on each products-list item (see API Contracts). An earlier implementation nested them snake_case under `pricing`; that is an as-built deviation to **fix to match this contract**, not an alternative shape. Signal-source mapping is currently minimal and should be expanded per Art. 6(1)(ea).
- **EC-7 enforcement** — the spec now mandates excluding the presented reduction from its own window (RULE in EC-7, test C16). Verify the as-built resolver actually drops the presented entry at the `recorded_at ≤ windowEnd` boundary; if it does not, that is a correctness bug to fix.
- **Cache invalidation on price write** — the spec requires price writes to invalidate the omnibus cache tag (Architecture → Caching). Verify the as-built price commands emit that invalidation; if they rely on TTL only, storefront reads may be stale up to 5 minutes after a price change.

## Final Compliance Report — 2026-06-30

### AGENTS.md Files Reviewed
root `AGENTS.md` (+ `.ai/ds-rules.md`, `.ai/ui-components.md`), `packages/core/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/ui/AGENTS.md`, `packages/cache/AGENTS.md`, `packages/events/AGENTS.md`, `packages/cli/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `packages/core/src/modules/catalog/AGENTS.md`, `packages/core/src/modules/sales/AGENTS.md`, `.ai/specs/AGENTS.md`.

### Compliance Matrix
| Rule Source | MUST rule | Status | Notes |
|---|---|---|---|
| root → Architecture | No cross-module ORM relations; FK ids + fetch | Compliant | sales by `price_id`/`product_id` + snapshot; `module-decoupling.test.ts` |
| root → Architecture | `tenant_id`+`organization_id` on every scoped query | Compliant | EC-23, C9, C15 |
| root/ui → UI & HTTP | Non-`CrudForm` writes via `useGuardedMutation().runMutation()` | Compliant | OmnibusSettings save routed through `useGuardedMutation` (UI/UX) |
| root/ui → UI & HTTP | `apiCall*`, never raw `fetch` | Compliant | UI/UX |
| root → DS rules | semantic status tokens; no arbitrary sizes | Compliant | `text-status-warning-text`; a11y note added |
| root/shared → i18n | user-facing via `useT()`/`resolveTranslations()`; `[internal]` internal | Compliant | i18n §; EC-10 |
| core → API Routes | export `openApi` on every route | Compliant | incl. updated `GET /api/catalog/products` openApi for new fields |
| core → API Routes | custom write routes wire mutation-guard registry (4-step) | Compliant | config PATCH: `getAllMutationGuardInstances()` + `bridgeLegacyGuard` + `runMutationGuards` (op `update`) + `afterSuccessCallbacks` |
| core → CRUD Factory | CRUD via `makeCrudRoute` (+`indexer`) | Compliant (justified) | history/preview are computed reads; price writes use existing CRUD/command path |
| core → Encryption | `findWithDecryption`/`findOneWithDecryption`; GDPR fields in `encryption.ts` | Compliant | reads scoped; no new PII → no `encryption.ts` (documented) |
| core → Commands/undo | mutations via commands; undo via `extractUndoPayload`; all undo paths | Compliant | all undo paths record `change_type='undo'` |
| core → withAtomicFlush | no `find`/`findOne` between scalar mutation and `flush` on same EM | Compliant | history on forked EM after `flush()` |
| core → Module Setup / ACL Sync | new `acl.ts` features in `setup.ts` defaults + `sync-role-acls` | Compliant | `price_history.view` + `settings.view` added; `settings.manage` reused (convention) |
| core → DB Entities | `<module>_` prefix, UUID PK, soft-delete unless exempt | Compliant | append-only log exempt (documented) |
| cli/core → Migrations | additive SQL + snapshot; no `db:migrate` in PR | Compliant | manual DDL marked; snapshot excludes trigger/partial-index/DESC |
| core → Module Config | `ModuleConfigService` with `scope`; tenant from auth | Compliant | key `catalog.omnibus`, scoped |
| shared → Feature matching | wildcard-aware matching for raw feature arrays | Compliant | declarative `requireFeatures` + guard `userFeatures` |
| cache → consistency | DI cache; tenant-scoped keys; invalidate **after commit** on write paths | Compliant (spec); as-built verify | invalidation mandated post-commit; if as-built is TTL-only it's a Known Gap |
| events | declare events; no undeclared events | Compliant | no new events |
| BACKWARD_COMPATIBILITY §7–13 | contract surfaces additive-only | Compliant | see Backward Compatibility & Contract Surfaces |
| catalog/AGENTS | use `selectBestPrice`/`catalogPricingService` for pricing | N/A | reads history + computes a reference; no price selection |
| sales/AGENTS | document math via `salesCalculationService` | N/A | read-side snapshot only; no doc math touched |
| .ai/specs/AGENTS | required sections present | Compliant | all present |

### Internal Consistency Check
- **Algorithm ↔ EC-7 ↔ C16:** consistent — the exclusion rule is identical in the pseudocode, EC-7, and test C16 (inclusive `<= windowEnd` window; drop the exact presented entry by `(price_id, change_type, recorded_at)` identity + any row with `recorded_at >= anchor`).
- **`isPersonalized` placement:** consistent — top-level camelCase is the single authoritative contract (API table + Known Gaps note the as-built deviation as a bug to fix).
- **API auth ↔ ACL:** consistent — GET `catalog.settings.view` / PATCH `catalog.settings.manage`; no `settings.edit`.
- **Compliance suite numbering:** consistent — C1–C16 in Testing, Risks, and Changelog.
- **`applicabilityReason` enum:** consistent across Data/API/Algorithm/Worked Examples (10 members).
- **Config `{}`-when-unset ↔ typing:** consistent — `defaultPresentedPriceKindId` optional, required only when `enabled=true`.

### Non-Compliant Items
None blocking. Open **as-built verification** items (spec is compliant; implementation to confirm) are tracked in Future / Known Gaps: EC-7 exclusion enforced in code, post-commit cache invalidation on price writes, `isPersonalized` top-level placement, `omnibus-preview` at-least-one-scope refinement, Monitoring instrumentation.

### Verdict
**Ready for PR (as a specification).** All MUST rules are Compliant or justified N/A; internal consistency checks pass. The listed as-built verification items are implementation follow-ups, not spec defects.

## Changelog

- **2026-06-30** — Implementation-grade specification authored from the feature on `feat/omnibus-rebased` (port of `strzesniewski/feat/omnibus` onto current `develop`) per `om-spec-writing`. Adds Regulatory Background (Art. 6a / 6(1)(ea) + derogations), Worked Examples, exhaustive Edge Cases, full API request/response/error examples, algorithm pseudocode, Compliance Gap Analysis, Monitoring & Alerting, and the C1–C16 compliance suite. Supersedes the intent of the legacy `SPEC-033-2026-02-18-omnibus-price-tracking.md`; final relationship decided at merge.
