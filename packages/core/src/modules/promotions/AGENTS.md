# Promotions Module — Agent Guidelines

Use `promotions` for the rule-tree evaluation engine, promotional codes, and the usage/budget ledger. This module ships Release 4 Phases 1-3 of `.ai/specs/SPEC-055-2026-02-23-promotions-module.md`; Phases 4-5 (extensibility registry, custom rule/benefit types, admin configurator widgets) are spec-only — do not build them without a fresh plan/approval. Read `packages/core/AGENTS.md` first for the generic command/migration/ACL/`withAtomicFlush` contract; this file only covers what's specific to `promotions`.

## Always

1. **MUST `container.register({ auth: asValue(auth) })` before resolving `promotionsService`** from any route or command, in this module or another — `evaluate`/`evaluateForProduct` (and the code/usage methods) read `container.resolve('auth')` for tenant/org scope and fail closed with `400` when it's absent. `api/evaluate/route.ts` is the reference route-level registration; `cart.reprice` (in the `cart` module) is the reference command-level registration.
2. **MUST resolve "which promotion does this code unlock" by reading `Rule`/`Promotion` directly** — `Code` has no `promotionId` column; the only link is a `ruleType: 'code'` rule's `config.codeId`, the same lookup `lib/rule-evaluators.ts`'s `evaluateCode` function performs during evaluation. Never invent a second resolution path.
3. **MUST resolve a code string through `lib/code-service.ts`'s exported `resolveCodeByString`** — it is the one place that checks both `Code.code` and `GeneratedCode.code` (the W5d one-namespace rule is an application convention, not a DB constraint). `reserveCode`/`useCode`/the code-generation worker's collision check/the `release` route's codeString→codeId resolution all call it; never re-derive "does this code exist" independently. QA F9: `code`/`prefix`/`suffix` are stored trim+upper-cased (`data/validators.ts`'s `clearableUppercaseStringSchema`, charset `A-Z0-9` only) and `resolveCodeByString` normalizes the presented string the same way — any OTHER direct `Code`/`GeneratedCode` lookup by code string (e.g. `useCode`'s own row-locking `GeneratedCode` query, which cannot call `resolveCodeByString` because it needs `LockMode.PESSIMISTIC_WRITE`) MUST apply the identical `codeString.trim().toUpperCase()` normalization or it silently reintroduces a case-sensitive mismatch.
4. **MUST use `LockMode.PESSIMISTIC_WRITE` inside `withAtomicFlush`, joining `ctx.transactionalEm` when a caller supplies one** for any new concurrency-sensitive write (budget/usage/code-exhaustion checks) — never serializable isolation, never a retry loop. `useCode` (locks `Code`/`GeneratedCode`) and `registerUsage` (locks `Promotion`) are the reference implementations.
5. **MUST wire `runRouteMutationGuards` explicitly into every mutating HTTP route** in this module — `commandBus.execute()` does not run mutation guards internally (confirmed: no reference to the guard registry anywhere in the command bus itself).
6. **MUST sum `|amountNet|` excluding `ADD_FREE_ITEM` effects** when computing budget consumption, and MUST skip budget enforcement entirely on a cross-currency order/budget mismatch (no FX conversion exists in this module) — do not silently convert or approximate.
7. **MUST keep Pass 1 (`lib/rule-evaluators.ts`)/Pass 2 (`lib/unit-selection.ts`)/Pass 3 (`lib/effect-resolvers.ts`) free of any `EntityManager` parameter** — the whole evaluation pipeline is pure and DB-free by construction; only `services/promotion-cache.ts` touches the database, once per evaluation, upstream of the pipeline.
8. **MUST emit both `amountNet` and `amountGross` on every amount-carrying effect** — never a single `amount` plus a basis flag; that model was replaced specifically because it let `sales`-side code silently reuse one side for the other.
9. **MUST invalidate the tree cache only from promotion/code mutation events, and the per-promotion counters-key cache only from usage events** (`subscribers/invalidate-*`) — never cross-wire the two; a usage event must never trigger a tree-cache invalidation and vice versa.

## Ask First

- Ask before building any Phase 4/5 surface (the extensibility registry, custom rule/benefit types, admin configurator widgets, delivery/payment/address/consent rule types) — these are explicitly hidden in Release 4 (D-R4-14) pending a real data source or owner decision.
- Ask before adding a sixth DI service or changing any of the five frozen DI token names (`promotionCacheService`, `promotionCodeService`, `promotionCodeGenerationService`, `promotionUsageService`, `promotionsService`) — SPEC-055's "Release 4 Contract Freeze" names them as STABLE.
- Ask before changing rounding (half-up at the currency's fraction digits) or the per-benefit `max_discount` ratio-scaling rule across multiple `LINE_DISCOUNT` effects — both are documented judgment calls with worked test cases (`TC-PROM-014`, `TC-PROM-065`) pinned to them.
- Ask before adding FX conversion to budget enforcement — the current cross-currency skip is deliberate, not a gap waiting to be filled casually.

## Never

- Never give any rule evaluator, unit selector, or effect resolver a DB/`EntityManager` dependency — the whole point of the three-pass pipeline is that it's provably pure and fast (measured P95 ≈ 5ms at 200 promotions × 50 lines); any DB access belongs in `services/promotion-cache.ts`, upstream.
- Never add `organizationId`/`tenantId` to a request body on any cart-facing route (`evaluate`, `product-page`, `dynamic-labels`, `free-products`, `codes/*`, `usage/*`) — scope comes from the resolved auth/API-key identity only.
- Never add a module-specific auth header/scheme (e.g. a revived `X-Module-Key`) — every route uses the platform's standard `getAuthFromRequest`, unifying API-key and cookie-session identity.
- Never add `ce.ts`, `translations.ts`, or `search.ts` to this module — none exist today, by the spec's own non-goals for Phases 1-3 (the extensibility registry that would need them is Phase 5).

## Validation Commands

```bash
yarn db:generate
yarn generate
yarn workspace @open-mercato/core build
yarn jest src/modules/promotions
```

`promotions/__integration__/*.spec.ts` (Playwright) need a live dev server + disposable Postgres — see `.ai/qa/AGENTS.md`. This app's dev server serves packages from built `dist/` output: rebuild (`yarn workspace @open-mercato/core build`) after every source edit, before any live/Playwright check. The 200-promotion × 50-line P95 benchmark (`lib/__tests__/evaluation-engine-performance.test.ts`) runs in-process with no DB/network — keep any extension to it that way.

## Commands

| Command id | File | When to use |
|---|---|---|
| `promotions.promotion.create/.update/.delete` | `commands/promotions.ts` | Admin promotion CRUD, undo via snapshots. |
| `promotions.rule_tree.reconcile` (`RULE_TREE_RECONCILE_COMMAND_ID`), `promotions.promotion.reorder` (`PROMOTION_REORDER_COMMAND_ID`) | `commands/rule-tree.ts` | Tree-builder save and list drag-sort. Both protect the `Promotion` aggregate directly with its own `updatedAt` optimistic lock, independent of the row-level header `CrudForm` sends for plain metadata PUTs. |
| `promotions.code.reserve/.release/.use` | `commands/codes.ts` | The code lifecycle. `.use` row-locks `Code`/`GeneratedCode`. |
| `promotions.code.create/.update/.delete` | `commands/codes.ts` | Admin `Code` CRUD, mirroring `commands/promotions.ts`'s shape — backs the admin `codes` route. |
| `promotions.usage.register/.revert` | `commands/usage.ts` | Budget ledger. `register` processes `appliedPromotions[]` independently per promotion (own lock, own budget re-read, own ledger row), returning `budgetExceeded: string[]` rather than throwing. |

`validateCode`/`extendReservation` are plain reads/housekeeping on `PromotionCodeService`/`promotionsService` — per §A.2a, never wrap them in `commandBus.execute()`.

## Evaluation Pipeline

Pass 1 → Pass 2 → Pass 3, orchestrated by `lib/evaluation-engine.ts`'s `evaluatePromotions` (date window, excluded tags, currency eligibility, optimistic budget pre-check, non-cumulative `break`, tag accumulation — ordering/cumulativity/tag-exclusion all live here; there is no separate `lib/tag-exclusion.ts`).

- **Pass 1 — `lib/rule-evaluators.ts`**: eleven Release-4 rule types (`order_value`, `order_date`, `product_count`, `cart_weight`, `row_total`, `product`, `category` [includes descendants, D-R4-15], `product_attribute`, `customer_group`, `customer_order_history`, `code`). Six more types are reserved in the data model but hidden until a real data source exists (D-R4-14) — do not wire them up speculatively.
- **Pass 2 — `lib/unit-selection.ts`**: selector ordering, cart-wide cap budget spending (`max_quantity`/`max_lines`/`quantity_step`).
- **Pass 3 — `lib/effect-resolvers.ts`**: four resolved effect types — `LINE_DISCOUNT`, `CART_DISCOUNT`, `ADD_FREE_ITEM` real; `DELIVERY_DISCOUNT` defined but unreachable in Release 4 (no rule set can produce it, D-R4-14).

## Key Entities (`data/entities.ts`)

- **`Promotion` → `RuleGroup`** (recursive AND/OR tree) **→ `Rule`** (polymorphic `ruleType` + `config` jsonb) **and `Benefit`** (polymorphic `benefitType` + `config` jsonb, each with an `appliesTo: 'order'|'line'|'unit'` target and a shared quantity-cap block).
- **`Code`/`GeneratedCode`** — static vouchers vs. dynamically generated pools. `CodeReservation`'s unique key is `(code_id, cart_id)` (D-R4-8 — per-cart, not per-customer) with a 24h TTL. MUST keep its own sweeper (`services/code-reservation-sweeper.ts`, 30-min cadence) independent of `cart`'s own expiry/abandonment sweepers — a reservation must not depend on another module's job succeeding.
- **`CodeUsage`/`PromotionUsage`** — per-use and per-order ledger rows. `PromotionUsage` is `ON DELETE RESTRICT` (no cascade) — it's a compliance audit trail; never give it a cascading delete rule.
- Code generation (`workers/code-generation.worker.ts`) MUST reconcile `Code.generated` from a fresh `COUNT(*)` against `promotion_generated_codes` on every run (idempotent restart), never trust the possibly-stale counter column directly.

## HTTP Surface

Admin CRUD: `/api/promotions`, `/api/promotions/[id]`, `/api/promotions/[id]/tree`, `/api/promotions/codes*`. Cart-facing reads: `evaluate`, `product-page`, `dynamic-labels`, `free-products` — visibility resolved via `customer_groups.CustomerGroupsService.resolveAssortmentScope`, not `ecommerce`'s heavier `resolveBuyerContext` (none of these four wire contracts can supply the store/channel binding it needs); `product-page`/`dynamic-labels` carry no buyer identity at all, so they resolve against the anonymous/default-group scope rather than skip the check; all three fail CLOSED to empty results if scope resolution genuinely fails. Cart-facing codes/usage: `codes/{reserve,validate,use,release}`, `usage/{register,revert}` — thin adapters over the DI services. Full route-by-route detail belongs in `apps/docs/docs/api/promotions.mdx`, not here.
