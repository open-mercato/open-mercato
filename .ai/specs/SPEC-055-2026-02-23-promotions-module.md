# SPEC-055: Promotions Module

**Date**: 2026-02-23
**Status**: Approved (amended 2026-08-14, reconciliation-fixed 2026-08-17, audit-fixed 2026-08-17, applies-to/caps amendment 2026-09-07, §B.6 mapping corrected 2026-09-09, **eComm Release 4 decisions applied 2026-10-14 (v2.2.0)**, **Phases 1–3 implemented 2026-10-15 (v2.2.1, PR adeptofvoltron/open-mercato#15)**, **eComm Release 5 C5 `revertCodeUse`/cancellation-subscriber amendment applied 2026-10-26 (v2.3.0)**, **eComm Release 5 D-R5-17 `delivery_method`/`DELIVERY_DISCOUNT` un-hide applied 2026-10-26 (v2.4.0)** — see §Amendment and §Changelog; Phases 4–5 unchanged, spec-only, not built)
**Suite**: [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 6, Phase 2
**Release 4 decisions**: [eComm Release 4 Decisions](./analysis/ANALYSIS-2026-10-14-ecommerce-release-4-decisions.md) D-R4-1…29 (authoritative audit trail; this revision is where they land in the spec text)
**Release 5 decisions**: [eComm Release 5 Owner Decisions](./analysis/ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md) — finding C5 ([checkout analysis](./analysis/ANALYSIS-2026-10-26-checkout-release-5.md)), accepted as an owner decision directly (no separate D-R5 row); D-R5-17 (un-hides `delivery_method`/`DELIVERY_DISCOUNT`, amends D-R4-14)

> **Amendment notice (2026-08-14).** This spec was written against a hypothetical external cart addressed over HTTP by SKU. The platform now has a first-class [`cart` module](./2026-08-14-cart-module.md). The **Amendment** section near the end of this document is normative and takes precedence over the *Cart-Facing Endpoints* section where they conflict: the primary integration becomes a DI service call, the `/api/cart/*` namespace moves to `/api/promotions/*`, item addressing gains product and variant ids, and effects map onto `SalesAdjustmentDraft`. Everything else in this spec — the rule tree, the three-pass engine, codes, usage ledger, extensibility — is unchanged. **(rev 2.2.0, 2026-10-14)** Items are now addressed by id alone, with no `sku` fallback, and effects carry `amountNet`/`amountGross` directly rather than a single amount with a basis flag — see §A.4/§A.5 (superseded) and §Public TypeScript Contract for the current shapes.

---

## TLDR

**Key Points:**
- A standalone `promotions` module that defines promotions via a flexible, recursive rule-condition tree, evaluates which promotions apply to a given cart context, and returns **fully resolved effects** to the cart module — promotions owns the math, the cart only applies the pre-computed results.
- Promotional codes (static vouchers and dynamically generated pools) are managed independently of individual promotions and linked via `CodeRule` nodes inside the rule tree.
- **Extensible by design**: other modules can register custom rule types, custom benefit types, evaluation middleware (before/after hooks), and custom admin configurator components — without modifying core promotions code.

**Scope:**
- Domain model: `Promotion`, `RuleGroup` (recursive tree), polymorphic `Rule` + eleven Release-4 rule types (rev — W10/P10; the full model reserves config space for six more, hidden until a data source exists — §Data Models), polymorphic `Benefit` + built-in benefit types with an explicit application target (`order`/`line`/`unit`) and cart-wide quantity caps, `Code`, `GeneratedCode`, `CodeReservation`, `CodeUsage`, `PromotionUsage` (per-order audit ledger + global spend tracking)
- Three-pass evaluation engine (boolean pass → benefit collection pass → effect resolution pass), product-page lightweight variant
- Promotion ordering, cumulativity, and tag-based self-exclusion algorithm
- Cart interaction REST API (apply-promotion, code lifecycle endpoints)
- Admin UI: drag-sortable promotion list, inline tree builder, promotional codes table
- Extension infrastructure: server-side `PromotionExtensionRegistry`, client-side configurator registry, evaluation middleware pipeline, declared widget injection slots

**Concerns:**
- Rule tree depth and polymorphic joins require careful N+1 mitigation and upfront caching strategy
- Code reservation TTL must be handled atomically; concurrent checkouts must not bypass per-customer limits
- Budget cap enforcement (`max_budget`) requires a row lock (`SELECT … FOR UPDATE`) inside `registerUsage`'s transaction — never serializable isolation, which `withAtomicFlush` does not provide and which a nested `checkout` transaction would silently drop (rev — C6/D-R4-12) — to prevent concurrent checkouts from jointly overshooting the cap; the optimistic cache-based pre-check reduces but does not eliminate this race window

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
3. **Cart API** — `/api/promotions/evaluate` and code lifecycle endpoints (`/api/promotions/codes/*`, `/api/promotions/usage/*`) consumed in-process by the `cart` module via `promotionsService`, or over HTTP by external carts/POS integrations (Amendment §A.2–A.3)
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
- **Operator** wants to cap a discount at the first 5 pieces so that a promotion on a bulk-ordered product cannot drain the margin on a large cart (**US-J**)
- **Operator** wants to state whether a benefit applies to the whole order, to a line, or to each piece so that the same "20% off" does not silently mean three different things (**US-K**)

---

## Architecture

**(rev — Release 4, D-R4-29).** `notifications.ts`, `search.ts`, `translations.ts`, `ce.ts` and every file under `widgets/` are **Phase 4/5 only** — Release 4 (Phases 1–3) ships none of them, per the root `AGENTS.md` Task Router scope for this release. They are listed here because this tree documents the module's full, eventual shape; §"Implementation Plan" below marks each file's owning phase explicitly.

```
promotions/
├── index.ts                          Module metadata
├── acl.ts                            Feature definitions
├── events.ts                         Typed event declarations
├── setup.ts                          Tenant init, seeding, defaultRoleFeatures
├── notifications.ts                  Phase 4 — Notification types (code exhausted, etc.)
├── search.ts                         Phase 4 — Fulltext search config for promotions + codes
├── translations.ts                   Phase 4 — Translatable fields (benefit labels)
├── di.ts                             DI registrar (services)
├── ce.ts                             Phase 4 — Custom entity sets
│
├── api/
│   ├── openapi.ts                    OpenAPI shared helpers
│   ├── route.ts                       Rev (W2) — collection CRUD via `makeCrudRoute`; mounts at `/api/promotions`, not `/api/promotions/promotions`
│   ├── [id]/route.ts                  Rev (W2) — detail + nested tree fetch; mounts at `/api/promotions/[id]`
│   ├── [id]/tree/route.ts            Atomic tree reconciliation (PUT); `/api/promotions/[id]/tree`
│   ├── order/route.ts                Batch order update (PATCH); `/api/promotions/order`
│   ├── codes/route.ts                Code CRUD; `/api/promotions/codes`
│   ├── codes/[id]/generate/route.ts  Trigger dynamic code generation worker; `/api/promotions/codes/[id]/generate`
│   ├── codes/[id]/generated/route.ts List individual generated codes; `/api/promotions/codes/[id]/generated`
│   ├── evaluate/route.ts             Cart benefit resolver (POST); `/api/promotions/evaluate` — was cart/apply-promotion, fixed 2026-08-17 (Amendment §A.3)
│   ├── codes/reserve/route.ts        Code reservation (POST); `/api/promotions/codes/reserve` — was cart/add-code
│   ├── codes/validate/route.ts       Re-validate reserved code (POST); `/api/promotions/codes/validate` — was cart/validate-code
│   ├── codes/use/route.ts            Mark code used + write CodeUsage (POST); `/api/promotions/codes/use` — was cart/use-code
│   ├── codes/release/route.ts        Release reservation (POST); `/api/promotions/codes/release` — was cart/delete-code
│   ├── usage/register/route.ts       Record confirmed discount audit + budget check (POST); `/api/promotions/usage/register` — was cart/register-usage
│   ├── usage/revert/route.ts         Revert usage on order cancellation (POST); `/api/promotions/usage/revert` — was cart/revert-usage
│   ├── dynamic-labels/route.ts       Storefront condition metadata (GET); `/api/promotions/dynamic-labels`
│   ├── free-products/route.ts        Free product eligibility (POST); `/api/promotions/free-products`
│   ├── product-page/route.ts         Product promotion badge data (POST); `/api/promotions/product-page`
│   └── extension-types/route.ts      Phase 5 — available extension rule/benefit type metadata (GET)

**`delivery-methods/route.ts` stays deferred (rev — D-R5-17, amends D-R4-14).** Release 5 gave `delivery_method`/`DELIVERY_DISCOUNT` their data source — `promotionsService.evaluate`'s `deliveryMethodCode`/`deliveryCost` inputs, and checkout as the caller that supplies them — so the rule evaluator and the benefit resolver are now real (§Data Models, §Public TypeScript Contract). This standalone badge-check route (distinct from checkout's own rate quoting, out of scope here) stays unbuilt; §API Contracts marks it.
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
│   ├── types.ts                      Rev — public TypeScript contract barrel (§A.2, W6); every `cart`-facing type
│   ├── promotions-service.ts         `promotionsService` — the primary integration facade (DI token `promotionsService`, Amendment §A.2)
│   ├── evaluation-engine.ts          Three-pass recursive evaluator
│   ├── rule-evaluators.ts            Release-4 rule evaluators (§P10 — not "15 built-in"; see Data Models)
│   ├── unit-selection.ts             Selector ordering + cart-wide quantity budget
│   ├── effect-resolvers.ts           Benefit config → ResolvedEffect[] (owns all discount math)
│   ├── product-page-engine.ts        Lightweight variant (product visibility)
│   ├── code-service.ts               Code validation, reservation (per-cart, §A.6 rev), usage, and its reversal (`revertCodeUse`, Release 5 C5) — DI token `promotionCodeService`
│   ├── tag-exclusion.ts              Promotion ordering + cumulativity + tag exclusion loop
│   ├── extension-registry.ts         Phase 5 — Server-side rule/benefit/middleware extension registry
│   ├── extension-registry.client.ts  Phase 5 — Client-side configurator component registry
│   └── promotion-usage-service.ts    DI token `promotionUsageService` — registerUsage / revertUsage / getBudgetConsumed
│
├── services/
│   ├── promotion-cache.ts            DI token `promotionCache` — active promotions cache (tag-invalidated)
│   ├── code-generation.ts            DI token `promotionCodeGenerationService` — dynamic code batch generator
│   └── code-reservation-sweeper.ts   Rev — releases lapsed `CodeReservation` rows independently of the cart's own sweep (A.6 rev, X7)
│
├── workers/
│   ├── code-generation.worker.ts     Background worker for dynamic code pools
│   └── code-reservation-sweep.worker.ts  Rev — queue worker behind the sweeper above, registered via `schedulerService`
│
├── subscribers/
│   ├── invalidate-promotion-cache.ts On promotion CUD + usage events → invalidate cache
│   ├── budget-exhausted.ts           On budget-exhausted → emit notification (Phase 4 — no notification type exists before then; this subscriber is a no-op shell in Release 4)
│   └── order-cancelled-usage-revert.ts  Release 5 C5 — persistent subscriber on `sales.order.cancelled`; calls `revertUsage` then `revertCodeUse`, idempotently; FK-id only, never imports a `sales` entity
│
├── data/
│   ├── entities.ts                   MikroORM entities (all tables, incl. `PromotionUsage` — moved to Phase 1, C8)
│   └── validators.ts                 Zod schemas for all inputs
│
├── migrations/                       DB migrations (generated, never hand-written)
├── i18n/{de,en,es,ko,pl}.json         Rev — five locales from Phase 1 (root AGENTS.md i18n rule; previously Phase 4-only `en.json`)
├── components/                       Shared React components (tree builder)
└── widgets/                          Phase 4/5 only — no widget file exists before then
    ├── injection-table.ts            Widget-to-slot mappings
    └── injection/                    Widget injection slots (injected by other modules)
```

### Evaluation Engine Data Flow

```
POST /api/promotions/evaluate  (or promotionsService.evaluate() in-process — Amendment §A.2)
  │
  ├─ Load active promotions (from cache, key: promotions:active:{tenantId}:{organizationId})
  │   └─ Serves NormalizedPromotion[] — no ORM entities, zero DB access during evaluation
  │
  ├─ For each promotion (ORDER BY order ASC, id ASC):
  │   ├─ Date-window check (rev — R-H3b/P8): if promotion.startsAt ≠ null AND context.evaluatedAt < promotion.startsAt → skip;
  │   │   if promotion.endsAt ≠ null AND context.evaluatedAt > promotion.endsAt → skip. Filtered against the CALLER-SUPPLIED
  │   │   evaluatedAt, never a clock read inside the evaluator — the engine stays pure and a fixed-clock test is reproducible
  │   ├─ Check excluded_tags ∩ applied_tags → skip if non-empty
  │   ├─ Currency eligibility check: if promotion.eligibleCurrencies.length > 0
  │   │   AND context.currency ∉ promotion.eligibleCurrencies → skip
  │   ├─ Budget pre-check (optimistic): if promotion.maxBudget is set
  │   │   AND promotion.totalDiscountGranted >= promotion.maxBudget → skip
  │   │   (Not authoritative — enforced atomically in registerUsage via a row lock, not serializable isolation)
  │   ├─ Apply item exclusion filters (rev — exclude_promotional_prices per D-R4-16, replacing the exclude_medicine example; the flag lives in exclude_flags and is checked per item against priceIsPromotional)
  │   ├─ Pass 1: evaluateGroup(rootGroup, context) → boolean
  │   └─ If true:
  │       ├─ Pass 2: collectBenefits(rootGroup, parentChainValid=true) → NormalizedBenefit[]
  │       ├─ Pass 3: resolveEffects(benefits, context) → ResolvedEffect[]
  │       │   ├─ Each benefit config + cart context → concrete amounts (LINE_DISCOUNT,
  │       │   │  CART_DISCOUNT, DELIVERY_DISCOUNT, ADD_FREE_ITEM). Math lives here only.
  │       │   └─ Per benefit with a quantity cap: selectUnits(benefit, context) orders
  │       │      qualifying units/lines by `selector`, then spends a cart-wide budget of
  │       │      `max_quantity` units and `max_lines` lines across them, in blocks of
  │       │      `quantity_step`. The budget is per benefit invocation and spans lines,
  │       │      so it is held here — not inside a per-line loop.
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
  startsAt: string | null             // rev — R-H3b/P8; ISO date, filtered against context.evaluatedAt at evaluation time, never at cache-build time
  endsAt: string | null               // rev — same; the cache holds every active=true promotion regardless of its window
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
  appliesTo: "order" | "line" | "unit"
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

1. A single cache build performs **all** required database reads (every `active = true` promotion **regardless of `starts_at`/`ends_at`** — rev, R-H3b/P8, replacing "active and within date range," which made a window opening or closing invisible until the next rebuild — → rule groups (recursive) → `promotion_rules` → `promotion_benefits` → `SUM(total_discount_amount)` per promotion from `promotion_usages WHERE reverted_at IS NULL`)
2. After caching, promotion evaluation executes with **zero database access**; date-window filtering happens inside the evaluator against the caller-supplied `context.evaluatedAt` (§Evaluation Engine Data Flow), never against a clock read at cache-build or evaluation time
3. Any missing eager-loaded relation is treated as a critical bug
4. `totalDiscountGranted` in `NormalizedPromotion` is a **snapshot** — it is intentionally stale between cache rebuilds. It is used only for an optimistic pre-check that skips obviously-exhausted promotions without adding latency. Authoritative enforcement happens in `registerUsage` via a row lock and a re-read of the sum inside the (possibly ambient) transaction — **never** a serializable isolation level (rev — C6/D-R4-12; §Promotion Usage Lifecycle). Kept in a **separate, small counters key** from the main cache (rev — R-H3c/P8), read only for budget-capped promotions, so a `usage.registered` event evicts just that counter rather than forcing a full promotion-tree rebuild on every order
5. The main cache (the promotion trees) is invalidated **only** by promotion mutation events (`promotions.promotion.*`, `promotions.code.*`) — never by a usage event, which touches only the counters key above (rev — R-H3c/P8)

The evaluation engine (`lib/evaluation-engine.ts`) operates purely on `NormalizedPromotion` objects and **must not** use the entity manager, repository calls, lazy relation access, or dynamic DB lookups. All required data must be provided via the cart context or the normalized promotion.

### Code Lifecycle

```
codes/reserve  → validate code + per-customer limit (CodeUsage + other carts' active reservations, D-R4-8) → create/extend CodeReservation keyed (code_id, cart_id), TTL 24h
codes/validate → re-check reservation + code active status
evaluate       → codes: {id, type}[] passed in context (rev — never a single code_id) → CodeRule evaluator matches
codes/use      → deactivate GeneratedCode OR increment Code.used → write CodeUsage (cart_id always, order_id when the
                 caller already knows it, generated_code_id for a dynamic use) → delete reservation keyed (code_id, cart_id)
codes/release  → delete CodeReservation for that (code_id, cart_id) only
revertCodeUse  → (rev — Release 5 C5, additive, no HTTP route — in-process service method + registered command only)
                 find unreverted CodeUsage row(s) by cart_id and/or order_id, scoped to tenant/organization
                 → reactivate the specific GeneratedCode OR decrement Code.used (and reactivate once headroom
                   returns) — the exact inverse of codes/use's own flip
                 → SET reverted_at = NOW() on each row; never deletes (audit immutability, same as CodeUsage's
                   append-only-log precedent and PromotionUsage.reverted_at below)
```

(route names per `/api/promotions/*`, Amendment §A.3 — each also has a matching `promotionsService` method, §A.2.
`revertCodeUse` is NOT an HTTP route — nothing calls `codes/use` yet either (checkout's Phase 4 submit sequence is
its first caller, D-R4-26/C5), so this Release 5 Step ships only the reversal capability and the subscriber that
invokes it automatically on `sales.order.cancelled`, ahead of that caller.)

**Reversal — `promotions.code.use.revert` / `PromotionCodeService.revertCodeUse` (Release 5 C5, additive).**
`useCode` had nothing identifying *which* cart or order a use belonged to, so there was nothing a reversal could
key on — `CodeUsage` gains `cart_id`, `order_id` (both nullable; see §Data Models), and `generated_code_id` (so a
dynamic use reactivates the one voucher it deactivated, never every `GeneratedCode` under the parent `Code`) to
close that gap. `UseCodeInput` gains an additive, optional `orderId` so checkout's future submit sequence — which
calls `useCode` **after** document creation (§C19) — can record it immediately. A promotions-owned, persistent
subscriber on `sales.order.cancelled` (`order-cancelled-usage-revert.ts`) calls `PromotionUsageService.revertUsage`
then `PromotionCodeService.revertCodeUse`, both keyed by the event's `orderId`; both are idempotent (unreverted-row
lookups), so redelivery reverts nothing twice. This is the fix for the finding recorded at D-R4-26 above: the
original §3.3 text said `sales` would call `revertUsage` directly, which is impossible — `sales` cannot depend on
`promotions` (upstream never depends on downstream, root `AGENTS.md`) — and nothing subscribed to anything in its
place. The subscriber lives in `promotions`, reads only the event payload's `orderId`/`tenantId`/`organizationId`,
and never imports a `sales` entity.

### Promotion Usage Lifecycle

**(rev — C6/P7/D-R4-12, replacing the serializable-isolation claim: `withAtomicFlush` joins an ambient transaction and ignores `isolationLevel`, and `checkout` is expected to call `registerUsage` inside its own order transaction — under that call shape, serializable isolation silently stops applying and no `40001` retry helper exists anywhere in `packages/shared` to recover from it if it somehow did.)**

```
usage/register → validate orderId not already registered (idempotent upsert)
              → lock the promotion row (SELECT … FOR UPDATE) inside the (possibly ambient) transaction
              → re-read SUM(total_discount_amount) WHERE reverted_at IS NULL AND currency = budget_currency
              → if max_budget set AND new total would exceed max_budget → rollback this promotion's write, emit budget_exhausted, return 207 for this promotionId
              → write PromotionUsage (effects_snapshot, total_discount_amount, currency, order_type)
              → commit → emit promotions.usage.registered → invalidate promotion cache entry
usage/revert  → SET reverted_at = NOW() on all PromotionUsage rows
              WHERE order_id = ? AND organization_id = ? AND tenant_id = ? AND reverted_at IS NULL
              → emit promotions.usage.reverted → invalidate promotion cache entry
```

The row lock, not a transaction isolation level, is what makes this correct whether the call is top-level or nested inside `checkout`'s own transaction — a lock held by the current transaction blocks a concurrent `FOR UPDATE` on the same row regardless of isolation level, so no retry loop is needed. Test: N concurrent `registerUsage` calls against one promotion, issued inside one ambient transaction, never jointly exceed `max_budget` (R-H2).

`PromotionUsageService` (`lib/promotion-usage-service.ts`) exposes:

| Method | Description |
|--------|-------------|
| `registerUsage(params)` | Writes `PromotionUsage`; enforces `max_budget` atomically via a row lock + re-read-sum inside the (possibly ambient) transaction (rev — C6/D-R4-12, never serializable isolation); idempotent on `(promotion_id, order_id, tenant_id)` |
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
| `promotions.code.use.revert` | — **(rev — Release 5 C5, additive)** No event emitted, matching `codes/use`'s own behaviour; the subscriber that calls it reacts directly to `sales.order.cancelled`, so no further event is needed to drive cache invalidation (`revertCodeUse` calls `invalidateCrudCache` itself) |
| `promotions.generated_code.generate` | `promotions.generated_code.created` (batch) — **(rev — W1/D-R4-25, decided literally: event ids use underscores, naming `generated_code` by id).** Replaces the hyphenated `promotions.generated-code.generate`/`.created`; no hyphenated event id exists anywhere in this platform (`ecommerce` uses `store_domain_binding`, `branding_updated`) |

Additional events emitted by the evaluation and code pipelines:

| Trigger | Event emitted | Payload |
|---------|--------------|---------|
| Successful `evaluate` call | `promotions.evaluation.completed` — **(rev — A9)** ephemeral telemetry only, never `clientBroadcast`; every cart mutation triggers an `evaluate`, so this must not be a persisted, UI-facing event | `{ organizationId, tenantId, appliedPromotionIds, effectCount, durationMs }` |
| `codes/use` finalises successfully | `promotions.code.used` (existing) + `promotions.code.exhausted` (if the code pool is now empty) | |
| Code pool drops to zero available | `promotions.code.exhausted` | `{ organizationId, tenantId, codeId, codeName }` |
| Promotion `ends_at` within 48h | `promotions.promotion.expiring_soon` — **(rev — W1/D-R4-25)** underscore id | `{ organizationId, tenantId, promotionId, endsAt }` — emitted by a scheduled check, not on mutation; Phase 4 (no scheduled-check infrastructure before then) |
| `usage/register` commits successfully | `promotions.usage.registered` | `{ organizationId, tenantId, promotionId, orderId, orderType, totalDiscountAmount, currency }` |
| `usage/revert` marks rows reverted | `promotions.usage.reverted` | `{ organizationId, tenantId, orderId, promotionIds: string[] }` |
| `max_budget` first reached via `registerUsage` | `promotions.promotion.budget_exhausted` — **(rev — W1/D-R4-25)** underscore id | `{ organizationId, tenantId, promotionId, maxBudget, totalDiscountGranted, budgetCurrency }` |

### Evaluation Middleware Hooks

These are synchronous hooks registered on `PromotionExtensionRegistry` — they are NOT async event bus events. They execute in-process within the same request and are called in registration order.

| Hook | When it runs | What it can do |
|------|-------------|----------------|
| `EvaluationMiddleware.beforeEvaluate` | Before Pass 1 starts for any promotion | Return a modified `CartContext` (e.g. append loyalty tier data to `context.extensions`) |
| `EvaluationMiddleware.afterResolve` | After Pass 3 produces all `AppliedPromotion[]` | Filter, augment, or reorder the resolved effects (e.g. enterprise pricing caps a maximum discount) |
| `CodeMiddleware.beforeCodeUse` | Inside the row-locked transaction before `codes/use` commits (rev — C6/D-R4-12) | Throw a typed error to veto code use |
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

**(rev — W5a)** `Promotion.rule_group_id` and `RuleGroup.promotion_id` form a two-table cycle at creation time. The `promotions.create` command breaks it by creating the root `RuleGroup` first with `promotion_id` left nullable-then-set in the same transaction (`withAtomicFlush`), or by creating `Promotion` with `rule_group_id` nullable-then-set — either order works as long as one FK is nullable during the single creating transaction; the root group is identified by `parent_rule_group_id IS NULL`, never by being "the promotion's named group," so a reader never depends on which FK happened to be set first.

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

**Release 4 rule set (rev — P10/D-R4-14, replacing the full 16-type list below).** Only a rule whose input the platform can actually supply is offered in the admin tree builder for Release 4 — shipping an unreachable rule type lets an operator believe a campaign is live when it can never match. Models and validators for the hidden types stay in the codebase (so the discriminated union doesn't need a second migration later); only the admin UI and the rule-evaluator registration for Release 4 are restricted.

| `rule_type` | Config fields | Release 4 |
|-------------|---------------|-----------|
| `order_value` | `value` decimal string, `operator` text, `tax_inclusive` bool, `limit_to_category` text nullable | Shipped |
| `order_date` | `date` date string, `operator` text | Shipped. Compared by whole UTC calendar day (rev 2.2.3): `eq` matches all of that day, `lte` includes it, `gt` starts the next day |
| `product_count` | `value` integer, `operator` text | Shipped (`exclude_pharmaceutical` dropped — no such flag exists on `catalog.CatalogProduct`; see hidden rules below) |
| `cart_weight` | `value` decimal string, `operator` text | **Hidden** (rev 2.2.3 — QA round 2, D-R4-14's rule). `cart` sends `cartWeight: null`: nothing aggregates line weight yet, so the rule could never match. Model and validator stay (`ruleInputSchemaFull`) |
| `row_total` | `value` decimal string, `operator` text, `product_id` uuid nullable, `category_id` uuid nullable | Shipped (rev — `sku`/`category_slug` replaced by id fields; items are never addressed by SKU in Release 4, §API Contracts). `value` is compared with the net row total; the editor labels it "(net)" (rev 2.2.3) |
| `product` | `product_id` uuid, `variant_id` uuid nullable, `quantity` integer, `operator` text | Shipped (rev — `sku` replaced by `product_id`/`variant_id`) |
| `category` | `category_id` uuid, `quantity` integer, `operator` text | Shipped (rev — `category_slug` replaced by `category_id`; **includes descendants** — ancestor-expanded match, the same logic `scope_keys` uses in buyer-scoped visibility, D-R4-15). The echo line in the UI lists what the match covers (§UI/UX). |
| `product_attribute` | `attribute_code` text, `operator` text, `value` text | **Hidden** (rev 2.2.3 — QA round 2, D-R4-14's rule). The planned promotions-side batch resolution (D-R4-21) has no source: `catalog` has no attribute-code concept distinct from tenant custom fields, so enrichment yields `{}` and the rule could never match. Model and validator stay |
| `customer_group` | `customer_group_id` uuid string | Shipped (rev — **replaces** `user_group`, which named no referent on this platform: there is no "user group", only `customer_groups`. Not an additive rename — `user_group` is dropped outright, since nothing has ever shipped against it) |
| `customer_order_history` | `value` integer, `operator` text | **Hidden** (rev 2.2.3 — QA round 2, D-R4-14's rule). Reads `customerOrderCount` from the request (P10), which `cart` always sends as `null` (no order-count lookup), so the rule could never match. Model and validator stay |
| `code` | `code_id` uuid string — application-layer validated reference to `promotion_codes`; validated in commands before persist | Shipped |
| `producer` | `producer_code` text, `quantity` integer, `operator` text | **Hidden.** No producer/manufacturer field exists on `catalog.CatalogProduct` |
| `exclude_pharmaceutical` | (flag only, no config) | **Hidden.** No such product flag exists in `catalog` |
| `consent_flag` | `flag_key` text | **Hidden.** No consent store exists in `customer_accounts` |
| `delivery_method` | `delivery_method_code` text | **Shipped (rev — D-R5-17, Release 5, amends D-R4-14).** Checkout is the data source Release 4 lacked: `EvaluateInput.deliveryMethodCode` is now a real (optional) field. Matches when `context.deliveryMethodCode` equals the configured code; evaluates to `false` (never throws) when the caller omits delivery context entirely — every cart-stage caller today, unchanged by this amendment |
| `payment_method` | `payment_method_code` text | **Hidden.** Same reason D-R4-14 gave — still no payment-method field on the `evaluate` request |
| `shipping_address` | `field` text, `operator` text, `value` text | **Hidden.** Same reason |

This is **eleven** shipped rule types for Release 4 — twelve as of Release 5's `delivery_method` (D-R5-17) — not the "15 built-in" or "16-row table" earlier revisions of this document claimed (W10) — the count was never true against this platform and the gap is closed by deciding which ones have a real data source rather than by building the missing sources.

### Benefit

Table: `promotion_benefits`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `rule_group_id` | uuid FK → promotion_rule_groups | |
| `promotion_id` | uuid FK → promotions | Denormalised |
| `benefit_type` | text | Discriminator |
| `applies_to` | text | `order` \| `line` \| `unit` — the application target (see below). NOT NULL; the write path fills it from the benefit type's default when the operator does not choose one. |
| `config` | jsonb | Validated per `benefit_type` by Zod discriminated union in `data/validators.ts`, intersected with the shared quantity-cap block below |
| `sort_order` | integer | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### Application target (`applies_to`)

Every benefit states what it is applied to. Before this field existed the target was implied by `benefit_type` and written down nowhere, which made "10% off, but only the first 5 pieces" inexpressible and left `cart` guessing how to map a resolved effect.

`applies_to` is a **column, not a config field.** It decides the shape of the resolved effect and therefore how `cart` hands that effect to `salesCalculationService`; core must be able to read it for a benefit whose `config` schema core does not own (extension benefit types — see §Extensibility). A discriminator-independent value inside a discriminated union is also the one thing a Zod discriminated union models badly.

| Value | Meaning | Resolved effect |
|-------|---------|-----------------|
| `order` | One effect against the document as a whole. Not attributable to any single line. | `CART_DISCOUNT`, `DELIVERY_DISCOUNT`, or `ADD_FREE_ITEM` |
| `line` | Qualifying **lines** are discounted whole. Quantity caps consume entire lines: a line is either fully covered or not covered at all. | `LINE_DISCOUNT` with `appliedQuantity` equal to the line's full quantity |
| `unit` | Qualifying **units** are discounted individually. Quantity caps consume units, so a line may be partially covered. | `LINE_DISCOUNT` with `appliedQuantity` ≤ the line's quantity |

`ADD_FREE_ITEM` sits at `order` because a promotion-inserted line is not a discount *on* anything in the cart — it is a new line the promotion decided to add. `buy_x_get_y` is the one type that can emit either shape: a percentage or fixed reward discounts the reward line (`LINE_DISCOUNT`, hence its `line`/`unit` targets), while a 100%-off reward is emitted as `ADD_FREE_ITEM` regardless of the benefit's `applies_to`, because there is no existing line to attribute it to.

`line` and `unit` produce the same effect *type*; they differ in whether a cap is allowed to split a line. That difference is the whole point: "20% off, max 5 pieces" on a cart holding one line of 8 means 5 discounted units under `unit`, and nothing at all under `line` (8 > 5, and a line cannot be split).

**Allowed values per benefit type** — enforced in `data/validators.ts`, not merely documented:

| `benefit_type` | Allowed `applies_to` | Default |
|----------------|----------------------|---------|
| `product_discount` | `line`, `unit` | `line` |
| `cart_discount` | `order` | `order` |
| `delivery_discount` | `order` | `order` |
| `free_product` | `order` | `order` |
| `buy_x_get_y` | `line`, `unit` | `unit` |
| `tiered_discount` | `order`, `line`, `unit` | `order` |

`tiered_discount` previously carried its own `scope` (`cart`\|`line`) and `delivery_discount` an undocumented `scope text` whose value set appeared nowhere in this document. Both are removed in favour of `applies_to`; `scope: 'cart'` reads as `applies_to: 'order'`.

#### Quantity caps (shared config block)

These three fields are validated by one shared Zod object intersected into every built-in benefit variant, so the same words mean the same thing on every benefit type. `product_discount`'s `pcs_limit` — one undefined sentence, and absent from `tiered_discount` — is replaced by `max_quantity`.

| Field | Type | Meaning |
|-------|------|---------|
| `max_quantity` | int nullable | Maximum number of **units** the benefit may discount. Null = unbounded. Only meaningful when `applies_to` is `line` or `unit`. |
| `max_lines` | int nullable | Maximum number of **lines** the benefit may touch. Null = unbounded. Only meaningful when `applies_to` is `line` or `unit`. |
| `quantity_step` | int nullable | Units are consumed in whole blocks of this size; a remainder smaller than one block is not discounted. Null = 1. Expresses "discount applies per pair", the counterpart of Magento's `discount_step`. Defined in units only — rejected 422 under `applies_to: 'line'`, where the budget spends whole lines and a "block of units" has no meaning. |
| `selector` | text nullable | Which qualifying units the budget is spent on (values below). Required when `max_quantity` or `max_lines` is set; on an uncapped benefit `null` is read as `all`. |
| `nth_position` | int nullable | Position for `selector: nth`, 1-indexed. Required with `nth`, rejected without it. |

`selector` and `nth_position` live in this shared block rather than on individual benefit configs — `nth` was previously offered to three benefit types while only `product_discount` carried a field to hold its position, so it was unusable on the other two.

**Counting basis — normative.** `max_quantity` and `max_lines` are counted **across the whole cart, per benefit invocation** — not per line, and not per satisfied rule. A cart holding three lines of the same product at four pieces each, against a benefit with `max_quantity: 5`, yields five discounted units in total (four on the first line, one on the second, none on the third under `applies_to: 'unit'`; four on the first line and nothing more under `applies_to: 'line'`, because covering a second whole line would need eight). Per-line counting was rejected because a buyer defeats it by splitting a purchase across lines — and with configurable products (engraving, B2B configurator output) the lines split on their own, so the cap would loosen for reasons unrelated to intent.

**Cap ordering — normative.** `selector` (below) decides which units the budget is spent on, and it is **required whenever `max_quantity` or `max_lines` is set**; a config that caps without selecting is a 422 at the write path. There is deliberately no default: "the first 5 pieces" and "the 5 most expensive pieces" are different promotions with different costs, and silently picking one for the operator is how a campaign overspends. Within the chosen order, ties break on `lineId` ascending (rev — not `cartLineId`, D-R4-21) so evaluation is deterministic across retries.

**Three orthogonal caps.** `max_quantity` bounds *how many units*, `max_discount` bounds *how much money* (§below), and `buy_x_get_y.max_applications` bounds *how many times the trigger fires*. They compose; whichever binds first wins, and a benefit may set all three. The two counters run over different things — `max_applications` counts trigger firings, each consuming `trigger_quantity` units, while `max_quantity` counts *rewarded* units — so one rule settles the overlap: **an application whose reward the remaining `max_quantity` budget cannot fund in full is not granted at all.** A partially funded final application is dropped rather than pro-rated, because a half-delivered "buy 2 get 1 free" is a support ticket.

**Write-path rejections (422), normative.** The shared block is intersected into every benefit variant for schema uniformity, but a quantity cap on a target that has no quantity is an operator error, not a field to ignore:

| Rejected configuration | Why |
|---|---|
| `max_quantity`, `max_lines` or `quantity_step` set on a benefit whose `applies_to` is `order` | Nothing to count; silently ignoring it would make the admin UI show a cap that does not apply |
| `max_quantity` or `max_lines` set with no `selector` | §B.4 — the operator has not said which units the budget buys |
| `selector: all` combined with any quantity cap | A contradiction: `all` means every qualifying unit |
| `selector: nth` combined with `max_quantity` **or** `max_lines` | `nth` selects exactly one unit and is its own cap |
| `selector: nth` without `nth_position`, or `nth_position` without `selector: nth` | Neither half is meaningful alone |
| `quantity_step` set with `applies_to: 'line'` | Blocks are counted in units; the `line` target spends whole lines |

**Config schemas per `benefit_type`:**

Every variant below is intersected with the shared quantity-cap block (`max_quantity`, `max_lines`, `quantity_step`, `selector`, `nth_position`) described above; the fields listed here are the type-specific ones.

| `benefit_type` | Config fields |
|----------------|---------------|
| `product_discount` | `product_id` uuid nullable, `discount_type` text, `value` decimal string, `limit_to_category_id` uuid nullable, `max_discount` decimal string nullable, `labels` Record\<locale, string\> |
| `cart_discount` | `discount_type` text, `value` decimal string, `max_discount` decimal string nullable, `labels` Record\<locale, string\> |
| `delivery_discount` | `delivery_method_code` text, `discount_type` text, `value` decimal string, `labels` Record\<locale, string\> — **shipped as of Release 5 (rev — D-R5-17, amends D-R4-14)**; `applies_to` is fixed to `order` (no line/unit dimension for a delivery charge), and `max_discount` does not apply — the benefit is naturally bounded by `deliveryCost` (resolution clamps the magnitude to it, same clamp every other benefit's base amount gets) |
| `free_product` | `product_id` uuid nullable, `category_id` uuid nullable, `quantity` int, `labels` Record\<locale, string\> |
| `buy_x_get_y` | `trigger_product_id` uuid nullable, `trigger_category_id` uuid nullable, `trigger_quantity` int, `reward_product_id` uuid, `reward_variant_id` uuid nullable, `reward_quantity` int, `discount_type` text, `value` decimal string, `max_applications` int nullable, `max_discount` decimal string nullable, `labels` Record\<locale, string\> |
| `tiered_discount` | `limit_to_category_id` uuid nullable, `tiers` TierElement[], `max_discount` decimal string nullable, `labels` Record\<locale, string\> |

**(rev — identity change, consistent with §API Contracts/Data Models above).** Every `sku`/`*_slug` config field is replaced by the matching `*_id` field: items, categories and reward products are referenced by platform id, never by SKU or slug, because SKU is not a stable per-line identity (two lines may share one SKU with different `configuration`) and a slug is a display concern, not an identity. `excluded_producers` is dropped — `catalog.CatalogProduct` has no producer field to exclude by (same reason `producer` is a hidden rule type, above).

**`selector` values** — which qualifying units a capped benefit spends its budget on. Lives in the shared block above, so every benefit type targeting `line` or `unit` has it; **required whenever `max_quantity` or `max_lines` is set**, and read as `all` when a benefit sets no cap.

| Value | Meaning |
|-------|---------|
| `all` | Every qualifying unit receives the benefit. Only valid with no quantity cap — `all` plus a cap is a contradiction and is rejected at the write path. |
| `cart_order` | Units in cart order — the order lines were added to the cart, then unit index within a line. This is the value that means "the **first** N pieces". |
| `cheapest` | Lowest unit price first |
| `most_expensive` | Highest unit price first |
| `nth` | Only the item at position `nth_position` (1-indexed) in ascending price order — the *n*-th unit under `applies_to: 'unit'`, the *n*-th line under `applies_to: 'line'`, following the same ordering rule as every other selector. Its own cap, so it may not be combined with `max_quantity` or `max_lines`. |

Under `applies_to: 'line'` the selector orders **lines** by the unit price of the line; under `applies_to: 'unit'` it orders **units**. Ties break on `lineId` ascending, then unit index, so a re-evaluation of an unchanged cart returns identical effects.

`max_discount` (optional, decimal string) caps the total monetary discount produced by a single benefit invocation. The effect resolver in `lib/effect-resolvers.ts` applies the cap after computing the raw amount: `effectiveAmount = min(rawAmount, max_discount)`. The cap is expressed in the cart's operating currency. This allows operators to configure benefits such as "10% off the cart, but no more than $1000". Applies to `product_discount`, `cart_discount`, `buy_x_get_y`, and `tiered_discount`; not relevant for `delivery_discount` (naturally bounded by delivery cost) or `free_product`/`buy_x_get_y` free-item additions (no monetary amount computed).

**`tiers` schema** for `tiered_discount` config must be explicitly validated in `data/validators.ts`. Each tier element: `{ threshold: string (decimal), discount_type: "percentage" | "fixed", value: string (decimal) }`. Tiers must be sorted ascending by `threshold`; the evaluator applies the highest tier whose threshold is met. A `threshold` is compared with the **net** amount; the editor labels it "(net)" (rev 2.2.3). A gross/net switch matching `order_value.tax_inclusive` is a follow-up (#7886).

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
| `usage_per_customer` | integer nullable | Max per-customer uses, counted (rev — C7/D-R4-8) as `CodeUsage` rows **plus** other carts' active `CodeReservation` rows for that customer — not `CodeUsage` alone, which let two carts both pass the check and race to the single remaining use |
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
| `code` | text UNIQUE (per tenant) | Actual voucher string — **(rev — W5d)** drawn from the same normalised namespace as `Code.code` (below): a lookup of a code string checks both tables, so the two must never collide within one `(tenant_id, organization_id)` |

### CodeReservation

Table: `promotion_code_reservations`

**(rev — C4/C7/D-R4-8, replacing the `(code_id, customer_id)` model — a reservation now holds real cart-level capacity, which is what `codes/use`, `codes/release` and the cart's own sweeper all key off.)**

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `code_id` | uuid | FK to `promotion_codes` |
| `code_string` | text | Resolved code (for display) |
| `cart_id` | uuid | The reserving cart's id (opaque to this module — `cart` passes it, never a token). **In the unique key** |
| `customer_id` | text nullable | Customer session identifier; `null` for a guest cart |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | `created_at + 24h`, extended on `extendReservation` (activity) |

> **Unique constraint**: `UNIQUE (code_id, cart_id)` — enforces at most one reservation row per cart per code, so two carts holding the same code each get their own row and their own capacity accounting (closing R-H4/X4: the old `(code_id, customer_id)` key could not express two carts, and `customer_id NOT NULL` could not express a guest). `reserveCode` uses **upsert semantics**, idempotent per `(code, cart)`: on re-reservation, the existing row's `expires_at` is extended (`extendReservation`) rather than inserting a new row. To check if a reservation is still active, compare `expires_at > NOW()` in application logic or queries — not in the index. This sidesteps PostgreSQL's prohibition on volatile functions (`NOW()`) in index predicates. Released by `cartId` on cart expiry, abandonment or code removal (cart-side), and independently by this module's own `code-reservation-sweep.worker.ts` (X7) — either sweeper is sufficient on its own; both exist because a reservation must not depend on the other module's sweeper running.

### CodeUsage

Table: `promotion_code_usages`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `code_id` | uuid FK → promotion_codes | |
| `cart_id` | uuid nullable | **(rev — Release 5 C5, additive)** The reserving cart's id, always written by `codes/use` (it already receives `cartId`). Lets `revertCodeUse` find the row before an order exists |
| `order_id` | text nullable | **(rev — Release 5 C5, additive)** The order this use was recorded against, when the caller already knows it — checkout's submit sequence calls `codes/use` *after* document creation (§C19), so it usually does. A plain FK-id, never a `ManyToOne` into `sales` (no cross-module ORM relationships, root `AGENTS.md`) — same precedent as `PromotionUsage.order_id` below |
| `generated_code_id` | uuid nullable, FK → promotion_generated_codes, `ON DELETE SET NULL` | **(rev — Release 5 C5, additive)** Which specific dynamic voucher this use deactivated, so `revertCodeUse` reactivates *that* row, never every `GeneratedCode` under the parent `Code`. `null` for a static-code use |
| `customer_id` | text nullable | `null` for a guest — a per-customer limit cannot apply to a guest, so a guest's usage never needs this column populated |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `used_at` | timestamptz | |
| `reverted_at` | timestamptz nullable | **(rev — Release 5 C5, additive)** Set by `revertCodeUse`; row is never deleted — same non-destructive-revert precedent as `PromotionUsage.reverted_at` below |

### PromotionUsage

Table: `promotion_usages`

Serves a dual purpose: **compliance audit ledger** (immutable record of exactly what discounts were applied to each order/quote) and **global usage counter** (drives `max_budget` enforcement and `revertUsage` on cancellation).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `promotion_id` | uuid FK → promotions, **`ON DELETE RESTRICT`** (rev — W5b; not cascade) | A ledger row must outlive the promotion it audited — cascading the delete would erase the compliance record the table exists to keep. Deleting a `Promotion` with usage history is a soft delete (`deleted_at`) only |
| `order_id` | text | External order/quote/cart ID supplied by the caller |
| `order_type` | text | `order`, `quote`, `pos_cart` — for cross-document audit filtering |
| `customer_id` | text nullable | Customer session identifier |
| `currency` | text | ISO 4217 currency code the order was placed in |
| `total_discount_amount` | numeric | Sum of `\|amountNet\|` across every `ResolvedEffect` for this promotion on this order that carries an amount. **(rev — budget-accounting rule, previously unstated.)** `ADD_FREE_ITEM` effects carry no amount and never contribute to this sum — a buy-2-get-1 promotion's `max_budget` is spent only by any amount-carrying effect on the *same* promotion, never by the gift itself; `DELIVERY_DISCOUNT` effects do contribute when they occur (Release 4: never, D-R4-14; reachable as of Release 5, D-R5-17 — this file's own `computeTotalDiscountAmount` required no change, since it already summed any amount-carrying effect generically) |
| `effects_snapshot` | jsonb | Full `ResolvedEffect[]` snapshot at time of registration — immutable audit record |
| `registered_at` | timestamptz | When the usage was recorded |
| `reverted_at` | timestamptz nullable | Set on order cancellation; row is never deleted — reverted rows are excluded from budget aggregation |

**Unique constraint**: `UNIQUE (promotion_id, order_id, organization_id, tenant_id)` — prevents double-registration for the same order. `registerUsage` uses upsert semantics (idempotent on re-submission).

**Index**: `(promotion_id, organization_id, tenant_id, currency, reverted_at)` — supports efficient `SUM(total_discount_amount) WHERE reverted_at IS NULL AND currency = ?` for budget checks.

---

## API Contracts

All routes export `openApi`. All mutating routes require `requireAuth` + appropriate `requireFeatures`. **(rev — C3/A1/A2, D-R4-11, replacing `X-Module-Key`).** Every route, admin and cart-facing alike, authenticates via the platform's standard API-key identity (`x-api-key` header or `Authorization: ApiKey …`, `shared/lib/auth/server.ts`), gated by per-method `requireFeatures` — `promotions.evaluate`, `promotions.codes.redeem`, `promotions.usage.manage` for the cart-facing routes (§ACL below), the existing `promotions.*` features for admin CRUD. `organizationId` and `tenantId` are **never** read from a request body on any route in this module — every body below that showed them in rev ≤ 2.1.1 is corrected to derive both from the authenticated principal, and every referenced `promotionId`/`codeId` is checked for tenant/organization ownership before use (a mismatch answers identically to "not found" — no cross-tenant existence oracle). A cross-tenant test exists per route (the `TC-PROM-0xx` ids are assigned per endpoint below).

### Admin CRUD

**Optimistic locking (rev — completeness gap; default-on per root `AGENTS.md`).** `GET /api/promotions` and `GET /api/promotions/[id]` return `updatedAt`; `CrudForm` derives its conflict header from it automatically (covers update and delete alike). `PUT /api/promotions/[id]/tree` additionally requires the promotion's `updatedAt` in the request (a separate surface from the row-level `updatedAt` `CrudForm` already sends, because the tree PUT replaces the whole tree in one call) and returns `409` with the standard conflict body on a stale value — a last-write-wins tree replacement silently discarding a second admin's concurrent edit is exactly the failure this guards against. `PATCH /api/promotions/order` carries each item's own `updatedAt` (`{ id, order, updatedAt }`) and 409s per item, not for the whole batch, on a stale one.

Every custom write route below (`[id]/tree`, `order`, and every `codes/*`/`usage/*` cart-facing route) is wired through the mutation-guard registry (rev — A3 completeness gap), the same as every other custom write in this platform.

#### `GET /api/promotions`
Query: `page`, `pageSize` (max 100), `search`, `active`, `cumulative`, `tags`, `startsFrom`, `startsTo`
Response: `{ items: Promotion[], total: number, page: number, pageSize: number }` — each item carries `updatedAt`

#### `POST /api/promotions`
Body: `{ name, description?, order, active, cumulative, tags, excluded_tags, exclude_flags, starts_at?, ends_at? }`
Response: `{ id: uuid }` — 201. Creates promotion with an empty root `RuleGroup`.

#### `PUT /api/promotions`
Body: promotion fields (partial) + the standard optimistic-lock header/field. Updates metadata only; tree mutations use separate commands.
Response: `{ ok: true }`

#### `DELETE /api/promotions`
Body: `{ id: uuid }` + the standard optimistic-lock header/field.
Response: `{ ok: true }` — cascades to rule groups, rules, benefits via DB constraints.

#### `GET /api/promotions/[id]`
Response: full promotion with nested rule group tree (recursive eager load, depth-limited to 10 levels), carrying `updatedAt`.

#### `PUT /api/promotions/[id]/tree`
Body: the full rule tree as a nested JSON structure, plus the promotion's `updatedAt` (rev — optimistic lock, above). Uses `withAtomicFlush` to reconcile existing records (add, update, delete nodes) in a single transaction. `409` with the standard conflict body on a stale `updatedAt`.

#### `PATCH /api/promotions/order`
Body: `{ items: Array<{ id: uuid, order: number, updatedAt: string }> }` — batch update for drag-sort save; a stale `updatedAt` on any item 409s that item only (rev — optimistic lock, above).

#### `GET /api/promotions/codes`
Paginated list. Query: `page`, `pageSize`, `search`, `type`, `active`.

#### `POST /api/promotions/codes`
Body: code creation payload. Creates `Code` record; for dynamic type, triggers generation worker.

#### `PUT /api/promotions/codes`
Update code metadata.

#### `DELETE /api/promotions/codes`
Soft-delete; deactivates generated codes.

#### `POST /api/promotions/codes/[id]/generate`
Triggers background generation of remaining dynamic codes to reach `amount`. Returns `{ jobId }`.

#### `GET /api/promotions/codes/[id]/generated`
Paginated list of `GeneratedCode` records. Query: `page`, `pageSize`, `active`.

### Cart-Facing Endpoints

Authenticated per the standard API-key model stated above (rev — C3/D-R4-11); not a module-specific scheme.

#### `POST /api/promotions/evaluate` (was `/api/cart/apply-promotion` — see Amendment §A.3)

**(rev — C1/C5/C11/D-R4-9/D-R4-10/D-R4-21/D-R4-28, replacing the SKU/attribute-carrying request and single-`amount` response below.)** Items are addressed by `productId`/`variantId`/`lineId`, never `sku` — SPEC-029 §5.1.1's lesson (a SKU is not a stable per-line identity once two lines of one product differ by configuration). Category, tag, producer and attribute fields are **not** sent by the caller: `promotions` resolves them itself, in batch, from `productId`/`variantId` via the same catalog scoping services `cart` uses (C11) — a field with no resolvable source for a given product is `null`, so a rule reading it evaluates false rather than the caller guessing. `organizationId`/`tenantId` are never in the body (derived from auth, above).

Request:
```jsonc
{
  "items": [
    {
      "lineId": "uuid",                 // the caller's own line identity; echoed back, never reinterpreted
      "productId": "uuid",
      "variantId": "uuid | null",
      "quantity": 2,
      "unitPriceNet": "19.99",
      "unitPriceGross": "24.59",
      "priceIsPromotional": false        // D-R4-16 — true when the unit price itself already came from a promotional CatalogPriceKind
    }
  ],
  "currency": "USD",                    // ISO 4217; required — currency eligibility check + stored in PromotionUsage
  "evaluatedAt": "2026-10-14T12:00:00Z", // D-R4-13 — date-window filtering happens here, against this value, never against "now" inside the evaluator
  "buyer": {                            // BuyerContext identity, D-R4-28
    "customerId": "string | null",      // the winning identity (person wins, D3/D3a)
    "customerIds": ["string"],          // broader set — order history, per-customer limits
    "customerGroupIds": ["string"]
  },
  "customerOrderCount": 5,              // null if unknown; cart supplies when it has the figure (P10)
  "cartWeight": "3.5",                  // null if unknown
  "codes": [                            // array, never a single object (X1) — empty if none entered
    { "id": "uuid", "type": "static | dynamic" }
  ],
  "deliveryMethodCode": "standard",     // optional (rev — D-R5-17, amends D-R4-14); present only once a caller has a selected delivery method — checkout, from Phase 2 (Step 2.13) onward. Omitted by every cart-stage caller today
  "deliveryCost": "9.99"                // optional, same gate as deliveryMethodCode — both or neither
}
```

Still deliberately absent from the request (D-R4-14 — no data source exists): `paymentMethodCode`, `shippingAddress`, `consentFlags`. The corresponding rule types (`payment_method`, `shipping_address`, `consent_flag`) and their config schemas stay hidden from the admin tree builder (§Data Models) so no promotion can be authored that would need these fields; a later release adds them back together with their caller. `deliveryMethodCode`/`deliveryCost` and the `delivery_method` rule/`delivery_discount` benefit they unlock are **no longer** in this deferred set — Release 5 (D-R5-17) gave them a real caller (checkout) and un-hid both.

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
          "appliesTo": "line",            // whole line covered
          "targetLineId": "uuid",         // echoes the request's lineId — never sku (rev)
          "targetProductId": "uuid",
          "targetVariantId": "uuid | null",
          "lineQuantity": 1,
          "appliedQuantity": 1,           // every unit on the line
          "amountNet": "-3.99",           // the row-level discount total — cart maps this AS-IS, never divided (§cart-module.md §3.2)
          "amountGross": "-4.91",
          "basis": "net",                 // audit only, D-R4-10 — cart always consumes amountNet/amountGross, never re-derives one from the other
          "currency": "USD",
          "label": { "en": "20% off electronics", "pl": "20% zniżki na elektronikę" }
        },
        {
          "type": "LINE_DISCOUNT",
          "appliesTo": "unit",            // cap bit: only 5 of the 8 units
          "targetLineId": "uuid",
          "targetProductId": "uuid",
          "targetVariantId": null,
          "lineQuantity": 8,
          "appliedQuantity": 5,           // max_quantity: 5, selector: cart_order
          "amountNet": "-12.00",          // the resolved row total for the 5 covered units — NOT unitAmount * lineQuantity
          "amountGross": "-14.76",
          "basis": "net",
          "currency": "USD",
          "label": { "en": "20% off electronics", "pl": "20% zniżki na elektronikę" }
        }
      ]
    },
    {
      "promotionId": "uuid",
      "promotionName": "Buy 2 Get 1 Free",
      "effects": [
        {
          "type": "ADD_FREE_ITEM",
          "productId": "uuid",            // resolved by promotions engine; cart does not decide
          "variantId": "uuid | null",
          "quantity": 1,
          "reason": "BUY_X_GET_Y",
          "promotionId": "uuid",          // rev (D-R4-7) — the marker cart stores on the gift CartLine, matching this response's own promotionId
          "label": { "en": "Free mug with your order" }
        }
      ]
    }
  ]
}
```

`DELIVERY_DISCOUNT` was a defined-but-unreachable effect type through Release 4 (D-R4-14): the `delivery_method` rule it depends on was hidden from the admin tree builder, so no promotion could resolve one. As of Release 5 (D-R5-17), it is reachable: once the caller supplies `deliveryMethodCode`/`deliveryCost` on the `evaluate` request and a `delivery_method` rule matches, `effect-resolvers.ts#resolveDeliveryDiscount` produces it, clamped to `deliveryCost` the same way every other benefit's base amount is clamped.

**Resolved Effect Types:**

| Type | Required fields | Notes |
|------|----------------|-------|
| `LINE_DISCOUNT` | `targetLineId`, `targetProductId`, `targetVariantId`, `appliesTo`, `lineQuantity`, `appliedQuantity`, `amountNet`, `amountGross` (both negative strings), `basis`, `currency` | One effect per affected line item. `amountNet`/`amountGross` are the total row discount for the covered quantity; `appliedQuantity` states how many of the line's `lineQuantity` units it covers. A capped benefit reports `appliedQuantity < lineQuantity`. **Rev (C1/D-R4-9):** the consumer (`cart`) maps `amountNet` as-is to `SalesLineSnapshot.discountAmount` with `discountAmountBasis: 'line'` — never divides by `lineQuantity` or `appliedQuantity`; that per-unit mapping is withdrawn (it matched no `sales` API that has ever existed on `develop`). |
| `CART_DISCOUNT` | `appliesTo`, `amountNet`, `amountGross` (negative strings), `basis`, `currency` | Flat or percentage discount applied against cart subtotal |
| `DELIVERY_DISCOUNT` | `appliesTo`, `deliveryMethodCode`, `amountNet`, `amountGross` (negative strings), `basis`, `currency` | Unreachable in Release 4 (D-R4-14); reachable as of Release 5 (D-R5-17, above) once the caller supplies delivery context |
| `ADD_FREE_ITEM` | `productId`, `variantId`, `quantity`, `reason`, `promotionId` | Promotions resolves which product/variant and how many; cart adds the line, marked with this `promotionId` (D-R4-7). `reason` is `FREE_PRODUCT` or `BUY_X_GET_Y` |

**Invariants:**
- `amountNet`/`amountGross` are always negative decimal strings (the cart adds them; no sign confusion)
- **Every** effect carrying an amount carries `amountNet`, `amountGross`, `appliesTo` and `basis` (rev — C5/D-R4-10, replacing the single-`amount`-with-fallback rule: rev ≤2.1.1 let `sales`-side code reuse one side for the other when only one was supplied, which silently mis-apportioned tax on an order-level discount)
- One `LINE_DISCOUNT` effect per **cart line** per promotion, addressed by `targetLineId` (rev — replaces Amendment §A.4's `targetSku`/`targetCartLineId` pair now that items are never addressed by SKU at all; `TC-PROM-054` asserts two lines sharing a product with different configuration receive independent discounts). Effects for the same line from different promotions are separate entries in separate `appliedPromotions` objects. A partially covered line stays **one** effect carrying `appliedQuantity` — the engine never emits one effect per unit, so a 50-unit line cannot fan out into 50 effects
- `appliedQuantity ≥ 1` and `appliedQuantity ≤ lineQuantity`; an effect covering zero units is omitted, never returned with `amountNet: "0"`
- `max_discount` capping is applied to `amountNet`/`amountGross` directly, each independently rounded half-up at the currency's fraction digits (D-R4-10); there is no `unitAmount` to back-solve in Release 4's model — `appliedQuantity` is not reduced to absorb the cap: the promotion still covered those units, it simply granted less in total
- `appliedQuantity === lineQuantity` whenever `appliesTo` is `line`; only `appliesTo: 'unit'` may report partial coverage
- `ADD_FREE_ITEM` effects are decided entirely by the promotions engine — the cart must not compute which free item to add from raw benefit config; a gift whose `productId`/`variantId` fails the buyer's assortment is not something this endpoint can know (promotions has no visibility scope) — `cart` performs that check before inserting the line (D-R4-7, cart-module.md §4.2 `origin`)
- When `max_discount` is set on a benefit config, the effect resolver caps `|amountNet|` (and derives `amountGross` consistently) at `max_discount` before returning the effect. The cap is applied per-benefit, not across the whole promotion.

#### `POST /api/promotions/codes/reserve` (was `/api/cart/add-code` — see Amendment §A.3)

**(rev — C4/C7/D-R4-8, replacing the bare `(code, customer)` model.)** Request: `{ codeString, cartId, customerId }`. `customerId` is `null` for a guest; a code carrying a per-customer limit then refuses a guest cart with `422 code_requires_identified_customer` (a guest cannot be limited per customer, so it cannot hold one). `organizationId`/`tenantId` come from auth.
Response: `{ ok: true, codeId: uuid, type: "static|dynamic" }` or 422 with error.

Validates: code exists, is active, has remaining global uses, per-customer limit not reached counting **`CodeUsage` plus every other cart's active `CodeReservation`** for that customer (rev — closes R-H4/C7: a reservation now holds real capacity, not merely an intention). Creates or extends a `CodeReservation` keyed `(code_id, cart_id)` — idempotent: a second `reserve` call for the same `(code, cart)` extends the TTL rather than erroring or double-counting. Rate-limited (`shared/lib/ratelimit`) to blunt brute-force code guessing; unknown, inactive and exhausted codes answer with the same error shape.

#### `POST /api/promotions/codes/validate` (was `/api/cart/validate-code` — see Amendment §A.3)

Request: `{ codeString, cartId, customerId }` (rev — `cartId` replaces nothing structurally, but is required so validation checks the same reservation `reserve` would extend)
Response: `{ valid: boolean, reason?: string }`

#### `POST /api/promotions/codes/use` (was `/api/cart/use-code` — see Amendment §A.3)

Request: `{ codeId, codeString, cartId, customerId, type }` (rev — `cartId` replaces nothing structurally; org/tenant from auth)
Response: `{ ok: true }`

Side effects (rev — C6/D-R4-12, replacing the serializable-transaction claim below, which `withAtomicFlush` cannot deliver — it joins an ambient transaction and ignores `isolationLevel`, and no `40001` retry helper exists anywhere in `packages/shared`): locks the code's row (`SELECT … FOR UPDATE`) inside the (possibly ambient, e.g. `checkout`'s own) transaction, re-reads global and per-customer usage counts under that lock, then proceeds — correct under a joined transaction with no retry loop needed. Deactivates `GeneratedCode` (dynamic) OR increments `Code.used` + deactivates if exhausted (static). Writes `CodeUsage`. Deletes the `(code_id, cart_id)` `CodeReservation`. Test: N concurrent `use` calls for the same single-use code, one succeeds.

#### `POST /api/promotions/codes/release` (was `/api/cart/delete-code` — see Amendment §A.3)

Request: `{ codeString, cartId, customerId }` — deletes the `CodeReservation` for that `(code, cartId)` only, never another cart's.
Response: `{ ok: true }`

#### `POST /api/promotions/usage/register` (was `/api/cart/register-usage` — see Amendment §A.3)

Called by the cart integration after an order/quote is **confirmed** (payment captured or quote finalised). Records the discount audit trail and enforces the lifetime budget cap. (Release 4 ships and tests this route; its first production caller is `checkout`, out of this release's scope — D-R4-26.)

Request:
```jsonc
{
  "orderId": "string",
  "orderType": "order | quote | pos_cart",
  "customerId": "string | null",
  "currency": "USD",
  "appliedPromotions": [
    {
      "promotionId": "uuid",
      "effects": [/* ResolvedEffect[] — same shape as returned by evaluate */]
    }
  ]
}
```

Response: `{ ok: true }` — 200. Idempotent on re-submission for the same `orderId`. `organizationId`/`tenantId` from auth.

Side effects (rev — C6/D-R4-12, same correction as `codes/use` above): for each `appliedPromotion`, `promotionUsageService.registerUsage(...)` locks the promotion's row inside the transaction, re-reads `SUM(total_discount_amount) WHERE reverted_at IS NULL AND currency = budget_currency`, and only then writes — never a serializable isolation level, which `withAtomicFlush` does not provide and which checkout's ambient transaction would silently drop anyway. If any promotion's budget would be exceeded, that promotion's write is rolled back and the endpoint returns **207 Multi-Status** with a `budgetExceeded` flag for the affected promotion IDs — the caller should re-evaluate whether to proceed with the order at a reduced discount or notify the customer. Emits `promotions.usage.registered` per successful promotion. Emits `promotions.promotion.budget_exhausted` (rev — underscore id, W1/D-R4-25) when the running total first reaches `max_budget`. Test: N concurrent `registerUsage` calls inside one ambient transaction never jointly exceed the budget.

#### `POST /api/promotions/usage/revert` (was `/api/cart/revert-usage` — see Amendment §A.3)

Called by the cart integration when an order is **cancelled** or a quote is **rejected/expired**.

Request: `{ orderId }` — `organizationId`/`tenantId` from auth.
Response: `{ ok: true, revertedCount: number }` — `revertedCount` is the number of `PromotionUsage` rows marked reverted.

Side effects: calls `promotionUsageService.revertUsage(...)`. Rows are never deleted — `reverted_at` is set. Emits `promotions.usage.reverted`. Invalidates the promotion cache so `totalDiscountGranted` is refreshed.

#### `GET /api/promotions/dynamic-labels`

Response: list of promotion condition summaries for storefront label rendering (promotion name, active rules in simplified form, applicable products/categories). **(rev — V2)** Returns only promotions whose scope the caller's own buyer context can see — an authenticated server caller passes a resolved `EffectiveAssortmentScope`; there is no anonymous, scope-free variant, closing the catalog-enumeration surface `storefront-public-api.md` §4.2 already closes for ordinary product reads.

#### `POST /api/promotions/free-products`

Request: cart context subset, addressed by `productId`/`variantId` (rev — never `sku`, same identity change as `evaluate`). Response: free product offers (FreeProductBenefit + BuyXGetY) applicable to the given context. **(rev — V2, P5/D-R4-7)** Respects the caller's buyer scope exactly as `dynamic-labels` does: a reward the buyer's assortment would hide is never offered here either, closing the read-side half of the free-item visibility gap `cart` closes on the write side.

#### `POST /api/promotions/delivery-methods` — still deferred (rev — D-R5-17, amends D-R4-14)

Request: cart context + delivery method codes to check. Response: which delivery methods have active discount benefits. Not built in Phases 1–3, and still not built by Release 5's D-R5-17: that decision un-hid the `delivery_method` rule/`DELIVERY_DISCOUNT` benefit and gave `evaluate` its `deliveryMethodCode`/`deliveryCost` data source, but building this separate per-delivery-method badge-check route was explicitly out of that Step's scope — checkout's own delivery-step UI (Phase 2, Step 2.13) calls `evaluate` directly instead.

#### `POST /api/promotions/product-page`

Request: `{ skus: string[] }` — list of SKUs rendered on a product listing or detail page. `organizationId`/`tenantId` from auth (rev — C3; this endpoint keeps SKU addressing, unlike `evaluate`/`free-products`, because a listing/PDP context has no cart line identity to carry — `TC-PROM-0xx` cross-tenant test still applies per route).
Response: `{ badges: Array<{ sku: string, promotionId: uuid, promotionName: string, label: Record<string, string> }> }` — one entry per SKU that has an active promotion with a matching `ProductDiscount` or `BuyXGetY` benefit. Evaluated via `lib/product-page-engine.ts` against the same normalized promotion cache; zero DB access. **(rev — V2)** Scoped the same way as `dynamic-labels`/`free-products`: an authenticated caller's resolved buyer scope filters which SKUs can return a badge at all.

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
      "contextKeys": [],
      "supportedAppliesTo": ["order"],
      "defaultAppliesTo": "order",
      "capsHonoured": false
    }
  ]
}
```

`contextKeys` is surfaced so cart integrations can determine which `extensions` fields to include in `POST /api/promotions/evaluate` requests (or the `evaluate()` DI call, in-process — Amendment §A.2).

`supportedAppliesTo` / `defaultAppliesTo` let the tree builder restrict the **Applies to** control for an extension benefit exactly as it does for a built-in one, and `capsHonoured: false` makes the admin UI disable the quantity-cap fields with an explanation instead of offering a cap the extension will ignore.

---

## Internationalization (i18n)

- All admin UI labels, tooltips, empty states, confirmation dialogs, error messages in locale files
- Benefit `labels` field is a per-locale map stored in JSONB; rendered by cart/checkout/POS
- `translations.ts` declares benefit label fields as translatable for the platform's translation system — Phase 4 (§Architecture)
- Key namespaces: `promotions.*`, `promotions.codes.*`, `promotions.rules.*`, `promotions.benefits.*`
- **(rev — completeness gap)** `i18n/{de,en,es,ko,pl}.json` ship from **Phase 1**, not after the UI as earlier phase ordering had it — `useT()` keys exist from the first component that needs one. `yarn i18n:check-sync` and the hardcoded-string checker gate Phase 1, not Phase 4.

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
2. **Settings** — active toggle, cumulative toggle, tags chip input (autocomplete from existing tags), excluded_tags chip input (same autocomplete, distinct input). **(rev — P9/D-R4-16, dropping the unbacked "promotional-price-visibility toggle": no such column ever existed.)** The real control — whether this promotion applies on top of a catalog promotional price — lives in the Exclusions panel below as the `exclude_promotional_prices` flag
3. **Exclusions** — boolean flag checkboxes driven by `exclude_flags` config: `exclude_promotional_prices` (D-R4-16 — excludes items whose unit price already came from a promotional `CatalogPriceKind`; checked against each item's `priceIsPromotional`, §API Contracts) ships in Release 4. Other flags (e.g. a future pharmaceutical exclusion) are extension-registered — none ship with core in this release, since no such product flag exists in `catalog` yet
4. **Rules & Benefits** — tree builder (see below)

### Rule Group Tree Builder

**(rev — A6/om-ds-guardian.)** Every colour below is a semantic design-system token, not a literal hue — a "green add-rule button" means `Button` with the `variant` the DS maps to that affordance, not a hardcoded Tailwind color class, and depth is a left-border/elevation step on the DS surface scale, not a `color-mix` lightening ramp (arbitrary CSS values are a lint violation on this platform regardless of how reasonable the ramp looks).

- Recursive `RuleGroupNode` component; indented with L-shaped connector lines per level
- Nesting depth communicated via the DS surface-elevation scale (a left border token that steps per level) — never a computed `color-mix`/arbitrary-value background
- Group header: **AND/OR** pill toggle (left), action buttons (right) using DS `Button` semantic variants: Add Rule (`secondary`), Add Sub-group (`outline`), Add Benefit (`accent`/promotional-status token — never a hardcoded orange), Duplicate (`ghost`, sub-groups only), Delete (`destructive`, sub-groups only)
- Rules rendered as inline cards: type dropdown (filterable combobox), type-specific inline fields, delete (`destructive`-variant icon button)
- Benefits rendered in a visually distinct zone at group bottom: a divider using the DS's accent/benefit token with a `BENEFITS` badge, each benefit is an inline card identical in layout to a rule card but using that same accent token for its border, never a raw color; includes collapsible Labels section (locale → string inputs)
- Every benefit card carries an **Applies to** segmented control (Whole order / Order line / Each piece) restricted to the values the selected benefit type allows, and a **Limits** row (`max_quantity`, `max_lines`, `quantity_step`, `max_discount`). Choosing `Whole order` hides the quantity limits, which are meaningless there. Entering a quantity limit reveals the **Which pieces** selector (`cart_order` labelled *First added*, `cheapest`, `most_expensive`) and makes it required — the write path rejects a cap without a selector, so the form must not let the operator reach that state
- The benefit card renders a one-line plain-language echo of the configured combination (*"20% off — the first 5 pieces across the cart, max $50"*), because `applies_to` + selector + three caps is precisely the combination operators mis-read
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
   * Application targets this benefit supports, and the one used when the
   * operator does not choose. Core stores `applies_to` on the benefit row and
   * validates it against this list — it never parses the extension's config to
   * find out what the benefit applies to.
   */
  supportedAppliesTo: BenefitAppliesTo[]
  defaultAppliesTo: BenefitAppliesTo
  /**
   * Resolves the benefit into concrete ResolvedEffect[].
   * MUST be pure — no DB access, no side effects.
   *
   * `selection` is the already-ordered, already-budgeted set of units core
   * resolved from the shared cap block — the extension prices it and does not
   * re-apply the caps. Under `applies_to: 'order'` it arrives empty.
   *
   * An extension is free to ignore `selection` and resolve effects from its own
   * config instead; core cannot stop it, so `capsHonoured: false` declares that
   * up front and the extension-types endpoint surfaces it, rather than an
   * operator discovering an uncapped benefit from an overspent campaign.
   */
  resolve(config: unknown, context: CartContext, selection: UnitSelection): ResolvedEffect[]
  /** Whether `resolve` honours `selection`. Surfaced to the admin UI. */
  capsHonoured: boolean
}

/**
 * The unit set a capped benefit may discount, produced by
 * `selectUnits(benefit, context)` in `lib/unit-selection.ts` — ordered by the
 * benefit's `selector`, truncated to `max_quantity` / `max_lines` /
 * `quantity_step`, with the deterministic tie-break already applied.
 */
export type UnitSelection = {
  /** One entry per covered line, in selection order. */
  lines: Array<{
    lineId: string                  // rev — never sku/cartLineId; the caller's own line identity (D-R4-21)
    productId: string
    variantId: string | null
    lineQuantity: number
    /** How many of this line's units the budget covered; ≤ lineQuantity. */
    appliedQuantity: number
    unitPriceNet: string
    unitPriceGross: string
  }>
  /** Total units covered across every line — the spent budget. */
  totalQuantity: number
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
   * Runs inside the row-locked transaction before `codes/use` finalises (rev — C6/D-R4-12, never serializable isolation).
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
  selection = selectUnits(benefit, context)   // ordering + cart-wide quantity budget
  Built-in benefit types → lib/effect-resolvers.ts(config, context, selection)
  Unknown type           → registry.getBenefitExtension(type)?.resolve(config, context, selection) ?? []
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
  // ... eleven Release-4 branches, plus the six hidden-but-modelled types (§Data Models) ...
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

`EvaluateInput` (rev — named `CartContext` before the Release 4 public-contract naming pass; accepted by `POST /api/promotions/evaluate` / `promotionsService.evaluate()`, §Public TypeScript Contract) is extended with an open-ended `extensions` field to let cart integrations supply extension-specific data:

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

- All tables created via MikroORM migrations (`yarn db:generate`; review the SQL, keep only this module's migration + snapshot — **never** `yarn db:migrate` without asking first, root `AGENTS.md`)
- No existing promotions data — clean migration, no backfill required
- Cart-facing API is additive; existing cart/POS integrations are unaffected until they opt in
- POS module (SPEC-022) deferred promotions to Phase 3 — this module enables that integration
- The 2.1.0 amendment (`applies_to`, quantity caps, quantity-aware `LINE_DISCOUNT`) breaks no contract surface: `promotions` and `cart` are both unimplemented at the time of writing, so `promotion_benefits` has no rows to backfill and no external caller consumes a `ResolvedEffect` yet. It touches no shipped module — §B.6 maps line effects onto `SalesLineSnapshot` fields that `sales` already exposes, and §B.7 defers the `sales` change that would have been a contract surface
- **(rev — eComm Release 4, 2026-10-14, missing-BC-section fix).** Still greenfield at this revision: every rename this revision makes (`X-Module-Key`→standard API-key identity, `sku`-based addressing→id-based, single `amount`+`basis`→`amountNet`+`amountGross`, `(code_id, customer_id)`→`(code_id, cart_id)`, hyphenated→underscore event ids, `user_group`→`customer_group`) is a rename of a contract that has never shipped — no deprecation protocol triggers, no bridge is owed, and nothing above (clean migration, additive cart-facing API, POS deferral) changes. §Release 4 Contract Freeze records what becomes STABLE the moment Phase 1 *does* ship

---

## Implementation Plan

**(rev — C2/C8/D-R4-29, replacing the phase ordering below.)** Three corrections to rev ≤2.1.1's phases, all forced by facts discovered after they were written: (1) `PromotionUsage` moves from "Phase 3" into Phase 1, because Phase 2's cache build already aggregates `SUM(total_discount_amount)` from it — the entity cannot be created after the table it reads; (2) i18n moves from Phase 4 into Phase 1, per the root `AGENTS.md` i18n-before-UI rule; (3) the `code` rule ships in Phase 1 (a plain `code_id` config field, validated against `promotion_codes` at write time) even though the codes system itself — generation, reservation, redemption — is Phase 3, because the rule-tree builder and the `code` rule type are both admin-tree concerns independent of the runtime codes lifecycle. Every step below also reflects the Release-4 rule set (eleven types, not 15/16/17 — §Data Models), the `promotionsService` facade (§Amendment A.2), and the cart-facing auth/identity/reservation model fixed above (§API Contracts).

### Phase 1 — Domain Model & Core Admin

**Goal:** Operators can create, edit, and delete promotions with a full rule-benefit tree. Data persists correctly. All entities, migrations, and CRUD in place. `promotionsService`'s own DI/ACL/events scaffolding exists, even though its `evaluate` method lands in Phase 2.

1. Scaffold module: `index.ts`, `acl.ts` (incl. `promotions.evaluate`, `promotions.codes.redeem`, `promotions.usage.manage` — D-R4-11), `events.ts` (underscore ids — D-R4-25), `setup.ts` (`defaultRoleFeatures`, admin only for the three new features), `di.ts`. **No** `ce.ts`, `translations.ts`, `search.ts`, `notifications.ts`, or any `widgets/` file — those are Phase 4/5 only (§Architecture).
2. Write all MikroORM entities in `data/entities.ts`: `Promotion`, `RuleGroup`, `Rule` with `rule_type` + `config jsonb`, `Benefit` with `benefit_type` + `applies_to` + `config jsonb`, and **`PromotionUsage`** (rev — C8, moved from Phase 3; `ON DELETE RESTRICT` on `promotion_id`, §Data Models)
3. Write Zod validators in `data/validators.ts` for all entities and API inputs: the shared quantity-cap block (`max_quantity`, `max_lines`, `quantity_step`) intersected into every benefit variant; the per-type `applies_to` allow-list; the two write-path rejections from §B.4 (a cap without a `selector`, `selector: all` combined with a cap — `TC-PROM-062`); the Release-4 rule-type allow-list for the admin write path (the eleven shipped types, §Data Models — rejecting a hidden type at the write path, not merely hiding it in the UI, so an API client cannot create what the UI cannot); single-`eligible_currency` validation on `fixed`/tiered/threshold benefits (D-R4-27, `TC-PROM-062b`)
4. `yarn db:generate`; review the generated SQL; keep only the promotions migration + snapshot (never `yarn db:migrate` — root `AGENTS.md` "Ask First")
5. Implement `commands/promotions.ts` — create/update/delete with undo support (`extractUndoPayload`), events, cache invalidation after commit (never inside `withAtomicFlush`); breaks the `Promotion`↔`RuleGroup` creation cycle per §Data Models' rev note
6. Implement `commands/rule-tree.ts` — atomic tree reconciliation command using `withAtomicFlush`; the promotion's `updatedAt` is a required input, `409` on a stale value (optimistic lock, §API Contracts)
7. Implement `api/route.ts` (list, create, update, delete) using `makeCrudRoute` + `indexer` — mounts at `/api/promotions`, **not** `api/promotions/route.ts` (W2, §Architecture)
8. Implement `api/[id]/route.ts` (detail with nested tree eager-load)
9. Implement `PUT /api/promotions/[id]/tree` — tree reconciliation endpoint; carries `updatedAt`
10. Implement `PATCH /api/promotions/order` — batch order update; each item carries its own `updatedAt`
11. Build backend list page (`backend/promotions/page.tsx`) — card layout, drag-sort, filters, batch save
12. Build promotion form pages (create + detail) — 4 panels (rev — 3 content panels + tree, `promotional-price-visibility` toggle dropped, §UI/UX), tag chip inputs
13. Build `RuleGroupNode` recursive tree component with AND/OR toggle, action buttons, type dropdowns for the **eleven** Release-4 rule types (rev — not 15), benefit zone, drag-within-tree; DS semantic tokens throughout, no hardcoded colours (A6, §UI/UX)
14. Add the benefit card's **Applies to** segmented control, **Limits** row and conditional **Which pieces** selector (§UI/UX), wired so a capped benefit cannot be saved without a selector, plus the plain-language echo line (including the category-descendants echo, D-R4-15, and the `exclude_promotional_prices` flag, D-R4-16)
15. `i18n/{de,en,es,ko,pl}.json` (rev — Phase 1, not Phase 4); `yarn i18n:check-sync`
16. `yarn generate` (rev — not `npm run modules:prepare`, which is not a repo command)
17. Integration tests: promotion CRUD, tree save, order batch update, `applies_to` persistence, the write-path rejections (`TC-PROM-062`, `TC-PROM-062b`, `TC-PROM-067`, `TC-PROM-071`), the rule-type allow-list rejection, and optimistic-lock conflicts on `[id]/tree` and `order` (self-contained API fixtures, cleanup in `finally`)
18. UI integration tests (Playwright, rev — completeness gap): tree builder save/reload with nested groups and benefits; a capped benefit cannot be saved without a selector; list drag-sort and save

### Phase 2 — Evaluation Engine & Cart API

**Goal:** Cart module can call `promotionsService.evaluate` (in-process) or `POST /api/promotions/evaluate` (HTTP) and receive correct, fully resolved effects.

1. Define the **public TypeScript contract** in `lib/types.ts` (rev — W6, new §Public TypeScript Contract below) — every type `cart` and any HTTP caller needs: `ResolvedEffect` (with `amountNet`/`amountGross`, D-R4-10), `EvaluateInput`/`EvaluateResult`, `BuyerContext` identity (D-R4-28), `CodeRef`. Implement `lib/evaluation-engine.ts` — three-pass recursive evaluator accepting `NormalizedPromotion[]`; MUST NOT depend on MikroORM entities or any DB access; applies deterministic ordering (`ORDER BY order ASC, id ASC`); the date-window check against caller-supplied `evaluatedAt` (D-R4-13, before Pass 1); currency eligibility check; optimistic budget pre-check (`totalDiscountGranted >= maxBudget`); Pass 3 calls effect resolvers with the cart context to compute final amounts
2. Implement `lib/rule-evaluators.ts` — the **eleven** Release-4 rule evaluators (rev — not 15/16/17, §Data Models): `order_value`, `order_date`, `product_count`, `cart_weight`, `row_total`, `product`, `category` (with descendant expansion, D-R4-15), `product_attribute` (resolved via step 6's batch enrichment), `customer_group` (rev — replaces `user_group`), `code`, `customer_order_history`. Evaluators receive normalized `config` objects only
3. Implement `lib/unit-selection.ts` and `lib/effect-resolvers.ts`: `selectUnits(benefit, context)` expands qualifying cart lines into an ordered unit (or line) sequence per `selector`, applies the deterministic tie-break, then spends the cart-wide `max_quantity` / `max_lines` / `quantity_step` budget (held here, not a per-line loop, §B.3; exported for extension benefit types). `effect-resolvers.ts` maps a `NormalizedBenefit` config + cart context to `ResolvedEffect` objects carrying **`amountNet` and `amountGross`** (rev — C5/D-R4-10, replacing the single `amount`+fallback model), rounded once, half-up, at the currency's fraction digits in integer minor units (P2); `max_discount` capping applied to `amountNet` directly, `amountGross` derived consistently, never a pre-cap `unitAmount` back-solve (rev — no `unitAmount` in the Release-4 model, §API Contracts); `ADD_FREE_ITEM` carries `promotionId` as its marker (D-R4-7) and no monetary amount
4. Implement `lib/tag-exclusion.ts` — promotion ordering + cumulativity + tag exclusion loop
5. Implement `services/promotion-cache.ts`: the cache holds every `active = true` promotion **regardless of date window** (rev — R-H3/P8, replacing "active and within range"); `totalDiscountGranted` moves into a **separate, small counters key** (rev — R-H3c), read only for budget-capped promotions; `startsAt`/`endsAt` ride in `NormalizedPromotion` for the evaluator's own date-window check. Subscriber in `subscribers/invalidate-promotion-cache.ts` invalidates the **main cache only on promotion/code mutation events** (rev — not on usage events, which touch only the counters key)
6. Implement `promotionsService.evaluate`/`.evaluateForProduct` in `lib/promotions-service.ts` (rev — new file, the DI facade named in §Amendment A.2) — batch context enrichment from the request's `productId`/`variantId` (D-R4-21/C11): resolves category/tag/attribute membership for every item in one batch call against the same catalog-scoping services `cart` uses, never per-item; a field with no resolvable source is `null`. `BuyerContext` identity per D-R4-28
7. Implement `api/evaluate/route.ts`, `api/product-page/route.ts`, `api/dynamic-labels/route.ts`, `api/free-products/route.ts` — standard API-key identity, `requireFeatures`, ownership checks on referenced ids, assortment scope respected on the three visibility-sensitive routes (V2/P5, §API Contracts). **No** `api/delivery-methods/route.ts` in this release (D-R4-14)
8. Integration tests: per-rule engine unit tests with a throwing `EntityManager` (zero DB access assertion); end-to-end `evaluate` API tests asserting `ResolvedEffect.amountNet`/`amountGross` (not raw percentages), `ADD_FREE_ITEM` product/variant resolution, cumulativity, tag exclusion, sub-group benefit collection, deterministic selection (`TC-PROM-064`); a cross-tenant test per route; performance benchmark at **200 promotions × 50 lines**, P95 ≤ 150 ms (rev — A.7/`TC-PROM-057`, not "≥ 100," W12/gate-mismatch); cap and targeting behaviour per `TC-PROM-058`–`TC-PROM-061`, `TC-PROM-063`–`TC-PROM-065`, `TC-PROM-069`, `TC-PROM-070`, `TC-PROM-072`

### Phase 3 — Codes System

**Goal:** Operators can manage code templates; cart can validate, reserve, and finalize code redemptions, with per-cart reservation capacity.

1. Write `Code`, `GeneratedCode`, `CodeReservation` (rev — `cart_id` in the unique key, C4/D-R4-8, §Data Models), `CodeUsage` entities and validators; one normalised code-string namespace unique per `(tenant_id, organization_id)` across both `Code.code` and `GeneratedCode.code` (W5d)
2. `yarn db:generate`; review SQL; keep only the codes migration + snapshot
3. Implement `commands/codes.ts` — code CRUD with undo, events
4. Implement `lib/code-service.ts` — `reserveCode` (idempotent per `(code, cart)`), `extendReservation`, `validate`, `use` (row-lock budget check, C6/D-R4-12 — never serializable isolation), `release` (by `(code, cartId)`)
5. Implement `workers/code-generation.worker.ts` — background batch generator with uniqueness validation against the one normalised namespace (step 1); register queue `promotions-code-generate` (rev — hyphenated queue-name convention, W-low)
6. Implement `services/code-generation.ts` — triggers worker, tracks progress
7. Implement **`services/code-reservation-sweeper.ts`** and **`workers/code-reservation-sweep.worker.ts`** (rev — A.6/X7, previously unspecified) — releases lapsed `CodeReservation` rows independently of `cart`'s own expiry sweeper; registered via `schedulerService`
8. Implement `api/codes/route.ts`, `api/codes/[id]/generate/route.ts`, `api/codes/[id]/generated/route.ts`
9. Implement code endpoints under `api/codes/`: `reserve`, `validate`, `use`, `release` (was `cart/add-code`, `cart/validate-code`, `cart/use-code`, `cart/delete-code` — Amendment §A.3); bodies per the rev — C4/D-R4-8 shapes in §API Contracts (`cartId`, never `organizationId`/`tenantId`)
10. Build codes backend pages: list, create, detail with generated codes panel; DS tokens (A6)
11. Implement `lib/promotion-usage-service.ts` — `registerUsage` (row-lock + re-read-sum budget enforcement, rev — C6/D-R4-12, never serializable; idempotent upsert; `promotions.promotion.budget_exhausted` emission on first budget hit — rev, underscore id), `revertUsage` (bulk `reverted_at` update), `getBudgetConsumed`. (`PromotionUsage` itself was created in Phase 1, C8 — this step only adds the service.)
12. Implement `api/usage/register/route.ts` (was `api/cart/register-usage/route.ts` — Amendment §A.3) — loops `appliedPromotions`, calls `registerUsage` per promotion, returns 207 Multi-Status with `budgetExceeded` flag for any promotions that were blocked; exports `openApi`
13. Implement `api/usage/revert/route.ts` (was `api/cart/revert-usage/route.ts` — Amendment §A.3) — calls `revertUsage`, returns `{ ok: true, revertedCount }`; exports `openApi`
14. Update `subscribers/invalidate-promotion-cache.ts` to subscribe to `promotions.usage.registered`/`.reverted` for the **counters key only** (rev — step 2.5's cache split; the main tree cache is untouched by usage events)
15. Register `promotionCodeService`, `promotionUsageService`, `promotionCodeGenerationService` in `di.ts` (rev — DI token names per §Architecture, W3)
16. Integration tests: `TC-PROM-020`–`026`, `050`–`057` (rev — re-threaded per the Testing Strategy below): code lifecycle, per-customer limit counting `CodeUsage` + other carts' reservations, concurrent reservation of the last code (one succeeds), concurrent `registerUsage` inside one ambient transaction never exceeding budget, currency eligibility, and a cross-tenant test per route; UI test for the codes backend pages

### Phase 4 — Search, Notifications & Polish

**Goal:** Promotions are searchable; operators receive relevant notifications; edge cases handled.

1. Implement `search.ts` — fulltext indexing for promotions (name, description, tags) and codes (name, code)
2. Implement `notifications.ts` — code pool exhaustion notification (`promotions.code.exhausted` event), promotion `expiring_soon` notification (rev — underscore id, W1/D-R4-25)
3. Implement `subscribers/` for notification events
4. i18n ships from Phase 1 (rev — moved, above); nothing left to do here
5. Declare widget injection slots in `widgets/injection-table.ts`: `promotions.promotion-list.toolbar`, `promotions.promotion-detail.panels`, `promotions.promotion-detail.sidebar`, `promotions.codes-list.toolbar`, `promotions.dashboard.stats`
6. POS integration event subscription: `pos.cart.completed` → trigger `codes/use` if code in session
7. Final compliance and spec update
8. Integration tests: `TC-PROM-030` Search indexing, `TC-PROM-031` Notification on code exhaustion, `TC-PROM-032` Notification on promotion expiring soon

### Phase 5 — Extension Infrastructure

**Goal:** Other modules can register custom rule types, benefit types, evaluation middleware, and admin configurator UI against the promotions module without modifying any promotions file.

1. Implement `lib/extension-registry.ts` — `PromotionExtensionRegistry` class; `registerRuleType`, `registerBenefitType`, `registerEvaluationMiddleware`, `registerCodeMiddleware`; validate at registration that evaluators are synchronous functions; log a warning on duplicate `type` registration (last-registered wins)
2. Register `PromotionExtensionRegistry` as a singleton in `di.ts` under the token `promotionExtensionRegistry`
3. Update `lib/evaluation-engine.ts` — resolve unknown rule types from registry in Pass 1; resolve unknown benefit types from registry in Pass 3; run `EvaluationMiddleware.beforeEvaluate` chain before Pass 1; run `EvaluationMiddleware.afterResolve` chain after Pass 3; pass `context.extensions` through unchanged to all evaluators
4. Update `lib/code-service.ts` — call `CodeMiddleware.beforeCodeUse` inside the serializable transaction; call `CodeMiddleware.afterCodeUse` after transaction commits; wrap `beforeCodeUse` errors as 422 responses with the thrown message
5. Update `data/validators.ts` — add extension passthrough branch to the Zod discriminated union for `rule_type` and `benefit_type`; run `extension.configSchema.parse(config)` in commands for unknown types before persisting
6. Extend `CartContext` type to include `extensions?: Record<string, unknown>`; update the `POST /api/promotions/evaluate` Zod schema and OpenAPI spec to include the `extensions` field
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
| `promotions/api/route.ts` | Create | CRUD route with makeCrudRoute — mounts at `/api/promotions` (rev — W2, not `api/promotions/route.ts`) |
| `promotions/backend/promotions/page.tsx` | Create | List page |
| `promotions/backend/promotions/[id]/page.tsx` | Create | Detail + tree editor |
| `promotions/i18n/{de,en,es,ko,pl}.json` | Create | Rev — Phase 1, five locales |
| `promotions/lib/types.ts` | Create | Rev — public TypeScript contract barrel (W6) |

### Testing Strategy

Integration tests for each phase following `.ai/qa/AGENTS.md`:
- Phase 1: `TC-PROM-001` Promotion CRUD, `TC-PROM-002` Rule tree save/load, `TC-PROM-003` Order batch update, `TC-PROM-062` capped benefit without a selector rejected, `TC-PROM-062b` fixed/tiered/threshold benefit without `eligible_currency` rejected (D-R4-27), `TC-PROM-067`/`071` write-path rejections, a hidden-rule-type write rejected at the API even though the UI never offers it
- Phase 2: `TC-PROM-010` `evaluate` returns resolved `amountNet`/`amountGross` (never raw percentages or a pre-cap `unitAmount`) for each of the eleven rule types, `TC-PROM-011` Cumulativity + tag exclusion, `TC-PROM-012` Sub-group benefit collection, `TC-PROM-013` `ADD_FREE_ITEM` effect carries correct `productId`/`variantId` + quantity + `promotionId` marker for FreeProduct and BuyXGetY, `TC-PROM-014` `max_discount` cap — a `cart_discount` benefit with `value: "10%"` and `max_discount: "100"` applied to a $1500 cart produces `amountNet: "-100"` (capped), not `"-150"`, `TC-PROM-057` P95 ≤ 150 ms at 200 promotions × 50 lines (rev — the gate, not "≥100"), `TC-PROM-064` deterministic selection under a re-evaluation of an unchanged cart, a cross-tenant test per Phase 2 route
- Phase 3: `TC-PROM-020` Code lifecycle, `TC-PROM-021` Per-customer limit counted as `CodeUsage` + other carts' reservations (rev — D-R4-8), `TC-PROM-022` Concurrent reservation race for the last code (one succeeds), `TC-PROM-023` `usage/register` writes `PromotionUsage` row with correct `effects_snapshot` and `total_discount_amount` (excluding `ADD_FREE_ITEM`, which carries none), `TC-PROM-024` `usage/revert` sets `reverted_at` on all matching rows (never deletes); `getBudgetConsumed` decrements accordingly, `TC-PROM-025` Budget cap enforcement via the row-lock mechanism (rev — C6/D-R4-12, not serializable isolation) — promotion with `max_budget: "500"` accepts registrations until cumulative hits 500, then blocks with 207 + `budgetExceeded: true` and emits `promotions.promotion.budget_exhausted` (rev — underscore); cache refresh causes post-exhaustion `evaluate` to skip the promotion, `TC-PROM-026` Currency eligibility — promotion with `eligible_currencies: ["EUR"]` is excluded from `evaluate` response when `currency: "USD"` is passed; included when `currency: "EUR"` is passed, `TC-PROM-050`–`056` concurrent `registerUsage` inside one ambient transaction never exceeding budget (R-H2), a cross-tenant test per Phase 3 route, UI test for the codes backend pages
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
- **Scenario**: Two browser sessions for the same customer both call `codes/reserve` (`/api/promotions/codes/reserve`, or `promotionsService.reserveCode()` in-process) with a code that has `usage_per_customer: 1` and 0 existing `CodeUsage` records. Both pass the limit check and both create a `CodeReservation`.
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

**(rev — C6/P7/D-R4-12, replacing the serializable-isolation mechanism below.)** `withAtomicFlush` joins an ambient transaction and ignores `isolationLevel`, and `checkout` is expected to call `registerUsage` inside its own order transaction — so `ISOLATION LEVEL SERIALIZABLE` never actually applies under the real call shape, and no `40001` retry helper exists anywhere in `packages/shared` to recover from a serialization failure if it somehow did.

- **Scenario**: Multiple concurrent orders for the same promotion all pass the optimistic budget pre-check (stale cache snapshot), then all call `usage/register` concurrently.
- **Severity**: Low — a row lock (`SELECT … FOR UPDATE`) on the promotion row inside `registerUsage`'s transaction serializes the read-modify-write against the budget sum, regardless of the surrounding transaction's isolation level or whether it is ambient (nested inside `checkout`'s own transaction) or top-level.
- **Affected area**: `max_budget` enforcement in `registerUsage`
- **Mitigation**: `promotionUsageService.registerUsage` locks the promotion's row, re-reads `SUM(total_discount_amount) WHERE reverted_at IS NULL AND currency = budget_currency` under that lock, then writes — correct under a joined transaction with no retry loop needed, unlike the withdrawn serializable-isolation approach. Test: N concurrent `registerUsage` calls against one promotion inside one ambient transaction never jointly exceed the budget.
- **Residual risk**: None beyond ordinary lock contention under very high concurrent throughput (unlikely for promotions context), which simply serializes the writes rather than risking an overshoot.

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

### Addendum — 2026-08-17 (Amendment reconciliation)

| Requirement | Status |
|---|---|
| Command pattern for financially consequential writes | `reserveCode`/`releaseCode`/`useCode`/`registerUsage`/`revertUsage` implemented as registered commands (§A.2a) |
| Cross-module coupling direction | `cart` → `promotions` is a hard dependency, not an optional `tryResolve` peer (§A.2b) — documented rationale, not a silent omission |
| DI contract completeness | `PromotionsService` covers all 7 cart-facing operations (§A.2, fixed) |
| Internal consistency of the `/api/cart/*` → `/api/promotions/*` rename | All references across the document updated (§A.3, fixed) |

### Addendum — 2026-09-07 (Application target and quantity caps)

| Requirement | Status |
|---|---|
| No cross-module coupling introduced | §B.6 maps line effects onto `SalesLineSnapshot` fields `sales` already exposes; §B.7 defers the `SalesAdjustmentDraft.lineId` change to its own spec rather than editing a shipped module from a promotions amendment |
| No contract surface broken | Both `promotions` and `cart` are unimplemented; no rows to backfill, no external consumer of `ResolvedEffect` (§Migration & Compatibility) |
| Validation at the application boundary | `applies_to` allow-list, the shared quantity-cap block and the two capped-config rejections are Zod-validated in `data/validators.ts` (Phase 1 step 3), not merely documented |
| Determinism | Selector ordering has a specified tie-break (`lineId`, then unit index) so an unchanged cart re-evaluates identically (§B.4, `TC-PROM-064`) |
| No hard-coded user-facing strings | The admin control's labels (*Whole order* / *Order line* / *Each piece*, *First added*) and the plain-language echo line route through `useT()` keys in `i18n/*.json` (rev — not `translations.ts`, which declares the benefit `labels` *content* field as translatable, a distinct per-record-content concern from the admin UI's own chrome strings) |

### Addendum — 2026-10-14 (rev 9 — eComm Release 4 decisions applied)

| Requirement | Status |
|---|---|
| §B.6 / A-R6 / `TC-PROM-060` match the shipped `sales` contract | Rewritten for `discountAmountBasis: 'line'` (§B.6 below, C1/D-R4-9) — the 2026-09-09 fix assumed `sales` had no basis flag; `#5640` shipped one on `develop` before this correction, and the mapping is rewritten against what actually exists |
| HTTP auth model matches the platform | `X-Module-Key` withdrawn; standard API-key identity + `requireFeatures`, no tenant/org ids in request bodies (C3/A1/A2, D-R4-11) |
| `ResolvedEffect` carries both tax sides | `amountNet` + `amountGross` on every amount-carrying effect (C5/D-R4-10) |
| Serializable-isolation claims replaced | Row-lock + re-read-sum inside the (possibly ambient) transaction everywhere `withAtomicFlush` was previously described as serializable (C6/D-R4-12, §Promotion Usage Lifecycle, §API Contracts `codes/use`) |
| Code reservations hold real capacity | `CodeReservation.cart_id`, `UNIQUE (code_id, cart_id)`, idempotent `reserveCode`, per-cart release (C4/C7/D-R4-8) |
| Free-item line representable in `cart` | `ADD_FREE_ITEM.promotionId` marker matches `cart`'s `CartLine.promotion_id`/`origin` (C4a/D-R4-7, coordinated with `2026-08-14-cart-module.md` rev 9) |
| Visibility respected on promotion reads | `dynamic-labels`, `free-products`, `product-page` scoped to the caller's buyer context (V1/V2/P5) |
| Release-4 rule set has a real data source for every shipped type | Eleven types; six hidden (producer, pharmaceutical flag, consent, delivery/payment/address, delivery discount) until a data source exists (P10/D-R4-14, §Data Models) |
| Phase ordering fixed | `PromotionUsage` and i18n moved into Phase 1 (C8, §Implementation Plan) |
| Public TypeScript contract exists | `lib/types.ts` barrel (W6, §Public TypeScript Contract) |
| Event ids, route paths, DI tokens corrected pre-publish | §Architecture, §API Contracts, §Release 4 Contract Freeze (W1–W3) |

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
| root AGENTS.md | No direct ORM relationships between modules | Compliant | All cross-module references use FK IDs only (`customer_group_id`, `category_id`, `product_id`, `variant_id` — rev, identity change; `delivery_method_code`/`payment_method_code` hidden rule types, D-R4-14) |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | All entities carry `organization_id` + `tenant_id`; all queries scoped accordingly |
| root AGENTS.md | Never expose cross-tenant data from API handlers | Compliant | Cache keys include `tenantId`+`organizationId`; all code lookups scoped by tenant; cart endpoints require tenant scope from auth context |
| root AGENTS.md | Use DI (Awilix) via `di.ts`; avoid `new`-ing directly | Compliant | `di.ts` registers `PromotionCache`, `CodeGenerationService`, `CodeService`; evaluation engine is stateless (no DI needed) |
| root AGENTS.md | Validate all inputs with Zod; place validators in `data/validators.ts` | Compliant | All API inputs and entity creation shapes covered; `tiers` JSONB validated explicitly |
| root AGENTS.md | Derive TS types from Zod via `z.infer` | Compliant | No hand-written type duplicates; all types derived from validators |
| root AGENTS.md | Use `findWithDecryption`/`findOneWithDecryption` | Compliant | Applied in admin detail routes where `Promotion` and `Code` entities are fetched |
| root AGENTS.md | Never hand-write migrations | Compliant | All tables generated via `yarn db:generate` |
| root AGENTS.md | RBAC: `requireAuth` + `requireFeatures` on all admin routes | Compliant | All admin routes declare guards; cart-facing endpoints use the standard API-key identity + `requireFeatures` (rev — C3/D-R4-11, `X-Module-Key` withdrawn) |
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
| root AGENTS.md | Run `yarn generate` after adding module files | Compliant | (rev — `npm run modules:prepare` is not a repo command) Noted in Phase 1 step 14 |
| packages/core/AGENTS.md | Module placed in `packages/core/src/modules/promotions/` | Compliant | Architecture section confirms path |
| packages/core/AGENTS.md | Module ID: plural, snake_case | Compliant | Module ID `promotions` |
| packages/core/AGENTS.md | Event IDs: `module.entity.action` (dot-separated, singular entity, past tense) | Compliant | All events follow `promotions.promotion.created`, `promotions.code.used`, `promotions.generated_code.created` pattern (rev — underscore, W1/D-R4-25; no hyphenated id) |
| packages/core/AGENTS.md | Feature naming: `<module>.<action>` | Compliant | `promotions.view`, `promotions.create`, `promotions.update`, `promotions.delete`, `promotions.codes.manage`, and (rev — W4/D-R4-11) `promotions.evaluate`, `promotions.codes.redeem`, `promotions.usage.manage` for the cart-facing routes; `setup.ts` `defaultRoleFeatures` maps the three new ones to admin only |
| packages/cache/AGENTS.md | Use `@open-mercato/cache`; never raw Redis/SQLite | Compliant | `services/promotion-cache.ts` resolves cache via DI; uses tag-based invalidation |
| packages/queue/AGENTS.md | Background workers use queue contract; never custom queues | Compliant | `workers/code-generation.worker.ts` exports `metadata` with `queue` + `concurrency` |
| packages/events/AGENTS.md | Cache invalidation subscriber uses ephemeral subscription | Compliant | `invalidate-promotion-cache.ts` uses ephemeral subscription (immediate, in-process) |
| packages/search/AGENTS.md | `search.ts` exports `searchConfig` | Compliant | Phase 4 implements `search.ts` for promotions + codes fulltext indexing |
| packages/ui/AGENTS.md | Use `CrudForm` for standard forms; `useGuardedMutation` for non-CrudForm writes | Compliant | Promotion and code forms use `CrudForm`; tree reconciliation (PUT) uses `useGuardedMutation` |
| packages/ui/AGENTS.md | Use `LoadingMessage`/`ErrorMessage` | Compliant | All backend pages use `LoadingMessage`/`ErrorMessage` from `@open-mercato/ui/backend/detail` |
| packages/ui/AGENTS.md | Use `DataTable` for lists | Compliant | Codes list and generated codes panel use `DataTable` |
| root AGENTS.md | Widget injection: declare in `widgets/injection/`, map via `injection-table.ts` | Compliant | 5 injection slots declared in `widgets/injection-table.ts`; external modules inject via the standard widget system |
| root AGENTS.md | Events: use `createModuleEvents()` with `as const` for all emitted events | Compliant | New events (`evaluation.completed`, `code.exhausted`, `promotion.expiring_soon`, `usage.registered`, `usage.reverted`, `promotion.budget_exhausted`) added to `events.ts` following `createModuleEvents()` pattern (rev — underscores, W1/D-R4-25) |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `PromotionExtensionRegistry` holds only plain objects (interfaces); no ORM entities or repositories cross module boundaries through the registry |
| root AGENTS.md | Validate all inputs with Zod | Compliant | Extension `configSchema` is validated at write time via `configSchema.parse(config)` in commands; unknown types are not persisted without validation |

---

## Public TypeScript Contract (rev 9 — new, W6)

`lib/types.ts` exports every type a consumer needs to code against Phases 1–3 without guessing a shape from prose. Phase 2 step 1 of §Implementation Plan creates this file; everything below is additive to the existing `data/validators.ts`-derived entity types.

```typescript
// Identity (D-R4-28)
export interface BuyerContext {
  customerId: string | null        // the winning identity (person wins, D3/D3a)
  customerIds: string[]            // order history, per-customer limits
  customerGroupIds: string[]
}

export interface CodeRef { id: string; type: 'static' | 'dynamic' }

// evaluate (D-R4-9, D-R4-10, D-R4-13, D-R4-21, D-R4-28)
export interface EvaluateItem {
  lineId: string
  productId: string
  variantId: string | null
  quantity: string
  unitPriceNet: string
  unitPriceGross: string
  priceIsPromotional: boolean      // D-R4-16
}

export interface EvaluateInput {
  items: EvaluateItem[]
  currency: string
  evaluatedAt: string              // ISO 8601 — D-R4-13
  buyer: BuyerContext
  customerOrderCount: number | null
  cartWeight: string | null
  codes: CodeRef[]
  deliveryMethodCode?: string | null  // additive, Release 5 D-R5-17 (amends D-R4-14) — present once a caller (checkout) has a selected delivery method
  deliveryCost?: string | null        // additive, same gate as deliveryMethodCode
}

export type EffectBasis = 'net' | 'gross'

export interface ResolvedEffectBase {
  type: 'LINE_DISCOUNT' | 'CART_DISCOUNT' | 'DELIVERY_DISCOUNT' | 'ADD_FREE_ITEM'
  appliesTo: 'order' | 'line' | 'unit'
  currency: string
  label: Record<string, string>
}

export interface LineDiscountEffect extends ResolvedEffectBase {
  type: 'LINE_DISCOUNT'
  targetLineId: string
  targetProductId: string
  targetVariantId: string | null
  lineQuantity: number
  appliedQuantity: number
  amountNet: string                // negative decimal string
  amountGross: string
  basis: EffectBasis                // audit only — D-R4-10
}

export interface CartDiscountEffect extends ResolvedEffectBase {
  type: 'CART_DISCOUNT'
  amountNet: string
  amountGross: string
  basis: EffectBasis
}

export interface DeliveryDiscountEffect extends ResolvedEffectBase {
  type: 'DELIVERY_DISCOUNT'       // Release 5 (D-R5-17, amends D-R4-14): reachable once a caller supplies deliveryMethodCode/deliveryCost
  deliveryMethodCode: string
  amountNet: string
  amountGross: string
  basis: EffectBasis
}

export interface AddFreeItemEffect extends ResolvedEffectBase {
  type: 'ADD_FREE_ITEM'
  productId: string
  variantId: string | null
  quantity: number
  reason: 'FREE_PRODUCT' | 'BUY_X_GET_Y'
  promotionId: string              // D-R4-7 marker, matches cart-module.md CartLine.promotion_id
}

export type ResolvedEffect = LineDiscountEffect | CartDiscountEffect | DeliveryDiscountEffect | AddFreeItemEffect

export interface AppliedPromotion { promotionId: string; promotionName: string; effects: ResolvedEffect[] }
export interface EvaluateResult { appliedPromotions: AppliedPromotion[] }

// Codes (C4/C7/D-R4-8)
export interface ReserveCodeInput { codeString: string; cartId: string; customerId: string | null }
export interface CodeReservationResult { ok: true; codeId: string; type: 'static' | 'dynamic' }
export interface CodeValidationResult { valid: boolean; reason?: string }
// `orderId` is additive (rev — Release 5 C5): optional because nothing calls `useCode`
// yet, but checkout's Phase 4 submit sequence calls it AFTER document creation (§C19),
// so the order already exists and can be recorded for a later `revertCodeUse`.
export interface UseCodeInput { codeId: string; codeString: string; cartId: string; orderId?: string | null; customerId: string | null; type: 'static' | 'dynamic' }
export interface CodeUseResult { ok: true }

// Reversal (rev — Release 5 C5, additive). At least one of `cartId`/`orderId` is
// required; either locates the `CodeUsage` row(s) `useCode` wrote.
export interface RevertCodeUseInput { cartId?: string; orderId?: string }
export interface RevertCodeUseResult { ok: true; revertedCount: number }

// Usage (D-R4-12, D-R4-26)
export interface RegisterUsageInput {
  orderId: string
  orderType: 'order' | 'quote' | 'pos_cart'
  customerId: string | null
  currency: string
  appliedPromotions: AppliedPromotion[]
}
export interface RevertUsageInput { orderId: string }

// Primary integration facade (Amendment §A.2)
export interface PromotionsService {
  evaluate(input: EvaluateInput): Promise<EvaluateResult>
  evaluateForProduct(input: { productId: string; variantId: string | null; buyer: BuyerContext; evaluatedAt: string }): Promise<{ badges: Array<{ promotionId: string; promotionName: string; label: Record<string, string> }> }>
  reserveCode(input: ReserveCodeInput): Promise<CodeReservationResult>
  extendReservation(codeId: string, cartId: string): Promise<void>
  validateCode(input: ReserveCodeInput): Promise<CodeValidationResult>
  useCode(input: UseCodeInput): Promise<CodeUseResult>
  releaseCode(codeId: string, cartId: string): Promise<void>
  revertCodeUse(input: RevertCodeUseInput): Promise<RevertCodeUseResult>   // rev — Release 5 C5, additive
  registerUsage(input: RegisterUsageInput): Promise<{ ok: true; budgetExceeded: string[] }>
  revertUsage(input: RevertUsageInput): Promise<{ ok: true; revertedCount: number }>
}
```

`cart` imports these types from `@open-mercato/core/modules/promotions/lib/types` (or the package path this repo's import convention uses for cross-module types); it never re-declares a shadow copy.

## Release 4 Contract Freeze (rev 9 — new, missing BC section per the Release 4 analysis §"Missing BC Section")

Everything below becomes **STABLE** per `BACKWARD_COMPATIBILITY.md` the moment Phase 1 ships. Getting the name right now is cheaper than a deprecation cycle later.

| Surface | Frozen names |
|---|---|
| Event ids | `promotions.promotion.{created,updated,deleted}`, `promotions.code.{created,updated,deleted,used,exhausted,generated}`, `promotions.generated_code.created`, `promotions.usage.{registered,reverted}`, `promotions.promotion.budget_exhausted`, `promotions.promotion.expiring_soon` (Phase 4), `promotions.evaluation.completed` (ephemeral/telemetry, never persisted/broadcast) |
| DI tokens | `promotionsService`, `promotionCache`, `promotionUsageService`, `promotionCodeService`, `promotionCodeGenerationService`, `promotionExtensionRegistry` (Phase 5) |
| ACL features | `promotions.view`, `.create`, `.update`, `.delete`, `.codes.manage`, `.evaluate`, `.codes.redeem`, `.usage.manage` |
| Route paths | `/api/promotions`, `/api/promotions/[id]`, `/api/promotions/[id]/tree`, `/api/promotions/order`, `/api/promotions/codes*`, `/api/promotions/evaluate`, `/api/promotions/product-page`, `/api/promotions/dynamic-labels`, `/api/promotions/free-products`, `/api/promotions/usage/{register,revert}` |
| Public types | Every export in `lib/types.ts` above, in particular `ResolvedEffect`'s discriminated union shape (`amountNet`/`amountGross`/`basis` on every variant) |
| Tables | `promotions`, `promotion_rule_groups`, `promotion_rules`, `promotion_benefits`, `promotion_codes`, `promotion_generated_codes`, `promotion_code_reservations`, `promotion_usages` |
| Module id | `promotions` (plural, standard) |

Additive-only, requiring the multi-module owner approval already recorded for D-R4-3: the new `catalog` DI keys `catalogBuyerPricingService`, `catalogScopedProductService`, and the `availability` quantity-rule derivation `cart` and this module both consume.

---

## Amendment — 2026-08-14: Alignment with the `cart` Module

This section is normative. Where it conflicts with *API Contracts → Cart-Facing Endpoints*, this section wins.

### A.1 What changed underneath this spec

Version 1.0 assumed the cart lived outside the platform: endpoints authenticated by `X-Module-Key`, items addressed by `sku`, prices passed in as decimal strings, and the caller responsible for applying returned effects. That was the right design for an unknown external caller.

The platform now has [`cart`](./2026-08-14-cart-module.md), an in-process module that owns baskets for the storefront, POS, pay links and AI agents. It calls promotions on every mutation and hands the resolved effects to `salesCalculationService`. Three consequences follow.

### A.2 The primary integration is a DI service, not HTTP

`promotions/di.ts` registers `promotionsService` under the DI token `promotionsService` (rev — W3). **The full, current type is `lib/types.ts`'s `PromotionsService` (§Public TypeScript Contract) — that is the normative signature as of rev 9; the block below is kept only as the historical shape this amendment originally introduced, for anyone diffing against an older copy of this document.**

```typescript
// Superseded 2026-10-14 by lib/types.ts's PromotionsService/EvaluateInput (§Public TypeScript Contract) —
// kept for history. The current input is addressed by productId/variantId, never sku (D-R4-21);
// uses BuyerContext identity (D-R4-28); carries evaluatedAt (D-R4-13); and codes:{id,type}[] (unchanged shape, now normative).
export type PromotionEvaluationInput_v1 = {
  cart: CartContext              // §Extensible Cart Context, extended per A.4 — superseded, see note
  codes: Array<{ id: string; type: 'static' | 'dynamic' }>
  buyer: {
    customerId: string | null
    customerGroupIds: string[]   // priority-ordered; see spec 1 §3.2
    customerUserId: string | null
    channelId: string | null
  }
}
```

**Fixed 2026-08-17**: the interface originally omitted `validateCode` and `useCode` — two of the seven cart-facing routes renamed in §A.3 had no DI method, which directly contradicted the "in-process callers MUST use the service" rule below for those two operations. Every renamed route now has a matching method; `codes/validate` and `codes/use` (§A.3) are the HTTP adapters over `validateCode`/`useCode`, same as the other five.

The HTTP endpoints remain, unchanged in behaviour, for genuinely external carts — a third-party storefront or a legacy shop integrating against Open Mercato. They become a thin adapter over the same service rather than the only door.

**In-process callers MUST use the service.** Routing an in-process call through HTTP would lose the request-scoped container, the transaction and the tenant scope, and would re-serialize a cart the callee could read directly. `cart` is the primary in-process caller for `evaluate`/`reserveCode`/`releaseCode`, but `useCode`/`registerUsage`/`revertUsage` are architecturally destined to be called by `checkout` (spec 7, not yet written) at order confirmation/cancellation — this service is available to any in-process module, not only `cart`.

### A.2a Command pattern (fixed 2026-08-17)

`reserveCode`, `releaseCode`, `useCode`, `registerUsage` and `revertUsage` are all financially or budget consequential writes — root `AGENTS.md`'s "implement domain writes through commands" rule applies to them the same as to `Promotion`/`Code` CRUD, which already go through commands. Each is implemented as a registered command (`promotions.code.reserve`, `.release`, `.use`, `.usage.register`, `.usage.revert`), wrapping the existing serializable-transaction logic described in *Code Lifecycle* / *Promotion Usage Lifecycle* rather than replacing it — the transaction boundary and budget re-check stay exactly as specified there. `evaluate`/`evaluateForProduct` remain plain reads with no command wrapping, since they mutate nothing.

### A.2b Dependency direction (fixed 2026-08-17)

`cart` depends on `promotions` as a **hard** dependency, not an optional peer resolved via `tryResolve` (contrast with `wms`/`availability`, which are genuinely optional). Every cart mutation that changes lines or quantities calls `promotionsService.evaluate()` (§A.1); there is no meaningful "cart without a promotions engine" mode the way there is a "storefront without WMS" mode — an empty promotion set is simply the normal case when no promotions are configured, not an absent-module fallback. `cart`'s module manifest declares `requires: ['promotions']` accordingly.

### A.3 Namespace move — breaking, and necessary

The cart-facing endpoints move. **Fixed 2026-08-17**: this table originally listed a route (`remove-code`) that does not exist anywhere else in this document — the real route is `delete-code` — and omitted two real cart-facing routes (`validate-code`, `use-code`) entirely, which would have left them under `/api/cart/*` and defeated the whole point of this section. Corrected to cover all seven cart-facing routes actually defined in *API Contracts*:

| Was | Becomes |
|---|---|
| `POST /api/cart/apply-promotion` | `POST /api/promotions/evaluate` |
| `POST /api/cart/add-code` | `POST /api/promotions/codes/reserve` |
| `POST /api/cart/validate-code` | `POST /api/promotions/codes/validate` |
| `POST /api/cart/use-code` | `POST /api/promotions/codes/use` |
| `POST /api/cart/delete-code` | `POST /api/promotions/codes/release` |
| `POST /api/cart/register-usage` | `POST /api/promotions/usage/register` |
| `POST /api/cart/revert-usage` | `POST /api/promotions/usage/revert` |

`/api/cart/*` belongs to the `cart` module (roadmap §9). Two modules serving one namespace would make route ownership ambiguous and would collide outright — `cart` defines `POST /api/cart/carts/:token/promotions`.

Nothing is deployed under the old paths, so this is a specification change and no deprecation protocol is triggered. Had they shipped, the old paths would need a redirect for one minor version.

**This table is the single source of truth for these seven routes.** Every other section of this document — module file structure, *API Contracts* headers, the implementation plan — must read the `/api/promotions/*` path on the right, not the `/api/cart/*` path on the left; occurrences of the old paths elsewhere in this document that were not updated in this pass are a defect, not an alternative.

### A.4 Items are addressed by id, never by SKU (rev 9 — superseded)

**Superseded 2026-10-14 (D-R4-21/C11).** This section originally added `productId`/`variantId`/`cartLineId` fields alongside a retained `sku`, for "external callers [who] may have nothing else." Release 4 drops that retention: `EvaluateInput.items[]` (§Public TypeScript Contract) is addressed by `lineId`/`productId`/`variantId` only — there is no `sku` field anywhere in the Release 4 evaluate contract, and no SKU-keyed rule config (`row_total.sku`, `product.sku`, `category.category_slug`, `producer`) ships either (§Data Models' Release-4 rule set). An external, non-`cart` caller integrating against this API supplies ids the same way `cart` does; a SKU-only integration is not supported in this release. `targetCartLineId` is likewise superseded by `targetLineId` (§API Contracts, §Public TypeScript Contract) — the rename from "cart line" to "line" reflects that the id is the caller's own, not necessarily a `cart`-module `CartLine.id`.

`customerGroupIds` (via `BuyerContext`, D-R4-28) and the `customer_group` rule type are unaffected by this supersession and remain as originally added here — matching on set membership is still how a wholesale-only promotion is expressed, without listing customer ids individually. `taxMode`/`storeId` as standalone `CartContext` fields are also superseded: tax basis is now carried per-amount (`amountNet`/`amountGross`, A.5 below) rather than signalled once via `taxMode`, and `storeId`/per-store campaigns are not part of the Release 4 rule set (no rule reads it).

### A.5 Effects map onto `SalesAdjustmentDraft` and `SalesLineSnapshot` (rev 9 — superseded; current contract is §API Contracts + B.6)

**Superseded 2026-10-14 (C5/D-R4-10, and by Amendment §B.6 below for the line-targeted case).** The original mapping used a single `amount` plus a `basis: 'net' | 'gross'` flag, with `salesCalculationService` expected to apply tax to convert sides. That flag alone cannot do it correctly for an order-scoped discount — `resolveAdjustmentAmounts` on `develop` falls back to `net = gross` (and vice versa) when only one side is supplied, silently misapportioning tax. Release 4's `ResolvedEffect` carries **both** `amountNet` and `amountGross` directly (D-R4-10): the engine computes both sides itself, from the same per-item `unitPriceNet`/`unitPriceGross` it was given, and `cart` consumes whichever side `salesCalculationService` needs without ever deriving one from the other. `basis` survives only as an audit-trail field, never the thing a consumer branches on.

Order-scope effects (`CART_DISCOUNT`; `DELIVERY_DISCOUNT`, reachable as of Release 5/D-R5-17 but not yet mapped here — see §Resolution table above) still map to `SalesAdjustmentDraft` with `scope: 'order'`, `amountNet`/`amountGross` from the effect. Line-scope effects (`LINE_DISCOUNT`) do **not** map to a `SalesAdjustmentDraft` at all — `sales` still rejects a line-attributed draft (`"Line-scoped adjustments are not supported yet."`) — they map to `SalesLineSnapshot.discountAmount` with `discountAmountBasis: 'line'`, taken from `amountNet` **as-is**, never divided. This is Amendment §B.6's rule, restated normatively here because this section is where a reader lands first; §B.6 is the section with the full derivation and the arithmetic showing why the old per-unit-division reading (introduced 2026-09-09, superseded 2026-10-14) does not match `sales` as shipped.

`ADD_FREE_ITEM` does not map to an adjustment or a snapshot discount — it instructs `cart` to insert a `CartLine` with `origin: 'promotion'` and `promotion_id` set to this effect's `promotionId` (rev — D-R4-7, replacing the `added_by: 'merge'` language, which predates `cart` rev 7's `added_by_actor_type` rename). Such a line is **excluded from the next evaluation's eligibility computation** (sent to `evaluate` with nothing that would let it re-trigger its own promotion), or a buy-2-get-1 promotion re-triggers on its own free item and loops. This exclusion is an explicit invariant, tested (`TC-PROM-053`).

### A.6 Code reservations follow the cart's lifecycle (rev 9 — mechanism corrected, same obligations)

`CodeReservation` carries `cart_id` **in its unique key** (`UNIQUE (code_id, cart_id)` — rev, C4/C7/D-R4-8; the original text said merely "gains `cart_id`" without saying the key changed, which left the single-use-per-customer bug the key was supposed to fix unfixed). Reservations are released when:

- the code is removed from the cart
- the cart is abandoned (ahead of full expiry — a 30-day cart holding a limited code for 30 days exhausts a campaign against baskets nobody bought)
- the cart expires
- the cart is merged and the target cart already holds the code

Reservation TTL is independent of and shorter than cart TTL. `cart`'s expiry sweeper calls `codes/release`; `promotions` also sweeps independently (`services/code-reservation-sweeper.ts`, §Implementation Plan Phase 3 step 7), because a reservation must not depend on another module's job succeeding.

### A.7 Evaluation cost

`cart` evaluates on every line mutation. Two obligations follow:

1. **Batch mutations evaluate once.** `POST /api/cart/current/lines/bulk` (rev — path per `cart-module.md` rev 9 §10) results in a single `evaluate` call. A 50-line B2B quick order must not run 50 passes.
2. **Latency budget:** P95 under 150 ms for a 50-line cart against 200 active promotions. Measured at the Phase 2 gate of this module (engine-only) and re-measured end-to-end at the `cart` module's own Phase 3 release gate. If the three-pass engine cannot meet it, the mitigation is a narrowed candidate set from the cache build — not caching the evaluation result, which depends on the whole cart and would key on the cart itself.

### A.8 Risks added

| # | Risk | Severity | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| A-R1 | Discount basis confusion | **High** | An order-scoped effect supplies only one side; `sales`-side code reuses it for the other, charging tax on an already-taxed discount. Every promoted order is mispriced. | Every amount-carrying effect carries **both** `amountNet` and `amountGross` directly (rev — C5/D-R4-10, replacing the single `amount`+`basis`-flag model); a property test asserts cart totals with promotions equal order totals with the same promotions | Low |
| A-R2 | Free-item feedback loop | **High** | A buy-2-get-1 free item counts toward its own trigger; each evaluation adds another free item until a cap or a timeout. | Promotion-inserted lines excluded from eligibility (A.5), tested explicitly; a per-evaluation cap on inserted items as a backstop | Low |
| A-R3 | Line targeting collision | Medium | Two lines share a product with different configurations; a discount lands on the wrong line or twice. | `targetLineId` (rev — never `sku`, A.4) | Low |
| A-R4 | Reservation leak across cart lifetime | Medium | Abandoned carts hold single-use codes; a limited campaign exhausts against baskets nobody bought. Two carts holding the same code could previously both pass a per-customer check. | Independent shorter reservation TTL; release on abandonment; both modules sweep; `(code_id, cart_id)` key gives each cart its own capacity (rev — C7/D-R4-8, A.6) | Low |
| A-R5 | Evaluation latency on bulk B2B carts | Medium | 50-line quick order × 200 promotions blocks the mutation response. | Single evaluation per batch; latency budget gated (A.7) | Medium — depends on engine performance, measured before Phase 2 exit |
| A-R6 | Budget enforcement loses isolation under an ambient transaction | **High** | `registerUsage` called inside `checkout`'s own order transaction silently drops any serializable-isolation assumption; concurrent orders jointly overshoot `max_budget` with no retry path. | Row lock (`SELECT … FOR UPDATE`) + re-read-sum inside the (possibly ambient) transaction — correct regardless of isolation level, no retry loop (rev — C6/D-R4-12) | Low |

### A.9 Additional test cases

- `TC-PROM-050` — In-process `promotionsService.evaluate` and `POST /api/promotions/evaluate` return identical effects for the same context
- `TC-PROM-051` — `customer_group` rule matches on set membership, including a buyer in several groups
- `TC-PROM-052` — Every amount-carrying effect carries both `amountNet` and `amountGross`, each independently correct; cart totals with promotions equal order totals with the same promotions (A-R1, rev — replaces the single-`basis`-field assertion)
- `TC-PROM-053` — A promotion-inserted free line does not count toward its own trigger across three consecutive evaluations (A-R2)
- `TC-PROM-054` — Two lines with the same product and different `configuration` receive independent line discounts, addressed by `targetLineId` (A-R3, rev — never `targetSku`)
- `TC-PROM-055` — Reservation released on cart abandonment, expiry, code removal, and merge into a cart already holding the code (A-R4)
- `TC-PROM-056` — A 100-line bulk add triggers exactly one evaluation (A.7)
- `TC-PROM-057` — 50-line cart against 200 active promotions evaluates within the P95 budget
- `TC-PROM-050b`–`056` (rev — C6/D-R4-12, A-R6) — N concurrent `registerUsage` calls against one promotion inside one ambient transaction never jointly exceed `max_budget`; N concurrent `codes/use` calls for one single-use code, exactly one succeeds

---

## Amendment — 2026-09-07: Benefit application target and quantity caps

> Normative over §*Data Models — Benefit*, §*Cart-Facing Endpoints — Resolved Effect Types*, and the `LINE_DISCOUNT` row of §A.5. The affected tables in the body of this spec have been updated in place; this section records why.

### B.1 What was missing

A benefit never stated what it was applied to. The target was implied by `benefit_type` and written down nowhere, so three questions an operator asks on day one had no answer in this document:

1. *Is this discount on the whole order, on a line, or on each piece?* Implied per type, unqueryable, and invisible to `cart`, which has to map the effect without being told.
2. *Can I cap it at the first 5 pieces?* `product_discount` carried `pcs_limit` described in a single sentence — "caps the total number of items that receive the discount regardless of `selector`" — that never said whether the count is per line, per cart, or per satisfied rule. `tiered_discount` had no such field at all.
3. *Which 5 pieces?* `selector` orders only by price (`nth` is explicitly "1-indexed in ascending price order"), so "the first five" — the reading almost every operator intends — was not expressible at all.

Two smaller defects fell out of the same hole. `tiered_discount` carried `scope: cart|line` while `product_discount` carried `pcs_limit`: the same business decision, split across two field names on two types. And `delivery_discount.scope` was declared `scope text` with its value set defined nowhere in this document — a field no implementer could have built.

### B.2 `applies_to` is a column, not a config field

The three targets are `order`, `line` and `unit`. `line` and `unit` differ in what a cap consumes: under `line` a cap spends whole lines and a line is covered entirely or not at all; under `unit` a cap spends individual units and a line may be partially covered. "20% off, max 5 pieces" against a single line of 8 therefore discounts 5 units under `unit` and nothing under `line` — a difference worth making the operator state.

It is stored as a column rather than inside `config` for two reasons that outweigh the consistency cost of breaking the "everything type-specific lives in the JSONB" pattern. First, `applies_to` decides the shape of the resolved effect and therefore how `cart` hands it to `salesCalculationService`; core must read it for extension benefit types whose `config` schema core does not own. Second, a field common to every variant of a Zod discriminated union is exactly the field a discriminated union models badly — it would have to be repeated in six schemas and could drift in any of them.

### B.3 The quantity budget is cart-wide and lives in Pass 3

`max_quantity` and `max_lines` count **across the whole cart per benefit invocation**. Per-line counting was rejected: a buyer defeats it by splitting a purchase across lines, and with configurable products the lines split on their own, so the cap would loosen for reasons unrelated to intent. Per-application counting (the `buy_x_get_y.max_applications` model) was rejected for the general case because a cap that resets on every trigger rarely binds, which is indistinguishable from having no cap while looking like one in the admin UI.

The consequence for the engine is structural, not cosmetic: a cart-wide budget cannot be enforced inside a per-line loop. `resolveEffects` orders every qualifying unit or line for the benefit first, then walks that order spending the budget. This is why the budget is drawn at Pass 3 in §*Evaluation Engine Data Flow* and not at the point where each line's amount is computed.

### B.4 Ordering is configured, never defaulted

`selector` is **required whenever `max_quantity` or `max_lines` is set**. There is deliberately no default. "The first 5 pieces" and "the 5 most expensive pieces" are different promotions with different costs against the same cart, and choosing silently for the operator is how a campaign overspends without anyone having decided anything. A capped config without a selector is a 422 at the write path, and the admin form must not let an operator reach that state.

On an uncapped benefit `selector: null` is read as `all` — there is no budget to spend, so every qualifying unit is covered and the ordering is irrelevant. `all` remains a distinct, explicitly stored value so an operator can state the intent; the two behave identically and both are rejected the moment a cap is added without the operator revisiting the selector.

`cart_order` is added to the selector value set for the literal "first N added" reading. Ties break on `lineId` ascending (rev — not `cartLineId`) then unit index, so re-evaluating an unchanged cart returns byte-identical effects — a property the cart relies on to avoid spurious total changes between two reads of the same basket.

### B.5 `LINE_DISCOUNT` becomes quantity-aware

The effect gains `appliesTo`, `lineQuantity`, `appliedQuantity` and `unitAmount` alongside the existing `amount`. A partially covered line stays **one** effect: emitting one effect per unit (the Sylius `OrderItemUnit` model) would have broken the existing "one `LINE_DISCOUNT` per SKU per promotion" invariant and turned a 50-unit line into 50 entries in every evaluation response.

Without `appliedQuantity` the coverage is unrecoverable downstream. The cart cannot render *"5 of 8 pieces −20%"*, and a return of one piece has no basis on which to decide how much discount to reverse — the same total is consistent with 5 units at −2.40 and 8 units at −1.50.

### B.6 Mapping into `sales` — supersedes the `LINE_DISCOUNT` row of §A.5 (rev 9 — rewritten 2026-10-14, C1/D-R4-9; the 2026-09-09 fix below is itself superseded)

**What changed underneath this section a second time.** The 2026-09-09 fix (preserved below for history) corrected a draft that assumed `sales` had no discount-basis concept at all and so divided the effect's total across the line's units. That assumption was already false by the time of writing: `SalesLineSnapshot.discountAmountBasis?: 'unit' | 'line'` and `resolveLineDiscountTotal` shipped in `#5640` (merged 2026-08-28, before the 2026-09-09 edit), and the 2026-09-09 text asserted the opposite — that neither identifier "occurs nowhere" — which the Release 4 pre-implementation analysis found to be the stale claim it was. Followed as written, `cart` would have implemented a workaround for a problem `sales` had already solved, reintroducing the exact sub-cent residual the 2026-09-09 fix was written to avoid (`10.00 / 3 → 3.3333 × 3 = 9.9999`), on a figure that `sales` itself does not produce when given the basis flag directly.

**Resolution (current, normative).** Promotion effects split by target rather than travelling as one kind:

| Effect | Carried as |
|--------|-----------|
| `LINE_DISCOUNT` (`appliesTo: 'line'` or `'unit'`) | `SalesLineSnapshot.discountAmount` on the matching line, with `discountAmountBasis: 'line'`, set to `\|amountNet\|` **taken as-is — never divided by `lineQuantity` or `appliedQuantity`** |
| `CART_DISCOUNT` (`appliesTo: 'order'`) | `SalesAdjustmentDraft` with `scope: 'order'`, carrying `amountNet`/`amountGross` directly (§A.5) |
| `DELIVERY_DISCOUNT` | Unreachable in Release 4 (D-R4-14). Reachable from `evaluate` as of Release 5 (D-R5-17), but **not yet mapped anywhere** — per D-R5-17 the discount must reach an order as an adjustment on the shipping charge `sales` computes, never via promotions arithmetic; that adjustment-mapping is checkout/sales integration work, not this amendment's scope |
| `ADD_FREE_ITEM` | A new `CartLine` with `origin: 'promotion'` + `promotion_id` (§A.5, D-R4-7) |

Three rules bind `cart` here, each of them a mispriced order if broken. **Their normative home is the `cart` module spec (§3.2, rev 9), not this document** — they constrain `cart`'s implementation, and a promotions amendment does not get to legislate another module's code any more than it gets to legislate `sales`'s (§B.7). They are restated here because this section is where a reader checking the promotions-side contract lands first:

1. **`discountAmount = |amountNet|`, `discountAmountBasis: 'line'`, `discountPercent` never set.** `buildBaseLineResult`'s basis-aware branch (`packages/core/src/modules/sales/lib/calculations.ts:97-116`, `resolveLineDiscountTotal`) consumes a line-total discount directly when `discountAmountBasis` is `'line'` — there is no division step to get wrong, because the shipped contract already expects the total, not a per-unit figure. A benefit covering 5 of 8 units at −2.40 net has `amountNet: "-12.00"`; `cart` assigns `discountAmount: 12.00, discountAmountBasis: 'line'` and `sales` reproduces exactly 12.00. Setting `discountPercent` on a promotion-sourced line is a write-path error (never do it) — `sales/data/validators.ts:345` has it win over `discountAmount` when both are present, silently discarding the resolved figure. The old per-unit-division reading (`|amount| / lineQuantity`, assign to a basis-less field) matched no `sales` API that has ever existed on `develop`; it is withdrawn rather than corrected, because there is no "corrected" version of a mapping that never needed to exist.
2. **`amountNet`/`amountGross` are already both present on the effect (A.5, D-R4-10)** — there is no basis-conversion step for `cart` to perform here. It takes `amountNet` as the magnitude (absolute value) directly; the days of deriving one side from the other inside `cart` ended with A.5's supersession.
3. **Sum, then record.** `SalesLineSnapshot.discountAmount` is one scalar per line. Several cumulative promotions discounting the same line sum into it; per-promotion attribution does not survive the mapping — it lives in `PromotionUsage.effects_snapshot` instead.

No sub-cent residual exists under this mapping: the line-total basis is a single assignment, not a divide-then-remultiply round trip, so there is nothing for 4 dp rounding to disturb between the effect and the document. `cart-module.md`'s release invariant (§3.2 rev 9) is defined independently of this residual question, against `quote`/`order` document-total equality — the residual this section used to excuse no longer needs excusing.

<details>
<summary>Historical: the 2026-09-09 fix, now superseded</summary>

§A.5 mapped `LINE_DISCOUNT` onto `SalesAdjustmentDraft` with `scope: 'line'`. That mapping does not work against the `sales` module as implemented:

- `SalesAdjustmentDraft` (`packages/core/src/modules/sales/lib/types.ts`) has no line reference at all. `scope: 'line'` is accepted, but nothing on the draft says *which* line.
- The persisted entities do have one — `SalesOrderAdjustment.order_line_id` and `SalesQuoteAdjustment.quote_line_id` — so the schema was never the obstacle.
- The command path closes the gap in the other direction: `createAdjustmentDraftFromInput` in `packages/core/src/modules/sales/commands/documents.ts` throws `400 "Line-scoped adjustments are not supported yet."` when a line-scoped adjustment arrives *with* a line reference.

So the §A.5 mapping either fails with a 400 or succeeds having silently detached the discount from its line. Neither is acceptable for a per-line, let alone per-unit, promotion.

The 2026-09-09 resolution assigned `discountAmount = |amount| / lineQuantity` to a `SalesLineSnapshot.discountAmount` it believed carried no basis flag, with a stated sub-cent residual whenever `lineQuantity` did not divide the total evenly. This was superseded 2026-10-14 once the Release 4 analysis established that `discountAmountBasis: 'line'` already existed on `develop` and made the division (and its residual) both unnecessary and wrong against the shipped API — see the normative resolution above.

</details>

The cost of (3) is stated plainly because it is real: a promoted line shows its discount in the total but not which campaigns produced it, so the per-promotion audit trail lives only in `PromotionUsage.effects_snapshot`, which §*Promotion Usage Lifecycle* already writes at order confirmation. The clamp in `sales` (`Math.min(discountTotal, netSubtotalBeforeDiscount)`) also means a discount exceeding the line silently truncates rather than erroring; promotions must not rely on it as a guard, and `max_discount` remains the intended bound.

### B.7 What is deliberately not fixed here

Giving `SalesAdjustmentDraft` a `lineId` and teaching `documents.ts` to persist line-attributed adjustments is the better long-term answer: it would restore per-promotion attribution on the line and light up the `order_line_id` column that already exists. It is **out of scope for this amendment** and belongs in its own spec against the `sales` module, for a reason of blast radius rather than difficulty — `sales` is shipped code with live orders, quotes and returns reading these drafts, whereas `promotions` and `cart` are both greenfield. A change to a shipped module's calculation contract should not ride along inside a promotions amendment.

Until that spec exists, §B.6 is the mapping. It is a contraction of ambition, not a workaround with a hidden failure mode: totals are correct, caps are honoured, and the only loss is per-promotion attribution on the line, which is recorded elsewhere.

### B.8 Risks added

| # | Risk | Severity | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| A-R6 | Line-total discount mis-mapped | **High** (rev — mechanism changed 2026-10-14, risk unchanged) | A future edit reintroduces per-unit division (`\|amountNet\| / lineQuantity`) against the now-shipped line-total contract, or sets `discountPercent` beside `discountAmount` and silently discards the resolved figure. | `discountAmount = \|amountNet\|`, `discountAmountBasis: 'line'`, unconditionally, `discountPercent` never set (B.6, rev); `TC-PROM-060` asserts the partially covered line's document total against the single correct mapping and against the withdrawn per-unit one, so a regression fails the suite | Low |
| A-R7 | Ambiguous cap ordering | Medium | An operator caps at 5 pieces without stating which 5; the engine picks, and a campaign costed against the cheapest units is billed against the most expensive. | `selector` required whenever a cap is set, rejected at the write path, and unreachable in the admin form (B.4) | Low |
| A-R8 | Cap loosened by line splitting | Medium | A cap counted per line is defeated by splitting a purchase across lines — which configurable products do on their own, without the buyer intending it. | Cart-wide budget held in `resolveEffects` (B.3), tested against a multi-line cart of one product (`TC-PROM-059`) | Low |

### B.9 Additional test cases

- `TC-PROM-058` — `max_quantity: 5` with `selector: cart_order` on an 8-unit line under `applies_to: 'unit'` returns one effect with `appliedQuantity: 5`, `lineQuantity: 8`, and `amountNet`/`amountGross` equal to the resolved total for those 5 units (rev — no `unitAmount` field exists in the Release 4 model to cross-check against; the effect reports only the row total)
- `TC-PROM-059` — The same benefit against three lines of the same product at four units each discounts five units **in total** across lines, not five per line (A-R8)
- `TC-PROM-060` — A partially covered line mapped through `cart` produces a document total equal to `unitPriceNet × quantity − |amountNet|` (rev — C1/D-R4-9, replacing the three-direction assertion against a withdrawn per-unit mapping). Asserted against the correct mapping (`discountAmount = |amountNet|`, matches) and against the withdrawn per-unit mapping (`discountAmount = |amountNet| / lineQuantity`, which would now **under**-discount, the inverse of the old over-discount failure) so a regression to either wrong shape fails the suite. Concretely — 8 units at 25.00 net (200.00), effect `amountNet: "-12.00"` for 5 covered units — the expected total is 188.00; the withdrawn per-unit mapping would give `200.00 − 12.00/8×8 = 188.00` by coincidence at full-line coverage but diverges the moment coverage is partial, which is exactly this fixture's point. **Owned by the `cart` module's suite** — it exercises `cart`'s mapping and `sales`'s arithmetic, not the promotions engine; listed here so A-R6 has a visible mitigation
- `TC-PROM-061` — `applies_to: 'line'` with `max_quantity: 5` against a single 8-unit line applies **nothing** — a line cannot be split under that target
- `TC-PROM-062` — A benefit config with `max_quantity` and no `selector` is rejected 422 at the write path (A-R7); `selector: all` with a cap is rejected likewise
- `TC-PROM-063` — `quantity_step: 3` with `max_quantity: 5` discounts 3 units, not 5: a remainder smaller than a whole block is not discounted
- `TC-PROM-064` — Determinism, tested at the level where it is observable: a unit test on `selectUnits` asserts that two calls with the same benefit and cart return the same `UnitSelection` — same lines, same order, same `appliedQuantity` per line — including when two lines tie on unit price. The evaluation-level assertion is the weaker "two evaluations return identical effects"; *which* units were selected is not recoverable from the effect payload by design (§B.5), so it must be asserted against the helper, not the response
- `TC-PROM-065` — `max_quantity` and `max_discount` compose, with concrete figures in both directions (rev — no `unitAmount` back-solve; `amountNet` is capped directly). Cart: one line, 10 units at 20.00 net, benefit `value: "50%"`, `applies_to: 'unit'`, `selector: cart_order`. (a) `max_quantity: 4`, `max_discount: "100"` → the quantity cap binds first: `appliedQuantity: 4`, `amountNet: "-40.00"`. (b) `max_quantity: 8`, `max_discount: "50"` → the money cap binds: `appliedQuantity: 8` (unchanged — the cap reduces the amount granted, not the units covered), `amountNet: "-50.00"` (capped from the raw −80.00)
- `TC-PROM-070` — `max_lines: 2` against a cart of four qualifying lines discounts exactly two lines, chosen by `selector`, with `max_quantity` unset; and `max_lines: 2` combined with `max_quantity: 5` stops at whichever binds first
- `TC-PROM-071` — Every write-path rejection in the §Data Models rejection table returns 422: a cap on an `order`-target benefit, `selector: nth` with `max_quantity`, `nth` without `nth_position`, `nth_position` without `nth`, and `quantity_step` under `applies_to: 'line'`
- `TC-PROM-072` — A `buy_x_get_y` whose final application cannot be funded in full by the remaining `max_quantity` budget grants that application **not at all** rather than pro-rating it (§B.3)
- `TC-PROM-066` — `amountNet` and `amountGross` are each independently correct for a benefit configured against a tax-inclusive unit price (rev — replaces the single-`basis`-conversion assertion, A.5/B.6). The cart-equals-order totals assertion is `TC-PROM-052`'s and is not repeated here
- `TC-PROM-067` — The `applies_to` allow-list is enforced, not merely documented: `cart_discount` with `applies_to: 'unit'` and `product_discount` with `applies_to: 'order'` are both rejected 422 at the write path. The same check runs for an extension benefit type against its declared `supportedAppliesTo`, reading only the registry entry and never the extension's `config` (B.2)
- `TC-PROM-068` — Two cumulative promotions discounting the same line sum into that line's single `discountAmount`, and both remain individually recoverable from `PromotionUsage.effects_snapshot` after order confirmation (B.6 rule 3)
- `TC-PROM-069` — A `buy_x_get_y` benefit with a 100%-off reward emits `ADD_FREE_ITEM` rather than a `LINE_DISCOUNT`, whatever its `applies_to`, and the inserted line is excluded from the next evaluation's eligibility (B.2, reinforcing `TC-PROM-053`)

### B.10 Market reference

The shape follows the consensus of the established engines rather than inventing one. Magento 2 cart price rules carry `discount_qty` ("Maximum Qty Discount is Applied To") and `discount_step` ("Discount Qty Step") as first-class columns beside the action type — `max_quantity` and `quantity_step` are those fields under project naming. Shopify's discount API separates the allocation method (`ACROSS` the order vs `EACH` entitled item) from the entitled quantity, which is the `applies_to` / `max_quantity` split. Medusa carries the same distinction as `allocation: 'total' | 'item'`.

The one place this spec diverges is Sylius, whose unit-level actions attach an adjustment to every `OrderItemUnit` individually. That is the most faithful model for partial returns, and it is rejected here for the reason in B.5: it would break an existing invariant and fan a large B2B line out into hundreds of effects per evaluation. `appliedQuantity` on a single effect preserves what the fan-out was for — knowing how many units were covered — at a fraction of the payload.

---

## Changelog

| Date | Version | Summary |
|------|---------|---------|
| 2026-02-23 | 1.0.0 | Initial spec — domain model, three-pass evaluation engine, cart API, admin UI, code system, 4-phase implementation plan |
| 2026-02-24 | 1.1.0 | Replace 15 concrete rule tables + 6 concrete benefit tables with JSONB approach: `promotion_rules.rule_type + config jsonb` and `promotion_benefits.benefit_type + config jsonb`. Aligns with `condition_expression` pattern in `business_rules` and `workflows`. Normalization step now maps rows directly to `{ type, config }` shape. Config per type validated by Zod discriminated union. |
| 2026-02-24 | 1.2.0 | Add extensibility architecture: server-side `PromotionExtensionRegistry` (custom rule types, custom benefit types, evaluation middleware `beforeEvaluate`/`afterResolve`, code middleware `beforeCodeUse`/`afterCodeUse`); client-side `promotionExtensionConfiguratorRegistry` for custom tree-builder UI components; `GET /api/promotions/extension-types` endpoint; `context.extensions` field on `CartContext`; 5 declared widget injection slots; Phase 5 implementation plan and TC-PROM-040–045 test cases; new events `evaluation.completed`, `code.exhausted`, `promotion.expiring-soon`. |
| 2026-02-24 | 1.3.0 | Add `max_discount` optional field to `product_discount`, `cart_discount`, `buy_x_get_y`, and `tiered_discount` benefit configs. Effect resolvers in `lib/effect-resolvers.ts` cap the computed amount at `max_discount` after the raw calculation. New invariant: cap is per-benefit, expressed in operating currency. Added `TC-PROM-014` test case. |
| 2026-08-14 | 2.0.0 | **Amendment for the `cart` module** (see §Amendment, normative over *Cart-Facing Endpoints*). Primary integration becomes DI `promotionsService`; HTTP endpoints retained as an adapter for external carts. Cart-facing routes move from `/api/cart/*` to `/api/promotions/*` to resolve a namespace collision with the `cart` module. `CartContext.items[]` gains `productId`, `variantId`, `cartLineId`; effect targeting gains `targetCartLineId` alongside `targetSku`. `CartContext` gains `customerGroupIds`, `taxMode`, `storeId`; new built-in `customer_group` rule type enables B2B group-scoped promotions. Effects gain a required `basis: 'net' \| 'gross'` so `salesCalculationService` does not tax an already-taxed discount. `ADD_FREE_ITEM` lines are excluded from subsequent eligibility to prevent a buy-X-get-Y feedback loop. `CodeReservation` gains `cart_id` with a lifecycle tied to cart abandonment and expiry. Single evaluation per batch mutation, with a P95 latency budget. Risks A-R1…A-R5 and cases TC-PROM-050…057 added. |
| 2026-02-26 | 1.4.0 | Add `PromotionUsage` entity (`promotion_usages` table) serving as per-order compliance audit ledger and global spend tracker. Add `PromotionUsageService` (`lib/promotion-usage-service.ts`) with `registerUsage` (serializable budget cap enforcement, idempotent upsert, 207 Multi-Status on budget block), `revertUsage` (soft-revert on order cancellation), and `getBudgetConsumed`. Add `POST /api/cart/register-usage` and `POST /api/cart/revert-usage` cart-facing endpoints. Add `eligible_currencies` (text[]) + `max_budget` (numeric nullable) + `budget_currency` (text nullable) to `Promotion`. Add `currency` (required) to `CartContext`. Add currency eligibility check and optimistic budget pre-check to evaluation engine. Update `NormalizedPromotion` shape with `eligibleCurrencies`, `maxBudget`, `budgetCurrency`, `totalDiscountGranted`. Update cache build to aggregate `totalDiscountGranted` from usage table. Add `promotions.usage.registered`, `promotions.usage.reverted`, `promotions.promotion.budget-exhausted` events. Add `TC-PROM-023`–`TC-PROM-026` test cases. Add Budget Cap Race Window risk entry. |
| 2026-08-17 | 2.0.1 | **Amendment reconciliation fix.** §A.3's route-rename table was incomplete and partly wrong: it listed a route (`remove-code`) that does not exist anywhere in this document — the real route is `delete-code` — and omitted `validate-code`/`use-code` entirely, which would have left both under the colliding `/api/cart/*` namespace the amendment exists to resolve. This table entry (1.4.0, dated *before* the 2.0.0 amendment but positioned after it) had also re-added `POST /api/cart/register-usage`/`revert-usage` under the pre-amendment namespace without reconciling against §A.3. Corrected §A.3 to cover all seven cart-facing routes; updated the module file structure, every *API Contracts* route header, and the Phase 3 implementation-plan steps to the `/api/promotions/*` paths. No further behavioural change. |
| 2026-08-17 | 2.0.2 | **`/om-pre-implement-spec` audit fixes.** (1) The 2.0.1 fix was itself incomplete: 8 further `/api/cart/*`/old-operation-name references remained in the Proposed Solution summary, the Evaluation Engine Data Flow / Code Lifecycle / Promotion Usage Lifecycle diagrams, the Extensibility section (twice), the Phase 5 plan step, and a Risk scenario — all now updated. (2) `PromotionsService` (§A.2) was missing `validateCode`/`useCode` — two of the seven renamed routes had no in-process method, contradicting the "in-process callers MUST use the service" rule for those two operations; added. (3) Added §A.2a stating `reserveCode`/`releaseCode`/`useCode`/`registerUsage`/`revertUsage` are registered commands, not bare service calls, per root `AGENTS.md`. (4) Added §A.2b declaring `cart → promotions` a hard dependency, not an optional `tryResolve` peer. (5) Added a Final Compliance Report addendum for all of the above. See `ANALYSIS-2026-02-23-spec-055-promotions-cart-amendment.md` for the full audit. |
| 2026-09-07 | 2.1.0 | **Benefit application target and quantity caps** (see §Amendment — 2026-09-07, normative over *Data Models — Benefit*, *Resolved Effect Types* and the `LINE_DISCOUNT` row of §A.5; the affected body tables are updated in place). `Benefit` gains an `applies_to` column (`order` \| `line` \| `unit`) with a per-type allow-list, replacing the implied-by-`benefit_type` target, `tiered_discount.scope` and the undefined `delivery_discount.scope`. A shared quantity-cap block (`max_quantity`, `max_lines`, `quantity_step`) intersected into every benefit variant replaces `product_discount.pcs_limit`; counting is **cart-wide per benefit invocation**, held in Pass 3 because the budget spans lines. `selector` gains `cart_order` (the literal "first N") and becomes **required whenever a cap is set** — no default, since "first 5" and "5 most expensive" are different campaign costs. `LINE_DISCOUNT` gains `appliesTo`, `lineQuantity`, `appliedQuantity` and `unitAmount`; a partially covered line stays one effect rather than fanning out per unit. §B.6 supersedes §A.5's line mapping: `sales` rejects a line-attributed adjustment draft today (`documents.ts` — *"Line-scoped adjustments are not supported yet."*) and `SalesAdjustmentDraft` carries no line reference, so line effects travel on `SalesLineSnapshot.discountAmount`, which `sales` reads as a **per-unit** amount and multiplies by the line's full quantity — `cart` therefore assigns `\|amount\| / lineQuantity`, never `unitAmount` and never the raw `amount`. Extending `sales` with line-attributed adjustments is deferred to its own spec (§B.7). `NormalizedBenefit` gains `appliesTo`; `BenefitExtension` gains `supportedAppliesTo`/`defaultAppliesTo` and receives a pre-budgeted `UnitSelection`. New `lib/unit-selection.ts`. Risks A-R6…A-R8 and cases TC-PROM-058…072 added. `BenefitExtension` also declares `capsHonoured`, and `GET /api/promotions/extension-types` surfaces it alongside the applies-to metadata. |
| 2026-09-09 | 2.1.1 | **§B.6 rule 1 corrected — it was specified against a `sales` API that does not exist.** 2.1.0 mandated `discountAmountBasis: 'line'` and attributed the behaviour to `resolveLineDiscountTotal` in `sales/lib/calculations.ts`. Neither identifier occurs anywhere in the repository: `SalesLineSnapshot` (`packages/core/src/modules/sales/lib/types.ts:35-63`) has no basis field, and `buildBaseLineResult` (`calculations.ts:80-123`) reads `discountAmount` as `discountPerUnit` and multiplies by the line's **full** `quantity` unconditionally — the one basis 2.1.0 forbade, with no opt-out. Followed as written, `cart` would have assigned the effect's total and discounted it `lineQuantity` times over; on this amendment's own TC-PROM-065(a) figures the clamp then takes a 200.00 line to zero against an intended 40.00 discount. Rule 1 now states the real contract — `discountAmount = \|amount\| / lineQuantity`, the line's full quantity rather than `appliedQuantity`, never `unitAmount` and never the raw `amount` — plus the sub-cent residual where the division is inexact (`round()` is 4 dp, `calculations.ts:22-24`). A-R6's mechanism restated around the two real mis-mappings instead of a fictional basis flag; `TC-PROM-060` widened from two directions to three with worked figures; the §B.6 mapping table and the 2.1.0 changelog row corrected to match. §B.7's deferral is unaffected. |
| 2026-10-14 | 2.2.0 | **eComm Release 4 decisions applied** (D-R4-1…29, C1–C14, P1–P14; see [eComm Release 4 Decisions](./analysis/ANALYSIS-2026-10-14-ecommerce-release-4-decisions.md)), ahead of Phases 1–3 implementation. Highlights: §B.6/A.5 rewritten a second time — 2.1.1's own premise (no basis flag on `develop`) was itself stale by the time it was written, since `discountAmountBasis: 'line'` had shipped in `#5640` before 2.1.1's edit; the correct, final mapping is `discountAmount = \|amountNet\|`, never divided, with no sub-cent residual. Every amount-carrying effect now carries **both** `amountNet` and `amountGross` (C5/D-R4-10), replacing the single `amount`+`basis`-flag model that let `sales`-side code silently reuse one side for the other. `X-Module-Key` withdrawn in favour of the platform's standard API-key identity with new features `promotions.evaluate`/`.codes.redeem`/`.usage.manage`; no `organizationId`/`tenantId` in any request body (C3/A1/A2/D-R4-11). Items addressed by `productId`/`variantId`/`lineId`, never `sku` (A.4 superseded, D-R4-21/C11) — context enrichment (category, tag, attribute) moves promotions-side, batched. `ADD_FREE_ITEM` carries a `promotionId` marker matching `cart`'s `CartLine.promotion_id`/`origin` (C4a/D-R4-7). `CodeReservation.cart_id` enters the unique key (`UNIQUE (code_id, cart_id)`, C4/C7/D-R4-8), replacing `(code_id, customer_id)`. Budget/code-use enforcement corrected from a (non-functional) serializable-transaction claim to a row lock + re-read-sum, correct under `checkout`'s ambient transaction (C6/D-R4-12). Cache now holds every `active=true` promotion regardless of date window, filtered at evaluation against a caller-supplied `evaluatedAt`; `totalDiscountGranted` moved to a separate counters key (R-H3/P8/D-R4-13). Release-4 rule set fixed at eleven shipped types (`user_group`→`customer_group`; category includes descendants, D-R4-15; `product_attribute` resolved server-side); six hidden pending a data source (P10/D-R4-14). `exclude_promotional_prices` flag added, replacing the unbacked "promotional-price-visibility toggle" (P9/D-R4-16). `promotions.*` event ids corrected to underscores (W1/D-R4-25); API route paths corrected to their actual mounted shape (W2); DI token names fixed (W3). New **Public TypeScript Contract** and **Release 4 Contract Freeze** sections (W6, missing-BC-section fix). Implementation Plan re-threaded: `PromotionUsage` and i18n (five locales) moved into Phase 1 (C8); the reservation sweeper, `promotionsService` facade and mutation-guard/optimistic-lock wiring specified where they were previously absent. Event-performance gate fixed to 200 promotions × 50 lines, P95 ≤ 150 ms (not "≥100," W12). DS-compliant (semantic tokens, no hardcoded colours) tree-builder description (A6). |
| 2026-10-15 | 2.2.1 | **Release 4 Phases 1–3 implemented** (`adeptofvoltron/open-mercato#15`; implementation record in `.ai/runs/2026-10-14-ecommerce-release-4-write-side/{PLAN,HANDOFF,NOTIFY}.md`). Per PLAN.md's Step 7.7, this spec stays in `.ai/specs/` — Phases 4–5 remain unbuilt. Findings a future reader should know about without re-reading the run: (1) `evaluate`/`evaluateForProduct`'s frozen signatures carry no tenant/org parameter, and no DI-resolvable "current auth" context existed anywhere in the codebase — resolved by having `promotionsService` read `container.resolve('auth')` and fail closed with `400` when absent; every in-process caller (the four Phase 2 cart-facing routes, the six Phase 3 codes/usage routes, and the `cart` module's own `cart.reprice`) now registers `{ auth }` onto its own request container before resolving the service — a cross-module convention this document did not anticipate, now load-bearing for `cart`. (2) `Code` has no `promotionId` column; a code links to a promotion only through a `ruleType: 'code'` rule's `config.codeId`, the same mechanism `evaluate()`'s own `evaluateCode` evaluator reads — `cart.promotions.apply` resolves "which promotion does this code unlock" the same way, since there is no FK shortcut. (3) `Code` CRUD commands (`promotions.code.{create,update,delete}`) were missing from the Phase 1 implementation plan — only `reserve`/`release`/`use` were built there — and were added once the admin `codes` route needed them. (4) `codes/release`'s documented body (`{codeString,cartId,customerId}`) doesn't match `releaseCode`'s service signature (`codeId, cartId`); the route resolves the string via `code-service.ts`'s own `resolveCodeByString` rather than a second resolution path. (5) `commandBus.execute()` does not run mutation guards internally — every mutating Phase 2/3 route wires `runRouteMutationGuards` explicitly. (6) Real concurrency proof landed against live Postgres, not mocked: 8 concurrent `codes/use` calls on one single-use code → exactly 1 succeeded; 10 concurrent `usage/register` calls (100 each, 500 budget) → exactly 5 accepted/5 blocked, DB sum exactly 500. Validation evidence: 220 `promotions` jest tests; 34/34 `promotions/__integration__/` Playwright specs passed. |
| 2026-10-16 | 2.2.2 | **Phase 8 manual-QA fixes** (F2, F1, F3, F5, F8, F4, F7, F9 — tracked in `.ai/runs/2026-10-14-ecommerce-release-4-write-side/{PLAN,HANDOFF,NOTIFY}.md` Phase 8, each with its own regression test against the live repro). **F2 (commit `8e372e4598`)**: `promotionUpdateSchema`'s `.partial()` over a default-carrying base schema still applied Zod 4's `.default()` inside `.partial()`, so `commands/promotions.ts`'s `!== undefined` guards always fired — a `PUT {id, eligibleCurrencies}` silently reset `active`/`tags` to their create-time defaults. Rebuilt the update shape from default-free field schemas; defaults stay create-only. **F1/F3 (commit `9827edb6f6`)**: the promotion form had no `eligibleCurrencies`/`maxBudget`/`budgetCurrency` fields, so a D-R4-27 tree (`order_value`/`row_total` rules, fixed/tiered benefits) couldn't be saved from the UI at all; added (currency select from `currencies`, budget with its required currency). `RuleTreeBuilder.tsx`'s tree-save flow used to flash a generic error and drop the `422` `issues[]` array — now surfaces the real message, pointing at the `eligibleCurrencies` field when that's the failing path. **F5/F8/F4 (commit `92cc2c294a`)**: `RuleCard`/`BenefitCard` used a free-text-filter `ComboboxInput` for closed lists, so the pre-selected first rule/benefit type filtered the dropdown to one visible option (a tester could not find "Product count"; a benefit silently stayed `product_discount`) — switched to the `Select` primitive, open shows all 11 rule types / 5 benefit types. The benefit labels editor's locale field is now a `Select` of the app's real supported locales (was free text); dropped an arbitrary `grid-cols-[100px_1fr_auto]` for DS-scale classes and aligned the `IconButton`/`Input` control heights. **F7 (commit `b0d766608d`)**: a date-only `endsAt` coerced to `00:00:00.000 UTC`, so a promotion "ending today" was dead for the whole day (`evaluation-engine.ts`'s `evaluatedAt > endsAt` check). `clearableEndOfDayDateSchema` bumps a date-only `endsAt` to `23:59:59.999 UTC` of the same day on write (form → API); a full ISO timestamp passes through unchanged — `startsAt` and the engine's own comparison are untouched. **F9 (commit `8d9c24baef`)**: a static code's `code`/`prefix`/`suffix` were stored and matched case-sensitively, so `summer10` missed a stored `SUMMER10`. Normalized to trimmed, upper-cased, `A-Z0-9`-only on write (`clearableUppercaseStringSchema`) and on every lookup path (`resolveCodeByString`, plus `useCode`'s own row-locking `GeneratedCode` query, the one direct lookup that bypasses `resolveCodeByString` because it needs `LockMode.PESSIMISTIC_WRITE`). Validation evidence: full `cart`+`promotions` jest suite 466/466 at Checkpoint 4 (up from 419 at the start of Phase 8); live `promotions/__integration__/` Playwright re-run recorded in `checkpoint-5-checks.md` under the same run folder. |
| 2026-10-23 | 2.2.3 | **QA round 2 fixes** (PR #7592 answers to the 2026-10-23 extended QA pass). `cart_weight`, `customer_order_history` and `product_attribute` move to **Hidden** under D-R4-14's own rule (the UI shows only rules with a data source): implementation found none of them has one (`cart` sends `cartWeight`/`customerOrderCount` as `null`; catalog has no attribute-code concept), so each could be saved but never matched. They leave `RELEASE_4_SHIPPED_RULE_TYPES` and the write-path `ruleInputSchema` and stay in `ruleInputSchemaFull`; implementing them is follow-up #7887. `order_date` now compares whole UTC calendar days instead of instants (previously `eq` matched only at midnight and `lte` dropped most of its own day). `tiered_discount` thresholds and the `row_total` value are labelled as net in the editor; a gross switch is follow-up #7886. |
| 2026-10-26 | 2.3.0 | **eComm Release 5, finding C5 — code-use reversal and a promotions-owned cancellation subscriber** (see `ANALYSIS-2026-10-26-checkout-release-5.md` §C5; accepted as an owner decision directly, no separate D-R5 row). `useCode` had nothing identifying which cart or order a use belonged to, so nothing could reverse it — `CodeUsage` gains additive `cart_id`, `order_id`, `generated_code_id` and `reverted_at` columns (migration `Migration20261026161603_promotions`); `UseCodeInput` gains an additive, optional `orderId`. New `PromotionCodeService.revertCodeUse({ cartId?, orderId? })` (registered command `promotions.code.use.revert`, additive to §A.2a's own five) reverses the specific `GeneratedCode`/`Code.used` flip `codes/use` made and marks the `CodeUsage` row `reverted_at` — idempotent, tenant/organization-scoped, never deletes. New persistent subscriber `subscribers/order-cancelled-usage-revert.ts` on `sales.order.cancelled` calls `PromotionUsageService.revertUsage` then `PromotionCodeService.revertCodeUse`, both keyed by the event's `orderId`, replacing the original §3.3 text ("`sales` calls `revertUsage`" — impossible, upstream never depends on downstream) with the correct direction: `promotions` owns the subscription, reads only FK ids off the event payload, never imports a `sales` entity. No HTTP route and no checkout caller ship in this revision — checkout's Phase 4 submit sequence (D-R4-26) is `useCode`'s first caller and lands later; this revision only makes reversal already work end to end once it does. |
| 2026-10-26 | 2.4.0 | **eComm Release 5, D-R5-17 — `delivery_method` rule and `DELIVERY_DISCOUNT` benefit un-hidden** (amends D-R4-14; see `ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md` D-R5-17). Checkout is the data source D-R4-14 said these two were waiting for: `EvaluateInput`/`EvaluationContext`/`EvaluationInput` (`lib/types.ts`) gain additive, optional `deliveryMethodCode`/`deliveryCost`. `delivery_method` moves from `hiddenRuleVariants` to `shippedRuleVariants` and `delivery_discount` from `hiddenBenefitVariants` to `shippedBenefitVariants` (`data/validators.ts`) — the exact mechanism D-R4-14 used to hide them (excluded from the write-path `ruleInputSchema`/`benefitInputSchema` discriminated unions, and from `RULE_TYPE_OPTIONS`/`BENEFIT_TYPE_OPTIONS` in the admin tree builder, which import those lists directly) — `RELEASE_4_SHIPPED_RULE_TYPES`/`RELEASE_4_SHIPPED_BENEFIT_TYPES` keep their names but grow by one entry each, rather than a repo-wide rename. `rule-evaluators.ts#evaluateDeliveryMethod` matches `context.deliveryMethodCode` against the rule's configured code, failing closed (not throwing) when the caller omits delivery context — every cart-stage caller today, per D-R4-14's cart-stage exclusion, unchanged by this amendment. `effect-resolvers.ts#resolveDeliveryDiscount` resolves a `DELIVERY_DISCOUNT` against `context.deliveryCost` as its base amount, clamped to it the same way every other benefit's base amount is already clamped; no effect resolves without both the matching delivery method and a cost. `benefitRequiresSingleEligibleCurrency` (D-R4-27) now also covers `delivery_discount` with `discountType: 'fixed'`, the same guard `cart_discount` already has. Budget/usage accounting (`promotion-usage-service.ts`) required no code change — `computeTotalDiscountAmount` already summed any amount-carrying effect generically. The admin rule/benefit-type pickers (`RuleCard.tsx`/`BenefitCard.tsx`/`ruleFieldSpecs.ts`) gained matching entries with i18n labels across all five locales. **Explicitly out of scope** (later Steps): checkout calling `evaluate` with real delivery context (Step 2.13); the shipping-charge adjustment mapping in `sales` (checkout/sales integration, not this amendment). |
