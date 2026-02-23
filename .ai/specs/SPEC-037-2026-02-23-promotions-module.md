# SPEC-037: Promotions Module

**Date**: 2026-02-23
**Status**: Approved

---

## TLDR

**Key Points:**
- A standalone `promotions` module that defines promotions via a flexible, recursive rule-condition tree, evaluates which promotions apply to a given cart context, and returns **fully resolved effects** to the cart module — promotions owns the math, the cart only applies the pre-computed results.
- Promotional codes (static vouchers and dynamically generated pools) are managed independently of individual promotions and linked via `CodeRule` nodes inside the rule tree.

**Scope:**
- Domain model: `Promotion`, `RuleGroup` (recursive tree), polymorphic `Rule` + 15 concrete rule types, polymorphic `Benefit` + 6 concrete benefit types, `Code`, `GeneratedCode`, `CodeReservation`, `CodeUsage`
- Three-pass evaluation engine (boolean pass → benefit collection pass → effect resolution pass), product-page lightweight variant
- Promotion ordering, cumulativity, and tag-based self-exclusion algorithm
- Cart interaction REST API (apply-promotion, code lifecycle endpoints)
- Admin UI: drag-sortable promotion list, inline tree builder, promotional codes table

**Concerns:**
- Rule tree depth and polymorphic joins require careful N+1 mitigation and upfront caching strategy
- Code reservation TTL must be handled atomically; concurrent checkouts must not bypass per-customer limits

---

## Overview

The Promotions module is a first-class Open Mercato module that lives at `packages/core/src/modules/promotions/`. It enables operators to build complex promotional campaigns through a nested condition-benefit tree without writing code. The evaluation engine resolves applicable promotions and computes their fully resolved effects (actual amounts, free item SKUs, delivery discounts) at cart request time; the cart module receives pre-computed effects and applies them without re-doing any discount math.

> **Market Reference**: Studied Sylius (promotion + rule + action model), Magento 2 (cart price rules), and Akeneo (nested condition trees). Adopted Sylius's clean separation of rule evaluation from price application. Improved on it by making benefits first-class tree nodes (benefits on sub-groups, not just top-level promotions) and supporting a BuyXGetY and TieredDiscount native type that Sylius requires complex workarounds to achieve. Rejected Magento's flat rule model — it cannot express the conditional branching required by the spec. Rejected storing discount results in the promotions module — the cart module owns pricing; promotions is a pure resolver.

---

## Problem Statement

Open Mercato has no native promotions system. The POS module spec (SPEC-022) explicitly deferred promotions integration. Sales and catalog modules have no awareness of promotional discounts. Without this module:

- Operators cannot build rule-based campaigns (seasonal sales, loyalty tiers, code-gated offers, delivery discounts)
- The cart cannot apply promotions without a backend resolver
- Promotional codes cannot be managed or tracked

---

## Proposed Solution

A dedicated `promotions` module placed in `packages/core/src/modules/promotions/` following all platform conventions. It exposes:

1. **Admin UI** — promotion list with drag-sort, inline rule tree builder, code template manager
2. **Internal API** — standard CRUD for promotions, rule groups, and codes
3. **Cart API** — `/api/cart/apply-promotion` and code lifecycle endpoints consumed by cart/POS integrations
4. **Evaluation engine** — a two-pass recursive tree evaluator that is pure, stateless, and context-driven

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Benefits live on `RuleGroup`, not on `Promotion` | Allows different benefit sets for different condition branches within a single promotion |
| Polymorphic rule/benefit tables | Each concrete type has its own table; only the discriminator and FK live on the `rules`/`benefits` tables — clean separation, no sparse columns |
| Codes are promotion-agnostic | A single code template can unlock multiple promotions simultaneously via `CodeRule` in each promotion's tree |
| Three-pass evaluation | Pass 1 is pure boolean (no side effects); Pass 2 collects benefits only from fully-satisfied ancestor chains; Pass 3 resolves each benefit into concrete effects using the cart context (actual amounts, free item SKUs) — avoids partial benefit collection and keeps math out of the cart |
| Promotions resolves effects; cart applies them | The promotions engine owns all discount math — it receives unit prices in the cart context and returns fully computed effect amounts. The cart module applies pre-computed effects without re-doing any calculations. No duplication, no ambiguity, deterministic totals. |
| Free item effects include the SKU and quantity | `ADD_FREE_ITEM` effects carry the resolved SKU and quantity — the cart does not decide which item to add; the promotions engine resolves BuyXGetY and FreeProduct benefit configs into the correct item reference |
| Dynamic code generation via background worker | Generating thousands of unique codes is CPU-bound; must not block request threads |
| CodeReservation with 24h TTL | Soft hold to prevent concurrent multi-session exploitation; a completed checkout produces a permanent `CodeUsage` record |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Store promotions in sales module | Promotions are cross-cutting (POS, e-commerce, B2B); sales module is document-flow oriented |
| Flat rule model (Magento-style) | Cannot express conditional sub-group branching with per-branch benefits |
| Return benefit descriptors and let cart compute math | Duplicates discount logic in every cart integration; changes to discount formulas must be coordinated across modules; creates ambiguity on tiered/BuyXGetY math |

---

## User Stories / Use Cases

- **Operator** wants to create a seasonal sale that gives 20% off all electronics so that customers get an automatic discount at checkout
- **Operator** wants to configure a Buy 2 Get 1 Free rule so that the system automatically grants the free product when the cart qualifies
- **Operator** wants to issue a one-time-use voucher code for newsletter subscribers so that only targeted recipients get the discount
- **Operator** wants to build a tiered loyalty discount (spend €100 = 5%, €200 = 10%) so that higher spenders are rewarded automatically
- **Operator** wants to offer free shipping on orders over €50 for a specific delivery method so that the discount is scoped correctly
- **Operator** wants to exclude pharmaceutical products from all promotions so that regulatory-controlled items are never discounted
- **Cashier / Cart** wants to submit a cart context and receive a list of applicable benefits so that price calculations can be performed in the cart module
- **Customer** wants to enter a promotional code so that their qualifying discount is applied to their cart
- **Operator** wants to reorder promotions by drag-and-drop so that evaluation priority is immediately obvious and controllable

---

## Architecture

```
promotions/
├── index.ts                          Module metadata
├── acl.ts                            Feature definitions
├── events.ts                         Typed event declarations
├── setup.ts                          Tenant init, seeding, defaultRoleFeatures
├── notifications.ts                  Notification types (code exhausted, etc.)
├── search.ts                         Fulltext search config for promotions + codes
├── translations.ts                   Translatable fields (benefit labels)
├── di.ts                             DI registrar (services)
├── ce.ts                             Custom entity sets
│
├── api/
│   ├── openapi.ts                    OpenAPI shared helpers
│   ├── promotions/route.ts           CRUD via makeCrudRoute
│   ├── promotions/[id]/route.ts      Detail + nested tree fetch
│   ├── promotions/[id]/tree/route.ts Atomic tree reconciliation (PUT)
│   ├── promotions/order/route.ts     Batch order update (PATCH)
│   ├── codes/route.ts                Code CRUD
│   ├── codes/[id]/generate/route.ts  Trigger dynamic code generation worker
│   ├── codes/[id]/generated/route.ts List individual generated codes
│   ├── cart/apply-promotion/route.ts Cart benefit resolver (POST)
│   ├── cart/add-code/route.ts        Code reservation (POST)
│   ├── cart/validate-code/route.ts   Re-validate reserved code (POST)
│   ├── cart/use-code/route.ts        Mark code used + write CodeUsage (POST)
│   ├── cart/delete-code/route.ts     Release reservation (POST)
│   ├── dynamic-labels/route.ts       Storefront condition metadata (GET)
│   ├── free-products/route.ts        Free product eligibility (POST)
│   ├── delivery-methods/route.ts     Delivery promotion eligibility (POST)
│   └── product-page/route.ts         Product promotion badge data (POST)
│
├── backend/
│   ├── promotions/page.tsx           Promotion list (drag-sort, filters, save)
│   ├── promotions/create/page.tsx    Promotion create form
│   ├── promotions/[id]/page.tsx      Promotion detail + tree editor
│   ├── codes/page.tsx                Code template list
│   ├── codes/create/page.tsx         Code create form
│   └── codes/[id]/page.tsx           Code detail + generated codes panel
│
├── commands/
│   ├── promotions.ts                 Create/update/delete + undo
│   ├── codes.ts                      Code CRUD + generate
│   └── rule-tree.ts                  Atomic rule group tree mutations
│
├── lib/
│   ├── evaluation-engine.ts          Three-pass recursive evaluator
│   ├── rule-evaluators.ts            15 concrete rule evaluators
│   ├── effect-resolvers.ts           Benefit config → ResolvedEffect[] (owns all discount math)
│   ├── product-page-engine.ts        Lightweight variant (product visibility)
│   ├── code-service.ts               Code validation, reservation, usage
│   └── tag-exclusion.ts              Promotion ordering + cumulativity + tag exclusion loop
│
├── services/
│   ├── promotion-cache.ts            Active promotions cache (tag-invalidated)
│   └── code-generation.ts            Dynamic code batch generator
│
├── workers/
│   └── code-generation.worker.ts     Background worker for dynamic code pools
│
├── subscribers/
│   └── invalidate-promotion-cache.ts On promotion CUD → invalidate cache
│
├── data/
│   ├── entities.ts                   MikroORM entities (all tables)
│   └── validators.ts                 Zod schemas for all inputs
│
├── migrations/                       DB migrations (generated, never hand-written)
├── i18n/en.json                      English locale strings
├── components/                       Shared React components (tree builder)
└── widgets/injection/                Widget injection slots
```

### Evaluation Engine Data Flow

```
POST /api/cart/apply-promotion
  │
  ├─ Load active promotions (from cache, key: promotions:active:{tenantId}:{organizationId})
  │   └─ Serves NormalizedPromotion[] — no ORM entities, zero DB access during evaluation
  │
  ├─ For each promotion (ORDER BY order ASC, id ASC):
  │   ├─ Check excluded_tags ∩ applied_tags → skip if non-empty
  │   ├─ Apply item exclusion filters (exclude_medicine, etc.)
  │   ├─ Pass 1: evaluateGroup(rootGroup, context) → boolean
  │   └─ If true:
  │       ├─ Pass 2: collectBenefits(rootGroup, parentChainValid=true) → NormalizedBenefit[]
  │       ├─ Pass 3: resolveEffects(benefits, context) → ResolvedEffect[]
  │       │   └─ Each benefit config + cart context → concrete amounts (LINE_DISCOUNT,
  │       │      CART_DISCOUNT, DELIVERY_DISCOUNT, ADD_FREE_ITEM). Math lives here only.
  │       ├─ applied_tags ← applied_tags ∪ promotion.tags
  │       └─ If !promotion.cumulative → BREAK
  │
  └─ Return: { appliedPromotions: AppliedPromotion[] }
             where AppliedPromotion = { promotionId, promotionName, effects: ResolvedEffect[] }
```

### Normalized Promotion Shape

The active promotions cache stores `NormalizedPromotion` plain objects — never ORM entity graphs. This structure is fully eager-loaded, denormalized, and immutable. It is the only input the evaluation engine may receive.

```
NormalizedPromotion {
  id: uuid
  name: string
  order: number
  cumulative: boolean
  tags: string[]
  excludedTags: string[]
  excludeFlags: Record<string, boolean>
  rootGroup: NormalizedRuleGroup
}

NormalizedRuleGroup {
  operator: "and" | "or"
  rules: NormalizedRule[]        // pre-sorted by sort_order
  benefits: NormalizedBenefit[]  // pre-sorted by sort_order
  children: NormalizedRuleGroup[]
}

NormalizedRule {
  type: string
  config: Record<string, unknown>
}

NormalizedBenefit {
  type: string
  config: Record<string, unknown>
}
```

**Normalization requirements:**

- Polymorphic tables are flattened — each `(dispatcher, concrete)` row becomes a single `{ type, config }` object
- ORM references are not retained in the normalized structure
- Arrays are pre-sorted by `sort_order`
- In non-production builds, objects are deep-frozen to detect accidental mutation

### Cache Build Contract

`services/promotion-cache.ts` guarantees:

1. A single cache build performs **all** required database reads (promotions → rule groups (recursive) → rule dispatchers → all concrete rule tables → benefit dispatchers → all concrete benefit tables)
2. After caching, promotion evaluation executes with **zero database access**
3. Any missing eager-loaded relation is treated as a critical bug

The evaluation engine (`lib/evaluation-engine.ts`) operates purely on `NormalizedPromotion` objects and **must not** use the entity manager, repository calls, lazy relation access, or dynamic DB lookups. All required data must be provided via the cart context or the normalized promotion.

### Code Lifecycle

```
add-code   → validate code + per-customer limit → create CodeReservation (TTL 24h)
validate-code → re-check reservation + code active status
apply-promotion → code_id passed in context → CodeRule evaluator matches
use-code   → deactivate GeneratedCode OR increment Code.used → write CodeUsage → delete reservation
delete-code → delete CodeReservation only
```

### Commands & Events

| Command | Event emitted |
|---------|--------------|
| `promotions.promotion.create` | `promotions.promotion.created` |
| `promotions.promotion.update` | `promotions.promotion.updated` |
| `promotions.promotion.delete` | `promotions.promotion.deleted` |
| `promotions.code.create` | `promotions.code.created` |
| `promotions.code.update` | `promotions.code.updated` |
| `promotions.code.delete` | `promotions.code.deleted` |
| `promotions.code.use` | `promotions.code.used` |
| `promotions.generated-code.generate` | `promotions.generated-code.created` (batch) |

---

## Data Models

All entities include `organization_id` (uuid) and `tenant_id` (uuid) for tenant isolation. Soft-delete via `deleted_at` where relevant.

### Promotion

Table: `promotions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `organization_id` | uuid | Tenant isolation |
| `tenant_id` | uuid | Tenant isolation |
| `name` | text | Required |
| `description` | text nullable | |
| `order` | integer | Evaluation priority (ASC = higher priority) |
| `active` | boolean | Default false |
| `starts_at` | timestamptz nullable | |
| `ends_at` | timestamptz nullable | |
| `cumulative` | boolean | Default true |
| `tags` | text[] | Promotion family tags |
| `excluded_tags` | text[] | Skip if any already applied |
| `exclude_flags` | jsonb | Map of boolean exclusion flags (e.g. `{exclude_medicine: true}`) |
| `rule_group_id` | uuid FK → rule_groups | Root of the tree |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

### RuleGroup

Table: `promotion_rule_groups`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `promotion_id` | uuid FK → promotions | Denormalised for efficient tenant scoping |
| `parent_rule_group_id` | uuid FK → self nullable | Null on root groups |
| `operator` | text | `and` or `or` |
| `sort_order` | integer | Display ordering within parent |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### Rule (polymorphic dispatcher)

Table: `promotion_rules`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `rule_group_id` | uuid FK → promotion_rule_groups | |
| `promotion_id` | uuid FK → promotions | Denormalised |
| `ruleable_type` | text | Discriminator (e.g. `order_value`, `product`, `code`) |
| `ruleable_id` | uuid | FK to concrete rule table |
| `sort_order` | integer | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### Concrete Rule Tables

One table per rule type. All share `id` (uuid PK), `organization_id`, `tenant_id`. Fields per type:

| Table | Key fields |
|-------|-----------|
| `promotion_rules_order_value` | `value` decimal, `operator` text, `tax_inclusive` bool, `limit_to_category` text nullable |
| `promotion_rules_order_date` | `date` date, `operator` text |
| `promotion_rules_product_count` | `value` integer, `operator` text, `exclude_pharmaceutical` bool |
| `promotion_rules_cart_weight` | `value` decimal, `operator` text |
| `promotion_rules_row_total` | `value` decimal, `operator` text, `sku` text nullable, `category_slug` text nullable |
| `promotion_rules_product` | `sku` text, `quantity` integer, `operator` text |
| `promotion_rules_category` | `category_slug` text, `quantity` integer, `operator` text, `exclude_pharmaceutical` bool |
| `promotion_rules_producer` | `producer_code` text, `quantity` integer, `operator` text, `exclude_pharmaceutical` bool |
| `promotion_rules_product_attribute` | `attribute_code` text, `operator` text, `value` text |
| `promotion_rules_user_group` | `user_group_id` uuid |
| `promotion_rules_customer_order_history` | `value` integer, `operator` text |
| `promotion_rules_consent_flag` | `flag_key` text — identifier of a consent flag the customer must have accepted (e.g. `newsletter_optin`, `loyalty_terms`); evaluated against `consentFlags` in the cart context |
| `promotion_rules_code` | `code_id` uuid FK → promotion_codes |
| `promotion_rules_delivery_method` | `delivery_method_code` text |
| `promotion_rules_payment_method` | `payment_method_code` text |
| `promotion_rules_shipping_address` | `field` text (`country`/`region`/`postcode`), `operator` text, `value` text |

### Benefit (polymorphic dispatcher)

Table: `promotion_benefits`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `rule_group_id` | uuid FK → promotion_rule_groups | |
| `promotion_id` | uuid FK → promotions | Denormalised |
| `benefitable_type` | text | Discriminator |
| `benefitable_id` | uuid | FK to concrete benefit table |
| `sort_order` | integer | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### Concrete Benefit Tables

| Table | Key fields |
|-------|-----------|
| `promotion_benefits_product_discount` | `sku` text nullable, `discount_type` text, `value` decimal, `selector` text, `nth_position` int nullable, `pcs_limit` int nullable, `limit_to_category` text nullable, `excluded_producers` text[], `labels` jsonb |
| `promotion_benefits_cart_discount` | `discount_type` text, `value` decimal, `labels` jsonb |
| `promotion_benefits_delivery_discount` | `delivery_method_code` text, `discount_type` text, `value` decimal, `scope` text, `labels` jsonb |
| `promotion_benefits_free_product` | `sku` text nullable, `category_slug` text nullable, `quantity` int, `labels` jsonb |
| `promotion_benefits_buy_x_get_y` | `trigger_sku` text nullable, `trigger_category_slug` text nullable, `trigger_quantity` int, `reward_sku` text, `reward_quantity` int, `discount_type` text, `value` decimal, `max_applications` int nullable, `labels` jsonb |
| `promotion_benefits_tiered_discount` | `scope` text (`cart`\|`line`), `selector` text nullable (see selector values below), `limit_to_category` text nullable, `tiers` jsonb, `labels` jsonb |

**`selector` values** (used in `promotion_benefits_product_discount` and `promotion_benefits_tiered_discount`):

| Value | Meaning |
|-------|---------|
| `all` | Every qualifying item receives the benefit |
| `cheapest` | Only the lowest unit-price qualifying item(s) |
| `most_expensive` | Only the highest unit-price qualifying item(s) |
| `nth` | Only the item at position `nth_position` (1-indexed) in ascending price order |

`pcs_limit` caps the total number of items that receive the discount regardless of `selector`.

**`tiers` JSONB schema** for `promotion_benefits_tiered_discount` must be explicitly validated in `data/validators.ts`. Each tier element: `{ threshold: string (decimal), discount_type: "percentage" | "fixed", value: string (decimal) }`. Tiers must be sorted ascending by `threshold`; the evaluator applies the highest tier whose threshold is met.

### Code

Table: `promotion_codes`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `name` | text | Internal label |
| `type` | text | `static` or `dynamic` |
| `code` | text nullable | Static code value |
| `prefix` | text nullable | Dynamic prefix |
| `suffix` | text nullable | Dynamic suffix |
| `length` | integer nullable | Dynamic code body length |
| `amount` | integer nullable | Target pool size for dynamic |
| `generated` | integer | Generated so far (default 0) |
| `used` | integer | Global uses consumed (default 0) |
| `usage` | text | `single`, `multiple`, or `unlimited` |
| `usage_amount` | integer nullable | Max global uses when `multiple` |
| `usage_per_customer` | integer nullable | Max per-customer uses |
| `active` | boolean | Default true |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | |

### GeneratedCode

Table: `promotion_generated_codes`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `code_id` | uuid FK → promotion_codes | |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `code` | text UNIQUE (per tenant) | Actual voucher string |
| `active` | boolean | Default true |
| `created_at` | timestamptz | |

### CodeReservation

Table: `promotion_code_reservations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `code_id` | uuid | FK to `promotion_codes` |
| `code_string` | text | Resolved code (for display) |
| `customer_id` | text | Customer session identifier |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | `created_at + 24h` |

> **Partial unique index**: `(code_id, customer_id) WHERE expires_at > NOW()` — enforces at most one active reservation per customer per code. Expired reservations are excluded from the constraint, allowing a customer to re-enter a code after their session expires.

### CodeUsage

Table: `promotion_code_usages`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `code_id` | uuid FK → promotion_codes | |
| `customer_id` | text | |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `used_at` | timestamptz | |

---

## API Contracts

All routes export `openApi`. All mutating routes require `requireAuth` + appropriate `requireFeatures`. Cart-facing endpoints are authenticated via module API key (header `X-Module-Key`).

### Admin CRUD

#### `GET /api/promotions`
Query: `page`, `pageSize` (max 100), `search`, `active`, `cumulative`, `tags`, `startsFrom`, `startsTo`
Response: `{ items: Promotion[], total: number, page: number, pageSize: number }`

#### `POST /api/promotions`
Body: `{ name, description?, order, active, cumulative, tags, excluded_tags, exclude_flags, starts_at?, ends_at? }`
Response: `{ id: uuid }` — 201. Creates promotion with an empty root `RuleGroup`.

#### `PUT /api/promotions`
Body: promotion fields (partial). Updates metadata only; tree mutations use separate commands.
Response: `{ ok: true }`

#### `DELETE /api/promotions`
Body: `{ id: uuid }`
Response: `{ ok: true }` — cascades to rule groups, rules, benefits via DB constraints.

#### `GET /api/promotions/[id]`
Response: full promotion with nested rule group tree (recursive eager load, depth-limited to 10 levels).

#### `PUT /api/promotions/[id]/tree`
Accepts the full rule tree as a nested JSON structure. Uses `withAtomicFlush` to reconcile existing records (add, update, delete nodes) in a single transaction.

#### `PATCH /api/promotions/order`
Body: `{ items: Array<{ id: uuid, order: number }> }` — batch update for drag-sort save.

#### `GET /api/codes`
Paginated list. Query: `page`, `pageSize`, `search`, `type`, `active`.

#### `POST /api/codes`
Body: code creation payload. Creates `Code` record; for dynamic type, triggers generation worker.

#### `PUT /api/codes`
Update code metadata.

#### `DELETE /api/codes`
Soft-delete; deactivates generated codes.

#### `POST /api/codes/[id]/generate`
Triggers background generation of remaining dynamic codes to reach `amount`. Returns `{ jobId }`.

#### `GET /api/codes/[id]/generated`
Paginated list of `GeneratedCode` records. Query: `page`, `pageSize`, `active`.

### Cart-Facing Endpoints

All authenticated via `X-Module-Key` header (module API key).

#### `POST /api/cart/apply-promotion`

Request:
```jsonc
{
  "organizationId": "uuid",
  "tenantId": "uuid",
  "items": [
    {
      "sku": "PROD-001",
      "quantity": 2,
      "unitPrice": "19.99",          // ex-tax unit price
      "unitPriceIncTax": "24.59",
      "rowTotal": "39.98",
      "rowTotalIncTax": "49.18",
      "categorySlug": "electronics",
      "producerCode": "SONY",
      "weight": "0.5",
      "attributes": { "color": "red" } // optional product attributes
    }
  ],
  "customerId": "string | null",
  "customerOrderCount": 5,            // null if unknown
  "code": {                           // null if no code entered
    "id": "uuid",
    "type": "static | dynamic"
  },
  "deliveryMethodCode": "string | null",
  "paymentMethodCode": "string | null",
  "shippingAddress": {                // null if not yet provided
    "country": "PL",
    "region": "mazowieckie",
    "postcode": "00-001"
  },
  "cartWeight": "3.5",
  "deliveryCost": "9.99",             // null if delivery not yet selected
  "consentFlags": ["newsletter_optin"] // consent flags accepted by the customer; empty array if none
}
```

Response:
```jsonc
{
  "appliedPromotions": [
    {
      "promotionId": "uuid",
      "promotionName": "Summer Sale",
      "effects": [
        {
          "type": "LINE_DISCOUNT",
          "targetSku": "PROD-001",        // resolved from benefit + cart item match
          "amount": "-3.99",              // computed: 20% of unitPrice * quantity
          "currency": "USD",
          "label": { "en": "20% off electronics", "pl": "20% zniżki na elektronikę" }
        },
        {
          "type": "LINE_DISCOUNT",
          "targetSku": "PROD-007",
          "amount": "-11.98",
          "currency": "USD",
          "label": { "en": "20% off electronics", "pl": "20% zniżki na elektronikę" }
        }
      ]
    },
    {
      "promotionId": "uuid",
      "promotionName": "Free Shipping",
      "effects": [
        {
          "type": "DELIVERY_DISCOUNT",
          "deliveryMethodCode": "dpd",
          "amount": "-9.99",              // full delivery cost resolved from context
          "currency": "USD",
          "label": { "en": "Free DPD shipping" }
        }
      ]
    },
    {
      "promotionId": "uuid",
      "promotionName": "Buy 2 Get 1 Free",
      "effects": [
        {
          "type": "ADD_FREE_ITEM",
          "sku": "FREE-MUG",             // resolved by promotions engine; cart does not decide
          "quantity": 1,
          "reason": "BUY_X_GET_Y",
          "label": { "en": "Free mug with your order" }
        }
      ]
    }
  ]
}
```

**Resolved Effect Types:**

| Type | Required fields | Notes |
|------|----------------|-------|
| `LINE_DISCOUNT` | `targetSku`, `amount` (negative string), `currency` | One effect per affected line item; amount is the total row discount (not unit) |
| `CART_DISCOUNT` | `amount` (negative string), `currency` | Flat or percentage discount applied against cart subtotal |
| `DELIVERY_DISCOUNT` | `deliveryMethodCode`, `amount` (negative string), `currency` | Amount is the discount against delivery cost; may reduce to zero. For `percentage` discount types, the effect resolver computes the concrete amount using `deliveryCost` from the cart context — `deliveryCost` must be present in the request when a delivery method is selected. |
| `ADD_FREE_ITEM` | `sku`, `quantity`, `reason` | Promotions resolves which SKU and how many; cart adds the line. `reason` is `FREE_PRODUCT` or `BUY_X_GET_Y` |

**Invariants:**
- `amount` is always a negative decimal string (the cart adds it; no sign confusion)
- One `LINE_DISCOUNT` effect per SKU per promotion (effects for the same SKU from different promotions are separate entries in separate `appliedPromotions` objects)
- `ADD_FREE_ITEM` effects are decided entirely by the promotions engine — the cart must not compute which free item to add from raw benefit config

#### `POST /api/cart/add-code`

Request: `{ organizationId, tenantId, codeString, customerId }`
Response: `{ ok: true, codeId: uuid, type: "static|dynamic" }` or 422 with error.

Validates: code exists, is active, has remaining global uses, per-customer limit not reached. Creates `CodeReservation`.

#### `POST /api/cart/validate-code`

Request: `{ organizationId, tenantId, codeString, customerId }`
Response: `{ valid: boolean, reason?: string }`

#### `POST /api/cart/use-code`

Request: `{ organizationId, tenantId, codeId, codeString, customerId, type }`
Response: `{ ok: true }`

Side effects: runs inside a **serializable transaction** that re-checks global usage limits, per-customer limits, and code active status before proceeding (closes multi-device race conditions). Deactivates `GeneratedCode` (dynamic) OR increments `Code.used` + deactivates if exhausted (static). Writes `CodeUsage`. Deletes `CodeReservation`.

#### `POST /api/cart/delete-code`

Request: `{ organizationId, tenantId, codeString, customerId }`
Response: `{ ok: true }` — deletes `CodeReservation` only.

#### `GET /api/dynamic-labels`

Response: list of promotion condition summaries for storefront label rendering (promotion name, active rules in simplified form, applicable products/categories).

#### `POST /api/free-products`

Request: cart context subset. Response: free product offers (FreeProductBenefit + BuyXGetY) applicable to the given context.

#### `POST /api/delivery-methods`

Request: cart context + delivery method codes to check. Response: which delivery methods have active discount benefits.

#### `POST /api/product-page`

Request: `{ organizationId, tenantId, skus: string[] }` — list of SKUs rendered on a product listing or detail page.
Response: `{ badges: Array<{ sku: string, promotionId: uuid, promotionName: string, label: Record<string, string> }> }` — one entry per SKU that has an active promotion with a matching `ProductDiscount` or `BuyXGetY` benefit. Evaluated via `lib/product-page-engine.ts` against the same normalized promotion cache; zero DB access.

---

## Internationalization (i18n)

- All admin UI labels, tooltips, empty states, confirmation dialogs, error messages in locale files
- Benefit `labels` field is a per-locale map stored in JSONB; rendered by cart/checkout/POS
- `translations.ts` declares benefit label fields as translatable for the platform's translation system
- Key namespaces: `promotions.*`, `promotions.codes.*`, `promotions.rules.*`, `promotions.benefits.*`

---

## UI/UX

### Promotions List (`/backend/promotions`)

- Server-side paginated list (default page size 50, max 100); server-side filter bar: name search, date range, active state, cumulative state, tag filter
- Card layout: header (drag handle + name + date badges + tag chips), footer (Active toggle, Cumulative toggle, Edit, Delete)
- Drag-and-drop reorder via dnd-kit operates on the current filtered/paginated set; keyboard Up/Down arrow buttons as accessible alternative
- Pending changes (order or toggle) highlighted — Save button shows accent border; changes not persisted until explicit Save
- Warning banner when saving with active filter: *"Saving while filtered may reorder promotions outside the current page"*
- Delete: confirm dialog if promotion has a non-empty rule tree

### Promotion Form (`/backend/promotions/[id]`)

Four panels in a single page (not tabs):

1. **Info** — name (required), description, starts_at / ends_at date pickers
2. **Settings** — active toggle, cumulative toggle, promotional-price-visibility toggle, tags chip input (autocomplete from existing tags), excluded_tags chip input (same autocomplete, distinct input)
3. **Exclusions** — boolean flag checkboxes (exclude_medicine, exclude_outlet, etc.; driven by config)
4. **Rules & Benefits** — tree builder (see below)

### Rule Group Tree Builder

- Recursive `RuleGroupNode` component; indented with L-shaped connector lines per level
- Background fill lightens by ~10% per nesting level (CSS `color-mix` or CSS variables)
- Group header: **AND/OR** pill toggle (left), action buttons (right): Add Rule (green), Add Sub-group (blue), Add Benefit (orange), Duplicate (purple, sub-groups only), Delete (red, sub-groups only)
- Rules rendered as inline cards: type dropdown (filterable combobox), type-specific inline fields, delete (red icon)
- Benefits rendered in a visually distinct zone at group bottom: orange divider with `BENEFITS` badge, each benefit is an inline card identical in layout to a rule card but orange-accented; includes collapsible Labels section (locale → string inputs)
- Drag-and-drop within tree is type-scoped (rules→rule containers, sub-groups→sub-group containers, benefits→benefit containers); cross-type drops disabled
- Selecting a new rule type resets the data fields for that rule
- Deletion: sub-groups with children show confirmation dialog; empty sub-groups, rules, and benefits delete immediately
- Empty states: *"Add a rule or sub-group to define when this promotion activates."* and *"No benefits yet."*

### Promotional Codes (`/backend/codes`)

- Paginated `DataTable` (server-side) with filters: search, type, active
- Dynamic code rows: progress bar `generated / amount`, Generate action button
- Code detail (`/backend/codes/[id]`): full form + generated codes panel (modal with paginated list of individual codes, active status, copy-to-clipboard)

---

## Configuration

- Module API key for cart-facing endpoints: resolved via `api_keys` module with scope `promotions`
- Promotion exclusion flag definitions configurable via module settings (which flags exist, their labels)
- Code reservation TTL: configurable via module setting (default 24h)
- Tree size guardrails: configurable limits enforced at the API layer; requests exceeding any limit return 422

| Setting | Default | Purpose |
|---------|---------|---------|
| `max_tree_depth` | `10` | Prevent recursion abuse |
| `max_nodes_per_promotion` | `200` | Prevent oversized trees |
| `max_rules_per_group` | `25` | Prevent wide groups |
| `max_benefits_per_group` | `10` | Prevent excessive benefit fan-out |

---

## Migration & Compatibility

- All tables created via MikroORM migrations (`yarn db:generate` → `yarn db:migrate`)
- No existing promotions data — clean migration, no backfill required
- Cart-facing API is additive; existing cart/POS integrations are unaffected until they opt in
- POS module (SPEC-022) deferred promotions to Phase 3 — this module enables that integration

---

## Implementation Plan

### Phase 1 — Domain Model & Core Admin

**Goal:** Operators can create, edit, and delete promotions with a full rule-benefit tree. Data persists correctly. All entities, migrations, and CRUD in place.

1. Scaffold module: `index.ts`, `acl.ts`, `events.ts`, `setup.ts`, `di.ts`, `ce.ts`, `translations.ts`
2. Write all MikroORM entities in `data/entities.ts` (Promotion, RuleGroup, Rule, 15 concrete rule tables, Benefit, 6 concrete benefit tables)
3. Write Zod validators in `data/validators.ts` for all entities and API inputs
4. Generate and apply DB migration (`yarn db:generate && yarn db:migrate`)
5. Implement `commands/promotions.ts` — create/update/delete with undo support, events, cache invalidation
6. Implement `commands/rule-tree.ts` — atomic tree reconciliation command using `withAtomicFlush`
7. Implement `api/promotions/route.ts` (list, create, update, delete) using `makeCrudRoute` + `indexer`
8. Implement `api/promotions/[id]/route.ts` (detail with nested tree eager-load)
9. Implement `PUT /api/promotions/[id]/tree` — tree reconciliation endpoint
10. Implement `PATCH /api/promotions/order` — batch order update
11. Build backend list page (`backend/promotions/page.tsx`) — card layout, drag-sort, filters, batch save
12. Build promotion form pages (create + detail) — 4 panels, tag chip inputs
13. Build `RuleGroupNode` recursive tree component with AND/OR toggle, action buttons, type dropdowns for all 15 rule types, benefit zone, drag-within-tree
14. Run `npm run modules:prepare` and `yarn generate`
15. Integration tests: promotion CRUD, tree save, order batch update

### Phase 2 — Evaluation Engine & Cart API

**Goal:** Cart module can call the promotions API and receive correct benefit descriptors.

1. Implement `lib/evaluation-engine.ts` — three-pass recursive evaluator accepting `NormalizedPromotion[]`; MUST NOT depend on MikroORM entities or any DB access; applies deterministic ordering (`ORDER BY order ASC, id ASC`); Pass 3 calls effect resolvers with the cart context to compute final amounts
2. Implement `lib/rule-evaluators.ts` — all 15 concrete rule evaluators with context key declarations; evaluators receive normalized `config` objects only
3. Implement `lib/effect-resolvers.ts` — all 6 concrete effect resolvers; each resolver maps a `NormalizedBenefit` config + cart context to one or more `ResolvedEffect` objects with computed amounts and resolved SKUs; no math may live outside this file
4. Implement `lib/tag-exclusion.ts` — promotion ordering + cumulativity + tag exclusion loop
5. Implement `services/promotion-cache.ts` — tenant-scoped active promotions cache: fully eager-load all promotions with complete rule/benefit trees, normalize entity graphs into `NormalizedPromotion[]` (flattening polymorphic tables, pre-sorting arrays by `sort_order`, deep-freezing in non-production builds), cache per key `promotions:active:{tenantId}:{organizationId}`; subscriber in `subscribers/invalidate-promotion-cache.ts` with broad invalidation on any `promotions.*` mutation event
6. Implement `api/cart/apply-promotion/route.ts` — full cart evaluation endpoint
7. Implement `api/dynamic-labels/route.ts`, `api/free-products/route.ts`, `api/delivery-methods/route.ts`
8. Implement `lib/product-page-engine.ts` — lightweight variant that evaluates active promotions against a list of SKUs; implement `api/product-page/route.ts` consuming it
9. Integration tests: evaluation engine unit tests for each rule type with assertion that zero DB calls occur during evaluation; end-to-end apply-promotion API tests asserting `ResolvedEffect` amounts (not raw percentages), `ADD_FREE_ITEM` SKU resolution, cumulativity, tag exclusion, sub-group benefit collection; performance benchmark captured for ≥ 100 promotions

### Phase 3 — Codes System

**Goal:** Operators can manage code templates; cart can validate, reserve, and finalize code redemptions.

1. Write `Code`, `GeneratedCode`, `CodeReservation`, `CodeUsage` entities and validators
2. Generate and apply migration
3. Implement `commands/codes.ts` — code CRUD with undo, events
4. Implement `lib/code-service.ts` — validation, per-customer limit check, reservation, use, delete
5. Implement `workers/code-generation.worker.ts` — background batch generator with uniqueness validation; register queue `promotions.code.generate`
6. Implement `services/code-generation.ts` — triggers worker, tracks progress
7. Implement `api/codes/route.ts`, `api/codes/[id]/generate/route.ts`, `api/codes/[id]/generated/route.ts`
8. Implement cart code endpoints: `add-code`, `validate-code`, `use-code`, `delete-code`
9. Build codes backend pages: list, create, detail with generated codes panel
10. Integration tests: code lifecycle (add → validate → use → audit trail), per-customer limit enforcement, dynamic code uniqueness

### Phase 4 — Search, Notifications & Polish

**Goal:** Promotions are searchable; operators receive relevant notifications; edge cases handled.

1. Implement `search.ts` — fulltext indexing for promotions (name, description, tags) and codes (name, code)
2. Implement `notifications.ts` — code pool exhaustion notification, promotion about to expire
3. Implement `subscribers/` for notification events
4. Add i18n locale files (`i18n/en.json`, `i18n/pl.json`, etc.)
5. Widget injection: promotion count widget for dashboard, code usage stats
6. POS integration event subscription: `pos.cart.completed` → trigger `use-code` if code in session
7. Final compliance and spec update

### File Manifest (Phase 1 critical files)

| File | Action | Purpose |
|------|--------|---------|
| `promotions/index.ts` | Create | Module metadata |
| `promotions/acl.ts` | Create | Feature definitions |
| `promotions/events.ts` | Create | Typed events with `as const` |
| `promotions/setup.ts` | Create | Tenant init + defaultRoleFeatures |
| `promotions/di.ts` | Create | DI registrar |
| `promotions/data/entities.ts` | Create | All MikroORM entities |
| `promotions/data/validators.ts` | Create | All Zod schemas |
| `promotions/commands/promotions.ts` | Create | CRUD commands with undo |
| `promotions/commands/rule-tree.ts` | Create | Atomic tree reconciliation |
| `promotions/api/promotions/route.ts` | Create | CRUD route with makeCrudRoute |
| `promotions/backend/promotions/page.tsx` | Create | List page |
| `promotions/backend/promotions/[id]/page.tsx` | Create | Detail + tree editor |

### Testing Strategy

Integration tests for each phase following `.ai/qa/AGENTS.md`:
- Phase 1: `TC-PROM-001` Promotion CRUD, `TC-PROM-002` Rule tree save/load, `TC-PROM-003` Order batch update
- Phase 2: `TC-PROM-010` Apply-promotion returns resolved amounts (not raw percentages) for each rule type, `TC-PROM-011` Cumulativity + tag exclusion, `TC-PROM-012` Sub-group benefit collection, `TC-PROM-013` ADD_FREE_ITEM effect carries correct SKU + quantity for FreeProduct and BuyXGetY
- Phase 3: `TC-PROM-020` Code lifecycle, `TC-PROM-021` Per-customer limit, `TC-PROM-022` Concurrent reservation race
- Phase 4: `TC-PROM-030` Search indexing, `TC-PROM-031` Notification on code exhaustion

---

## Risks & Impact Review

### Data Integrity Failures

#### Rule Tree Atomicity
- **Scenario**: Operator submits a large tree update; server crashes after partial node writes. Some rule groups are orphaned; others reference deleted concrete rule records.
- **Severity**: High
- **Affected area**: Promotion evaluation (orphaned groups evaluate incorrectly), admin UI (shows corrupted tree)
- **Mitigation**: All tree mutations wrapped in a single database transaction via `withAtomicFlush({ transaction: true })`. Orphaned nodes are detected via cascade delete on promotion delete.
- **Residual risk**: Transaction rollback may silently discard large user edits — UI must detect 5xx and prompt re-edit.

#### Concurrent Code Reservation
- **Scenario**: Two browser sessions for the same customer both call `add-code` with a code that has `usage_per_customer: 1` and 0 existing `CodeUsage` records. Both pass the limit check and both create a `CodeReservation`.
- **Severity**: High
- **Affected area**: Per-customer code limits
- **Mitigation**: `CodeReservation` creation is wrapped in a serialisable transaction that re-reads `CodeUsage` count + existing reservation count inside the transaction. A unique constraint on `(code_id, customer_id)` for active reservations enforces single-claim.
- **Residual risk**: Customers with very high checkout abandonment rates create many expired reservations; cleanup job required.

#### Polymorphic Rule Deletion
- **Scenario**: A concrete rule record (e.g. `promotion_rules_product`) is deleted directly without deleting its parent `Rule` dispatcher. The dispatcher now references a non-existent ID.
- **Severity**: Medium
- **Affected area**: Evaluation engine (null-pointer on dispatch)
- **Mitigation**: All concrete rule deletions cascade from `Rule` deletion; no direct delete of concrete tables via API. Evaluator validates `ruleable_id` exists before dispatch and returns false (not throw) if missing.
- **Residual risk**: Low — cascades are DB-enforced.

### Cascading Failures & Side Effects

#### Cache Invalidation Lag
- **Scenario**: Operator deactivates a promotion. Cache is still serving the old active promotions list. Customers continue receiving benefits from the deactivated promotion for up to TTL seconds.
- **Severity**: Medium
- **Affected area**: Cart apply-promotion endpoint
- **Mitigation**: Cache subscriber uses broad invalidation — any `promotions.*` mutation event evicts the relevant tenant-scoped cache entry immediately (not on TTL). Covered events: promotion created / updated / deleted, order changed, rule tree mutated, rule or benefit created / updated / deleted, active toggle, date window change, tags or exclusions change, code activation state change. Broad invalidation is preferred over selective eviction to prevent missed triggers.
- **Residual risk**: Event delivery latency (milliseconds on ephemeral subscriptions); acceptable for promotional context.

#### Evaluation Engine Depth Explosion
- **Scenario**: An operator constructs a rule tree 50 levels deep (accidentally or maliciously). The recursive evaluator stack-overflows.
- **Severity**: Medium
- **Affected area**: `apply-promotion` endpoint
- **Mitigation**: Max tree depth enforced at API write time (default 10; configurable). Evaluator carries a depth counter and returns false at limit.
- **Residual risk**: Trees saved before limit enforcement are grandfathered — migration to enforce retroactively may be needed.

### Tenant & Data Isolation Risks

#### Cross-Tenant Code String Collision
- **Scenario**: Two tenants generate dynamic codes with identical strings. A customer from tenant A uses tenant B's code.
- **Severity**: High
- **Affected area**: Code validation
- **Mitigation**: All code lookups are scoped by `(tenant_id, organization_id, code_string)`. The UNIQUE constraint on `promotion_generated_codes.code` is per-tenant (partial unique index). `add-code` endpoint requires tenant scope from authenticated request context.
- **Residual risk**: None — isolation is index-enforced.

#### Promotion Cache Leakage
- **Scenario**: Promotion cache is keyed incorrectly (missing tenant scope). Tenant A's promotions served to tenant B.
- **Severity**: Critical
- **Affected area**: All cart evaluations
- **Mitigation**: Cache keys MUST include `tenantId` + `organizationId`. Cache implementation uses `@open-mercato/cache` with tenant-scoped tag invalidation. Code review checklist includes cache key inspection.
- **Residual risk**: Implementation error — mitigated by explicit cache key type that enforces required fields.

### Migration & Deployment Risks

#### Large Number of Tables
- **Scenario**: 15 concrete rule tables + 6 concrete benefit tables = 21+ new tables. Migration creates all at once. If migration fails mid-way, partial state is left.
- **Severity**: Medium
- **Affected area**: Database schema
- **Mitigation**: MikroORM generates a single migration file; Postgres wraps it in a transaction. Rollback restores prior state completely.
- **Residual risk**: Migration time on large databases — tables are empty on first deploy; negligible.

### Operational Risks

#### Dynamic Code Generation Stall
- **Scenario**: Worker process crashes mid-generation. `generated` counter does not match actual count of `GeneratedCode` rows.
- **Severity**: Low
- **Affected area**: Code pool accuracy
- **Mitigation**: Worker is idempotent — on restart it queries `SELECT COUNT(*) FROM promotion_generated_codes WHERE code_id = ?` to determine actual generated count, then continues from there. `Code.generated` is reconciled on worker completion, not incremented per-insert.
- **Residual risk**: Temporary display inconsistency in admin UI between worker runs; acceptable.

#### Promotion List Performance at Scale
- **Scenario**: An organization accumulates 10,000 promotions. The list endpoint loads all of them (spec says all are loaded at once for drag-sort).
- **Severity**: Medium
- **Affected area**: Admin list page
- **Mitigation**: In Phase 1, enforce a soft limit (warn at 500, hard limit at 1000 per organization). Active promotions cache is separate from admin list — cache only loads `active=true` AND within date range. Admin list uses paginated query with server-side filters; drag-sort operates on the filtered subset.
- **Residual risk**: Operators with very large promotion archives need bulk archive/cleanup tooling (Phase 4 scope).

---

## Final Compliance Report — 2026-02-23

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/search/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | All cross-module references use FK IDs only (`user_group_id`, `category_slug`, `delivery_method_code`, `payment_method_code`, `producer_code`) |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | All entities carry `organization_id` + `tenant_id`; all queries scoped accordingly |
| root AGENTS.md | Never expose cross-tenant data from API handlers | Compliant | Cache keys include `tenantId`+`organizationId`; all code lookups scoped by tenant; cart endpoints require tenant scope from auth context |
| root AGENTS.md | Use DI (Awilix) via `di.ts`; avoid `new`-ing directly | Compliant | `di.ts` registers `PromotionCache`, `CodeGenerationService`, `CodeService`; evaluation engine is stateless (no DI needed) |
| root AGENTS.md | Validate all inputs with Zod; place validators in `data/validators.ts` | Compliant | All API inputs and entity creation shapes covered; `tiers` JSONB validated explicitly |
| root AGENTS.md | Derive TS types from Zod via `z.infer` | Compliant | No hand-written type duplicates; all types derived from validators |
| root AGENTS.md | Use `findWithDecryption`/`findOneWithDecryption` | Compliant | Applied in admin detail routes where `Promotion` and `Code` entities are fetched |
| root AGENTS.md | Never hand-write migrations | Compliant | All tables generated via `yarn db:generate` |
| root AGENTS.md | RBAC: `requireAuth` + `requireFeatures` on all admin routes | Compliant | All admin routes declare guards; cart endpoints use `X-Module-Key` auth instead |
| root AGENTS.md | API routes MUST export `openApi` | Compliant | All routes include `openApi` export; `api/openapi.ts` provides shared helpers |
| root AGENTS.md | CRUD routes: use `makeCrudRoute` with `indexer` | Compliant | Promotion and code list routes use `makeCrudRoute` with `indexer: { entityType }` |
| root AGENTS.md | `setup.ts`: declare `defaultRoleFeatures` when adding `acl.ts` features | Compliant | `setup.ts` maps all features to default admin/manager roles |
| root AGENTS.md | Events: use `createModuleEvents()` with `as const` | Compliant | `events.ts` uses `createModuleEvents()` with `as const`; all commands emit typed events |
| root AGENTS.md | Commands with undo support | Compliant | `commands/promotions.ts` and `commands/codes.ts` implement undo/redo pattern; tree reconciliation command implements inverse-diff undo |
| root AGENTS.md | Use `apiCall`/`apiCallOrThrow` — never raw `fetch` | Compliant | All backend page components use `apiCall` from `@open-mercato/ui/backend/utils/apiCall` |
| root AGENTS.md | Every dialog: `Cmd/Ctrl+Enter` submit, `Escape` cancel | Compliant | Delete confirm dialog and generated codes panel modal implement both shortcuts |
| root AGENTS.md | `pageSize` at or below 100 | Compliant | All list endpoints default 50, max 100 |
| root AGENTS.md | No `any` types | Compliant | All types derived from Zod schemas or explicit interfaces; evaluation engine uses `NormalizedPromotion` type hierarchy |
| root AGENTS.md | Boolean parsing: use `parseBooleanToken`/`parseBooleanWithDefault` | Compliant | Query params `active`, `cumulative` parsed via shared boolean helpers |
| root AGENTS.md | Run `npm run modules:prepare` after adding module files | Compliant | Noted in Phase 1 step 14 |
| packages/core/AGENTS.md | Module placed in `packages/core/src/modules/promotions/` | Compliant | Architecture section confirms path |
| packages/core/AGENTS.md | Module ID: plural, snake_case | Compliant | Module ID `promotions` |
| packages/core/AGENTS.md | Event IDs: `module.entity.action` (dot-separated, singular entity, past tense) | Compliant | All events follow `promotions.promotion.created`, `promotions.code.used`, `promotions.generated-code.created` pattern |
| packages/core/AGENTS.md | Feature naming: `<module>.<action>` | Compliant | `promotions.view`, `promotions.create`, `promotions.update`, `promotions.delete`, `promotions.codes.manage` |
| packages/cache/AGENTS.md | Use `@open-mercato/cache`; never raw Redis/SQLite | Compliant | `services/promotion-cache.ts` resolves cache via DI; uses tag-based invalidation |
| packages/queue/AGENTS.md | Background workers use queue contract; never custom queues | Compliant | `workers/code-generation.worker.ts` exports `metadata` with `queue` + `concurrency` |
| packages/events/AGENTS.md | Cache invalidation subscriber uses ephemeral subscription | Compliant | `invalidate-promotion-cache.ts` uses ephemeral subscription (immediate, in-process) |
| packages/search/AGENTS.md | `search.ts` exports `searchConfig` | Compliant | Phase 4 implements `search.ts` for promotions + codes fulltext indexing |
| packages/ui/AGENTS.md | Use `CrudForm` for standard forms; `useGuardedMutation` for non-CrudForm writes | Compliant | Promotion and code forms use `CrudForm`; tree reconciliation (PUT) uses `useGuardedMutation` |
| packages/ui/AGENTS.md | Use `LoadingMessage`/`ErrorMessage` | Compliant | All backend pages use `LoadingMessage`/`ErrorMessage` from `@open-mercato/ui/backend/detail` |
| packages/ui/AGENTS.md | Use `DataTable` for lists | Compliant | Codes list and generated codes panel use `DataTable` |

---

## Changelog

| Date | Version | Summary |
|------|---------|---------|
| 2026-02-23 | 1.0.0 | Initial spec — domain model, three-pass evaluation engine, cart API, admin UI, code system, 4-phase implementation plan |
