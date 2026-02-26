# SPEC-037: Promotions Module

**Date**: 2026-02-23
**Status**: Approved

---

## TLDR

**Key Points:**
- A standalone `promotions` module that defines promotions via a flexible, recursive rule-condition tree, evaluates which promotions apply to a given cart context, and returns **fully resolved effects** to the cart module — promotions owns the math, the cart only applies the pre-computed results.
- Promotional codes (static vouchers and dynamically generated pools) are managed independently of individual promotions and linked via `CodeRule` nodes inside the rule tree.
- **Extensible by design**: other modules can register custom rule types, custom benefit types, evaluation middleware (before/after hooks), and custom admin configurator components — without modifying core promotions code.

**Scope:**
- Domain model: `Promotion`, `RuleGroup` (recursive tree), polymorphic `Rule` + 15 built-in rule types, polymorphic `Benefit` + 6 built-in benefit types, `Code`, `GeneratedCode`, `CodeReservation`, `CodeUsage`, `PromotionUsage` (per-order audit ledger + global spend tracking)
- Three-pass evaluation engine (boolean pass → benefit collection pass → effect resolution pass), product-page lightweight variant
- Promotion ordering, cumulativity, and tag-based self-exclusion algorithm
- Cart interaction REST API (apply-promotion, code lifecycle endpoints)
- Admin UI: drag-sortable promotion list, inline tree builder, promotional codes table
- Extension infrastructure: server-side `PromotionExtensionRegistry`, client-side configurator registry, evaluation middleware pipeline, declared widget injection slots

**Concerns:**
- Rule tree depth and polymorphic joins require careful N+1 mitigation and upfront caching strategy
- Code reservation TTL must be handled atomically; concurrent checkouts must not bypass per-customer limits
- Budget cap enforcement (`max_budget`) requires a serializable transaction in `registerUsage` to prevent concurrent checkouts from jointly overshooting the cap; the optimistic cache-based pre-check reduces but does not eliminate this race window

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
| JSONB rule/benefit config | `promotion_rules` and `promotion_benefits` each store a `rule_type`/`benefit_type` discriminator and a `config jsonb` column. Follows the established `condition_expression` pattern in `business_rules` and `workflows`. Zod discriminated union validates config per type at the application boundary. No migrations required when adding new rule or benefit types. The only application-layer concern is validating `code_id` references inside `code` rule configs, handled in commands before persisting. |
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
│   ├── cart/register-usage/route.ts  Record confirmed discount audit + budget check (POST)
│   ├── cart/revert-usage/route.ts    Revert usage on order cancellation (POST)
│   ├── dynamic-labels/route.ts       Storefront condition metadata (GET)
│   ├── free-products/route.ts        Free product eligibility (POST)
│   ├── delivery-methods/route.ts     Delivery promotion eligibility (POST)
│   ├── product-page/route.ts         Product promotion badge data (POST)
│   └── extension-types/route.ts      Available extension rule/benefit type metadata (GET)
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
│   ├── rule-evaluators.ts            15 built-in rule evaluators
│   ├── effect-resolvers.ts           Benefit config → ResolvedEffect[] (owns all discount math)
│   ├── product-page-engine.ts        Lightweight variant (product visibility)
│   ├── code-service.ts               Code validation, reservation, usage
│   ├── tag-exclusion.ts              Promotion ordering + cumulativity + tag exclusion loop
│   ├── extension-registry.ts         Server-side rule/benefit/middleware extension registry
│   ├── extension-registry.client.ts  Client-side configurator component registry
│   └── promotion-usage-service.ts    registerUsage / revertUsage / getBudgetConsumed
│
├── services/
│   ├── promotion-cache.ts            Active promotions cache (tag-invalidated)
│   └── code-generation.ts            Dynamic code batch generator
│
├── workers/
│   └── code-generation.worker.ts     Background worker for dynamic code pools
│
├── subscribers/
│   ├── invalidate-promotion-cache.ts On promotion CUD + usage events → invalidate cache
│   └── budget-exhausted.ts           On budget-exhausted → emit notification
│
├── data/
│   ├── entities.ts                   MikroORM entities (all tables)
│   └── validators.ts                 Zod schemas for all inputs
│
├── migrations/                       DB migrations (generated, never hand-written)
├── i18n/en.json                      English locale strings
├── components/                       Shared React components (tree builder)
└── widgets/
    ├── injection-table.ts            Widget-to-slot mappings
    └── injection/                    Widget injection slots (injected by other modules)
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
  │   ├─ Currency eligibility check: if promotion.eligibleCurrencies.length > 0
  │   │   AND context.currency ∉ promotion.eligibleCurrencies → skip
  │   ├─ Budget pre-check (optimistic): if promotion.maxBudget is set
  │   │   AND promotion.totalDiscountGranted >= promotion.maxBudget → skip
  │   │   (Not authoritative — enforced atomically in registerUsage)
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
  eligibleCurrencies: string[]        // empty array = all currencies
  maxBudget: string | null            // null = no cap; decimal string in budgetCurrency
  budgetCurrency: string | null       // ISO 4217; null when maxBudget is null
  totalDiscountGranted: string        // snapshot at cache-build time; used for optimistic budget pre-check only
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

1. A single cache build performs **all** required database reads (promotions → rule groups (recursive) → `promotion_rules` → `promotion_benefits` → `SUM(total_discount_amount)` per promotion from `promotion_usages WHERE reverted_at IS NULL`)
2. After caching, promotion evaluation executes with **zero database access**
3. Any missing eager-loaded relation is treated as a critical bug
4. `totalDiscountGranted` in `NormalizedPromotion` is a **snapshot** — it is intentionally stale between cache rebuilds. It is used only for an optimistic pre-check that skips obviously-exhausted promotions without adding latency. Authoritative enforcement happens in `registerUsage` inside a serializable transaction.

The evaluation engine (`lib/evaluation-engine.ts`) operates purely on `NormalizedPromotion` objects and **must not** use the entity manager, repository calls, lazy relation access, or dynamic DB lookups. All required data must be provided via the cart context or the normalized promotion.

### Code Lifecycle

```
add-code   → validate code + per-customer limit → create CodeReservation (TTL 24h)
validate-code → re-check reservation + code active status
apply-promotion → code_id passed in context → CodeRule evaluator matches
use-code   → deactivate GeneratedCode OR increment Code.used → write CodeUsage → delete reservation
delete-code → delete CodeReservation only
```

### Promotion Usage Lifecycle

```
register-usage → validate orderId not already registered (idempotent upsert)
              → open serializable transaction
              → re-read SUM(total_discount_amount) WHERE reverted_at IS NULL AND currency = budget_currency
              → if max_budget set AND new total would exceed max_budget → rollback, emit budget-exhausted, return 422
              → write PromotionUsage (effects_snapshot, total_discount_amount, currency, order_type)
              → commit → emit promotions.usage.registered → invalidate promotion cache entry
revert-usage  → SET reverted_at = NOW() on all PromotionUsage rows
              WHERE order_id = ? AND organization_id = ? AND tenant_id = ? AND reverted_at IS NULL
              → emit promotions.usage.reverted → invalidate promotion cache entry
```

`PromotionUsageService` (`lib/promotion-usage-service.ts`) exposes:

| Method | Description |
|--------|-------------|
| `registerUsage(params)` | Writes `PromotionUsage`; enforces `max_budget` atomically inside a serializable transaction; idempotent on `(promotion_id, order_id, tenant_id)` |
| `revertUsage(orderId, organizationId, tenantId)` | Marks all matching usage rows reverted; never deletes rows (audit immutability) |
| `getBudgetConsumed(promotionId, organizationId, tenantId, currency)` | `SUM(total_discount_amount) WHERE reverted_at IS NULL AND currency = ?`; used by `registerUsage` inside the transaction |

`registerUsage` **does not validate or re-evaluate** the promotion — it records the effects already returned by `apply-promotion`. The caller (cart/POS integration) is responsible for passing the correct `ResolvedEffect[]` snapshot.

The `promotions.usage.registered` and `promotions.usage.reverted` events trigger cache invalidation so that `totalDiscountGranted` in `NormalizedPromotion` stays approximately current.

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

Additional events emitted by the evaluation and code pipelines:

| Trigger | Event emitted | Payload |
|---------|--------------|---------|
| Successful `apply-promotion` call | `promotions.evaluation.completed` | `{ organizationId, tenantId, appliedPromotionIds, effectCount, durationMs }` |
| `use-code` finalises successfully | `promotions.code.used` (existing) + `promotions.code.exhausted` (if the code pool is now empty) | |
| Code pool drops to zero available | `promotions.code.exhausted` | `{ organizationId, tenantId, codeId, codeName }` |
| Promotion `ends_at` within 48h | `promotions.promotion.expiring-soon` | `{ organizationId, tenantId, promotionId, endsAt }` — emitted by a scheduled check, not on mutation |
| `register-usage` commits successfully | `promotions.usage.registered` | `{ organizationId, tenantId, promotionId, orderId, orderType, totalDiscountAmount, currency }` |
| `revert-usage` marks rows reverted | `promotions.usage.reverted` | `{ organizationId, tenantId, orderId, promotionIds: string[] }` |
| `max_budget` first reached via `registerUsage` | `promotions.promotion.budget-exhausted` | `{ organizationId, tenantId, promotionId, maxBudget, totalDiscountGranted, budgetCurrency }` |

### Evaluation Middleware Hooks

These are synchronous hooks registered on `PromotionExtensionRegistry` — they are NOT async event bus events. They execute in-process within the same request and are called in registration order.

| Hook | When it runs | What it can do |
|------|-------------|----------------|
| `EvaluationMiddleware.beforeEvaluate` | Before Pass 1 starts for any promotion | Return a modified `CartContext` (e.g. append loyalty tier data to `context.extensions`) |
| `EvaluationMiddleware.afterResolve` | After Pass 3 produces all `AppliedPromotion[]` | Filter, augment, or reorder the resolved effects (e.g. enterprise pricing caps a maximum discount) |
| `CodeMiddleware.beforeCodeUse` | Inside the serializable transaction before `use-code` commits | Throw a typed error to veto code use |
| `CodeMiddleware.afterCodeUse` | After `use-code` transaction commits (outside transaction) | Side effects — awarding loyalty points, sending confirmation events |

Middleware is registered at DI startup and is immutable for the lifetime of the process. Registration order is deterministic (alphabetical by module ID within a single DI container boot).

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
| `eligible_currencies` | text[] | Currency codes this promotion applies to; empty array = all currencies |
| `max_budget` | numeric nullable | Lifetime total discount cap across all orders in `budget_currency`; null = unlimited |
| `budget_currency` | text nullable | Required when `max_budget` is set; ISO 4217 code (e.g. `USD`). Only `PromotionUsage` rows in this currency contribute to the budget counter. |
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

### Rule

Table: `promotion_rules`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `rule_group_id` | uuid FK → promotion_rule_groups | |
| `promotion_id` | uuid FK → promotions | Denormalised |
| `rule_type` | text | Discriminator (e.g. `order_value`, `product`, `code`) |
| `config` | jsonb | Validated per `rule_type` by Zod discriminated union in `data/validators.ts` |
| `sort_order` | integer | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Config schemas per `rule_type`:**

| `rule_type` | Config fields |
|-------------|---------------|
| `order_value` | `value` decimal string, `operator` text, `tax_inclusive` bool, `limit_to_category` text nullable |
| `order_date` | `date` date string, `operator` text |
| `product_count` | `value` integer, `operator` text, `exclude_pharmaceutical` bool |
| `cart_weight` | `value` decimal string, `operator` text |
| `row_total` | `value` decimal string, `operator` text, `sku` text nullable, `category_slug` text nullable |
| `product` | `sku` text, `quantity` integer, `operator` text |
| `category` | `category_slug` text, `quantity` integer, `operator` text, `exclude_pharmaceutical` bool |
| `producer` | `producer_code` text, `quantity` integer, `operator` text, `exclude_pharmaceutical` bool |
| `product_attribute` | `attribute_code` text, `operator` text, `value` text |
| `user_group` | `user_group_id` uuid string |
| `customer_order_history` | `value` integer, `operator` text |
| `consent_flag` | `flag_key` text — identifier of a consent flag the customer must have accepted (e.g. `newsletter_optin`, `loyalty_terms`); evaluated against `consentFlags` in the cart context |
| `code` | `code_id` uuid string — application-layer validated reference to `promotion_codes`; validated in commands before persist |
| `delivery_method` | `delivery_method_code` text |
| `payment_method` | `payment_method_code` text |
| `shipping_address` | `field` text (`country`/`region`/`postcode`), `operator` text, `value` text |

### Benefit

Table: `promotion_benefits`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `rule_group_id` | uuid FK → promotion_rule_groups | |
| `promotion_id` | uuid FK → promotions | Denormalised |
| `benefit_type` | text | Discriminator |
| `config` | jsonb | Validated per `benefit_type` by Zod discriminated union in `data/validators.ts` |
| `sort_order` | integer | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Config schemas per `benefit_type`:**

| `benefit_type` | Config fields |
|----------------|---------------|
| `product_discount` | `sku` text nullable, `discount_type` text, `value` decimal string, `selector` text, `nth_position` int nullable, `pcs_limit` int nullable, `limit_to_category` text nullable, `excluded_producers` text[], `max_discount` decimal string nullable, `labels` Record\<locale, string\> |
| `cart_discount` | `discount_type` text, `value` decimal string, `max_discount` decimal string nullable, `labels` Record\<locale, string\> |
| `delivery_discount` | `delivery_method_code` text, `discount_type` text, `value` decimal string, `scope` text, `labels` Record\<locale, string\> |
| `free_product` | `sku` text nullable, `category_slug` text nullable, `quantity` int, `labels` Record\<locale, string\> |
| `buy_x_get_y` | `trigger_sku` text nullable, `trigger_category_slug` text nullable, `trigger_quantity` int, `reward_sku` text, `reward_quantity` int, `discount_type` text, `value` decimal string, `max_applications` int nullable, `max_discount` decimal string nullable, `labels` Record\<locale, string\> |
| `tiered_discount` | `scope` text (`cart`\|`line`), `selector` text nullable (see selector values below), `limit_to_category` text nullable, `tiers` TierElement[], `max_discount` decimal string nullable, `labels` Record\<locale, string\> |

**`selector` values** (used in `product_discount` and `tiered_discount` configs):

| Value | Meaning |
|-------|---------|
| `all` | Every qualifying item receives the benefit |
| `cheapest` | Only the lowest unit-price qualifying item(s) |
| `most_expensive` | Only the highest unit-price qualifying item(s) |
| `nth` | Only the item at position `nth_position` (1-indexed) in ascending price order |

`pcs_limit` caps the total number of items that receive the discount regardless of `selector`.

`max_discount` (optional, decimal string) caps the total monetary discount produced by a single benefit invocation. The effect resolver in `lib/effect-resolvers.ts` applies the cap after computing the raw amount: `effectiveAmount = min(rawAmount, max_discount)`. The cap is expressed in the cart's operating currency. This allows operators to configure benefits such as "10% off the cart, but no more than $1000". Applies to `product_discount`, `cart_discount`, `buy_x_get_y`, and `tiered_discount`; not relevant for `delivery_discount` (naturally bounded by delivery cost) or `free_product`/`buy_x_get_y` free-item additions (no monetary amount computed).

**`tiers` schema** for `tiered_discount` config must be explicitly validated in `data/validators.ts`. Each tier element: `{ threshold: string (decimal), discount_type: "percentage" | "fixed", value: string (decimal) }`. Tiers must be sorted ascending by `threshold`; the evaluator applies the highest tier whose threshold is met.

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

> **Unique constraint**: `UNIQUE (code_id, customer_id)` — enforces at most one reservation row per customer per code. The application uses **upsert semantics**: on re-reservation, the existing row's `expires_at` is extended rather than inserting a new row. To check if a reservation is still active, compare `expires_at > NOW()` in application logic or queries — not in the index. This sidesteps PostgreSQL's prohibition on volatile functions (`NOW()`) in index predicates.

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

### PromotionUsage

Table: `promotion_usages`

Serves a dual purpose: **compliance audit ledger** (immutable record of exactly what discounts were applied to each order/quote) and **global usage counter** (drives `max_budget` enforcement and `revertUsage` on cancellation).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `promotion_id` | uuid FK → promotions | |
| `order_id` | text | External order/quote/cart ID supplied by the caller |
| `order_type` | text | `order`, `quote`, `pos_cart` — for cross-document audit filtering |
| `customer_id` | text nullable | Customer session identifier |
| `currency` | text | ISO 4217 currency code the order was placed in |
| `total_discount_amount` | numeric | Sum of all `|amount|` values from `ResolvedEffect[]` for this promotion on this order |
| `effects_snapshot` | jsonb | Full `ResolvedEffect[]` snapshot at time of registration — immutable audit record |
| `registered_at` | timestamptz | When the usage was recorded |
| `reverted_at` | timestamptz nullable | Set on order cancellation; row is never deleted — reverted rows are excluded from budget aggregation |

**Unique constraint**: `UNIQUE (promotion_id, order_id, organization_id, tenant_id)` — prevents double-registration for the same order. `registerUsage` uses upsert semantics (idempotent on re-submission).

**Index**: `(promotion_id, organization_id, tenant_id, currency, reverted_at)` — supports efficient `SUM(total_discount_amount) WHERE reverted_at IS NULL AND currency = ?` for budget checks.

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
  "currency": "USD",                  // ISO 4217; required — used for currency eligibility check and stored in PromotionUsage
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
- When `max_discount` is set on a benefit config, the effect resolver caps `|amount|` at `max_discount` before returning the effect — the resolved `amount` is always `≥ -max_discount`. The cap is applied per-benefit, not across the whole promotion.

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

#### `POST /api/cart/register-usage`

Called by the cart integration after an order/quote is **confirmed** (payment captured or quote finalised). Records the discount audit trail and enforces the lifetime budget cap.

Request:
```jsonc
{
  "organizationId": "uuid",
  "tenantId": "uuid",
  "orderId": "string",
  "orderType": "order | quote | pos_cart",
  "customerId": "string | null",
  "currency": "USD",
  "appliedPromotions": [
    {
      "promotionId": "uuid",
      "effects": [/* ResolvedEffect[] — same shape as returned by apply-promotion */]
    }
  ]
}
```

Response: `{ ok: true }` — 200. Idempotent on re-submission for the same `orderId`.

Side effects: for each `appliedPromotion`, runs `PromotionUsageService.registerUsage(...)` inside a serializable transaction that re-checks `max_budget`. If any promotion's budget would be exceeded, that promotion's write is rolled back and the endpoint returns **207 Multi-Status** with a `budgetExceeded` flag for the affected promotion IDs — the caller should re-evaluate whether to proceed with the order at a reduced discount or notify the customer. Emits `promotions.usage.registered` per successful promotion. Emits `promotions.promotion.budget-exhausted` when the running total first reaches `max_budget`.

#### `POST /api/cart/revert-usage`

Called by the cart integration when an order is **cancelled** or a quote is **rejected/expired**.

Request: `{ organizationId, tenantId, orderId }`
Response: `{ ok: true, revertedCount: number }` — `revertedCount` is the number of `PromotionUsage` rows marked reverted.

Side effects: calls `PromotionUsageService.revertUsage(...)`. Rows are never deleted — `reverted_at` is set. Emits `promotions.usage.reverted`. Invalidates the promotion cache so `totalDiscountGranted` is refreshed.

#### `GET /api/dynamic-labels`

Response: list of promotion condition summaries for storefront label rendering (promotion name, active rules in simplified form, applicable products/categories).

#### `POST /api/free-products`

Request: cart context subset. Response: free product offers (FreeProductBenefit + BuyXGetY) applicable to the given context.

#### `POST /api/delivery-methods`

Request: cart context + delivery method codes to check. Response: which delivery methods have active discount benefits.

#### `POST /api/product-page`

Request: `{ organizationId, tenantId, skus: string[] }` — list of SKUs rendered on a product listing or detail page.
Response: `{ badges: Array<{ sku: string, promotionId: uuid, promotionName: string, label: Record<string, string> }> }` — one entry per SKU that has an active promotion with a matching `ProductDiscount` or `BuyXGetY` benefit. Evaluated via `lib/product-page-engine.ts` against the same normalized promotion cache; zero DB access.

#### `GET /api/promotions/extension-types`

Returns all rule and benefit extensions currently registered in `PromotionExtensionRegistry`. Used by the admin tree builder to populate rule/benefit type dropdowns with extension entries.

Requires `requireAuth` + `promotions.view` feature.

Response:
```jsonc
{
  "ruleTypes": [
    {
      "type": "loyalty.tier_membership",
      "label": { "en": "Customer loyalty tier", "pl": "Poziom lojalności klienta" },
      "description": { "en": "Applies when the customer belongs to the specified loyalty tier" },
      "contextKeys": ["loyalty.tier_membership"]
    }
  ],
  "benefitTypes": [
    {
      "type": "loyalty.points_multiplier",
      "label": { "en": "Loyalty points multiplier", "pl": "Mnożnik punktów lojalnościowych" },
      "description": { "en": "Multiplies earned loyalty points for this cart" },
      "contextKeys": []
    }
  ]
}
```

`contextKeys` is surfaced so cart integrations can determine which `extensions` fields to include in `POST /api/cart/apply-promotion` requests.

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

## Extensibility

The promotions module is designed so that other modules (enterprise, loyalty, POS, partner integrations) can add custom rule types, custom benefit types, evaluation middleware, and admin configurator UI — all without touching core promotions code.

### Extension Registry (Server-Side)

`lib/extension-registry.ts` exports `PromotionExtensionRegistry`, registered as a singleton in `di.ts` and resolvable by any other module's DI registrar.

```typescript
// lib/extension-registry.ts

export interface RuleExtension {
  /** Discriminator key, globally unique. Use namespaced form: '<module>.<rule>', e.g. 'loyalty.tier_membership' */
  type: string
  /** Human-readable label per locale, shown in the rule type dropdown */
  label: Record<string, string>
  description?: Record<string, string>
  /** Zod schema used to validate the config JSONB at write time */
  configSchema: z.ZodSchema
  /**
   * Evaluates whether the rule is satisfied.
   * MUST be pure given the same inputs — no DB access, no side effects.
   * Extension-specific context data is passed via `context.extensions[type]`.
   */
  evaluate(config: unknown, context: CartContext): boolean
  /**
   * Keys the extension needs from context.extensions.
   * Declared so cart integrations know what to include in the request body.
   */
  contextKeys?: string[]
}

export interface BenefitExtension {
  /** Discriminator key. Use namespaced form: '<module>.<benefit>', e.g. 'loyalty.points_multiplier' */
  type: string
  label: Record<string, string>
  description?: Record<string, string>
  configSchema: z.ZodSchema
  /**
   * Resolves the benefit into concrete ResolvedEffect[].
   * MUST be pure — no DB access, no side effects.
   */
  resolve(config: unknown, context: CartContext): ResolvedEffect[]
}

export interface EvaluationMiddleware {
  /** Stable ID for deduplication; use namespaced form: '<module>.<name>' */
  id: string
  /**
   * Runs before evaluation begins.
   * May return a modified CartContext (e.g. loyalty module appends tier info to context.extensions).
   * Must not mutate the original context object — return a new reference.
   */
  beforeEvaluate?(context: CartContext): Promise<CartContext>
  /**
   * Runs after all effects are resolved.
   * May filter, augment, or reorder the effects list.
   * Must not mutate the original array — return a new reference.
   */
  afterResolve?(effects: AppliedPromotion[], context: CartContext): Promise<AppliedPromotion[]>
}

export interface CodeMiddleware {
  id: string
  /**
   * Runs inside the serializable transaction before `use-code` finalises.
   * Throw a typed error to veto the code use (e.g. loyalty module vetoes if eligibility check fails).
   */
  beforeCodeUse?(codeId: string, context: CartContext): Promise<void>
  /**
   * Runs after `use-code` commits successfully (outside the transaction).
   * Used for side effects such as awarding loyalty points.
   */
  afterCodeUse?(codeId: string, context: CartContext): Promise<void>
}

export class PromotionExtensionRegistry {
  registerRuleType(ext: RuleExtension): void
  registerBenefitType(ext: BenefitExtension): void
  registerEvaluationMiddleware(middleware: EvaluationMiddleware): void
  registerCodeMiddleware(middleware: CodeMiddleware): void

  getRuleExtension(type: string): RuleExtension | undefined
  getBenefitExtension(type: string): BenefitExtension | undefined

  getAllRuleExtensions(): RuleExtension[]
  getAllBenefitExtensions(): BenefitExtension[]
  getEvaluationMiddlewares(): EvaluationMiddleware[]
  getCodeMiddlewares(): CodeMiddleware[]
}
```

**Registration pattern** — another module registers extensions in its own `di.ts`:

```typescript
// packages/core/src/modules/loyalty/di.ts
import { PromotionExtensionRegistry } from '@open-mercato/core/modules/promotions/lib/extension-registry'
import { loyaltyTierRule } from './promotions/loyalty-tier-rule'
import { loyaltyPointsMultiplierBenefit } from './promotions/loyalty-points-benefit'

export function register(container: AwilixContainer) {
  const registry = container.resolve<PromotionExtensionRegistry>('promotionExtensionRegistry')
  registry.registerRuleType(loyaltyTierRule)
  registry.registerBenefitType(loyaltyPointsMultiplierBenefit)
}
```

**Evaluation engine integration** — `lib/evaluation-engine.ts` resolves unknown rule/benefit types via the registry:

```
Pass 1 (boolean):
  Built-in rule types → lib/rule-evaluators.ts
  Unknown type        → registry.getRuleExtension(type)?.evaluate(config, context) ?? false

Pass 3 (effect resolution):
  Built-in benefit types → lib/effect-resolvers.ts
  Unknown type           → registry.getBenefitExtension(type)?.resolve(config, context) ?? []
```

The middleware pipeline wraps the entire evaluation:

```
beforeEvaluate middlewares (ordered by registration)
  → evaluateGroup() → collectBenefits() → resolveEffects()
afterResolve middlewares (ordered by registration)
  → return AppliedPromotion[]
```

**Constraints on extension evaluators:**

- MUST be synchronous (extensions returning `Promise` are rejected at registration time with a clear error)
- MUST NOT access the database, entity manager, or any I/O — all required data must be declared via `contextKeys` and supplied by the cart in `context.extensions`
- MUST return a deterministic result for the same inputs
- Config JSONB is validated against `configSchema` at write time; evaluators may safely assume the config is valid

**Validation integration** — `data/validators.ts` accepts extension types in the Zod discriminated union via a passthrough branch:

```typescript
// In the rule config discriminated union:
z.discriminatedUnion('rule_type', [
  // ... 15 built-in branches ...
  z.object({ rule_type: z.string(), config: z.unknown() })  // extension fallback; validated by extension's own configSchema
])
```

At write time, the API command resolves the extension from the registry and runs `extension.configSchema.parse(config)` before persisting, producing the same 422 validation errors as built-in types.

---

### Client-Side Configurator Registry

`lib/extension-registry.client.ts` provides a browser-side registry that maps extension type keys to React configurator components. The tree builder (`components/RuleGroupNode`) calls this registry when the selected rule/benefit type is not a built-in type.

```typescript
// lib/extension-registry.client.ts

export interface ConfiguratorProps<TConfig = unknown> {
  config: TConfig
  onChange(config: TConfig): void
  errors?: Record<string, string>
  locale: string
}

export interface RuleConfiguratorExtension {
  type: string
  label: Record<string, string>
  component: React.ComponentType<ConfiguratorProps>
}

export interface BenefitConfiguratorExtension {
  type: string
  label: Record<string, string>
  component: React.ComponentType<ConfiguratorProps>
}

export const promotionExtensionConfiguratorRegistry = {
  registerRule(ext: RuleConfiguratorExtension): void
  registerBenefit(ext: BenefitConfiguratorExtension): void
  getRule(type: string): RuleConfiguratorExtension | undefined
  getBenefit(type: string): BenefitConfiguratorExtension | undefined
  getAllRules(): RuleConfiguratorExtension[]
  getAllBenefits(): BenefitConfiguratorExtension[]
}
```

**Registration pattern** — another module registers its configurator component in its own `notifications.client.ts` or module entry point that is loaded by the app shell:

```typescript
// packages/core/src/modules/loyalty/promotions/configurators.client.ts
import { promotionExtensionConfiguratorRegistry } from '@open-mercato/core/modules/promotions/lib/extension-registry.client'
import { LoyaltyTierRuleConfigurator } from './LoyaltyTierRuleConfigurator'

promotionExtensionConfiguratorRegistry.registerRule({
  type: 'loyalty.tier_membership',
  label: { en: 'Customer loyalty tier', pl: 'Poziom lojalności klienta' },
  component: LoyaltyTierRuleConfigurator,
})
```

**Tree builder integration** — `components/RuleGroupNode.tsx` populates the rule type combobox by merging built-in rule descriptors with `promotionExtensionConfiguratorRegistry.getAllRules()`. When a rule card's `rule_type` matches an extension, the tree builder renders the extension's `component` instead of a built-in field set. The extension component receives `config` and `onChange`; the tree builder owns persistence.

The type dropdown groups extension types under a labelled section (e.g. `"Extensions"`) to distinguish them visually from built-in types.

---

### Widget Injection Points

The promotions module declares the following injection slots for other modules to inject UI widgets. Slot IDs follow the platform convention `<module>.<location>`.

| Slot ID | Location | Typical use |
|---------|----------|-------------|
| `promotions.promotion-list.toolbar` | Right side of the promotion list header bar | Bulk action buttons, export controls |
| `promotions.promotion-detail.panels` | Below the standard 4 panels on the promotion form | Module-specific metadata panels (e.g. loyalty stats for a promotion) |
| `promotions.promotion-detail.sidebar` | Sidebar alongside the tree editor | Real-time preview, analytics breakdowns |
| `promotions.codes-list.toolbar` | Right side of the codes list header bar | Bulk export, import |
| `promotions.dashboard.stats` | Dashboard overview area | Promotion usage summary, active promotions count |

Injected widgets receive `{ promotionId?: string, organizationId: string, tenantId: string }` as props via the standard widget context.

Slot declarations live in `widgets/injection-table.ts` following the platform's widget injection pattern.

---

### Extensible Cart Context

The `CartContext` (accepted by `POST /api/cart/apply-promotion`) is extended with an open-ended `extensions` field to let cart integrations supply extension-specific data:

```jsonc
{
  // ... existing fields ...
  "extensions": {
    "loyalty.tier_membership": { "tier": "gold", "points": 1240 },
    "enterprise.contract_pricing": { "contractId": "uuid" }
  }
}
```

Extension rule evaluators receive the full context and should read from `context.extensions[ext.type]`. The `contextKeys` field declared on each `RuleExtension` is surfaced via `GET /api/promotions/extension-types` so cart integrations know exactly which keys to populate.

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
2. Write all MikroORM entities in `data/entities.ts` (Promotion, RuleGroup, Rule with `rule_type` + `config jsonb`, Benefit with `benefit_type` + `config jsonb`)
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

1. Implement `lib/evaluation-engine.ts` — three-pass recursive evaluator accepting `NormalizedPromotion[]`; MUST NOT depend on MikroORM entities or any DB access; applies deterministic ordering (`ORDER BY order ASC, id ASC`); currency eligibility check before Pass 1 (`eligibleCurrencies` vs `context.currency`); optimistic budget pre-check before Pass 1 (`totalDiscountGranted >= maxBudget`); Pass 3 calls effect resolvers with the cart context to compute final amounts
2. Implement `lib/rule-evaluators.ts` — all 15 concrete rule evaluators with context key declarations; evaluators receive normalized `config` objects only
3. Implement `lib/effect-resolvers.ts` — all 6 concrete effect resolvers; each resolver maps a `NormalizedBenefit` config + cart context to one or more `ResolvedEffect` objects with computed amounts and resolved SKUs; no math may live outside this file. Resolvers for `product_discount`, `cart_discount`, `buy_x_get_y`, and `tiered_discount` must apply `max_discount` capping after computing the raw amount: `effectiveAmount = min(rawAmount, config.max_discount ?? Infinity)`
4. Implement `lib/tag-exclusion.ts` — promotion ordering + cumulativity + tag exclusion loop
5. Implement `services/promotion-cache.ts` — tenant-scoped active promotions cache: fully eager-load all promotions with complete rule/benefit trees, aggregate `totalDiscountGranted` per promotion from `promotion_usages WHERE reverted_at IS NULL`, normalize entity graphs into `NormalizedPromotion[]` (mapping `promotion_rules`/`promotion_benefits` jsonb rows directly to `{ type, config }` shape, pre-sorting arrays by `sort_order`, deep-freezing in non-production builds), cache per key `promotions:active:{tenantId}:{organizationId}`; subscriber in `subscribers/invalidate-promotion-cache.ts` with broad invalidation on any `promotions.*` mutation event or usage event (`promotions.usage.registered`, `promotions.usage.reverted`)
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
10. Write `PromotionUsage` entity and validators; generate and apply migration
11. Implement `lib/promotion-usage-service.ts` — `registerUsage` (serializable transaction, budget cap enforcement, idempotent upsert, `promotions.promotion.budget-exhausted` emission on first budget hit), `revertUsage` (bulk `reverted_at` update), `getBudgetConsumed`
12. Implement `api/cart/register-usage/route.ts` — loops `appliedPromotions`, calls `registerUsage` per promotion, returns 207 Multi-Status with `budgetExceeded` flag for any promotions that were blocked; exports `openApi`
13. Implement `api/cart/revert-usage/route.ts` — calls `revertUsage`, returns `{ ok: true, revertedCount }`; exports `openApi`
14. Update `subscribers/invalidate-promotion-cache.ts` to also subscribe to `promotions.usage.registered` and `promotions.usage.reverted` for cache invalidation
15. Register `PromotionUsageService` in `di.ts`
16. Integration tests: `TC-PROM-023` – `TC-PROM-026` (see Testing Strategy)

### Phase 4 — Search, Notifications & Polish

**Goal:** Promotions are searchable; operators receive relevant notifications; edge cases handled.

1. Implement `search.ts` — fulltext indexing for promotions (name, description, tags) and codes (name, code)
2. Implement `notifications.ts` — code pool exhaustion notification (`promotions.code.exhausted` event), promotion expiring-soon notification
3. Implement `subscribers/` for notification events
4. Add i18n locale files (`i18n/en.json`, `i18n/pl.json`, etc.)
5. Declare widget injection slots in `widgets/injection-table.ts`: `promotions.promotion-list.toolbar`, `promotions.promotion-detail.panels`, `promotions.promotion-detail.sidebar`, `promotions.codes-list.toolbar`, `promotions.dashboard.stats`
6. POS integration event subscription: `pos.cart.completed` → trigger `use-code` if code in session
7. Final compliance and spec update
8. Integration tests: `TC-PROM-030` Search indexing, `TC-PROM-031` Notification on code exhaustion, `TC-PROM-032` Notification on promotion expiring soon

### Phase 5 — Extension Infrastructure

**Goal:** Other modules can register custom rule types, benefit types, evaluation middleware, and admin configurator UI against the promotions module without modifying any promotions file.

1. Implement `lib/extension-registry.ts` — `PromotionExtensionRegistry` class; `registerRuleType`, `registerBenefitType`, `registerEvaluationMiddleware`, `registerCodeMiddleware`; validate at registration that evaluators are synchronous functions; log a warning on duplicate `type` registration (last-registered wins)
2. Register `PromotionExtensionRegistry` as a singleton in `di.ts` under the token `promotionExtensionRegistry`
3. Update `lib/evaluation-engine.ts` — resolve unknown rule types from registry in Pass 1; resolve unknown benefit types from registry in Pass 3; run `EvaluationMiddleware.beforeEvaluate` chain before Pass 1; run `EvaluationMiddleware.afterResolve` chain after Pass 3; pass `context.extensions` through unchanged to all evaluators
4. Update `lib/code-service.ts` — call `CodeMiddleware.beforeCodeUse` inside the serializable transaction; call `CodeMiddleware.afterCodeUse` after transaction commits; wrap `beforeCodeUse` errors as 422 responses with the thrown message
5. Update `data/validators.ts` — add extension passthrough branch to the Zod discriminated union for `rule_type` and `benefit_type`; run `extension.configSchema.parse(config)` in commands for unknown types before persisting
6. Extend `CartContext` type to include `extensions?: Record<string, unknown>`; update the `POST /api/cart/apply-promotion` Zod schema and OpenAPI spec to include the `extensions` field
7. Implement `api/extension-types/route.ts` — `GET`, resolves registry from DI, maps to response shape, exports `openApi`; requires `requireAuth` + `promotions.view`
8. Implement `lib/extension-registry.client.ts` — `promotionExtensionConfiguratorRegistry` object; `registerRule`, `registerBenefit`, `getRule`, `getBenefit`, `getAllRules`, `getAllBenefits`
9. Update `components/RuleGroupNode.tsx` tree builder — fetch `/api/promotions/extension-types` once on mount; merge extension entries into rule type and benefit type comboboxes under an `"Extensions"` group heading; render extension component from client registry when selected type is not built-in; fall back to a `<JsonConfigEditor>` (raw JSON textarea with schema validation) when a type is present in server metadata but has no registered client configurator
10. Integration tests: `TC-PROM-040` Register a test rule extension, create a promotion using it, verify evaluation returns correct result; `TC-PROM-041` Register a test benefit extension, verify effect is present in `apply-promotion` response; `TC-PROM-042` `beforeEvaluate` middleware can inject data into `context.extensions`; `TC-PROM-043` `afterResolve` middleware can filter effects; `TC-PROM-044` `beforeCodeUse` middleware can veto code use with 422; `TC-PROM-045` Extension type appears in `GET /api/promotions/extension-types` response

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
- Phase 2: `TC-PROM-010` Apply-promotion returns resolved amounts (not raw percentages) for each rule type, `TC-PROM-011` Cumulativity + tag exclusion, `TC-PROM-012` Sub-group benefit collection, `TC-PROM-013` ADD_FREE_ITEM effect carries correct SKU + quantity for FreeProduct and BuyXGetY, `TC-PROM-014` `max_discount` cap — a `cart_discount` benefit with `value: "10%"` and `max_discount: "100"` applied to a $1500 cart produces `amount: "-100"` (capped), not `"-150"`
- Phase 3: `TC-PROM-020` Code lifecycle, `TC-PROM-021` Per-customer limit, `TC-PROM-022` Concurrent reservation race, `TC-PROM-023` `register-usage` writes `PromotionUsage` row with correct `effects_snapshot` and `total_discount_amount`, `TC-PROM-024` `revert-usage` sets `reverted_at` on all matching rows (never deletes); `getBudgetConsumed` decrements accordingly, `TC-PROM-025` Budget cap enforcement — promotion with `max_budget: "500"` accepts registrations until cumulative hits 500, then blocks with 207 + `budgetExceeded: true` and emits `promotions.promotion.budget-exhausted`; cache refresh causes post-exhaustion `apply-promotion` to skip the promotion, `TC-PROM-026` Currency eligibility — promotion with `eligible_currencies: ["EUR"]` is excluded from `apply-promotion` response when `currency: "USD"` is passed; included when `currency: "EUR"` is passed
- Phase 4: `TC-PROM-030` Search indexing, `TC-PROM-031` Notification on code exhaustion, `TC-PROM-032` Notification on promotion expiring soon
- Phase 5: `TC-PROM-040` Custom rule extension evaluation, `TC-PROM-041` Custom benefit extension effect resolution, `TC-PROM-042` `beforeEvaluate` middleware context injection, `TC-PROM-043` `afterResolve` middleware effect filtering, `TC-PROM-044` `beforeCodeUse` veto, `TC-PROM-045` Extension type metadata endpoint

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

#### JSONB Config Schema Drift
- **Scenario**: A rule or benefit record is persisted with a `config` shape that no longer matches the current Zod schema (e.g. after a schema evolution). Evaluation engine receives unexpected config fields or missing required fields.
- **Severity**: Medium
- **Affected area**: Evaluation engine (runtime error in rule evaluator or effect resolver)
- **Mitigation**: All writes go through Zod discriminated union validation in `data/validators.ts` before persisting. Evaluators defensively destructure only known fields and return `false` (not throw) on unrecognised shapes. Schema migrations for existing rows must be handled via a one-time data migration when field renames occur.
- **Residual risk**: Low — write-time validation prevents bad data entering the store; evaluator defensiveness contains runtime exposure.

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

#### Budget Cap Race Window

- **Scenario**: Multiple concurrent orders for the same promotion all pass the optimistic budget pre-check (stale cache snapshot), then all call `register-usage` concurrently. The serializable transaction enforces the cap correctly on each commit, but two requests that entered the transaction at the same time may both see the remaining budget as sufficient before either has committed.
- **Severity**: Low — serializable isolation in PostgreSQL uses predicate locking to detect read-write conflicts. A transaction that reads and then increments the `SUM` aggregate will conflict with a concurrent transaction doing the same, causing one to retry or abort.
- **Affected area**: `max_budget` enforcement in `registerUsage`
- **Mitigation**: `registerUsage` runs at `ISOLATION LEVEL SERIALIZABLE`; PostgreSQL's SSI detects the read-modify-write conflict and forces one transaction to retry. The retry logic re-reads the current sum and may block the second registration if the cap is now met.
- **Residual risk**: Marginal overshoot in edge cases with very high concurrent throughput (unlikely for promotions context); acceptable and consistent with how most e-commerce platforms handle budget caps.

### Migration & Deployment Risks

#### Migration Scope
- **Scenario**: Schema migration introduces `promotion_rules` and `promotion_benefits` tables. If migration fails, partial state is left.
- **Severity**: Low
- **Affected area**: Database schema
- **Mitigation**: MikroORM generates a single migration file; Postgres wraps it in a transaction. Rollback restores prior state completely. Total new tables are ~6 (down from 23 in the original design), reducing migration surface.
- **Residual risk**: Negligible — tables are empty on first deploy.

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
| root AGENTS.md | Widget injection: declare in `widgets/injection/`, map via `injection-table.ts` | Compliant | 5 injection slots declared in `widgets/injection-table.ts`; external modules inject via the standard widget system |
| root AGENTS.md | Events: use `createModuleEvents()` with `as const` for all emitted events | Compliant | New events (`evaluation.completed`, `code.exhausted`, `promotion.expiring-soon`, `usage.registered`, `usage.reverted`, `promotion.budget-exhausted`) added to `events.ts` following `createModuleEvents()` pattern |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `PromotionExtensionRegistry` holds only plain objects (interfaces); no ORM entities or repositories cross module boundaries through the registry |
| root AGENTS.md | Validate all inputs with Zod | Compliant | Extension `configSchema` is validated at write time via `configSchema.parse(config)` in commands; unknown types are not persisted without validation |

---

## Changelog

| Date | Version | Summary |
|------|---------|---------|
| 2026-02-23 | 1.0.0 | Initial spec — domain model, three-pass evaluation engine, cart API, admin UI, code system, 4-phase implementation plan |
| 2026-02-24 | 1.1.0 | Replace 15 concrete rule tables + 6 concrete benefit tables with JSONB approach: `promotion_rules.rule_type + config jsonb` and `promotion_benefits.benefit_type + config jsonb`. Aligns with `condition_expression` pattern in `business_rules` and `workflows`. Normalization step now maps rows directly to `{ type, config }` shape. Config per type validated by Zod discriminated union. |
| 2026-02-24 | 1.2.0 | Add extensibility architecture: server-side `PromotionExtensionRegistry` (custom rule types, custom benefit types, evaluation middleware `beforeEvaluate`/`afterResolve`, code middleware `beforeCodeUse`/`afterCodeUse`); client-side `promotionExtensionConfiguratorRegistry` for custom tree-builder UI components; `GET /api/promotions/extension-types` endpoint; `context.extensions` field on `CartContext`; 5 declared widget injection slots; Phase 5 implementation plan and TC-PROM-040–045 test cases; new events `evaluation.completed`, `code.exhausted`, `promotion.expiring-soon`. |
| 2026-02-24 | 1.3.0 | Add `max_discount` optional field to `product_discount`, `cart_discount`, `buy_x_get_y`, and `tiered_discount` benefit configs. Effect resolvers in `lib/effect-resolvers.ts` cap the computed amount at `max_discount` after the raw calculation. New invariant: cap is per-benefit, expressed in operating currency. Added `TC-PROM-014` test case. |
| 2026-02-26 | 1.4.0 | Add `PromotionUsage` entity (`promotion_usages` table) serving as per-order compliance audit ledger and global spend tracker. Add `PromotionUsageService` (`lib/promotion-usage-service.ts`) with `registerUsage` (serializable budget cap enforcement, idempotent upsert, 207 Multi-Status on budget block), `revertUsage` (soft-revert on order cancellation), and `getBudgetConsumed`. Add `POST /api/cart/register-usage` and `POST /api/cart/revert-usage` cart-facing endpoints. Add `eligible_currencies` (text[]) + `max_budget` (numeric nullable) + `budget_currency` (text nullable) to `Promotion`. Add `currency` (required) to `CartContext`. Add currency eligibility check and optimistic budget pre-check to evaluation engine. Update `NormalizedPromotion` shape with `eligibleCurrencies`, `maxBudget`, `budgetCurrency`, `totalDiscountGranted`. Update cache build to aggregate `totalDiscountGranted` from usage table. Add `promotions.usage.registered`, `promotions.usage.reverted`, `promotions.promotion.budget-exhausted` events. Add `TC-PROM-023`–`TC-PROM-026` test cases. Add Budget Cap Race Window risk entry. |
