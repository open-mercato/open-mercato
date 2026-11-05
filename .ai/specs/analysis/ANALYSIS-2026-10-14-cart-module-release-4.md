# Pre-Implementation Analysis: Cart Module (rev 8) — Release 4, Phases 1–3

> **Spec**: `.ai/specs/2026-08-14-cart-module.md` (rev 8, 2026-09-27).
> **Scope**: Release 4 = Phases 1–3 (core cart, pricing behaviour, promotions and merge incl. §6a.5). Phase 4 (B2B, admin, proposal seam §7a) is out of scope; §10 confirms Phases 1–3 don't paint it into a corner.
> **Verified against**: `develop` @ `28ca93ed97` (2026-10-14), branch `feat/release-4-write-side`.
> **Earlier analysis**: `ANALYSIS-2026-08-14-cart-module.md` (its two Criticals — `version` counter, missing command pattern — were fixed in rev 2; verified). Release 3 decisions D1–D22: `ANALYSIS-2026-10-05-storefront-release-decisions.md`.

## Executive Summary

The domain design is sound and its core discipline (the cart does no arithmetic) still holds against today's `sales` code. But the spec was written when `ecommerce`, `customer_groups`, `availability`, the shared visibility algebra and the `sales` discount contract did not exist. Several of its claims are now stale.

More importantly, **the write-side security model has two Critical holes the visibility Phase 3 gate would not catch**:
- The assortment scope is a caller-supplied field on a *public* route, and a client can send `null` (unrestricted).
- A public `POST /carts` lets the client choose `channel` and `store`, which sidesteps §6a entirely.

Five integration contracts with SPEC-055 don't fit together (free-item lines, code reservations, delivery discounts, cart-context enrichment, reservation keys). The lock/convert surface the visibility gate depends on is not specified at all.

**Verdict: Needs spec updates first.** 8 Critical, 20 Warnings. None needs domain-model rework. Open Questions 5 and 6 get recommended resolutions in §9.

## 1. What is stale in the spec (verified against current code)

| # | Spec claim | Reality on `develop` | Effect |
|---|---|---|---|
| S1 | §3.2 rule 1 / rev 5: "`discountAmountBasis` and `resolveLineDiscountTotal` occur nowhere"; `buildBaseLineResult` always multiplies by quantity | Both exist: `SalesLineSnapshot.discountAmountBasis?: 'unit'\|'line'` (`sales/lib/types.ts:66`), `resolveLineDiscountTotal` (`sales/lib/calculations.ts:97-116`). Order-line validators accept the basis (`sales/data/validators.ts:345`), landed with #5640. `discountPercent` **wins** over `discountAmount` when non-zero. | `\|amount\|/lineQuantity` is no longer the only option; the sub-cent gap is avoidable (F3). |
| S2 | §3.1 "`catalogPricingService` — unit price for THIS buyer & quantity" | `resolvePrice(rows, ctx)` takes **pre-loaded rows**. The only complete price-for-buyer implementation is ecommerce-private (`ecommerce/lib/storefrontPricing.ts`). | Cart has no sanctioned way to get a unit price (F8). |
| S3 | §5.5 quantity rules "from the availability policy" (flagged as a gap in the 2026-10-11 changelog) | `policyResolutionService.resolveMany(em, scopes)` returns min/max/increment; ecommerce already derives `StorefrontQuantityRules` (`storefrontDetail.ts:633`). | Gap closes; reuse the PDP derivation or cart and PDP disagree (W16). |
| S4 | Implied single `customerId` | `PricingContext` has `customerIds[]`, `customerGroupIds[]`, `priceKindId`; `BuyerContext` carries `customerIds`, `customerOverlayId`, `assortmentScopeHash`, `priceScopeKey`, `digest`. Cart snapshots only `customer_id`, `customer_group_ids`, `price_kind_id`. | D3 snapshot columns insufficient (W9). |
| S5 | `CustomerPurchaseApproval` | Does **not** exist (only `CustomerGroup`, `Membership`, `Terms`). | Phase 4 only; note in spec. |
| S6 | "The storefront route has already called `storeContextService.resolve()`" | True for ecommerce read routes. No storefront cart route exists; `/api/cart/*` is specified public. `storeContextService` has `resolve/resolveBySlug/invalidate` only. | Root of F1/F2. |
| S7 | SPEC-055 `ADD_FREE_ITEM` → `added_by: 'merge'` semantics | Cart rev 7 replaced `added_by` with `added_by_actor_type`. | F4. |
| S8 | D1/D2/D3/D4/D11/D12 | Shipped as decided (D11: `catalogOmnibusService`, `TC-ECOM-013`). | Cart must honour D3, D4 (W8/W9). |

Still open from the 2026-08-17 analysis: no `setup.ts` `defaultRoleFeatures`, no scheduling primitive for the four sweepers, no BC section, no decision on `configuration`/`source_snapshot` encryption.

## 2. Backward Compatibility

`cart` is new; nothing can break an existing contract. The BC-relevant facts are what it touches and what it freezes.

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| 1 | 5, 7, 8, 9, 10 (all new) | Every `cart.*` event ID, `/api/cart/*` path, table, ACL feature, DI key is frozen on first release. Module id `cart` is singular vs the root rule "plural, snake_case" (precedent: `ecommerce`, `checkout`). | Warning | Decide now (C9); keep and record a named exception. |
| 2 | 7 API URLs | Q5: basket routes carry `:token` in the path (§10) while §8.3/R6 forbid it; moving later is breaking. | Warning (Critical after release) | Resolve before Phase 1 (§9). |
| 3 | 7 API URLs | Admin `GET /carts/:id` (Phase 4) and public `GET /carts/:token` collide (one dynamic segment name per Next directory). | Warning | Q5 resolution (`/current/*`). |
| 4 | 2, 3 (consumed) | Consumes `BuyerContext` (STABLE per D15), `StoreContext.digest`, `EffectiveAssortmentScope`, `PricingContext`, `ResolvedTerms` read-only. | None | — |
| 5 | 13 Generated | New module enters generated registries; `apps/mercato/src/modules.ts` gains `cart` + `promotions`; template follows D22 (commented out). | Warning | `yarn generate`, `yarn template:sync:fix`. |
| 6 | 1, 4, 6, 11, 12 | No rename/move/spot/notification/CLI change. | None | — |
| 7 | 9 DI keys (catalog/availability) | F8/C12 add catalog-side DI services. Additive. | Warning | ADDITIVE-ONLY; needs owner approval (multi-module, "Ask First"). |

**Missing BC section.** Add: (a) greenfield, no deprecation owed; (b) the rev 7 renames are paper-only *because Phase 1 creates the new columns directly*; (c) ADR-1/ADR-3 withdrawal of SPEC-029 v3's cart-as-session; (d) SPEC-055 namespace move already applied.

## 3. Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| Migration & BC | Required for contract-touching PRs | Add. |
| Step-level implementation plan | §15 is four paragraphs; `om-auto-continue-pr-loop` needs numbered steps with files | Add step list + file manifest (§8). |
| Test-case IDs | §14 is scenarios only | Assign `TC-CART-001…`; mark gates. |
| Idempotency data model | §8.2 stores keys per cart; no entity, no platform helper | Add `CartIdempotencyKey` (`cart_id`, `key`, `request_digest`, `response_status`, `response_body`, `created_at`, unique `(cart_id,key)`), swept by `expire-carts`. |
| Lock/convert service | §9, trigger 5, `cart.lock.*`, `release-stale-locks`, visibility's lock gate need an API; none in §3.1a/§10 | F7. |
| `setup.ts` | role features, schedule registration | Add. |
| i18n | Codes "translated", no key list | List `cart.warnings.*`/`cart.errors.*`; de, en, es, ko, pl. |
| Public-route scope derivation | Anonymous route has no auth | W8. |
| UI/UX | Phases 1–3 have no UI | State it; tests are API-level. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| §4.1 `Cart` | No `locked_at`/`lock_expires_at`/`checkout_session_id`, `resolved_at` (Q6), `last_price_change_at` (§5.3), `customer_ids`/`assortment_scope_hash` snapshots | Add. |
| §4.2 `CartLine` | No `promotion_id`/origin (F4), no persisted line discount, `deleted_at` implied by "non-deleted" but unstated | Add; define soft-delete. |
| §4.3 | No `code_id`/`code_type`; `evaluate` takes `codes: {id,type}[]` | Add. |
| §5.2 trigger 2 | GET re-prices only if stale, but nothing says every request resolves `BuyerContext` and compares `buyer_digest` | State: digest mismatch fires trigger 2 on any request incl. GET. |
| §6 | `toPromotionCartContext` undefined; `appliedCodes` untyped | X1/X2. |
| §7.1 | Guest vs customer cart may differ in store/currency | Merge only same store+currency; else keep both and disclose (W18). |
| §12 | No worker ids/scheduling/fan-out | W6. |
| R5 | "Measured at Phase 2 gate" but promotions integrate in Phase 3 | W13. |

## 4. AGENTS.md Compliance

| Rule | Location | Fix |
|---|---|---|
| Trust boundaries / tenant scoping | §6a.1, §10 | F1. |
| Modules plural | `cart` | C9. |
| Encryption: free-text notes about people | §4.1 declares only `email`; `note` unencrypted; `configuration` and `source_snapshot` undecided | Encrypt `note`. Leave `configuration` plaintext (encrypting breaks the generated hash) and state the reason. |
| Bearer credential at rest | `token` plaintext | `token_hash` (C13); also removes the dummy-token wart for proposals. |
| Mutation guard registry | §10 | Map each mutating route to create/update/delete guards; public routes pass no `userFeatures`. |
| Per-method `metadata` | §10 | Public `{ requireAuth: false }`; admin `requireFeatures`. |
| Cache | Cart uncached by design | State it; digest comparison replaces invalidation. |
| Undo via `extractUndoPayload` | §3.1a has both `cart.merge` undo **and** `cart.mergeUndo` + route | One restore function; `cart.merge` undo delegates; 15-min window only on the buyer route (W7). |
| Rate limiting | §8.3 | Use shared `ratelimit` (`checkRateLimit`, `readEndpointRateLimitConfig`), env prefix `CART_*`, per token and IP. |
| Queue/scheduler | §12 | W6. |
| Events | §11 | Fine; enumerate `clientBroadcast` per ID. |
| Zod strictness | §17 | `.strict()` on public bodies so `assortmentScope`, `channel`, `storeId`, `addedByActorId` are rejected (F1, F2, R16). |
| `findWithDecryption` | `email`/`note` | 5-arg form with scope. |

## 5. Cross-spec integration

### 5.1 Cart ↔ Promotions

| # | Cart says | SPEC-055 says | Mismatch |
|---|---|---|---|
| X1 | §6 `evaluate({cart, codes: appliedCodes, buyer:{customerId, customerGroupIds, channelId}})` | A.2: `codes: {id,type}[]`, `buyer` also has `customerUserId`; HTTP body has single `code` | Three type differences; align cart to A.2, fix SPEC-055's single-vs-array. |
| X2 | `toPromotionCartContext(cart)` undefined | A.4 needs `sku`, unit/row prices, `categorySlug`, `producerCode`, `weight`, `attributes`, `customerOrderCount`, `shippingAddress`, delivery/payment codes, `cartWeight`, `deliveryCost`, `consentFlags`, `extensions` | CartLine stores none of the catalog attributes; enriching 50 lines in cart is N+1 against P95 150 ms. Recommend promotions-side batch enrichment from `productId`/`variantId` (C11). Cart-stage-unknowable fields are `null`, so rules on them are false at cart stage; a promotion can **appear at checkout** and change the total — checkout must disclose via `priceChanges`. |
| X3 | §3.2 maps `DELIVERY_DISCOUNT` to order-scope adjustment | Amount is "against delivery cost resolved from context" | No delivery cost in a cart; negative adjustment drives total below subtotal (F6). |
| X4 | `code_reservation_id`, released on cart expiry | `CodeReservation` has **no `cart_id`** (A.6 says it gains one; data model, Phase 3 step 1 and `UNIQUE(code_id, customer_id)` never updated); text session id; fixed 24 h TTL; no extend method | Two carts share a row; guest has no id; 30-day cart outlives 24 h reservation (F5). |
| X5 | ADD_FREE_ITEM | A.5: `added_by: 'merge'` semantics, `promotionId` marker, excluded from eligibility | No marker column; gift merges with purchased line via unique index (F4). |
| X6 | P95 < 150 ms for 50 lines | A.7: 200 promotions; Phase 2 step 10: "≥ 100" | Pin 200; benchmark in cart Phase 3. |
| X7 | Cart releases on expiry; "promotions also sweeps independently" | Promotions Phase 3 has no sweeper step | Add one. |
| X8 | A.2b: cart `requires: ['promotions']` | Module doesn't exist on develop | Promotions P1–P2 must land first, or `requires` is declared when P3 lands. |

### 5.2 Cart ↔ Visibility Phase 3

| # | Finding | Consequence |
|---|---|---|
| V1 | §6a.1 code keys on `channel === 'storefront'`; §6a.4/visibility §6.4 say "scope supplied" | Different rules; pick one (C2): enforce iff storefront **or** supplied. |
| V2 | Both say "storefront route proxies it"; the client talks to the cart route | F1. |
| V3 | `ScopedProduct {id, categoryIds, tagIds}` (with ancestor categories) loader is ecommerce-private | Needs catalog-side loader (C12). |
| V4 | P3 gate: "lock refused while line flagged" | Needs F7 in the same release. |
| V5 | Visibility `triggeredBy` lacks `'merge'` | Sync one line. |
| V6 | R12 "identical body **and timing**" | Not reliably testable; reword to body/shape equality + structural no-extra-query assertion. |
| V7 | Free-item/proposal lines vs §6a | Promotion lines exempt, marked, logged; all others checked. |

## 6. Findings

### Critical

| ID | Finding | Fix |
|---|---|---|
| **F1** | **Scope is a caller-supplied field on a public route.** §10 lists `assortmentScope` as a request field; §6a.1 makes omission a `400`, but `null` is a legal "unrestricted" value. Any script/agent sends `null` and passes. The same hole is in `cart.merge` (§6a.5) and `preview`/`accept`. | Resolve scope server-side. `assortmentScope` stays an internal command input for trusted in-process callers; public handlers resolve it from `storeContextService.resolve(request)` (soft DI at the route edge), never from the body. Bodies `.strict()`. No `storeContextService` → no storefront carts. Tests: body-supplied scope and `null` both → 400. (C1) |
| **F2** | **Public `POST /carts` lets the client pick `channel`/`store_id`.** §6a.4 exempts `pos/pay_link/agent/api`. An anonymous caller creates an `api` cart, adds a restricted product unchecked, and checkout converts it. §6a.5 only guards merge *into* a storefront cart. | Derive `channel`/`store_id`/`sales_channel_id` server-side. Unauthenticated create always yields a storefront cart bound to the resolved store; other channels need an authenticated principal with a feature; `channel` immutable. Test: anonymous create with `channel:'api'` → 400. Record the obligation on checkout. |
| **F3** | **Release invariant is undefined and its mapping stale.** (a) Checkout is not in Release 4, so "equals the `SalesOrder` produced" has no producer; (b) "byte-for-byte" is untestable (JSON doubles vs `numeric(18,4)`); (c) rule 1 targets an API that has since changed; (d) no persisted line discount on `CartLine`. | (1) Define: same `SalesLineSnapshot[]` + adjustments give equal `SalesDocumentAmounts` for `'quote'` and `'order'`, compared as 4-dp numerics per key; the gate creates an order via the existing `sales` create command from the cart's lines (test-only helper). (2) Use `discountAmountBasis:'line'` with the net effect total; never set `discountPercent`. (3) Add `CartLine.discount_total_net`. (4) Property test over the tax matrix incl. promotions and a non-dividing quantity. (C10) |
| **F4** | **Free-item lines unrepresentable.** No marker; actor enum has no promotion origin; unique index merges gift into purchased line; the A-R2 exclusion can't be implemented; assortment treatment undefined. | `CartLine.promotion_id` + `origin 'customer'\|'promotion'`, actor `system`; `promotion_id` in the unique index; exclude promotion lines from eligibility but not totals; reconcile by diff after one `evaluate`; buyer-immutable (`409 promotion_line_immutable`); exempt from §6a with an operator event. (C3) |
| **F5** | **Reservation model can't back the cart lifecycle** (see X4). | Amend SPEC-055 before its Phase 3: `cart_id`, unique `(code_id, cart_id)`, idempotent `reserveCode` per cart, `extendReservation`, release by `cartId`, promotions-side sweeper. Cart extends on activity and emits `cart.promotion.no_longer_valid` + warning on lapse. (C4) |
| **F6** | **`DELIVERY_DISCOUNT` can't apply in a cart.** | Cart sends `deliveryMethodCode:null, deliveryCost:null`, discards delivery effects from totals (may show them as display-only, `deferredToCheckout:true`); checkout re-evaluates. Add test. (C5) |
| **F7** | **No lock/convert surface**, yet §9, trigger 5, `cart.lock.*`, `release-stale-locks`, the 423 body and visibility's lock gate are in scope. | DI `cartService.lock/unlock/markConverted` + commands `cart.lock/unlock/markConverted`; `lock` forces re-price + §6a.2 pass and refuses with `409 cart_has_unavailable_lines`. No public route. Columns: `locked_at`, `lock_expires_at`, `checkout_session_id`. (C6) |
| **F8** | **No sanctioned unit-price / scoped-product services.** Cart can't import ecommerce, and reimplementing makes PDP price ≠ cart price. | Extract additive `catalogBuyerPricingService.resolveLinePrice(...)` (winning row, net/gross/taxRate, tier + next tier) and `catalogScopedProductService.loadScopedProducts(ids, scope)` into `catalog`; refactor ecommerce onto them with no behaviour change (`TC-ECOM-010/012` as safety net). Needs owner approval. (C12) |

### Warnings

| ID | Finding | Fix |
|---|---|---|
| W1 | Singular module id | C9. |
| W2 | Q5 + admin route collision | §9. |
| W3 | Unique index `(cart_id, product_id, variant_id, configuration_hash)` has nullable columns, so plain lines duplicate. A stored generated column isn't expressible in MikroORM. Partial unique *indexes* need `ON CONFLICT (cols) WHERE …`. | `UNIQUE NULLS NOT DISTINCT` (PG17 baseline; precedent in `devices`/`availability` migrations) or `COALESCE` expression index. Compute the hash in the command and store it as a plain column. Add `promotion_id`. SQL-shape test. |
| W4 | Token plaintext | `token_hash`. |
| W5 | Encryption decisions | §4. |
| W6 | Sweepers: workers register handlers, not cadence. Lessons: module schedules can only target same-module workers; `seedDefaults` schedules miss later tenants; enqueue-then-stamp. | Workers `cart:mark-abandoned/expire/release-stale-locks/purge-expired`; register via optional `schedulerService` (pattern in `customer_accounts/setup.ts`) in `onTenantCreated` **and** an Upgrade Action; deterministic uuids. |
| W7 | Two merge undo mechanisms; anonymous actor on commands | One restore fn; define `ctx.auth` for public routes (precedent `sales/lib/publicQuoteTenantScope.ts`) and the action-log actor for a guest. |
| W8 | Tenant/org must come from the resolved store, not the token; D4 applies with a portal session; cross-tenant token must answer exactly like an unknown token | State in §8.3; test. |
| W9 | D3 snapshots missing (`customer_ids`, `customer_overlay_id`, `assortment_scope_hash`) | Re-resolve `BuyerContext` each request (cached 60 s); store ids only for callers without one. |
| W10, W11 | See F8 | — |
| W12 | See V1 | C2. |
| W13 | Gates inconsistent: Phase 1 gate says property test, R1/§14 say Phase 2; R5 P95 "at Phase 2" but promotions arrive in Phase 3; "each trigger in isolation" includes triggers 5 and 6 | Re-cut: P1 = line CRUD/snapshot/lock/idempotency/sweepers; P2 = triggers 1–4,7, tiers, quantity rules, equivalence without promotions; P3 = triggers 5/6, promotions, merge, §6a.5, lock service, equivalence with promotions, P95. |
| W14 | GET re-price bumps `updated_at`; persisted availability fields written on read would bump it on every read → every next write 409s | Don't persist availability (compute per response; drop the two columns); GET writes only when a trigger fires; `no-store`; test that two GETs inside the budget leave `updated_at` unchanged. |
| W15 | 409/423 bodies undefined | Reuse `OptimisticLockConflictBody` + `cart`; define 423 body. |
| W16 | Quantity rules duplicated between PDP and cart | Extract the derivation. |
| W17 | Context enrichment | C11. |
| W18 | Cross-store/currency merge | Merge only same store+currency. |
| W19 | Template sync, generate, five locales, modules.ts (D22) | Add to plan. |
| W20 | Digest definition lives in ecommerce; a new digest field silently re-prices carts | Disclose via `priceChanges` reason `buyer_context_changed`. |

## 7. Risk Assessment

**High**

| Risk | Mitigation |
|---|---|
| R11 reopened via F1/F2 | Fixes + tests that attack the HTTP surface, not just the command |
| Cart/order divergence (F3, F6) | Defined invariant, line-basis discount, deferred delivery discount, property test incl. promotions |
| Reservation mismatch (F5) | SPEC-055 amendment first |
| Free-item loop (F4) | Marker, eligibility exclusion, per-evaluation cap, TC-PROM-053 |
| Promotions P2 performance | Promotions-side enrichment, one evaluate per batch, benchmark at 200 in cart P3 |
| Sequencing (X8, F7, F8) | Order in §11 |

**Medium**: 409 storm (W14); plaintext token (W4); NULL semantics in the unique index (W3); sweeper wiring (W6); silent digest drift (W20); cross-store merge (W18); rate limits untested; gate cadence (W13).

**Low**: singular module id; `lineMap` obligation on checkout; Omnibus presentation not in `CartLineView`; timing assertion flakiness; i18n coverage.

## 8. Gap Analysis

**Critical:** F1–F8.

**Important:**
- `CartIdempotencyKey` entity.
- Lock service (F7).
- Sweeper scheduling, role features, Upgrade Action.
- Missing columns: `Cart` `locked_at`, `lock_expires_at`, `checkout_session_id`, `resolved_at`, `last_price_change_at`, `customer_ids`, `assortment_scope_hash`; `CartLine` `promotion_id`, `origin`, `discount_total_net`; `CartPromotionApplication` `code_id`, `code_type`.
- Per-request digest rule.
- Merge store/currency rule.
- Error-code catalogue: `product_unavailable`, `quantity_increment_violation` (with `nearestValid`), `quantity_below_min`, `quantity_capped`, `cart_locked` (423), `cart_has_unavailable_lines`, `idempotency_key_mismatch`, `promotion_line_immutable`, `code_*`.
- Rate-limit numbers.
- Cart-side reservation states (applied → reserved → lapsed → released).

**Nice-to-have:** notification types for R2/R4/R8; state "no `search.ts`"; currency switching (Q3) assumed re-price.

**File manifest (Phase 1):** `packages/core/src/modules/cart/`
- `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `di.ts`, `encryption.ts`.
- `data/{entities,validators}.ts`.
- `commands/{lines,cart,promotions,merge,lock}.ts`.
- `lib/{cartService,reprice,triggers,quantityRules,mergePolicy,tokens,idempotency,toSalesSnapshots,toPromotionContext}.ts`.
- `api/cart/current/**`, `api/openapi.ts`, `workers/*.ts`, `migrations/`.
- `i18n/{de,en,es,ko,pl}.json`.
- `__integration__/TC-CART-*.spec.ts`, `__tests__/` (totals property test).

`index.ts` declares `requires: catalog, sales, customer_groups` (promotions from P3, ecommerce soft).

## 9. Open Questions 5 and 6

**Q5 → move to a header-bound `/api/cart/current/*`, decided before Phase 1.**
- Credential is the header `X-Cart-Token` only. The platform doesn't read cookies for it (CSRF); the storefront app owns the httpOnly cookie and forwards a header. `POST /current` returns the token once in the body.
- Routes: `POST /current`, `GET|PATCH /current`, `POST /current/lines`, `PATCH|DELETE /current/lines/[lineId]`, `POST /current/lines/bulk`, `POST|DELETE /current/promotions[/…]`, `POST /current/merge` (header = source guest cart, target = portal session's cart), `POST /current/undo-merge`, `POST /current/reprice`. Admin keeps `/carts` and `/carts/[id]` (Phase 4), so there is no collision.
- Nothing is implemented yet, so the change is free now and breaking later.
- Add to §14: no route accepts a token in the path or query string.

**Q6 → adopt the stated default; no Release 4 impact.** The only obligation is the `resolved_at timestamptz null` column in the Phase 1 migration. Phase 1–3 purge baskets only.

## 10. Phase 4 corner check

Phases 1–3 don't paint Phase 4 into a corner provided the Phase 1 migration and code include:
1. Columns: `Cart.kind` (default `basket`) + `proposed_to_cart_id` with the check constraint; `CartLine.added_by_actor_type/id`; `CartMergeLog.merged_by_actor_type/id` + `proposal_cart_id`; `Cart.resolved_at`; nullable `token_hash`.
2. `resolveBasketByToken` and every sweeper query already filter `kind='basket'`. Line/promotion commands refuse a non-basket cart with `409 proposal_cart_immutable` (one `if`).
3. `CartMergeLog.outcome` shape from rev 7, used from the first merge.
4. `cart.merge` accepts an actor object; `strategy:'manual'` returns `501 not_supported` until Phase 4.
5. `added_by_actor_*` set from `ctx.auth` only (R16).
6. Channel immutability (F2) and the lock API (F7) are reused by Phase 4 acceptance.

Keep `origin` (what produced the line) and `added_by_actor_type` (who) as separate columns.

## 11. Remediation Plan

**Before implementation**
1. Cart rev 9: apply F1–F4, F6, F7 and the C-decisions. Fix §3.2 rule 1, reconcile §6 with A.2, and add the BC section, idempotency model, columns, re-cut gates, step plan, test IDs and the Q5 route table.
2. SPEC-055 amendment C: F5, X1, X2, F4/F6 contracts, benchmark = 200.
3. Visibility note: F1, V1, V5, V6, F7.
4. Owner approval for C12.
5. Reconcile with the SPEC-055 and visibility pre-implement reports (they share X1–X8 and V1–V7).

**During implementation:** error/rate-limit catalogue; five-locale i18n and `i18n:check-sync`/`check-usage`; `UPGRADE_NOTES.md` plus the sweeper Upgrade Action; `cart/AGENTS.md` (commands, `current/*`, no-arithmetic, never accept scope from a body); `apps/docs` API page.

**Post-implementation:**
- Phase 4 and the Q6 purge rule.
- Checkout obligations recorded in cart §11: `markConverted` payload, delivery re-evaluation, disclosing newly appearing promotions, refusing channel/store mismatch.
- Notification types.

**Order inside the release**
1. Spec revisions and decisions C1–C14.
2. Promotions P1 → P2 (no cart dependency).
3. Shared seams (C12) and ecommerce refactor; `TC-ECOM-*` stay green.
4. Cart P1, with §6a.1 enforcement built into the first line command, plus the visibility per-line suite (R1/R12).
5. Cart P2, plus the totals-equivalence property test without promotions.
6. Promotions P3.
7. Cart P3 (promotions integration, merge, §6a.5, lock, re-visibility pass), plus the visibility gate (R1/R7/R13), equivalence with promotions, and the P95 benchmark.

No storefront add-to-cart path ships before step 4 completes.

## 12. Recommendation

**Needs spec updates first.** Proceed only after cart rev 9, the SPEC-055 amendment and the visibility Phase 3 note are merged and the owner has decided C1–C14.

## Decisions for the owner

| ID | Decision | Options | Recommendation | Blocks |
|---|---|---|---|---|
| C1 | Source of scope/store/channel on public routes (F1, F2) | (a) handler resolves via `storeContextService` (soft DI); command input internal; bodies `.strict()`. (b) ecommerce owns `/api/storefront/cart/*` proxies. (c) caller-supplied as specified | **(a)** — keeps cart's public API in cart and ecommerce free of write paths | Cart P1; visibility P3 |
| C2 | §6a enforcement key (V1) | storefront-only / supplied-only / storefront **or** supplied | **storefront or supplied** | Cart P1 |
| C3 | Free-item representation (F4) | (a) `promotion_id`+`origin` columns, `system` actor, in unique index. (b) metadata marker. (c) no line | **(a)**, gift lines exempt from §6a and buyer-immutable | Cart P3; Promotions P2 |
| C4 | Reservation ownership (F5) | (a) amend SPEC-055 per `(code, cart)` + extend + sweeper. (b) keep per-customer | **(a)** | Promotions P3; Cart P3 |
| C5 | `DELIVERY_DISCOUNT` at cart stage (F6) | (a) null delivery context, exclude from totals, mark deferred. (b) estimate shipping in cart | **(a)** | Cart P3 |
| C6 | Lock/convert surface (F7) | (a) DI service + commands in P3, no public route. (b) public route. (c) leave to checkout | **(a)** | Cart P3; visibility P3 gate |
| C7 | Q5 token transport | (a) `X-Cart-Token` on `/api/cart/current/*`. (b) platform reads cookie. (c) keep path | **(a)**, before Phase 1 | Cart P1 |
| C8 | Q6 proposal retention | accept default / exempt while referenced | **accept default**; add `resolved_at` now | Nothing in Release 4 |
| C9 | Module id | keep `cart` / rename `carts` | **keep `cart`**, record the exception | Cart P1 (frozen on release) |
| C10 | Discount hand-off to `sales` (F3) | (a) `discountAmountBasis:'line'` + persisted `discount_total_net`. (b) per-unit division | **(a)**, (b) only if checkout can't pass the basis; never set `discountPercent` | Cart P2/P3 |
| C11 | Who enriches the promotion context (X2) | (a) promotions batch-loads from product/variant ids. (b) cart snapshots attributes | **(a)** (needs SPEC-055 amendment) | Promotions P2; Cart P3 |
| C12 | Shared pricing/scoped-product/quantity-rule seams (F8) | (a) extract into catalog/availability, refactor ecommerce. (b) duplicate in cart. (c) cart imports ecommerce | **(a)** — multi-module, needs your explicit approval | Cart P1 |
| C13 | Token at rest | `token_hash` / plaintext | **`token_hash`** | Cart P1 |
| C14 | Phase 4 seam columns in the Phase 1 migration | (a) include now (no proposal routes). (b) add in Phase 4 | **(a)**; also drop persisted availability columns (W14) | Cart P1 |

## Changelog
### 2026-10-14
- Initial Release 4 pre-implementation analysis of cart rev 8, Phases 1–3, against `develop` @ `28ca93ed97`. Extends `ANALYSIS-2026-08-14-cart-module.md`.
