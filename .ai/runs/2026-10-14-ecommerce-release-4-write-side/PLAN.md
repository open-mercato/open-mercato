# Plan — eComm Release 4 (write side)

**Branch:** `feat/release-4-write-side`
**PR:** adeptofvoltron/open-mercato#15 (base `develop` on the fork)
**Created:** 2026-10-14
**Decisions (authoritative until Phase 0 lands):** `.ai/specs/analysis/ANALYSIS-2026-10-14-ecommerce-release-4-decisions.md` (D-R4-1 … D-R4-29)
**Analyses:** `.ai/specs/analysis/ANALYSIS-2026-10-14-{cart-module-release-4,spec-055-promotions-release-4,buyer-scoped-catalog-visibility-phase-3,ecommerce-release-4-scope}.md`
**Source specs:** `.ai/specs/2026-08-14-cart-module.md` (Phases 1–3) · `.ai/specs/SPEC-055-2026-02-23-promotions-module.md` (Phases 1–3) · `.ai/specs/2026-08-21-buyer-scoped-catalog-visibility.md` (Phase 3)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 0 | 0.1 | Revise cart-module spec to rev 9 | inline | done | see `git log` |
| 0 | 0.2 | Amend SPEC-055 (promotions) for the release decisions | inline | done | see `git log` |
| 0 | 0.3 | Revise buyer-scoped visibility spec (Phase 3 folded into cart) | inline | done | see `git log` |
| 0 | 0.4 | Cross-spec consistency pass, roadmap and ADR touch-ups | inline | done | see `git log` |
| 1 | 1.1 | Promotions: scaffold module, ACL, events, setup, DI | dispatch | done | see `git log` |
| 1 | 1.2 | Promotions: entities, validators and migration (incl. PromotionUsage) | dispatch | done | see `git log` |
| 1 | 1.3 | Promotions: promotion CRUD commands with undo, events, cache invalidation | dispatch | done | see `git log` |
| 1 | 1.4 | Promotions: rule-tree reconcile command, tree PUT, order PATCH, optimistic locking | dispatch | todo | — |
| 1 | 1.5 | Promotions: CRUD API routes, OpenAPI, mutation guards | dispatch | todo | — |
| 1 | 1.6 | Promotions: i18n (5 locales) and backend list page | dispatch | todo | — |
| 1 | 1.7 | Promotions: promotion form pages and rule-tree builder | dispatch | todo | — |
| 1 | 1.8 | Promotions: benefit card (Applies to, Limits, Which pieces) and echo line | dispatch | todo | — |
| 1 | 1.9 | Promotions: Phase 1 API integration tests | dispatch | todo | — |
| 1 | 1.10 | Promotions: Phase 1 UI integration tests | dispatch | todo | — |
| 2 | 2.1 | Promotions: public types barrel and pure three-pass evaluation engine | dispatch:capable | todo | — |
| 2 | 2.2 | Promotions: rule evaluators for the Release 4 rule set | dispatch | todo | — |
| 2 | 2.3 | Promotions: unit selection and effect resolvers (net and gross, caps, rounding) | dispatch:capable | todo | — |
| 2 | 2.4 | Promotions: tag exclusion and cumulativity | dispatch | todo | — |
| 2 | 2.5 | Promotions: promotion cache, counters key and invalidation subscriber | dispatch | todo | — |
| 2 | 2.6 | Promotions: promotionsService evaluate and evaluateForProduct with context enrichment | dispatch | todo | — |
| 2 | 2.7 | Promotions: evaluate, product-page, dynamic-labels, free-products routes with API-key auth | dispatch | todo | — |
| 2 | 2.8 | Promotions: Phase 2 tests (engine unit, API, zero-DB assertion, 200-promotion benchmark) | dispatch | todo | — |
| 3 | 3.1 | Catalog: catalogBuyerPricingService extracted from ecommerce | dispatch:capable | todo | — |
| 3 | 3.2 | Catalog: catalogScopedProductService with equivalence property test | dispatch:capable | todo | — |
| 3 | 3.3 | Availability: shared quantity-rule derivation | dispatch | todo | — |
| 3 | 3.4 | Ecommerce: repoint onto the shared seams and add the fresh buyer-context option | dispatch:capable | todo | — |
| 4 | 4.1 | Cart: scaffold module, ACL, setup, events, DI, encryption, i18n | dispatch | todo | — |
| 4 | 4.2 | Cart: entities, validators and migration (incl. Phase 4 seam columns) | dispatch:capable | todo | — |
| 4 | 4.3 | Cart: token hashing, route-edge store and scope resolution, strict bodies | dispatch:capable | todo | — |
| 4 | 4.4 | Cart: evaluateCartVisibility with variant-derives-product and branded scope | dispatch:capable | todo | — |
| 4 | 4.5 | Cart: create and get commands (forced storefront channel, store binding) | dispatch | todo | — |
| 4 | 4.6 | Cart: line add, update, remove and bulkAdd commands with snapshots | dispatch:capable | todo | — |
| 4 | 4.7 | Cart: /api/cart/current routes, idempotency, rate limits, mutation guards | dispatch | todo | — |
| 4 | 4.8 | Cart: sweeper workers, scheduling and Upgrade Action | dispatch | todo | — |
| 4 | 4.9 | Cart: Phase 1 tests (R1 visibility suite, cross-tenant token, concurrency, idempotency) | dispatch:capable | todo | — |
| 5 | 5.1 | Cart: re-price triggers 1–4 and 7, per-request digest, priceChanges disclosure | dispatch:capable | todo | — |
| 5 | 5.2 | Cart: quantity tiers and nextTier | dispatch | todo | — |
| 5 | 5.3 | Cart: quantity rules and computed availability advisory | dispatch | todo | — |
| 5 | 5.4 | Cart: line-total discount mapping and totals-equivalence property test | dispatch:capable | todo | — |
| 5 | 5.5 | Cart: Phase 2 tests, each trigger in isolation | dispatch | todo | — |
| 6 | 6.1 | Promotions: code entities with per-cart reservations and migration | dispatch | todo | — |
| 6 | 6.2 | Promotions: code commands and code service (validate, reserve, release, use) | dispatch:capable | todo | — |
| 6 | 6.3 | Promotions: usage service with row-lock budget cap | dispatch:capable | todo | — |
| 6 | 6.4 | Promotions: code generation worker, service and routes | dispatch | todo | — |
| 6 | 6.5 | Promotions: reservation sweeper | dispatch | todo | — |
| 6 | 6.6 | Promotions: codes backend pages | dispatch | todo | — |
| 6 | 6.7 | Promotions: codes and usage HTTP routes with API-key auth | dispatch | todo | — |
| 6 | 6.8 | Promotions: Phase 3 tests (codes, reservations, usage, concurrency, UI) | dispatch:capable | todo | — |
| 7 | 7.1 | Cart: promotions integration, context mapping, free-item lines, flagged-line exclusion | dispatch:capable | todo | — |
| 7 | 7.2 | Cart: code application and reservation lifecycle | dispatch | todo | — |
| 7 | 7.3 | Cart: merge policy, merge log and single restore function | dispatch:capable | todo | — |
| 7 | 7.4 | Cart: triggers 5 and 6, merge-time re-visibility pass | dispatch:capable | todo | — |
| 7 | 7.5 | Cart: lock, unlock and markConverted service and commands | dispatch:capable | todo | — |
| 7 | 7.6 | Cart: Phase 3 gates (R1/R7/R13, equivalence with promotions via sales order, P95) | dispatch:capable | todo | — |
| 7 | 7.7 | Docs: module AGENTS.md files, API docs, UPGRADE_NOTES, spec changelogs and statuses | dispatch | todo | — |
| 7 | 7.8 | Create-app template sync for cart/promotions (app registration already done per-module, see 1.1 note) | dispatch | todo | — |

## Goal

Ship the e-commerce write side on the fork: a `cart` module (Phases 1–3), a `promotions` module (SPEC-055 Phases 1–3) and buyer-scoped catalog visibility Phase 3 enforced inside the cart. The release invariant is that cart totals equal the totals of the order the cart becomes, and that a product hidden from a buyer cannot enter a lockable cart through any route (create, line commands, merge, promotion gifts, non-storefront channels).

## Scope

In scope: the three spec scopes above, the shared seams in `catalog` and `availability` (D-R4-3), the ecommerce refactor onto them, and enabling the two new modules in `apps/mercato`.

## Non-goals

Cart Phase 4 (B2B approvals, bulk lines, admin list, proposal seam §7a), SPEC-055 Phases 4–5, visibility Phase 4, checkout, delivery/payment/address/consent promotion rules (hidden in the UI, D-R4-14). Do not create `ce.ts`, `translations.ts`, `search.ts`, `notifications.ts` or widget injection files in `promotions`.

## Risks

- R1 reopened by any route that bypasses the visibility check: the suite attacks the HTTP surface, not only the commands.
- Cart/order total divergence: guarded by the equivalence property test (Steps 5.4 and 7.6).
- Budget overshoot under concurrency: guarded by the row-lock test (6.3, 6.8).
- Multi-module change (catalog, availability, ecommerce): the ecommerce `TC-ECOM-*` suites must stay green after Phase 3.
- Contract freeze: event ids, DI tokens, ACL features, routes and exported types minted here become STABLE (see BACKWARD_COMPATIBILITY.md); follow D-R4-25 for event ids.

## Operating rules for this run

- Environment: Node 24 (`export PATH="/home/bernard/.nvm/versions/node/v24.16.0/bin:$PATH"`). Fresh worktree order: `yarn build:packages` → `yarn generate` → `yarn build:packages`.
- Never run `yarn db:migrate` (AGENTS.md "Ask First"); use `yarn db:generate`, review the SQL, keep only the intended migration and the module's `.snapshot-open-mercato.json`.
- Run gate tasks with `--force` (the turbo cache is shared across worktrees) and never pipe a gate command into `tail` (it masks the exit code).
- Run the `packages/ui` tests with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` (a Polish locale breaks `format.test.ts`); jest filters are bare positional patterns, not `--testPathPatterns`.
- The fork CI may never start (fork-internal PRs have no runner); the local gate is the authority. Do not block the end of the run waiting for CI.
- Steps whose Exec is `dispatch` must be fully implementable from the Step's spec anchors; each Step is exactly one commit.

## Implementation Plan

Each Step below matches the Tasks table. Spec section numbers refer to the specs as revised in Phase 0.

### Phase 0 — Spec revision (docs only)

- **0.1 Revise cart-module spec to rev 9.** Apply D-R4-1…D-R4-9, 18–21, 22–24, 29: header/status; server-derived scope and forced storefront channel (§6a, §8.3, §10); routes become header-bound `/api/cart/current/*` (Q5, §10, §14); `token_hash`; Phase 4 seam columns and `resolved_at` in the Phase 1 data model; flagged-line state; `promotion_id`/`origin`/`discount_total_net`; idempotency entity; lock/convert commands; `strategy: 'manual'` → 501; availability computed, not persisted; line-total discount mapping (§3.2, §14); delivery effects out of cart totals; re-cut §15 gates; a Migration & BC section; a step-level plan with `TC-CART-*` ids; error-code and rate-limit catalogue; module-id exception. Close Q5 and Q6 in the Open Questions. Changelog entry dated 2026-10-14.
- **0.2 Amend SPEC-055.** Apply D-R4-7…16, 25–28: §B.6 rule 1 / A-R6 / `TC-PROM-060` / 2.1.1 changelog for `discountAmountBasis: 'line'`; `amountNet` + `amountGross` and the rounding rule; API-key auth, features, no tenant ids in bodies; free-item contract (marker, context flag, assortment, lifecycle); per-cart reservations and the sweeper; row-lock budget; `evaluatedAt` and counters key; Release 4 rule set, `customer_group` instead of `user_group`, category descendants; promotional price kinds and `exclude_flags`; underscore event ids; mounted route paths; one DI token table; public TypeScript contract section; single-currency validation; BuyerContext identity; Phase 1–3 plan re-threaded (PromotionUsage and i18n into Phase 1, `promotionsService` step, `TC-PROM-050`–`057` assigned, `yarn generate` not `modules:prepare`, no `yarn db:migrate`); UI integration tests; optimistic locking; DS tokens in the tree builder; command undo table; Release 4 contract-freeze table. Changelog entry.
- **0.3 Revise the visibility spec.** Header and §12 status (Phases 1–2 shipped, Phase 3 folded into cart Phases 1–3 with the ownership table from the visibility analysis); §5.3/§6.1 server-derived scope, new §6.1a (route-edge derivation, store binding), named predicates and branded type, full list of commands that take the scope; variant-derives-product; flagged-line semantics (§6.2); lock command; `triggeredBy: 'merge'`; §6.3a one event per request; §11 timing assertion reworded; checkout obligation (D-R4-24); promotion-gift and promotion read endpoints respect scope. Changelog entry.
- **0.4 Cross-spec consistency pass.** Grep the three specs, `2026-08-14-ecommerce-suite-roadmap.md`, `2026-08-21-pricing-engine.md` and `storefront-public-api.md`/SPEC-029 for stale claims (token in path, `X-Module-Key`, `assortmentScope` in request bodies, per-unit discount division, `added_by: 'merge'` for gifts, hyphenated event ids, "no cart on develop") and fix each; add the ADR notes the roadmap needs; make the Phase 1–3 step lists of cart, SPEC-055 and visibility agree with this PLAN; update the scope file's status table. Docs-only; run `find .ai/specs -maxdepth 2 -name '*.md'` and the markdown link check if the repo has one.

### Phase 1 — Promotions foundation (SPEC-055 Phase 1)

- **1.1 Scaffold.** `packages/core/src/modules/promotions/`: `index.ts` (metadata), `acl.ts` (incl. D-R4-11 features), `events.ts` (underscore ids), `setup.ts` (`defaultRoleFeatures`), `di.ts`. No `ce.ts`/`translations.ts`/`search.ts`/`notifications.ts`/widgets.

> **Plan correction (found during Step 1.2, 2026-10-14).** This note originally said "register in `apps/mercato/src/modules.ts` only in Step 7.8." That is not achievable: `yarn db:generate`'s module list comes exclusively from `apps/mercato/src/modules.ts`'s `enabledModules` (`packages/cli/src/lib/resolver.ts` `loadEnabledModulesFromConfig`; no `--module` scoping flag exists for `db generate`), so a module's entities cannot be migrated before the module is registered. Step 1.2 registered `promotions` in `apps/mercato/src/modules.ts` for exactly this reason, and `cart`'s own Step 4.2 (migration) will do the same. **Step 7.8 narrows to:** keep both modules commented out in the `create-app` template (D22 precedent) and run `yarn template:sync:fix` + a final `yarn generate` — the app-registration half of 7.8 already happened earlier, per module, at its first migration-needing step.
- **1.2 Entities, validators, migration.** `Promotion`, `RuleGroup`, `Rule`, `Benefit`, `PromotionUsage` (RESTRICT, no cascade), zod validators including the shared quantity-cap block, per-type `applies_to` allow-list, write-path rejections (`TC-PROM-062`), single-currency validation (D-R4-27), rule set restricted per D-R4-14. `yarn db:generate`; keep only the promotions migration and snapshot.
- **1.3 CRUD commands.** Create/update/delete with undo, events, cache invalidation after commit; command undo table in the module AGENTS notes.
- **1.4 Rule-tree command and order endpoint.** `commands/rule-tree.ts` with `withAtomicFlush`; `PUT /tree` carrying the promotion's `updatedAt` (409 on stale); `PATCH /order` with per-item `updatedAt`.
- **1.5 API routes.** Collection routes at `api/route.ts` and `api/[id]/route.ts`, `makeCrudRoute` + `indexer`, per-method `metadata`, OpenAPI, mutation-guard registry on custom writes.
- **1.6 i18n and list page.** `i18n/{de,en,es,ko,pl}.json`, backend list page with card layout, drag-sort, filters, batch save; `yarn i18n:check-sync`.
- **1.7 Form pages and tree builder.** `CrudForm` create/detail, `RuleGroupNode` recursive component; design-system tokens only (no hard-coded status colours, no arbitrary values); `Cmd/Ctrl+Enter` and `Escape`.
- **1.8 Benefit card.** Applies to, Limits, Which pieces, the plain-language echo line, category-descendants echo (D-R4-15), `exclude_promotional_prices` (D-R4-16).
- **1.9 API integration tests.** CRUD, tree, order, `applies_to` persistence, write-path rejections (`TC-PROM-062/067/071`), optimistic-lock conflicts. Self-contained fixtures via API, cleanup in `finally`.
- **1.10 UI integration tests.** Playwright: tree builder save/reload, capped benefit cannot save without a selector, list drag-sort and save.

### Phase 2 — Promotions engine (SPEC-055 Phase 2)

- **2.1** `lib/types.ts` public barrel (all A.2 types) and `lib/evaluation-engine.ts`: pure three-pass evaluator over `NormalizedPromotion[]`, no DB access, `evaluatedAt` from the context (D-R4-13), currency eligibility and optimistic budget pre-check before Pass 1.
- **2.2** `lib/rule-evaluators.ts` for the D-R4-14 rule set (`customer_group`, category with descendants, `priceIsPromotional` handling).
- **2.3** `lib/unit-selection.ts` and `lib/effect-resolvers.ts`: caps, `max_discount`, `amountNet` + `amountGross`, half-up rounding at the currency's fraction digits (D-R4-10), gift reward with `promotionId` marker, no delivery discount.
- **2.4** `lib/tag-exclusion.ts`: ordering, cumulativity, tag exclusion.
- **2.5** `services/promotion-cache.ts` (all `active = true`, normalised and frozen outside production, SKU→product/variant ids resolved at build), separate counters key, subscriber invalidating on promotion mutations only.
- **2.6** `promotionsService.evaluate/evaluateForProduct`, batch context enrichment from `productId`/`variantId` (D-R4-21), `BuyerContext` identity (D-R4-28).
- **2.7** `api/evaluate`, `api/product-page`, `api/dynamic-labels`, `api/free-products` routes: API-key identity, features, scope from auth, ownership checks, assortment scope respected (D-R4-7), OpenAPI; no `delivery-methods` route in this release.
- **2.8** Tests: per-rule engine unit tests with a throwing EntityManager (zero DB), end-to-end `ResolvedEffect` amounts, cumulativity, tag exclusion, deterministic selection (`TC-PROM-064`), cross-tenant test per route, benchmark at 200 promotions × 50 lines (P95 ≤ 150 ms).

### Phase 3 — Shared seams (D-R4-3)

- **3.1** `catalogBuyerPricingService.resolveLinePrice(...)` (winning row, net/gross/tax rate, tier + next tier, `priceIsPromotional`) extracted from `ecommerce/lib/storefrontPricing.ts`; additive DI key; unit tests.
- **3.2** `catalogScopedProductService.loadScopedProducts(ids, scope)` returning `{ id, categoryIds (ancestor-expanded), tagIds, isActive }`, batch via `computeProductScopeKeys`, `null` for missing/deleted/other-tenant; property test tying it to `matchesScope` and the existing `evaluateIndexDocFilter`/`buildProductScopeKeys` equivalence (seeded `mulberry32`).
- **3.3** Shared quantity-rule derivation in `availability` (from `ecommerce/lib/storefrontDetail.ts`).
- **3.4** Repoint ecommerce onto 3.1–3.3 without behaviour change; add the optional `fresh` option to `storeContextService.resolve` (D-R4-22). `TC-ECOM-010/012` and the other ecommerce suites stay green.

### Phase 4 — Cart Phase 1 (core cart with visibility built in)

- **4.1** Scaffold `packages/core/src/modules/cart/` (`requires: catalog, sales, customer_groups`; ecommerce soft; promotions from 7.1), ACL, `setup.ts`, events (`cart.line.visibility_rejected` once per request, D-R4-23), DI, `encryption.ts` (`email`, `note`), `i18n/{de,en,es,ko,pl}.json`.
- **4.2** Entities and migration with every column from D-R4-5, 7, 9, 18, 19 (flag state, `promotion_id`/`origin`, `discount_total_net`, `token_hash`, seam columns, lock columns, `resolved_at`, no persisted availability), `CartIdempotencyKey`, `CartMergeLog`; unique index with `NULLS NOT DISTINCT` (or COALESCE expression) including `promotion_id`; zod validators.
- **4.3** Token lib, route-edge helper resolving store/scope through `storeContextService` (soft DI), store binding, `.strict()` request schemas (D-R4-1, 6).
- **4.4** `lib/visibility.ts` `evaluateCartVisibility` — the only caller of `matchesScope` in cart; variant-derives-product; branded `ResolvedAssortmentScope` and named predicates; uniform `product_unavailable` for restricted and nonexistent.
- **4.5** Create and get commands: forced storefront channel, store from host (D-R4-2), non-storefront creation only via authenticated command with a feature.
- **4.6** `cart.lines.add/.update/.bulkAdd/.remove` using `catalogBuyerPricingService`, snapshots, visibility check on every write, `remove` never blocked, batch loading for `bulkAdd(100)`.
- **4.7** `/api/cart/current/*` routes (`X-Cart-Token`), idempotency keys, rate limits via shared `ratelimit` (`CART_*`), mutation guards, `enforceCommandOptimisticLock`, 409/423 bodies.
- **4.8** Workers `cart:mark-abandoned/expire/release-stale-locks/purge-expired`, scheduling via `schedulerService` in `onTenantCreated` and an Upgrade Action, all queries filter `kind = 'basket'`.
- **4.9** Tests: the R1 suite (add/update/bulkAdd/omitted scope/body-supplied scope/`null`/exempt channels/enumeration/cross-product variant), anonymous create with `channel: 'api'` → 400, cross-tenant token answers like an unknown token, concurrency, idempotency, token never in path or query.

### Phase 5 — Cart Phase 2 (pricing behaviour)

- **5.1** Triggers 1–4 and 7, per-request `BuyerContext` digest comparison (also on GET), `priceChanges` including `buyer_context_changed`, GET writes only when a trigger fires.
- **5.2** Quantity tiers and `nextTier`.
- **5.3** Quantity rules (min/max/increment, `nearestValid`) and the computed availability advisory.
- **5.4** Line-total discount mapping to `SalesLineSnapshot` and the totals-equivalence property test without promotions: same snapshots give equal `SalesDocumentAmounts` for `quote` and `order`, 4-dp numerics, over the tax matrix and a non-dividing quantity.
- **5.5** Tests: each trigger verified in isolation, no re-price outside the set, two GETs leave `updated_at` unchanged.

### Phase 6 — Promotions Phase 3 (codes and usage)

- **6.1** `PromotionCode`, `GeneratedCode`, `CodeReservation` (with `cart_id`, unique `(code_id, cart_id)`), `CodeUsage`; one normalised code namespace per tenant/organization; migration.
- **6.2** Code commands and code service: validate, reserve (idempotent per cart), `extendReservation`, release by `cartId`, use; capacity-holding rules (D-R4-8); rate limit; uniform errors.
- **6.3** `promotionUsageService.registerUsage/revertUsage`: row lock then re-read sum, idempotent upsert, 207 Multi-Status, `budget_exhausted` event on first hit, counters-key update.
- **6.4** Code generation worker (`promotions-code-generate`), generation service, `codes`, `codes/[id]/generate`, `codes/[id]/generated` routes.
- **6.5** Reservation sweeper (queue worker + scheduler registration owned by promotions).
- **6.6** Codes backend pages (list, create, detail with generated-codes panel), i18n, DS tokens.
- **6.7** `codes/reserve|validate|use|release` and `usage/register|revert` routes with API-key auth and features.
- **6.8** Tests `TC-PROM-023`–`026`, `050`–`057`: concurrent reserve of the last code, concurrent `registerUsage` in an ambient transaction, cross-tenant per route, UI test for the codes pages.

### Phase 7 — Cart Phase 3 and release gate

- **7.1** `promotionsService` integration: `toPromotionCartContext`, effects → line discounts (basis `line`) and order adjustments (net + gross), gift lines with `promotion_id` (assortment-checked, buyer-immutable), flagged lines excluded from evaluation, delivery effects discarded; `requires` gains `promotions`.
- **7.2** Code application and reservation lifecycle: apply/remove, extend on activity, release on merge/abandon/expiry, `cart.promotion.no_longer_valid` and a warning on lapse.
- **7.3** Merge policy (five login situations, same store and currency only), `CartMergeLog` with its polymorphic actor, undo with one restore function and the 15-minute window on the buyer route.
- **7.4** Triggers 5 and 6, the merge-time re-visibility pass (§6a.5, `triggeredBy: 'merge'`, dispositions in `mergeSummary`, lines rejected rather than dropped), fresh buyer context on lock and merge routes.
- **7.5** `cartService.lock/unlock/markConverted` and commands; lock re-prices, runs the visibility pass and refuses with `409 cart_has_unavailable_lines`; optimistic-lock and `withAtomicFlush` so a concurrent add yields 409.
- **7.6** Release gates: R1/R7/R13 regression suite end to end, totals equivalence with promotions by creating an order through the existing `sales` command from the cart's lines, P95 ≤ 150 ms (50 lines × 200 promotions), restricted line merged from an exempt-channel cart rejected-and-disclosed.
- **7.7** Docs: `cart/AGENTS.md` and `promotions/AGENTS.md`, `apps/docs` API pages, `UPGRADE_NOTES.md`, spec changelogs and statuses (move nothing to `implemented/` — phases remain), Task Router rows if warranted (budget check `yarn agents:check-budget`).
- **7.8** `apps/mercato/src/modules.ts` registration already happened per-module (promotions at Step 1.2, cart at Step 4.2 — see the 1.1 plan-correction note above). This step is now just: keep both commented out in the create-app template (D22 precedent); `yarn template:sync:fix`; final `yarn generate`.

## External References

None.
