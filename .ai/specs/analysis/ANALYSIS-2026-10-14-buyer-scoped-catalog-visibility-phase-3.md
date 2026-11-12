# Pre-Implementation Analysis: Buyer-Scoped Catalog Visibility — Phase 3 only (Release 4)

> **Spec**: `.ai/specs/2026-08-21-buyer-scoped-catalog-visibility.md` (changelog to 2026-10-11).
> **Release scope analysed**: **Phase 3 — cart write-path enforcement** (`assortmentScope` on `cart.lines.add/.update/.bulkAdd`, required for storefront-channel carts, `product_unavailable` with `lineId`, whole-cart re-visibility pass at triggers 2 and 5, checkout-lock block). Phases 1–2 shipped; Phase 4 (per-customer overrides) is out of scope.
> **Analysed against**: `develop` @ `28ca93ed97` (2026-10-14), branch `feat/release-4-write-side`.
> **Companion specs read**: `2026-08-14-cart-module.md` rev 8 (§3.1a, §4, §5.2, §6a, §7, §9, §10, §11, §15), `2026-08-14-ecommerce-suite-roadmap.md` (Phase 2 gate), `SPEC-029` §6, `SPEC-055` (cross-checked for `ADD_FREE_ITEM`), earlier `ANALYSIS-2026-10-05-buyer-scoped-catalog-visibility-phase-2.md` and `ANALYSIS-2026-10-05-storefront-release-decisions.md`.
> **Lessons scanned** (`.ai/lessons.md`, tags `data-scoping`, `access-control`): only *Empty collection scopes need an explicit semantic predicate* applies. `null`, `[]` and `undefined` must be separate named predicates (C1/W5).

## Executive Summary

Phase 3 is **not a separate work package in this release**. The `cart` module is greenfield and is built in the same release, and `cart-module.md` rev 8 already contains the whole of Phase 3 as its §6a. Build the enforcement *into* cart Phases 1–3 (ownership table below) instead of bolting a "Phase 3 of spec 12" on afterwards. Phases 1 and 2 of the visibility spec are fully shipped (#6709, #7142), so the spec's header ("partially shipped, stub") is stale.

The spec cannot be implemented as written. Four **Critical** gaps would each re-open R1 (a hidden product bought through the cart) even with every listed test green:
- **C1:** the scope is described as a client-supplied request field.
- **C2:** the cart `channel` that switches enforcement off is unconstrained.
- **C3:** the `cart.lock` command that carries the checkout-lock block does not exist in cart's command list or phases.
- **C4:** a visible product id paired with a hidden product's variant id passes the check.

Ten Warnings follow. **Recommendation: needs spec updates first**, changing this spec's §5.3/§6/§12 and cart §6a/§10/§3.1a/§15. The algebra, the SQL twin and the buyer context are in place and fit.

## Verified state of `develop`

| Spec claim | Reality @ `28ca93ed97` | Evidence |
|---|---|---|
| Header: "Phase 1 partially shipped; `resolveAssortmentScope()` is a stub returning `null`" | **Stale.** The real body unions per-group scopes (`unionScopes`), reads `CustomerGroupTerms.assortment_scope`, takes `customerIds[]` (D3). `sourceCustomerOverrideId` is a fixed `null` (Phase 4). | `customer_groups/services/customerGroupsService.ts:377-393`; column `customer_groups/data/entities.ts:234` |
| `canonicalizeEffectiveScope` / `hashEffectiveScope` pending (D8) | Shipped and exported | `packages/shared/src/lib/catalog-visibility/index.ts` |
| Authored-scope validators reject `allOf` | Shipped (strict zod schemas without `allOf`) | `ecommerce/data/validators.ts:349`, `customer_groups/data/validators.ts:201` |
| Phase 2: `BuyerContext.assortmentScope`, `require_authentication` short-circuit to `[]`, channel pickers | Shipped. `[]` is returned before `customer_groups` is called. | `ecommerce/lib/buyerContext.ts:277-310`, `ecommerce/data/entities.ts:148`, `TC-ECOM-005` |
| `scopeKeys` SQL twin (Public API §3.3, D9) | Shipped: `scope_keys` enricher on `catalog:catalog_product`; `buildAssortmentScopeFilter` compiles the DNF. Unindexed docs **fail closed** for any restricted scope; a `null` scope emits no clause. | `catalog/lib/productScopeKeys.ts`, `ecommerce/lib/storefrontProductScope.ts:127` |
| SQL ↔ `matchesScope` equivalence property test | Exists, seeded `mulberry32`, over `scope_keys` docs | `ecommerce/lib/__tests__/storefrontProductScope.test.ts:179` |
| "No `cart` module on `develop`" | True. No add-to-cart route in `ecommerce/api/storefront/*` (`context`, `products`, `categories`, `search/suggest` only), and no catalog-line write path in `packages/checkout`. **Nothing needs gating today**, so R1 is not live. | directory listing |
| `matchesScope` has runtime consumers | **None.** Only tests use it. The cart will be its first runtime caller, and `ScopedProduct.categoryIds` has no producer in code. | grep over `packages/` |
| `customer_groups.membership.expired` fires when a membership lapses | **Declared, never emitted** (no sweeper, no emitter). | `customer_groups/events.ts:9` |
| Buyer context is "freshly resolved" per request | Cached **60 s** per (store, customerUserId). `storeContextService.resolve(request, opts)` has no bypass option. | `ecommerce/lib/cacheKeys.ts:57`, `buyerContext.ts:355-368`, `lib/storeContextService.ts` |

## Sequencing — how Phase 3 is built into cart

| Deliverable | Owner: cart phase | Notes |
|---|---|---|
| One pure function `evaluateCartVisibility(lines/products, scope)` in `cart/lib/visibility.ts`, the **only** place `matchesScope` is called | **Phase 1** | Every call site below uses it. This makes "forgot the clause" structurally impossible, including for merge. |
| Catalog seam producing `ScopedProduct` (ancestor-expanded, tenant/org-scoped, batch), see W1 | **Phase 1** (additive catalog change) | Prerequisite of the first `lines.add`. |
| `assortmentScope` as a *trusted command input*, server-derived in the route, `400` on missing for storefront carts, store-binding check (C1) | **Phase 1** | `store_id` is bound at creation (already in §4.1). |
| Per-line check in `lines.add/.update/.bulkAdd`, `product_unavailable` + `lineId`, i18n, `cart.line.visibility_rejected` declared | **Phase 1** | `lines.remove` is never blocked (W8). |
| R1 regression suite (add/update/bulk/omitted/exempt channels/enumeration) | **Phase 1** gate | Extends cart's Phase 1 gate, which today covers only totals-equivalence and concurrency. |
| Whole-cart re-visibility pass inside the trigger-2/5 re-price pipeline; `cart.lock`/`cart.unlock`; lock refused while flagged (C3) | **Phase 2** | Phase 2 already owns the trigger set. The lock command is new work. |
| R7 TOCTOU fixture (membership lapses → lock refused → line still present) | **Phase 2** gate | Needs the freshness decision V5. |
| Merge-time pass (§6a.5), `triggeredBy: 'merge'`, `mergeSummary` dispositions | **Phase 3** (already so in cart §15) | Same function; scope is the **target's** server-derived scope. |
| Promotion-added lines (`ADD_FREE_ITEM`) go through the same function (W3) | **Phase 3** | Cross-spec with SPEC-055 Phase 2. |

- **Where the R1/R7 suite lives:** `packages/core/src/modules/cart/__integration__/TC-CART-*`, unit tests next to `cart/lib/visibility.ts`, and one shared equivalence property (W6) tying it to the existing `storefrontProductScope.test.ts`.
- **Merge (§6a.5) vs triggers 2/5:** these are three call sites of one function. Triggers 2/5 check *existing* lines against the buyer's fresh scope. Merge checks *incoming* lines against the target's fresh scope before persisting. The spec should say so; cart §6a.2 and §6a.5 currently read as two mechanisms.
- **Channel-exemption hole (agent/api/pos/pay_link):** closed by C2, not by merge alone. §6a.5 closes the *merge* route, but the *lock* route of an exempt cart stays open unless unauthenticated callers cannot create exempt carts.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| 1 | 9 DI | A `fresh` option on `storeContextService.resolve` (V5) and a new catalog DI key (V7) are additive | None | Optional property, new key only |
| 2 | 5 Events | `cart.line.visibility_rejected` is new, and `cart` is new, so no consumer exists | None | — |
| 3 | 2/3 Types & signatures | `EffectiveAssortmentScope`, `matchesScope`, `ScopedProduct` and `resolveAssortmentScope` are shipped contracts (categories 2, 3, 9). Phase 3 must not change them. The temptation is adding `isActive` or ancestor expansion to the shared types. | Warning | Keep the shared contract frozen. Put `isActive` and ancestor expansion in the catalog seam's own return type, which extends `ScopedProduct` (W1). |
| 4 | 7 API routes | Cart §10 puts `assortmentScope` in the public request surface. Once shipped it is a STABLE contract that cannot be removed (C1). | Critical (irreversible) | Remove it from every route schema before the first release |
| 5 | 8 DB | Cart tables are new. A per-line visibility state (V4) is free now and a migration later. | Warning | Decide V4 before generating the Phase 1 migration |
| 6 | 1, 4, 6, 10–13 | None. No new ACL feature unless V2 adds one. | None | — |

**Missing BC section:** present in substance (§13), but its "nothing exists yet" claims about Phase 1 are stale. Add a dated line that the shared contract is frozen for Phase 3.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| Route-level scope derivation | C1, the biggest hole | New §6.1a: routes resolve `storeContextService` (soft DI), compare `cart.store_id` to `ctx.store.id`, and pass the scope to the command in-process. Request schemas contain **no** scope field. |
| Cart creation rules per channel | C2 | Add to cart §4.1/§10 |
| Lock/unlock command contract | C3 | Add `cart.lock` and `cart.unlock` to cart §3.1a and Phase 2; both take the trusted scope |
| Catalog seam for `ScopedProduct` | W1 | Add to §6.1: source of `categoryIds` (ancestor-expanded), inactive/deleted handling, batch API |
| Flagged lines vs totals and promotions | W2 | Add to §6.2 (V4) |
| Promotion-added lines | W3 | Add (V6) |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| Header, §12 Phase 1 status, §13 | Phases 1–2 are fully shipped. The "Release constraint" paragraph should become "Phase 3 ships inside cart Phases 1–2". | Revise in the spec revision pass |
| §5.3 | Lists three commands. §6.2 needs the scope on `cart.reprice`, `cart.lock` and `cart.merge` as well (and on `cart.proposal.create/.accept`, outside this release). | List every command that takes the scope |
| §6.1 pseudo-code | `assortmentScope === undefined` is satisfied by `null`, which is a legal `EffectiveAssortmentScope`, and a JSON body can carry `null` | Named predicates (`isScopeProvided`, `isUnrestricted`, `isDenyAll`) and a branded `ResolvedAssortmentScope` type that only the resolver can produce |
| §6.1 `rejectLine` | For `.add` the line has no id yet, so the client cannot attach the warning to a row | Return `productId`/`variantId` and the bulk index, without distinguishing restricted from nonexistent (R5) |
| §6.2 | "Unresolved warning" exists only in the response. Cart §4.2 has no line column for it, and the trigger-4 re-price runs no visibility pass. | V4: persist it, or recompute on every read |
| §6.3a | The event has no tenant/org in its payload and no throttle, and it is emitted per rejected line | V8 |
| §11 | "identical in body **and timing**" is not a stable test | Assert structural equality and one shared reject branch |
| §11 / R1 | "Purchasing a restricted product end-to-end" is impossible, since no checkout or order conversion exists in this release | Scope the gate to "cannot enter a lockable cart". The purchase half becomes an obligation on spec 7 (V10). |

## AGENTS.md Compliance

| Rule | Location | Fix |
|---|---|---|
| Never bypass mutation guards | Custom write routes | Routes call `runMutationGuards` (map to `update`) before the command. The check stays in the command, so non-HTTP callers (AI tools, workers) cannot skip it. |
| Modules independent, no cross-module coupling | §6.1 says `cart` has no dependency on `ecommerce`, but routes need a `StoreContext` | Soft DI (`tryResolve('storeContextService')`) in the **route layer** only. Commands receive the resolved value. Fail closed when the service is absent. |
| No `any`; zod in `data/validators.ts` | New command input | The `EffectiveAssortmentScope` zod mirror is for in-process validation only. Public route schemas must not include it. |
| Tenant scoping | Per-line product load | Load products with the cart's tenant/org. Another org's product returns the same `product_unavailable`. |
| Events via `createModuleEvents`, `module.entity.action` | `cart.line.visibility_rejected` | Compliant. Declare in `cart/events.ts`, not `clientBroadcast`. |
| i18n | `product_unavailable` message | New key in `cart/i18n/*.json` for all locales; `yarn i18n:check-sync` |
| Optimistic locking default ON | Lock/unlock | `cart.lock` uses `enforceCommandOptimisticLock`. The visibility pass and the `active → locked` write share one `withAtomicFlush`, so a concurrent `lines.add` gives a 409 instead of a lock over an unchecked line. |
| Encryption, DS/UI | No new PII or UI | None |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| H1. Client-supplied scope (C1) | Any caller sends `assortmentScope: null` and buys anything; the "required" check passes. Contradicts SPEC-029 §6.1 ("internal"). | V1. Contract test that no cart route schema contains the key. |
| H2. Cross-store scope substitution | A cart created on store A (wide scope) is mutated through store B's host, or the reverse. | Assert `cart.store_id === ctx.store.id`; mismatch gives `404` |
| H3. Exempt-channel cart reaches lock (C2) | `api`/`agent`/`pos`/`pay_link` carts are never checked | V2 |
| H4. Lock command missing (C3) | The R7 gate can't be written; Phase 2 would ship a lockable cart with no check | V3 |
| H5. Variant/product mismatch (C4) | A visible `productId` is paired with a hidden product's `variantId`. The check evaluates the visible product, pricing resolves the hidden variant, and the line snapshots the hidden SKU. | Derive the product from the variant, or reject on mismatch, before the check. Cover `update` and `bulkAdd`. Test with a cross-product variant. |
| H6. Stale "fresh" scope at lock (W4) | The 60 s buyer cache plus no expiry event means a membership that lapsed in the last minute still passes the lock | V5 |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Flagged lines still counted in totals/promotions | A flagged line can unlock a threshold promotion or free shipping for the visible lines. Removing it later changes the price with no `priceChanges` entry. | V4 |
| Gift line outside the assortment | `ADD_FREE_ITEM` inserts a hidden SKU, or drops it silently. Neither spec mentions it. | V6 |
| Read/write skew through index lag | Listing uses the async `scope_keys` index; the cart reads assignment tables directly. After a category move they disagree for the reindex window, and the cart is the stricter side. | Accept. Never read the cart's categories from the index doc, and mirror the fail-closed `isProductScopeIndexed` rule. |
| `bulkAdd` N+1 | 100 lines × per-line queries | Batch through `computeProductScopeKeys` (2 queries per batch) |
| Event flood | A script generates thousands of rejection events | V8 |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Idempotent replay returns the original success after the scope narrowed | The line is flagged at the next pass | Acceptable, document |
| `[]` vs `null` confusion in new code | Deny-all treated as unrestricted | Named predicates and branded type |
| Anonymous buyer on a `require_authentication` channel | Every add is `product_unavailable` | Intended. Add the case to the suite. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- **C1 — The scope is specified as a request field.** Cart §10 says the line routes "additionally carry `assortmentScope`". Visibility §5.3/§6.1 say "the caller supplies it … a `400` on omission". On a public, token-bound route the caller is the buyer or a script, and `null` passes an `=== undefined` check. Needed:
  - route-level server derivation through `storeContextService`;
  - the scope absent from every public request schema;
  - the store-binding check (H2);
  - a typed in-process input.

  A `400` on omission protects against forgetfulness, not forgery.
- **C2 — Channel is unconstrained.** Cart §4.1 allows `storefront | pos | pay_link | agent | api`, and `POST /carts` is public. The exemption in §6.4 is only safe if public callers cannot choose an exempt channel. Needed:
  - public routes force `channel = 'storefront'` and take `store_id` from the resolved store;
  - non-storefront carts are created only through the command, by an authenticated principal holding an explicit feature.
- **C3 — No lock/unlock command.** Cart §3.1a lists none, and §15 Phases 1–3 don't mention them. Checkout (spec 7) is Phase 3 of the suite, not this release. The lock block and the trigger-5 pass have no home, and the "lock is refused" gate can't be tested. Needed: `cart.lock`/`cart.unlock` plus a lock-timeout sweeper in Phase 2, with the lock taking the trusted scope and running trigger 5 first.
- **C4 — Variant/product mismatch** (H5). §6.1 loads "the product" and checks `product.id`, while the line stores both `product_id` and `variant_id`.

### Important Gaps (Should Address)

- **W1 — `ScopedProduct.categoryIds` has no producer and must be ancestor-expanded.** `matchesOne` does plain id overlap. The SQL twin works because `scope_keys` holds each assigned category and its ancestors. With direct assignments only, a scope granting a parent category rejects every product in a child category. That fails closed but is wrong, and it diverges from the listing. Provide a catalog DI seam (V7) built on `computeProductScopeKeys`, with these properties:
  - returns `{ id, categoryIds, tagIds, isActive }`;
  - batch-capable, and `null` for missing, deleted or other-tenant products;
  - treats `isActive === false` as unavailable, since the read path filters `is_active` and the spec is silent;
  - `cart` must not import `catalog/lib/*` directly.
- **W2 — Flagged-line semantics** (V4): not persisted, counted in totals and promotions, and invisible on trigger-4 reads.
- **W3 — Promotion-added lines** (V6): SPEC-055 `ADD_FREE_ITEM` and the `free-products` API are assortment-blind, and the cart spec never mentions free items.
- **W4 — Freshness** (V5): 60 s cache and no expiry event.
- **W5 — Named predicates and a branded type** for `null`, `[]` and `undefined`.
- **W6 — Equivalence test for the cart's point check.** Add a property that feeds the cart seam's output to `matchesScope` and compares it with `evaluateIndexDocFilter` over a doc built by `buildProductScopeKeys` from the same assignments. Use the seeded `mulberry32` generator (no `fast-check`).
- **W7 — Spec housekeeping:** stale header, §12 and §13.
- **W8 — `lines.remove` and recovery paths must never be blocked** by a flagged state. State that `update` on a flagged line is rejected and `remove` is the recovery.
- **W9 — Open Question 3 (checkout-submit re-check)** should become a recorded obligation on spec 7 (V10).
- **W10 — Idempotency/replay semantics** should be stated in §6.1 (see Low Risks).

### Nice-to-Have Gaps

- A per-store rejection-rate metric in the style of `ecommerce.assortment.empty_detected`.
- The Epic C explainability panel stays optional and outside this release's gate.
- Add the cart to the `isProductScopeIndexed` doc comment's consumer list.

## Remediation Plan

### Before Implementation (Must Do)
1. **Revise this spec** (§5.3, §6.1, new §6.1a, §6.2, §6.3a, §12, header, §13): server-derived scope, store binding, named predicates, command list, flagged-line semantics, stale status, and Phase 3 reassigned into the cart phases.
2. **Revise `cart-module.md`:**
   - §10: remove `assortmentScope` from the request surface and add channel rules.
   - §3.1a: add `cart.lock` and `cart.unlock`.
   - §4.1: add the channel creation rule.
   - §4.2: add the flag column if V4 says so.
   - §15: phase ownership and gates.
   - §6a.1/§6a.2/§6a.5: a single `evaluateCartVisibility`, variant-derives-product, and merge as a third call site.
3. **Decide V1–V8.**
4. **Add the catalog seam** to cart Phase 1.
5. **SPEC-055 amendment** for `ADD_FREE_ITEM` visibility (V6) and the cart-side handling in Phase 3.

### During Implementation (Add to Spec)
1. Record the final route/command contract table (which commands take the trusted scope).
2. Record measured `bulkAdd(100)` query counts.
3. Add the cart-seam equivalence property (W6) to §11.
4. Add a dated changelog entry "Phase 3 absorbed into cart Phases 1–3".

### Post-Implementation (Follow Up)
1. Spec 7 (checkout): call the same `evaluateCartVisibility` at submit (V10).
2. Optional: a sweeper that emits `customer_groups.membership.expired` so buyer-context caches evict on lapse.
3. Phase 4: the trigger-2 clause is already in cart §5.2, so nothing changes for it.

## Recommendation

**Needs spec updates first**, targeted and not a redesign. After the revisions above and decisions V1–V5, this is a bounded part of cart Phases 1–3 and can run under `om-auto-continue-pr-loop`. C1–C4 come first: shipping cart Phase 1 without them would reintroduce R1 behind a green suite.

Counts: **4 Critical gaps**, **10 Warnings**, BC **0 Critical / 2 Warning**, **6 High risks**.

## Cross-spec conflicts

| With | Conflict | Resolution |
|---|---|---|
| `cart-module.md` §10 | Request surface carries `assortmentScope` | V1 |
| `cart-module.md` §3.1a/§15 | No `cart.lock`. The Phase 1 gate omits the visibility suite and the Phase 2 gate omits R7. | V3, sequencing table |
| `cart-module.md` §4.2 | No line state for "flagged" | V4 |
| SPEC-029 §6.1 vs cart §10 | "assortmentScope is internal" vs "client carries it" | V1 |
| SPEC-055 | `ADD_FREE_ITEM`, `free-products` and promotion evaluation are unaware of assortment, and flagged lines would feed evaluation | V4, V6 |
| Release 3 decision D4 (tenant-mismatched token → 401) | A guest cart carried across a login on another store must not reuse the other store's scope | Covered by the store-binding check (H2) |

## Decisions for the owner

| # | Decision | Plain-words scenario | Options | Recommendation | Blocks |
|---|---|---|---|---|---|
| V1 | Where the "what may this buyer buy" rule comes from on cart requests | The spec has the browser send it with every add-to-cart, so a script just sends "everything". | (a) Server derives it from store + login, the request carries nothing; (b) client sends it with a server-verified signature; (c) as written | **(a).** The route resolves `storeContextService` (soft DI), checks the cart belongs to this store, and passes the scope in-process. | **Blocking**, cart Phase 1 |
| V2 | Who may create non-storefront carts (`api`, `agent`, `pos`, `pay_link`) | Anyone who can say `channel: "api"` skips every check, then merges or checks out. | (a) Public routes always create `storefront`, other channels only by command from an authenticated principal with a new feature; (b) ship only `storefront` over HTTP in this release; (c) as written | **(a)**, with (b) as the minimum if the feature slips | **Blocking**, cart Phase 1 |
| V3 | Lock/unlock commands in this release | "Can't check out a cart with a hidden product" needs a lock to refuse. No checkout module exists yet, so nobody would write it. | (a) Add `cart.lock`/`cart.unlock` plus the sweeper to cart Phase 2; (b) leave to the checkout spec | **(a)** | **Blocking**, cart Phase 2 |
| V4 | What a flagged ("no longer available") line does to the cart | A wholesale membership ends. The line stays, but should it still count toward totals and promotion thresholds? | (a) Persist a line state and exclude flagged lines from totals and promotion evaluation, shown separately; (b) keep counting them; (c) transient warning only | **(a).** Add one nullable `CartLine` column in the Phase 1 migration. | **Blocking**, cart Phase 1 schema |
| V5 | Freshness of the scope at lock and merge | The lock uses a buyer profile up to 60 s old, and expiry sends no event. A buyer whose access ended 30 s ago can still lock. | (a) `storeContextService.resolve(request, { fresh: true })` for lock/merge routes; (b) accept the ≤60 s window and document it; (c) also add an expiry sweeper | **(a)**, with (c) as a follow-up | Blocks the R7 gate wording |
| V6 | Promotion gift items vs assortment | "Buy 3, get a free mug" adds the mug. If the mug is hidden from this buyer, do they still get it? | (a) Gifts follow the buyer's scope (dropped and disclosed if hidden); (b) gifts bypass scope; (c) explicit per-promotion opt-in later | **(a)** for Release 4, **(c)** later if merchants ask | Cart Phase 3 / SPEC-055 Phase 2 |
| V7 | How cart learns a product's categories and tags | The cart needs each product's categories, including parent categories. | (a) New catalog DI service built on the existing scope-keys code; (b) cart imports catalog lib; (c) read the search index | **(a).** (c) is stale and looser; (b) breaks module boundaries. | **Blocking**, cart Phase 1 |
| V8 | Rejection event volume | A script adding 1000 hidden ids creates 1000 operator events. | (a) Throttle per (store, hour); (b) one event per request with a count; (c) every rejection | **(b)**, with tenant/org in the payload | Non-blocking |
| V9 | Fix this spec's stale status and fold Phase 3 into cart | The header still says the group scope is a stub. | Revise now / leave | **Revise now**, in the release spec pass | Non-blocking |
| V10 | Checkout-submit re-check | A future checkout that skips the lock could still turn a hidden product into an order. | (a) Record an obligation on spec 7 to call the same function at submit; (b) leave open | **(a)** | Non-blocking |
