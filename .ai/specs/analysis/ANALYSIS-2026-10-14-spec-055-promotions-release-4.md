# Pre-Implementation Analysis: SPEC-055 Promotions Module — Release 4 (Phases 1–3)

> **Spec**: `SPEC-055-2026-02-23-promotions-module.md` (v2.1.1, amended 2026-08-14 / 08-17 / 09-07 / 09-09). The amended text is treated as authoritative.
> **Release scope**: Implementation Plan Phases 1–3 only (domain model and core admin; evaluation engine and cart API; codes system). Phases 4–5 are out of scope, but Phases 1–3 must not block them.
> **Verified against**: `develop` @ `28ca93ed97` (2026-10-14), branch `feat/release-4-write-side`.
> **Cross-read**: `2026-08-14-cart-module.md` (rev 8), `2026-08-21-buyer-scoped-catalog-visibility.md`, `2026-08-07-sales-line-discount-amount-contract.md`, `2026-08-14-ecommerce-suite-roadmap.md`, and the earlier `ANALYSIS-2026-02-23-spec-055-promotions-cart-amendment.md`.
> **Release invariant under test**: cart totals are byte-for-byte equal to the totals of the order the cart becomes.

## Executive Summary

The engine design is sound: a pure three-pass evaluator over a cached, DB-free `NormalizedPromotion[]`, with codes and the usage ledger as separate, transaction-bound concerns. The module is still greenfield on `develop`: there is no `promotions` or `cart` module, and `ecommerce`, `customer_groups`, `availability` and the pricing seams it builds on all exist.

The spec is **not ready to implement as written**. The decisive problem is that the central mapping of line discounts into `sales` (§B.6 rule 1, A-R6, `TC-PROM-060`, and the same text in cart §3.2/§14) was corrected on 2026-09-09 against a `sales` API that, on `develop`, has since been settled the other way. `discountAmountBasis: 'line'` and `resolveLineDiscountTotal` exist (shipped in #5640, 2026-08-28). Followed literally, Release 4 would implement a workaround for a problem that no longer exists and would keep a sub-cent residual that breaks the release invariant.

The Phase 1–3 plan also predates the 2.0.x amendments: `promotionsService`, the code/usage commands, the `customer_group` rule, the `cartLineId`/`basis`/`taxMode` context and the reservation sweeper are in the amendment text but in no plan step. Several rule types and context keys have no data source on the platform. The free-item (`ADD_FREE_ITEM`) path has no home in the cart spec and bypasses buyer-scoped visibility.

**Recommendation: needs spec updates first** (a bounded list; 14 owner decisions in "Decisions for the owner" below), then ready.

Counts: **Critical 8 · Warning 17** (details below; BC audit, AGENTS.md compliance, cross-spec and gaps combined).

---

## Verification Against This Repository (what was actually checked)

| Assumption in the spec | Reality on `develop` @ `28ca93ed97` | Effect |
|---|---|---|
| No `promotions` / `cart` module | Confirmed. `packages/core/src/modules/` has neither. `ecommerce` (read side, `BuyerContext`), `customer_groups`, `availability` exist. | Additive release. |
| `sales` rejects line-attributed adjustment drafts | Still true (`documents.ts` throws *"Line-scoped adjustments are not supported yet."* at 3 sites). | §B.7 deferral still valid. |
| `sales` has **no** basis flag; `discountAmount` is always per-unit × full quantity (§B.6 rule 1, 2.1.1) | **False.** `SalesLineSnapshot.discountAmountBasis?: 'unit' \| 'line'` (`sales/lib/types.ts`), `resolveLineDiscountTotal` (`calculations.ts`), `discountAmountFromStoredRow`, `resolveUpsertDiscountFields` (`lineSnapshots.ts`) and validator support (`data/validators.ts:345`) all exist. Persisted `discount_amount` is a **line total**; a percent wins when set. Contract spec: `2026-08-07-sales-line-discount-amount-contract.md` (#5640, merged 2026-08-28, before the 2.1.1 correction). | Critical C1. |
| Order-scoped effects map to `SalesAdjustmentDraft` with one `amountNet` *or* `amountGross` | `resolveAdjustmentAmounts` falls back net = gross (and gross = net) when only one is supplied and `metadata.taxRate` is absent. `discount` kind is `Math.abs`-normalised. | Critical C5. |
| Cart-facing auth by `X-Module-Key`, "module API key scope `promotions`" | The string `X-Module-Key` occurs nowhere in the repo. API keys authenticate via `x-api-key` or `Authorization: ApiKey …` (`shared/lib/auth/server.ts`) and carry roles/features, not scopes. | Critical C3. |
| `withAtomicFlush(..., { transaction: true })` + serializable isolation | `withAtomicFlush` accepts `isolationLevel`, but **joins an ambient transaction and ignores it**; there is no 40001 retry helper anywhere in `packages/shared`. | Critical C6. |
| Event IDs `promotions.generated-code.created`, `…budget-exhausted`, `…expiring-soon` | No event ID in the repo contains a hyphen. `ecommerce` uses underscores (`store_domain_binding`, `branding_updated`). | Warning W1. |
| API paths `/api/promotions`, `/api/codes`, `/api/dynamic-labels` from files `api/promotions/route.ts`, `api/codes/route.ts` | Routes mount under the module id: `api/promotions/route.ts` → `/api/promotions/promotions`. A module-root `api/route.ts` is supported (e.g. `notifications`). | Warning W2. |
| `producer`, `exclude_pharmaceutical`, `consent_flag`, `customerOrderCount`, `product_attribute` inputs | No manufacturer/producer field in `catalog`; no consent store in `customer_accounts`; no order-count source; no attribute-resolution contract. `weight_value` and category/tag `slug` do exist. | Critical C4b / decision P10. |
| `user_group` rule (`user_group_id`) | The platform has *customer groups* (`customer_groups`) and *roles*; "user group" has no referent. A.4 adds `customer_group` separately, leaving both. | Warning W9, decision P10. |
| "15 built-in rule types" | The Data Models table lists **16** (`user_group` … `shipping_address`), and A.4 adds a 17th. | Warning W10. |
| Decimal arithmetic "rounded once to the currency's minor unit" | No decimal library in the repo; `currencies` exposes no minor-unit digits; `sales` rounds to 4 dp in JS numbers. | Warning W11 / decision P2. |
| `queue` worker contract, `cache` via DI, `dnd-kit`, `scheduler` package | All available. `@dnd-kit/*` already a dependency of `ui` and `enterprise`. Queue names mix `-` and `.` forms; both occur. | OK. |
| `PricingContext` can carry groups, person+company ids, price kind | Yes: `customerGroupIds`, `customerIds`, `priceKindId` (incl. the `isPromotion` overlay). `BuyerContext` is shipped (`ecommerce/lib/types.ts`). | OK, but see W8 (stacking with promotional price kinds). |

**Stale in the 2026-02-23 analysis**: all four of its remediation items (8 leftover `/api/cart/*` references, `useCode`/`validateCode` in the DI contract, command-pattern classification, hard-vs-optional dependency) were applied in 2.0.2. They are not re-raised. `packages/core/AGENTS.md` § Cross-Module Coupling forbids a hard `requires` only on an *optional* peer, so `cart` → `promotions` with `requires: ['promotions']` (as in `module-sets-for-standalone-apps.md`) is consistent.

---

## Backward Compatibility

The module is new, so most surfaces are additive. Because the phases mint FROZEN/STABLE names (event IDs, DI keys, ACL features, API URLs, the `ResolvedEffect` type), the audit below is about getting those names right **before** first publish.

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| C1 | 3 — Function signatures / types of a *shipped* contract (`SalesLineSnapshot.discountAmount`) | §B.6 rule 1, A-R6, §B.8/B.9, the 2.1.0/2.1.1 changelog rows and `TC-PROM-060` describe the pre-#5640 sales contract ("no basis flag", per-unit × full quantity). On `develop` the caller default is still per-unit, but `discountAmountBasis: 'line'` makes `discountAmount` the **line total**, and persisted rows hold a line total. Mapping `\|amount\| / lineQuantity` works only up to the 4 dp residual (`10.00 / 3 → 3.3333 × 3 = 9.9999`), which cart §14 then has to excuse in its "byte-identical" gate. Cart §3.2 and §14 repeat it. | **Critical** | Rewrite §B.6 rule 1: cart assigns `discountAmountBasis: 'line'`, `discountAmount = \|net line discount\|`, `discountPercent = null`. Delete the residual caveat and the "division" language; restate A-R6's mis-mapping arithmetic for the real failure (omitting the basis → `amount × lineQuantity`). Keep `TC-PROM-060` but assert the line-total path plus the idempotent round trip (`calculate(calculate(x)) == calculate(x)`), owned by cart's suite. Correct the 2.1.1 changelog claim that the identifiers "occur nowhere". Same edit in cart §3.2/§14. |
| C5 | 3 — `SalesAdjustmentDraft` input contract | Order-scoped effects carry one `amount` + `basis`. `sales` needs **both** `amountNet` and `amountGross` (or `metadata.taxRate`); with only one it reuses the figure for the other side, so the tax portion of an order-level discount is never apportioned. This is A-R1 (rated High) left open. | **Critical** | `CART_DISCOUNT` / `DELIVERY_DISCOUNT` / `LINE_DISCOUNT` carry `amountNet` **and** `amountGross` (the engine has both `unitPrice` and `unitPriceIncTax` in the context); `basis` stays as the audit trail. Property test: for every effect and tax mode, cart totals == totals of an order built from the same lines and adjustments. Decision P2. |
| W1 | 5 — Event IDs (FROZEN once published) | Hyphenated IDs (`generated-code`, `budget-exhausted`, `expiring-soon`) have no precedent. | Warning | Rename to `generated_code`, `budget_exhausted`, `expiring_soon` before first publish (P11). |
| W2 | 7 — API route URLs (FROZEN once published) | File tree mounts at `/api/promotions/promotions`, `/api/promotions/codes`, … while *API Contracts* writes `GET /api/promotions`, `GET /api/codes`, `GET /api/dynamic-labels`. Only the seven routes in §A.3 are consistent. | Warning | Collection routes at `api/route.ts` and `api/[id]/route.ts`; sub-resources `api/codes/…`, `api/evaluate`, `api/usage/…`, `api/product-page`, `api/dynamic-labels`, `api/free-products`, `api/delivery-methods`. Rewrite contract headers to the mounted path. Route test for `[id]` vs static `order`/`evaluate` precedence. |
| W3 | 9 — DI service names | Only `promotionExtensionRegistry` (Phase 5) has a token; Phase 3 step 15 says "`PromotionUsageService`" (PascalCase); A.2 says `promotionsService`; compliance matrix says `PromotionCache`. | Warning | One table: `promotionsService`, `promotionCache`, `promotionUsageService`, `promotionCodeService`, `promotionCodeGenerationService`. |
| W4 | 10 — ACL feature IDs | Declared: `promotions.view/create/update/delete/codes.manage`. Nothing for the HTTP adapters (`evaluate`, `codes/*`, `usage/*`). `usage/register` and `codes/use` mutate budgets and usage. | Warning | Add `promotions.evaluate`, `promotions.codes.redeem`, `promotions.usage.manage`; map in `setup.ts` `defaultRoleFeatures` (admin only); note `yarn mercato auth sync-role-acls` (P3). |
| W5 | 8 — Database schema | (a) Circular FK `promotions.rule_group_id` ↔ `promotion_rule_groups.promotion_id`. (b) `promotion_usages.promotion_id` FK with "cascade" vs immutable ledger. (c) `CodeReservation UNIQUE (code_id, customer_id)`, `customer_id NOT NULL` vs A.6 `cart_id` and guests. (d) generated-code uniqueness is not unique against static `promotion_codes.code`, yet `reserve(codeString)` looks up both. | Warning | (a) root marked by `parent_rule_group_id IS NULL`, or nullable-then-set. (b) `ON DELETE RESTRICT`, soft delete only. (c) P6. (d) one normalised-code namespace unique per `(tenant_id, organization_id)`. |
| W6 | 2 — Type definitions | `ResolvedPromotions`, `ProductPagePromotionInput/Promotions`, `CodeReservationResult`, `CodeValidationResult`, `CodeUseResult`, `RegisterUsageInput/Result`, `RevertUsageInput` are named in A.2 and never defined. `CartContext.customerId` is single, `BuyerContext` is person+company. | Warning | Add a "Public TypeScript contract" section; export from `promotions/lib/types.ts`. P14. |
| W7 | 4 — Import paths | Phase 5 example imports `…/promotions/lib/extension-registry`; `cart` will import Phase 1–3 types. | Warning | Declare the public barrel in Phase 1. |
| — | 1, 6, 11, 12, 13 | Phase 1–3 auto-discovery files follow convention. `ce.ts`, `translations.ts`, `search.ts`, `notifications.ts`, `widgets/*` are Phase 4 and must not be created in Release 4. Nothing to break for spot IDs, notification types, CLI, generated files. | OK | State in the plan that these files are Phase 4. |

### Missing BC Section

"Migration & Compatibility" exists, but its premises are stale: it says §B.6 maps onto `SalesLineSnapshot` fields `sales` already exposes and that nothing shipped is touched. The cited contract changed (C1), and nothing records the Release 4 consequences: the names minted here become FROZEN (W1–W4, W6), and `codes.use` / `usage.*` ship without a caller until `checkout` (P12). Add a "Release 4 contract freeze" table listing the event IDs, DI tokens, ACL features, route paths and types that become STABLE.

---

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Public TypeScript contract (A.2 types) | `cart` Phase 3 cannot be coded against names without shapes. | W6. |
| Ordering inside Phases 1–3 (C8) | Phase 2 `promotion-cache.ts` aggregates `promotion_usages`, but the entity and migration are Phase 3 step 10. Phase 1 step 13 offers the `code` rule and picker, but codes (and their UI) are Phase 3. | Move `PromotionUsage` to Phase 1; ship the `code` rule with a plain `code_id` field until Phase 3. |
| Integration coverage for key UI paths | Root `AGENTS.md`: API **and** key UI paths. Plan tests only APIs (plus Phase 1 step 16). | Playwright: tree builder save/reload (nested groups, benefits); *Applies to* / *Limits* / *Which pieces* constraints (capped benefit can't be saved without a selector); list drag-sort + save; code detail with generated-codes panel. Self-contained fixtures via API, cleanup in `finally`. |
| Reservation sweeper | A.6: "promotions also sweeps independently"; no plan step, worker or schedule. | Phase 3 step: queue worker + scheduler registration owned by `promotions`. |
| `promotionsService` implementation step | The facade is the primary integration (A.2) and is in no plan step. | Phase 2 (`evaluate`, `evaluateForProduct`) and Phase 3 (code/usage methods), with the A.2a commands. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Implementation Plan, Phases 1–3 | Predates 2.0.x: no `customer_group` rule, no `cartLineId`/`productId`/`variantId`/`basis`/`taxMode`/`storeId` in the evaluate schema, no `cart_id` on reservations, no free-item exclusion, no reserve/release/use/register/revert commands, no `TC-PROM-050`–`057` in any phase. | Re-thread A.2–A.9 and B.*; assign each `TC-PROM-0xx` to a phase. |
| Phase 1 step 4 | "Generate and apply DB migration (`yarn db:generate && yarn db:migrate`)". Root `AGENTS.md`: ask before `yarn db:migrate`. | `yarn db:generate`, review SQL, keep only the promotions migration + snapshot. |
| Phase 1 step 15 | `npm run modules:prepare` is not a repo command. | `yarn generate`. |
| Phase 4 step 4 (i18n) | Locale files come after the UI, and only `en`/`pl` ("etc."). Gate includes `yarn i18n:check-sync` and hardcoded-string checks; sibling modules ship `de/en/es/ko/pl`. | Move to Phase 1; five locales; `useT()` keys from the first component. |
| Optimistic locking (root *Always*) | Not mentioned. `Promotion`, `Code` are editable; `PUT /tree` replaces a whole tree; `PATCH /order` rewrites many rows. | `updatedAt` in list/detail; `CrudForm` header; tree PUT carries the promotion's `updatedAt` (409 if stale); `PATCH order` items each carry their own `updatedAt`; `surfaceRecordConflict`. |
| Performance gate | Phase 2 step 10: "≥ 100 promotions"; A.7/`TC-PROM-057`: P95 ≤ 150 ms for 50 lines × 200 promotions. | Make A.7 the gate; name the measuring profile. |
| Final Compliance Report | Still lists `npm run modules:prepare` and "cart endpoints require tenant scope from auth context" (contradicted by request bodies). | Rewrite after decisions. |
| Changelog | 1.4.0 (2026-02-26) sits after 2.0.0 (2026-08-14). | Re-order or note. |
| Currency of fixed amounts | `fixed` amounts, tier `threshold`, `order_value.value`, `max_discount` are currency-less, but `eligible_currencies` may list several currencies. | P13. |

---

## AGENTS.md Compliance

### Violations

| # | Rule | Location | Fix |
|---|------|----------|-----|
| A1 | Never skip tenant/org scoping; scope from auth (root *Never*) | Bodies of `evaluate`, `codes/*`, `usage/*`, `product-page` carry `organizationId`/`tenantId`; `usage/register` takes `promotionId` per promotion, with no ownership check stated. The compliance matrix claims scope comes from auth. | Remove both ids from bodies (derive from auth; reject mismatches); verify every `promotionId`/`codeId` belongs to the scope. Cross-tenant test per route. (C3) |
| A2 | Declarative per-method `metadata` guards; no custom header scheme | "authenticated via module API key (header `X-Module-Key`)" | Standard API-key identity (`x-api-key`), feature-checked (W4). |
| A3 | Custom write routes wire the mutation-guard registry | `PUT /tree`, `PATCH /order`, `codes/*`, `usage/*`, `codes/[id]/generate` | State it per route. |
| A4 | Optimistic locking default-on | See Completeness. | As above. |
| A5 | No hard-coded strings; i18n before UI | Phase 4 locale step. | Phase 1. |
| A6 | Design system: no hardcoded status colours / arbitrary values | UI/UX: *Add Rule (green)*, *Add Sub-group (blue)*, *Add Benefit (orange)*, *Duplicate (purple)*, *Delete (red)*, orange divider, "~10% lighter per nesting level (`color-mix`)". | `Button` variants and semantic tokens; depth via a token surface scale or a left border; run `om-ds-guardian` on the tree builder. |
| A7 | Ask first before `yarn db:migrate` | Phase 1 step 4, Phase 3 steps 2 and 10. | See Completeness. |
| A8 | Commands: undo via `extractUndoPayload`, side effects outside `withAtomicFlush` | Not stated: undo semantics for `rule-tree`, explicit "not undoable" for code reserve/use and usage register/revert, cache invalidation after commit. | Add a command table: undoable / not, with reason. |
| A9 | Event hygiene | `promotions.evaluation.completed` is emitted on every evaluate = every cart mutation (A.7). | Use telemetry for duration; if an event stays, ephemeral and not `clientBroadcast`. |
| A10 | Encryption: declare PII/GDPR fields; `findWithDecryption` | No `encryption.ts`, no statement. `customer_id` is an opaque id; `effects_snapshot` has no PII; a voucher code is a bearer credential, not personal data. | State "no encryption-map fields" and why; erasure note for `customer_id` in ledger tables (nullable, anonymise); `findWithDecryption` in cache build and detail routes anyway. |
| A11 | Cache: tenant-scoped key/tags, invalidate after commit | Key is correct; but every `usage.registered` evicts the whole tenant cache. | See R-H3. |
| A12 | Dialog shortcuts | Delete confirm and codes modal listed. | OK. |

---

## Cross-Spec Check

### Against the `cart` module (rev 8, Phase 3 consumer)

| # | Item | Finding | Severity |
|---|------|---------|----------|
| X1 | Line-discount mapping | Cart §3.2 rule 1 and §14 repeat the stale mapping and its 4 dp residual excuse. | **Critical** (C1) |
| X2 | `ADD_FREE_ITEM` | The cart spec has **no** text for inserting, pricing, protecting or removing a promotion line. (a) `CartLine` unique `(cart_id, product_id, variant_id, configuration_hash)` collides with buy-2-get-1 of the *same* product; (b) no marker column; (c) A.5 says `added_by: 'merge'`, rev 8 replaced it with `added_by_actor_type` (`system` fits); (d) `CartContext.items[]` has no "inserted by promotion" flag, so the exclusion invariant can't be built from the contract; (e) nothing on removal when the trigger lapses or buyer edit rights; (f) reward addressed by `sku` only, lines keyed by `productId`/`variantId`; (g) free line stock/availability and tax rate unspecified. | **Critical** (C4a) |
| X3 | Code reservations | A.6 adds `cart_id`; table still `UNIQUE (code_id, customer_id)`, `customer_id NOT NULL`. A-R4 says abandoned carts drain single-use codes, but *Code Lifecycle* checks only remaining global uses and per-customer limit, so a reservation holds no capacity. Two carts can reserve the last code; the loser fails at `codes/use`, after payment. | **Critical** (C7) |
| X4 | `toPromotionCartContext(cart)` | Referenced in cart §6, defined nowhere. No cart source for `producerCode`, `attributes`, multi-category `categorySlug`, `consentFlags`, `customerOrderCount`, delivery/payment/address/cost. Cart Phases 1–3 have no delivery, payment or address (that is Spec 7). | Warning (P10) |
| X5 | Delivery effects | `DELIVERY_DISCOUNT`, `delivery_discount`, `delivery-methods` can't be exercised end to end in Release 4. | Warning (P10) |
| X6 | `evaluate` shape | Cart §6: `buyer: { customerId, customerGroupIds, channelId }`; A.2 adds `customerUserId`; shipped `BuyerContext` also has `customerIds`, `companyId`, `taxMode`, `priceKindId`. Cart §6 says the cart "maps effects to `SalesAdjustmentDraft[]`", contradicting its own §3.2 split. | Warning (W6, P14) |
| X7 | Callers of `useCode`/`registerUsage`/`revertUsage` | None until `checkout`. Budgets and per-customer limits untestable end to end and unenforced in production in Release 4. | Warning (P12) |
| X8 | `CartPromotionApplication.scope` | `order \| line`; effects have three targets. | Low |
| X9 | Batch evaluation; release on merge/abandon/expiry; `requires: ['promotions']` | Consistent. | OK |
| X10 | Identity of totals | Holds when both sides use `salesCalculationService` with identical snapshots; remaining divergence sources are C1/C5 and rounding (P2). | — |

### Against buyer-scoped catalog visibility (Phase 3, same release)

| # | Item | Finding | Severity |
|---|------|---------|----------|
| V1 | Promotion-inserted lines | Visibility §6a checks `lines.add/.update/.bulkAdd` and merge. A gift line created by `ADD_FREE_ITEM` goes through none of them, and the reward is an operator-authored `reward_sku` unrelated to the buyer's assortment. A hidden product becomes obtainable (R1/R11 by a third route); the engine can't check it itself (zero DB access). The visibility spec never mentions promotions. | **Critical** (C4c) |
| V2 | Promotion read endpoints | `product-page` (SKUs in, badges out), `dynamic-labels` (applicable products/categories) and `free-products` return product-keyed data for caller-supplied SKUs: the enumeration oracle `storefront-public-api.md` §4.2 closes for the catalog. | Warning |
| V3 | Qualifying lines | Already vetted at `lines.add`; a discount can't make a hidden product purchasable. | OK |
| V4 | Ordering | Visibility Phase 3 amends `cart.lines.*` after cart Phase 1; `evaluate` must receive the buyer's scope (or cart post-filters rewards) before cart Phase 3 closes. | Note |

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **R-H1 Stale mapping (C1)** | Cart implements the workaround for a contract that changed; sub-cent residual fails "byte-identical". | Rewrite §B.6; add the idempotent round trip to the cart gate. |
| **R-H2 Budget cap by serializable isolation (C6)** | `registerUsage` is a command (A.2a). `withAtomicFlush` joins an ambient transaction and ignores `isolationLevel`; `checkout` will call it inside its order transaction, so serializable silently disappears and concurrent orders overshoot `max_budget`. No 40001 retry helper exists, so a top-level call would fail the second order with a raw serialization error. | Lock the promotion row (`SELECT … FOR UPDATE` or advisory lock) inside the transaction, then re-read the sum: works in a joined transaction, no retry loop (P7). Test: N concurrent registrations with an ambient transaction. |
| **R-H3 Cache design** | (a) Cache built from "active AND within date range", invalidated only by mutation events: windows opening/closing change nothing, so promotions apply late or past their end. (b) `order_date`/windows read "now" inside a supposedly pure evaluator: same cart, different results over time. (c) Every `usage.registered` evicts the tenant cache and rebuilds the `SUM` aggregate on each order. | Cache all `active = true`; filter by caller-supplied `context.evaluatedAt`. Keep `totalDiscountGranted` in a small separate counters key, read only for budget-capped promotions. Invalidate the main cache only on promotion mutations (P8). |
| **R-H4 Code capacity (C7)** | Last single-use code awarded to two carts; guests can't be limited per customer. | P6. |
| **R-H5 Free-item path (C4)** | Hidden product obtainable; same-SKU gift merges into the paid line; feedback loop if exclusion isn't implementable. | P4/P5. |
| **R-H6 Cross-tenant input (C3)** | Tenant/org/promotion/code ids in bodies of routes callable with a shared key. | A1 fix; cross-tenant test per route. |
| **R-H7 Rules without data (P10)** | Rules that can never match (or read a key nobody supplies) are offered in admin; operators think a campaign is live. | Ship only rules whose inputs exist. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Promotional price kind × promotion (W8) | `catalog` overlays `CatalogPriceKind.isPromotion` prices; a promotion on a promotional unit price double-discounts; the form mentions a "promotional-price-visibility toggle" with no column. | P9. |
| Rounding and currency (W11) | JS floats, "currency minor unit" with no data source; JPY/KWD wrong; gross/net drift against `sales` 4 dp. | P2: half-up at the currency's fraction digits (`Intl.NumberFormat(...).resolvedOptions()`) in integer minor units, passed through verbatim by the cart. |
| Fixed amounts without currency | Same number applies in EUR and USD. | P13. |
| Code brute force | Public `reserve`/`validate` with no rate limit in this spec. | `shared/lib/ratelimit`; uniform error for unknown/inactive/exhausted; case normalisation. |
| Tree PUT last-write-wins | Two admins, later silently wins. | A4. |
| Ledger deleted by cascade | Audit loss (W5b). | `RESTRICT`. |
| Gate mismatch | 100 promotions vs 50 × 200. | Align. |
| `evaluation.completed` storm (A9) | One persisted event per cart mutation. | Telemetry. |
| Phase ordering (C8) | Phase 2 cache build needs a Phase 3 table. | Move entity to Phase 1. |
| Budget accounting gaps | `total_discount_amount` sums `\|amount\|`; `ADD_FREE_ITEM` has none, so gifts never consume `max_budget`; delivery discounts do. | State the rule. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Soft delete vs cascade wording | Drift. | W5. |
| Generic entity names (`Code`, `Rule`, `Benefit`) | No collision today (checked); invites one. | `PromotionCode`, `PromotionRule`, … ids `promotions:promotion_code`. |
| Queue name style | Both `a-b` and `a.b` exist. | `promotions-code-generate`. |
| Promotion count limits (500/1000) | Hard limit without UI message. | i18n error key. |
| Changelog ordering | Cosmetic. | Re-order. |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

- **C1** Line-discount mapping stale vs `sales`. Blocks cart Phase 3 and the byte-identical gate.
- **C2** `promotionsService` and the A.2a commands are in no plan step; the amendment contracts (`customer_group`, `cartLineId`/ids, `basis`/`taxMode`/`storeId`, `cart_id` reservations, free-line exclusion) are not threaded into Phases 1–3; the A.2 types are undefined.
- **C3** Authentication/scope of the HTTP adapters: `X-Module-Key` doesn't exist; ids in bodies; no features; ledger-writing routes reachable by a shared key.
- **C4** Free-item path unspecified (cart) and unprotected (visibility): (a) line model and lifecycle, (b) context flag for the eligibility exclusion, (c) assortment check, (d) SKU → product/variant resolution (the cache build has DB access; resolve SKUs to ids there and normalise config).
- **C5** Order-scoped effects must carry net and gross.
- **C6** Serializable budget enforcement doesn't hold under an ambient transaction.
- **C7** Reservation semantics and uniqueness.
- **C8** Phase ordering (`promotion_usages`, `code` rule).

### Important Gaps (Should Address)

- Rules/context keys without data sources (P10); `user_group` vs `customer_group`; rule count 15/16/17.
- Category semantics: slug match on multi-category products; descendants?
- `product_attribute`: which attributes, how they reach the context.
- Currency of fixed amounts/thresholds (P13); rounding rule and its source (P2).
- `evaluatedAt` and cache windows (P8); stacking with `isPromotion` price kinds (P9).
- Customer identity for per-customer limits and order history (P14).
- Reservation sweeper scheduling; one code lookup namespace; normalisation and rate limiting.
- Mutation guards on custom write routes; optimistic locking on `Promotion`, `Code`, tree PUT, order PATCH.
- UI integration tests; i18n in Phase 1 with five locales; DS-token pass.
- Command undo table; plan commands (`yarn db:generate` only, `yarn generate`).
- Scope filter on `product-page`, `dynamic-labels`, `free-products`.
- No caller for `useCode`/`registerUsage`/`revertUsage` in this release (P12).

### Nice-to-Have Gaps

- Cart `CartPromotionApplication.scope` should allow `unit`.
- Cart §6 sentence should read "splits them (§3.2)".
- Evaluator timing as a telemetry histogram.
- Shared fixture factory for promotions/codes in `__integration__/helpers`.

---

## Remediation Plan

### Before Implementation (Must Do)

1. Rewrite §B.6 / A-R6 / `TC-PROM-060` and the 2.1.1 changelog for `discountAmountBasis: 'line'` (C1); same edit in cart §3.2/§14 in the same pass.
2. Add net + gross amounts to `ResolvedEffect` and the rounding rule (C5, P2).
3. Replace the HTTP auth model: standard API-key identity, new features (W4), scope from auth, no tenant/org ids in bodies, ownership checks on referenced ids (C3, A1, A2).
4. Thread the amendment into the plan: `promotionsService`, A.2a commands, `customer_group` rule, context fields, `cart_id` reservations, sweeper, `TC-PROM-050`–`057` (C2).
5. Define the A.2 types in a public barrel (W6).
6. Specify the free-item contract jointly with cart: marker, uniqueness discriminator, context flag, lifecycle (add / remove when trigger lapses / edit lock), assortment and availability check, id resolution (C4, P4, P5).
7. Fix reservation semantics and schema (C7, P6).
8. Fix the budget mechanism (C6, P7) and the cache/time model (R-H3, P8).
9. Re-order Phases 1–3: `PromotionUsage` and i18n into Phase 1; `code` picker with Phase 3 (C8).
10. Decide the Release 4 rule set (P10), stacking with promotional prices (P9), and P12–P14.
11. Rename events to underscores, fix route paths, name DI tokens (W1–W3); publish the "Release 4 contract freeze" table.

### During Implementation (Add to Spec)

1. Optimistic-lock wiring (list/detail `updatedAt`, tree PUT, order PATCH).
2. Mutation-guard registry on every custom write route.
3. DS-compliant tree builder; Playwright coverage of key UI paths.
4. Command undo table; side effects and cache invalidation outside `withAtomicFlush`.
5. Property tests: cart totals == order totals for every effect type and tax mode; idempotent recalculation for promoted lines; selection determinism (`TC-PROM-064`); no DB access during evaluation (throwing EntityManager).
6. Concurrency tests: concurrent reserve of the last code; concurrent `registerUsage` in an ambient transaction; parallel evaluations with one cache rebuild.
7. Update the Final Compliance Report and changelog.

### Post-Implementation (Follow Up)

1. Phase 4: search, notifications, injection slots, POS subscription, scheduled expiring-soon check.
2. Phase 5: extension registry; keep `BenefitExtension.capsHonoured`.
3. A `sales` spec for line-attributed adjustment drafts (§B.7) to restore per-promotion attribution.
4. `checkout` wires `useCode`, `registerUsage`, `revertUsage` and adds the end-to-end budget and per-customer-limit tests.

---

## Recommendation

**Needs spec updates first.** No rewrite is needed. The work is a bounded correction pass: the stale `sales` contract, a plan not aligned with the amendments, and a handful of unsound mechanisms (auth, budget isolation, cache windows, reservations, free items). After remediation items 1–11 and the decisions below, Phases 1–3 are implementable in this order: Phase 1 (domain model + usage entity + admin + i18n) → Phase 2 (engine, cache, `promotionsService.evaluate`, product-page) → Phase 3 (codes, reservations, usage, commands, sweeper).

---

## Decisions for the owner

Recommended option first.

| ID | Decision | Options | Recommendation | Blocks |
|----|----------|---------|----------------|--------|
| **P1** | How cart hands a line discount to `sales` | (a) `discountAmountBasis: 'line'`, `discountAmount = \|net line discount\|`; (b) per-unit `\|amount\| / lineQuantity` as the spec says today | **(a).** It is the shipped contract (#5640), has no 4 dp residual, and matches how persisted rows are stored, so cart → order is idempotent. Edit SPEC-055 §B.6/A-R6/`TC-PROM-060` and cart §3.2/§14. | SPEC-055 P2 effects, cart P3 gate |
| **P2** | Shape and rounding of money in `ResolvedEffect` | (a) every amount-carrying effect has `amountNet` **and** `amountGross` (+ `basis` for audit), rounded half-up at the currency's fraction digits in integer minor units; (b) one `amount` + `basis`, cart derives the other side; (c) return a `rate` for order-level percent discounts and let `sales` compute | **(a).** `sales` needs both sides, the engine already has both prices, and the cart stays arithmetic-free. | SPEC-055 P2, cart P3 |
| **P3** | HTTP adapters in Release 4 | (a) keep them behind standard API-key auth + new features (`promotions.evaluate`, `.codes.redeem`, `.usage.manage`), scope from auth only; (b) `promotionsService` in-process only; adapters when an external cart appears; (c) `evaluate` and `product-page` over HTTP, the rest in-process | **(a)** if the spec's tests (`TC-PROM-023`–`026`, `050`) stay HTTP-level; **(b)** for less surface. Either way `X-Module-Key` and ids in bodies go. | SPEC-055 P2–P3 |
| **P4** | How a gift line lives in the cart | (a) a real `CartLine` with a `promotion_id` marker column in the unique key, `added_by_actor_type: 'system'`, re-evaluated each time, not buyer-editable, flagged in `CartContext.items[]`; (b) keep it in `metadata` / a separate response section | **(a).** A same-product gift otherwise merges into the paid line. Needs cart rev 9. | cart P3, SPEC-055 P2 |
| **P5** | Do promotions respect the buyer's assortment? | (a) cart rejects a reward failing `matchesScope` (not inserted, `product_unavailable` warning); `product-page`/`dynamic-labels`/`free-products` take the buyer's scope or require authenticated server callers; (b) gifts exempt | **(a).** Otherwise a hidden product is free for the taking and visibility Phase 3 is incomplete. Add a paragraph to visibility §6a. | visibility P3, cart P3 |
| **P6** | Code reservations | (a) a reservation holds capacity until released/expired; unique `(code_id, cart_id)`; per-customer limit counts `CodeUsage` + other carts' active reservations; guests can't hold per-customer-limited codes; (b) advisory, enforced only at `useCode` | **(a).** A-R4 already assumes it; (b) fails the buyer after payment. | SPEC-055 P3, cart P3 |
| **P7** | Budget cap enforcement | (a) lock the promotion row (`FOR UPDATE`), re-read the sum; (b) serializable + a new retry helper | **(a).** Works inside `checkout`'s transaction, no retry loop; (b) silently loses isolation under an ambient transaction. | SPEC-055 P3 |
| **P8** | Time handling | (a) cache every active promotion; caller passes `evaluatedAt`; counters outside the main cache; (b) keep "active and within range" in the cache | **(a).** (b) applies promotions late or past the end and makes tests irreproducible. | SPEC-055 P2 |
| **P9** | Promotion × catalog promotional price kinds | (a) apply on top, expose `priceIsPromotional` per item, add an `exclude_flags` key `exclude_promotional_prices`; drop the unbacked "promotional-price-visibility toggle"; (b) never apply to promotional-priced units; (c) ignore | **(a).** Operator control without a hidden rule. | SPEC-055 P1–P2 |
| **P10** | Rule/benefit types in Release 4 | (a) ship rules whose inputs exist: `order_value`, `order_date`, `product_count`, `cart_weight`, `row_total`, `product`, `category`, `product_attribute`, `customer_group` (replacing `user_group`), `code`, `customer_order_history` (cart supplies); hide `producer`, `exclude_pharmaceutical`, `consent_flag`, `delivery_method`, `payment_method`, `shipping_address`, `delivery_discount`/`DELIVERY_DISCOUNT` until a data source exists; (b) all of them, unsupplied keys evaluate false; (c) all, plus build the missing sources | **(a).** Cart Phases 1–3 have no delivery, payment, address or consent. Settle the category rule (own category vs descendants) here. | SPEC-055 P1–P2, `toPromotionCartContext` |
| **P11** | Event ID style | (a) underscores (`generated_code`, `budget_exhausted`, `expiring_soon`) as in `ecommerce`; (b) keep hyphens | **(a).** IDs are FROZEN after first publish; no hyphenated ID exists today. | SPEC-055 P1 |
| **P12** | `useCode`, `registerUsage`, `revertUsage` in Release 4 | (a) implement, test (integration + concurrency) and expose now, no production caller until `checkout`; (b) defer to the checkout release, keep reserve/validate/release/evaluate | **(a).** The contract is needed for the budget gate; note in release notes "budgets and per-customer limits enforced from checkout". | SPEC-055 P3 |
| **P13** | Currency of fixed amounts and thresholds | (a) benefits with `fixed` amounts, tiers or `order_value`/`row_total` thresholds require a single `eligible_currency` (write-path validation); (b) per-currency value maps | **(a).** Simple, extendable to (b) later. | SPEC-055 P1 validators |
| **P14** | Which customer a promotion sees | (a) `customerId` = `BuyerContext.customerId` (person wins), `customerIds` for order history and per-customer limits, `customerGroupIds` as already unioned; (b) company only | **(a).** Matches D3/D3a already shipped in `BuyerContext`. | SPEC-055 P2–P3 types |
