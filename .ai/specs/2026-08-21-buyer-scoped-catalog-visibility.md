# Buyer-Scoped Catalog Visibility

| Field | Value |
|-------|-------|
| **Status** | Specification |
| **Created** | 2026-08-21 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — amends specs 1, 3, 5 |
| **Modules** | `customer_groups` (extended), `ecommerce` (extended), `cart` (extended), `packages/shared` (new: catalog-visibility contract) |
| **Depends on** | [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [SPEC-029 Ecommerce Store Module](./SPEC-029-2026-02-17-ecommerce-storefront-module.md), [Cart Module](./2026-08-14-cart-module.md), [Storefront Public API](./2026-08-14-storefront-public-api.md) |
| **Related** | [Storefront Merchandising](./2026-08-14-storefront-merchandising.md), [Pricing Engine](./2026-08-21-pricing-engine.md) |

---

## 📝 TLDR

**Key Points:**
- This is **not** stock/availability — it never touches `availabilityService` or `InventoryBalance`. It answers a different question: given who is asking (anonymous, or an authenticated buyer in one or more customer groups), which products are they even allowed to see and buy, independent of whether the item is in stock.
- Three sibling specs in this suite already stub out the pieces — `CustomerGroupTerms.assortment_scope` (spec 1), `EcommerceStoreChannelBinding.assortment_scope` (spec 3, same shape, declared to **intersect** with the group's), and `buildStorefrontProductScope` as the single read-side enforcement seam (spec 4) — but none of them specify how a buyer's scope is computed when they belong to more than one group, how `categoryIds`/`tagIds`/`excludeProductIds` combine within one scope object, or how a fully closed (login-required) channel is expressed. This spec closes exactly those gaps; it does not re-derive what is already decided.
- **The write side has no enforcement at all today.** `cart-module.md` (spec 5) is fully specified — `cart.lines.add`, `.update` and `.bulkAdd` already call `catalogPricingService` and `availabilityService.check()` — but never checks assortment scope. A buyer (or a script, or an AI purchasing agent) can add any product id directly to a cart today, bypassing the storefront's read-side 404 gate entirely. This spec closes that gap as a first-class requirement, not an afterthought.
- The cache-key primitive this needs **already exists** as shared infrastructure: `SPEC-029` §6.1's buyer-context digest already reserves an `assortmentScopeHash` slot. Nothing new is deferred here; this spec makes sure a correctly specified algorithm feeds that slot.
- Resolution: **base `AssortmentScope` type and pure algebra in `packages/shared`** (mirroring the `availability` contract's own base-in-shared / implementation-in-modules split), **storage and buyer-side resolution split between `customer_groups`** (group scope, union across memberships) **and `ecommerce`** (channel scope, intersection, the new authentication gate), **enforcement at both existing read seams (spec 4, unchanged) and a new write-side check added to `cart`'s three mutating line commands (spec 5, amended)**.

**Scope:**
- `AssortmentScope` type + `unionScopes` / `intersectScopes` / `matchesScope` pure functions, in `packages/shared/src/lib/catalog-visibility/`
- `customerGroupsService.resolveAssortmentScope()` — a new method, replacing `ResolvedTerms.assortmentScope` from spec 1 §6
- `EcommerceStoreChannelBinding.require_authentication: boolean` — new column, spec 3 §5.3
- `AssortmentScope` schema amendment (both spec 1 and spec 3 own a column of this shape): add `excludeCategoryIds` / `excludeTagIds` alongside the existing `excludeProductIds`
- A visibility check added to `cart.lines.add` / `.update` / `.bulkAdd` (spec 5, amended)
- Admin: category/tag/product pickers on the existing group-terms and channel-binding forms; a small "why can/can't this buyer see this product" explainability tool

**Concerns:**
- Getting the multi-group combination rule wrong either silently hides a product a merchant meant to grant (support ticket) or silently exposes one they meant to restrict (the more severe direction, same class as the suite's own cache-bleed findings)
- The write-side gap is the single highest-value fix in this spec — a read-side 404 that a cart mutation ignores is not a visibility control, it is a suggestion
- `require_authentication` and the multi-group union must not add a new cache-key dimension; they must resolve into the *existing* `assortmentScopeHash` input, or every fix here creates a second bleed vector

---

## 0) Relationship to Sibling Specs — Required Amendments

This document does not restate what is already decided. It amends three unimplemented sibling specs in the same suite, all still on branch `spec/ecommerce-module-suite` (PR [#5384](https://github.com/open-mercato/open-mercato/pull/5384), `do-not-merge`):

| Sibling spec | What changes |
|---|---|
| `2026-08-14-customer-groups-and-b2b-terms.md` | §5.3 `CustomerGroupTerms.assortment_scope`: shape amended (§4 below). §6 `ResolvedTerms`: the `assortmentScope` field is **withdrawn** — it cannot follow the generic per-field highest-priority-wins algorithm §6.1 defines for scalar terms (see §2.2 below for why). §6 gains a new sibling method, `resolveAssortmentScope()` (§5 below), specified here because its algorithm is the entire subject of this spec, not a two-line addition to another document. |
| `SPEC-029-2026-02-17-ecommerce-storefront-module.md` | §5.3 `EcommerceStoreChannelBinding.assortment_scope`: same shape amendment. New column `require_authentication: boolean` (§4.2 below). §4.1 step 6 and §6 `BuyerContext.assortmentScope`: computed via the new `intersectScopes()` (§3 below) instead of ad hoc intersection prose. |
| `2026-08-14-cart-module.md` | §3.1a commands `cart.lines.add`, `cart.lines.update`, `cart.lines.bulkAdd`: gain a mandatory assortment-scope check (§6 below) when the cart's channel is store-bound. New request field, new rejection code, new integration tests. §9's lock transition (`active → locked`) gains a new precondition (§6.2). §11's Events list gains one new event, `cart.line.visibility_rejected` (§6.3a). No entity or column changes to `cart` itself. |

None of these three files are edited by this spec — per this suite's own convention (see `2026-08-21-pricing-engine.md`'s own "Sibling spec provenance" note, which states its own citations to unmerged sibling documents are forward references, not settled fact), amendments are recorded here and applied to the sibling documents in a later revision or at implementation time.

---

## 1) Problem Statement

### 1.1 The scope-combination gap

`customer-groups-and-b2b-terms.md` §6.1 states `resolveTerms()`'s algorithm plainly: "per field independently: highest-priority group with a non-null value → its ancestors → tenant default." That rule is correct for `paymentTermsDays`, `priceKindId`, `approvalRequiredAbove` — scalar settings where exactly one value must win. It is the wrong rule for a *visibility grant*. A buyer in both "Wholesale" (scope: bulk-goods category) and "Q3 Preview" (scope: an upcoming-launch tag) would, under the generic rule, see only whichever group happens to have the higher `priority` integer — the other group's grant is silently discarded. Nothing in either sibling spec states this is intended, and it almost certainly is not: a merchant adding a second, more-permissive group to a buyer's account expects it to add visibility, not to be a no-op depending on a priority number they set for an unrelated reason (tie-breaking price rows).

### 1.2 The write-side gap

`storefront-public-api.md` enforces `buildStorefrontProductScope` on every product-returning read: listing, detail, facets, search, categories. `storefront-merchandising.md` treats it as a hard invariant curation cannot widen. Both are correct and both are read-only. `cart-module.md` §3.1, already fully specified, shows `cart` calling `catalogPricingService` (price) and `availabilityService.check()` (stock) from `lines.add`/`.update`/`.bulkAdd` — but nothing calls anything assortment-scope-related. A buyer who knows or guesses a product id (their own device history, a shared link, a scraped sitemap, a compromised session, a naive AI purchasing agent given a product id from an unrelated source) can add a restricted product straight to their cart via `POST /api/cart/carts/:token/lines`, and nothing in the currently-specified suite stops it. This is not a hypothetical: it is the exact "hidden but not actually protected" failure class, and it is worse than a merely cosmetic gap because `cart` totals feed directly into `checkout` and `SalesOrder` creation (per ADR-1/ADR-2) — an invisible product can be fully purchased.

### 1.3 The closed-catalog gap

Real B2B storefronts commonly need one of two things: (a) some products visible to everyone but a subset gated to specific groups (the common case — a public catalog with a wholesale tier layered on top), or (b) the entire storefront gated behind login (an invitation-only B2B portal with no public catalog at all). Case (a) is already achievable today by configuring group-level `assortment_scope` correctly (see §3.3). Case (b) has no first-class mechanism — an operator would have to configure the anonymous/default group's scope defensively and hope no code path bypasses it. BigCommerce and Shopify both ship an explicit "login required to view" switch (see Research, §2) rather than relying on an indirect configuration trick.

### 1.4 Field-combination ambiguity

Neither sibling spec states whether `categoryIds` and `tagIds` within one `AssortmentScope` object combine with AND or OR, nor whether an empty array means "no restriction on this dimension" or "restrict to the empty set" (i.e., hide everything). Both are genuine ambiguities with opposite-severity failure modes if guessed wrong: AND-instead-of-OR silently narrows a merchant's intended grant; empty-array-means-hide-everything turns a UI multi-select being cleared into an accidental storefront lockout.

---

## 2) Research — What Market Leaders Get Right

- **commercetools' Product Selections** are exactly this problem, solved as a first-class object: a Store's assortment is the union of its assigned *inclusion* Product Selections, and "if Product Selections of both Inclusion and Exclusion types are assigned to a Store and all are active, exclusion of Products takes precedence." This validates **multiple active selections combine (union)**, the precedent for Q1's resolution (§3.1 below) — commercetools does not have a "the highest-priority selection wins and the rest are discarded" mode. Its exclusion rule is a *cross-selection, global* override (an Exclusion-type selection beats the union of every Inclusion selection assigned to the store), which is a coarser mechanism than this spec's *within-one-scope* exclusion (§3.2, one group's own `excludeCategoryIds` only vetoes that same group's own grant — a sibling group without that exclusion can still grant the product back through the union). The two are not the same mechanism, but they support the same underlying principle — exclusion should win over inclusion wherever both apply — which `storefront-merchandising.md` §4.7 also independently adopted for its own, unrelated audience-targeting model ("Exclusion beats inclusion"), a second, unprompted confirmation the principle is the right default in this codebase's own conventions, even though its exclusion axis (group-audience membership) differs from this spec's (product/category/tag). [Product Selections | Merchant Center](https://docs.commercetools.com/merchant-center/product-selections)
- **Shopify B2B Catalogs** bundle a *publication* (which products) with a *price list* (what they cost) and assign the pair to a company or a specific company location; "if a publication isn't associated with a B2B catalog, then customers logged into their B2B accounts won't see any products for that location." This is the direct precedent for bundling assortment scope with commercial terms at the group level (`CustomerGroupTerms.assortment_scope`, spec 1's own already-made choice) rather than inventing a separate "visibility rule" entity — and for allowing more than one catalog/scope to apply to one buyer (multiple company locations can each carry catalogs), reinforcing the union decision in §3.1. [Catalogs and pricing in B2B](https://help.shopify.com/en/manual/b2b/catalogs)
- **BigCommerce and Shopify's "login to view" apps** both offer a whole-storefront gate distinct from per-group/per-category restriction — exactly the case this spec's `require_authentication` flag (§4.2) targets. Both frame it as a binary switch at the store/channel level, not as an emergent property of group configuration, which is the argument for adding an explicit field rather than relying on a defensively-configured default group.
- **What this spec deliberately skips relative to commercetools**: a first-class, independently-manageable "Product Selection" entity that can be assigned to multiple stores/groups at once. `CustomerGroupTerms.assortment_scope` and `EcommerceStoreChannelBinding.assortment_scope` are each a single embedded JSONB column, not a shared, reusable, separately-CRUD'd object. This was spec 1 and spec 3's decision, not this spec's to revisit — reopening it would mean re-litigating two already-written sibling specs' data models for a generalization this suite does not yet need (no requirement here for one scope to be shared across many groups/channels). Noted so the simplification is visible, not silently assumed.

---

## 3) Proposed Solution

No new module. No new entities. A shared pure-function contract, two schema amendments to already-planned columns, one new column, one new service method, and one new call site in an already-specified command.

### 3.1 Q1 resolved: multi-group combination is a union — and why the naive version is wrong

A buyer's **group-side** assortment scope is the union of every currently-matching group's own scope. The first draft of this spec tried to express that union by merging every group's `categoryIds`/`tagIds` into one flat `AssortmentScope` object. **That is mathematically wrong and was caught in review.** A flat scope object evaluates `categoryIds` AND `tagIds` together (§3.2) — so if a customer is in "Wholesale" (`{categoryIds: [A]}`) and "Preview" (`{tagIds: [B]}`), merging them into `{categoryIds: [A], tagIds: [B]}` and re-running the AND rule computes "in category A **and** tagged B," which wrongly *excludes* a plain category-A product that Wholesale alone should already grant. Two conditions on different dimensions cannot be flattened into one conjunctive object without changing their meaning; they can only be combined correctly as a **disjunction of the two original conditions** — "in category A, OR tagged B" — which is a different type shape, not a different value of the same shape.

The fix: a buyer's **effective** scope is not another `AssortmentScope`. It is a list of `AssortmentScope`s, each contributed by one group, combined by **OR across the list** (a product is visible if it matches *any* group's own, internally-unmodified scope):

```
groupScope(buyer) = [ effectiveScope(g1), effectiveScope(g2), ..., effectiveScope(gn) ]   // OR across elements
```

Each `gi`'s own `AssortmentScope` keeps its own internal AND-of-dimensions exactly as authored (§3.2) — nothing about one group's scope is altered by another group existing. This is a disjunction of conjunctions (DNF), the standard, and only correct, way to combine several independently-authored AND-conditions into one OR'd grant. §3.3 makes this the actual type.

If a customer is in "Wholesale" (grants category A) and "Preview" (grants tag B), the fix now genuinely grants **both** — a category-A product with no tag B, and a tag-B product outside category A, are both visible — regardless of which group has the higher `priority`. `priority` continues to govern every *scalar* term exactly as spec 1 §3.2/§6.1 already specifies (payment terms, price kind, credit limits); this is a deliberate, stated, single-field exception to that algorithm, not a departure from it.

**Why not intersection or priority-wins.** Priority-wins was rejected in §1.1: it silently discards a second group's grant. Intersection (a buyer sees only what *every one* of their groups agrees on) was considered and rejected too — it means adding a buyer to any additional group can only ever narrow what they see, which is backwards from how every reference platform in §2 treats combining grants, and would make "give this one wholesale customer early access to a preview collection" require removing them from Wholesale rather than adding Preview.

### 3.2 AND/OR and exclusion, within one scope object

Within a single `AssortmentScope` (one group's own, or the channel's own — this rule never spans more than one source):

```
included(product) =
     (categoryIds is empty/absent  OR  product.categoryIds ∩ categoryIds ≠ ∅)
  AND (tagIds is empty/absent       OR  product.tagIds ∩ tagIds ≠ ∅)

matchesOne(product, scope) =
     included(product)
  AND product.id       NOT IN excludeProductIds
  AND product.categoryIds ∩ excludeCategoryIds = ∅
  AND product.tagIds      ∩ excludeTagIds      = ∅
```

`categoryIds` and `tagIds` are **AND'd together as dimensions**, but each is itself an **OR-set** internally (matching how the storefront's own filter grammar already treats `options[color]=red,blue` — OR within one facet, per `storefront-public-api.md` §4.1). This is deliberately a *narrower* combination than §3.1's *across-source* union: within one scope object, a merchant is narrowing to an intersection of stated criteria ("must be in the wholesale category tree AND tagged for this campaign"); across independently-authored sources (§3.1), each is an independently-granted permission, so those combine additively via a different, list-shaped operator, never by merging fields. Keeping these two combinators textually and typographically distinct (`matchesOne`, single object, AND; vs. the list-level OR in §3.3) is what the naive draft got wrong by using one function name and one flat return type for both.

**Empty-array convention.** Within one `AssortmentScope`, an absent key and an explicitly empty array (`categoryIds: []`) are **equivalent** and both mean "no restriction on this dimension" — never "matches nothing." This is a safety rule, not just a convenience: an admin UI multi-select that gets cleared to empty must not silently lock out the whole channel or group. "Matches nothing" is instead expressed at the list level (§3.3) — an empty *list* of scopes, not an empty array inside one scope's fields.

**Exclusion beats inclusion** within one scope object, matching the principle (though not the exact mechanism — see §2) commercetools and `storefront-merchandising.md` §4.7 both apply.

### 3.3 The effective-scope type: an OR-list of AND-scopes, and why `[]` is not the same problem as `null`

```typescript
// packages/shared/src/lib/catalog-visibility/types.ts

/** One source's own grant — a group's, or a channel's. Never combines more than one source. */
export type AssortmentScope = {
  categoryIds?: string[]
  tagIds?: string[]
  excludeProductIds?: string[]
  excludeCategoryIds?: string[]   // new, this spec — symmetry with excludeProductIds
  excludeTagIds?: string[]        // new, this spec
}

/**
 * The resolved, buyer-facing grant. `null` = unrestricted (every source was unrestricted,
 * or there was nothing to restrict against — e.g. no matching groups). A non-null value is
 * an OR-list of AND-scopes (DNF): the buyer is visible-eligible for a product if it matches
 * ANY element. An empty array `[]` is therefore the vacuous OR — it has no element that could
 * ever match, so it means "matches nothing," and is distinct from `null`. This single
 * distinction (absent list = unrestricted; empty list = deny-all) is what let §5.2's
 * `require_authentication` short-circuit drop the sentinel-value/"third state" idea entirely:
 * `[]` already IS a well-typed, honest "matches nothing," expressible without widening
 * `AssortmentScope` itself or smuggling a hidden value through it.
 */
export type EffectiveAssortmentScope = AssortmentScope[] | null

export type ScopedProduct = { id: string; categoryIds: string[]; tagIds: string[] }

/** Single-source AND match, §3.2. */
export function matchesOne(product: ScopedProduct, scope: AssortmentScope): boolean

/** OR across sources. `null` → true (unrestricted). `[]` → false for every product (deny-all). */
export function matchesScope(product: ScopedProduct, effective: EffectiveAssortmentScope): boolean {
  if (effective === null) return true
  return effective.some(scope => matchesOne(product, scope))
}

/** Combines N independent sources' own scopes into one OR-list, §3.1. */
export function unionScopes(scopes: Array<AssortmentScope | null>): EffectiveAssortmentScope {
  if (scopes.length === 0) return null                         // no sources at all → unrestricted (spec 1 §6.2)
  if (scopes.some(s => s === null)) return null                // any unrestricted source makes the union unrestricted
  return scopes as AssortmentScope[]                            // each source becomes its own OR-branch, unmodified
}

/**
 * Distributes a single channel-level scope across every branch of an already-unioned
 * group-level effective scope: (channel) ∩ (g1 ∪ g2 ∪ ... ∪ gn) = (channel∩g1) ∪ (channel∩g2) ∪ ...
 * Each branch keeps BOTH conditions and evaluates them together via matchesOne-of-two-scopes —
 * this is why intersection does NOT try to merge categoryIds/tagIds arrays: merging the arrays
 * (e.g. via set intersection) computes a different, stronger condition than "matches channel's
 * own AND-rule and matches this group's own AND-rule," and is wrong for the same structural
 * reason flattening the union was wrong in §3.1.
 */
export function intersectScopes(channel: AssortmentScope | null, group: EffectiveAssortmentScope): EffectiveAssortmentScope {
  if (channel === null) return group
  if (group === null) return [channel]
  return group.map(g => mergeAsConjunction(channel, g))   // one AND-clause per branch; see below
}
```

`mergeAsConjunction(a, b)` evaluates "matches `a` AND matches `b`" for the two objects in one branch. It is implemented as evaluating both `matchesOne` calls at match time (a branch carries the *pair* of scopes to AND, not a single merged object) — `intersectScopes`'s exact internal representation of "one branch" (an `AssortmentScope[]` sub-list evaluated with AND, alongside the outer OR-list) is an implementation detail for whoever builds this; the property this spec requires and tests (§11) is: `matchesScope(product, intersectScopes(channel, group))` must equal `matchesOne(product, channel) && matchesScope(product, group)` for every fixture, i.e. the distributive law holds by construction, not by coincidence.

`matchesScope` is the single implementation both the SQL-shaped listing filter (§3.5) and the in-memory point-check (§6) are built from, so a listing query and a single-item check of the same effective scope can never disagree — a correctness property this spec asserts as a test (§9, §11).

Per `packages/shared/AGENTS.md` § Before Adding a New Utility, step 5: `packages/shared/src/lib/catalog-visibility/` imports nothing from `catalog`, `customer_groups`, `ecommerce`, or `cart` — it operates only on plain ids and the `AssortmentScope`/`ScopedProduct` shapes defined here, so there is no circular dependency by construction, in either direction. This mirrors `availability-contract.md`'s identical shared/module split, which states the same property for its own base contract.

### 3.4 `require_authentication` (Q2)

New column, `EcommerceStoreChannelBinding.require_authentication: boolean`, default `false`. When `true` and the resolving request has no authenticated buyer (`BuyerContext.customerUserId === null`), `storeContextService.resolve()` (SPEC-029 §4.1 step 6) short-circuits: `buyer.assortmentScope` is set to `[]` (§3.3's own well-typed "matches nothing" value) **before** calling `customer_groups` at all. This is a plain, ordinary value of the already-defined `EffectiveAssortmentScope` type — not a sentinel or a third state layered on top of it, which is what an earlier draft of this section incorrectly proposed and a review caught (Changelog). `matchesScope(anyProduct, [])` is `false` by construction (§3.3's `.some()` over an empty array), so this composes through `intersectScopes` exactly like any other branch — no special-casing needed downstream in `cart` (§6) or anywhere else. This is a per-channel, admin-configured toggle (Q2: "configurable if that is going to appear or not") — most channels leave it `false` and rely on group-level scoping for the common partial-restriction case (§1.3 case a); an operator running an invitation-only B2B portal sets it `true` on that channel (§1.3 case b).

This governs **catalog visibility only** — not the whole storefront (branding, static pages, login page itself). A full site-wide access wall is a distinct, larger feature and explicitly out of scope (§10).

### 3.5 Enforcement — read side unchanged, write side closed

`buildStorefrontProductScope` (`storefront-public-api.md` §3.3) does not change its own logic; it changes only what feeds it. Its `product ∈ (channel.assortmentScope ∩ buyer.assortmentScope)` clause is now `matchesScope(product, intersectScopes(channel.assortmentScope, buyer.assortmentScope))`, computed once per request by `ecommerce`, same as today (`buyer.assortmentScope` here is already the `EffectiveAssortmentScope` produced by `resolveAssortmentScope()`, §5.1). The handle-enumeration-oracle rule (`storefront-public-api.md` §4.2, R4) is unaffected: this spec adds no new information channel, only a correctly-computed input to a check that already collapses "restricted" and "nonexistent" into an identical 404.

The write side is new (§6): `cart.lines.add`/`.update`/`.bulkAdd` gain a `matchesScope` check.

---

## 4) Data Model

### 4.1 `CustomerGroupTerms.assortment_scope` (amends spec 1 §5.3)

Type becomes `AssortmentScope | null` (§3.3), i.e. the same jsonb column, with two new optional keys available: `excludeCategoryIds`, `excludeTagIds`. No migration beyond what spec 1 already specifies for this column — additive JSON keys inside an already-planned jsonb column require no schema change at all.

### 4.2 `EcommerceStoreChannelBinding` (amends `SPEC-029` §5.3)

| Column | Type | Notes |
|---|---|---|
| `assortment_scope` | jsonb, nullable | Unchanged column; type gains `excludeCategoryIds`/`excludeTagIds` per §4.1 |
| `require_authentication` | boolean | **New.** Default `false`. §3.4 |

### 4.3 No new entities, no new tables

Every field here lives on a column two sibling specs already planned to create. This spec's only net-new schema is one boolean.

---

## 5) Service Contract

### 5.1 `customer_groups` — `resolveAssortmentScope` (new, replaces `ResolvedTerms.assortmentScope`)

```typescript
// customer_groups/di.ts, customerGroupsService
interface CustomerGroupsService {
  // ...existing methods from spec 1 unchanged...

  resolveAssortmentScope(input: {
    customerId: string | null
    at?: Date
  }): Promise<{
    scope: EffectiveAssortmentScope   // union across every matching group, §3.1/§3.3; no matching groups → null (unrestricted)
    sourceGroupIds: string[]          // every group that contributed a scope, for the explain tool (§7)
  }>
}
```

`resolveTerms()` (spec 1 §6) is amended: its `ResolvedTerms` type **drops** the `assortmentScope` field. Every other field on `ResolvedTerms` is untouched and keeps resolving via the existing per-field-highest-priority algorithm — this amendment touches exactly one field.

`customerId: null` (anonymous, or no matching groups) returns `{ scope: null, sourceGroupIds: [] }` — consistent with spec 1 §6.2's existing rule that "absence of a group MUST NOT be an error," and with `unionScopes([])`'s defined behavior (§3.3).

### 5.2 `ecommerce` — `BuyerContext.assortmentScope` computation (amends `SPEC-029` §4.1 step 6, §6)

```typescript
// ecommerce/lib/storeContext.ts (inside storeContextService.resolve())
const requireAuth = channelBinding.requireAuthentication
const groupResult = requireAuth && !buyer.isAuthenticated
  ? { scope: [] as EffectiveAssortmentScope, sourceGroupIds: [] }   // §3.4 — the vacuous OR, not a sentinel
  : await customerGroupsService.resolveAssortmentScope({ customerId: buyer.customerId })

buyer.assortmentScope = intersectScopes(channelBinding.assortmentScope, groupResult.scope)
```

An earlier draft of this section tried to represent "deny all" as a special value threaded through `AssortmentScope` itself and got tangled in three mutually-incompatible sketches (a sentinel UUID, rejected as a hack; a "package-private third state," which would have contradicted §3.3's two-state type) — a review caught this as internally contradictory (Changelog). The fix needed no new machinery: `[]` is already a valid, ordinary `EffectiveAssortmentScope` value (§3.3) that means exactly "matches nothing," so `intersectScopes(channelBinding.assortmentScope, [])` returns `[]` (intersecting anything with "nothing" stays "nothing"), and every downstream consumer — `buildStorefrontProductScope` (§3.5) and `cart`'s write-path check (§6) — handles it through the same `matchesScope` call as any other resolved scope, with no special-casing.

### 5.3 `cart` — visibility input on the three mutating commands (amends `cart-module.md` §3.1a, §10)

```typescript
// cart.lines.add / cart.lines.update / cart.lines.bulkAdd — new input field
{
  // ...existing fields (productId, variantId, quantity, configuration, idempotencyKey)...
  assortmentScope?: EffectiveAssortmentScope   // from StoreContext.buyer.assortmentScope, §6 below
}
```

---

## 6) Write-Path Enforcement (the write-side gap, §1.2)

### 6.0 Two enforcement points, not one — closing the checkout-lock TOCTOU gap

A review of this spec's first draft found that checking only at `lines.add`/`.update`/`.bulkAdd` leaves a real, evidenced hole: `cart-module.md` §5.2 lists seven re-pricing triggers, two of which are whole-cart and one of which is stated as "**mandatory, never skipped**" — trigger 5, checkout requesting a lock. A group membership carries `valid_until` (spec 1 §5.2, a first-class, expected-to-be-exercised feature, not a hypothetical) — so a buyer can legitimately add a Wholesale-only product while a member, have that membership lapse before checkout, and reach checkout-lock with a now-invisible line that was never re-checked, because the original design only checked at add-time. That is exactly "an invisible product can be fully purchased" (§1.2's own motivating Critical risk), reopened by the fix meant to close it.

Enforcement therefore runs at **two** points, both amending `cart-module.md`:

1. **Per-line, at `lines.add`/`.update`/`.bulkAdd`** (§6.1 below) — cheap, immediate feedback when a buyer tries to add something they cannot see.
2. **Whole-cart, mandatory, at re-pricing triggers 2 (buyer identity/group membership change) and 5 (checkout requests a lock)** (§6.2 below) — the re-validation pass that closes the TOCTOU window, piggybacking on triggers `cart-module.md` already runs whole-cart and already never skips for trigger 5.

### 6.1 Per-line check, on add/update/bulkAdd

`cart.lines.add`, `cart.lines.update` (on quantity/configuration changes) and `cart.lines.bulkAdd` each call, after loading the product for its existing name/sku snapshot (`cart-module.md` §4.2) and before persisting the line:

```typescript
if (cart.channel === 'storefront') {
  if (input.assortmentScope === undefined) {
    throw new ValidationError('assortment_scope_required_for_storefront_channel')
  }
  const scopedProduct = { id: product.id, categoryIds: product.categoryIds, tagIds: product.tagIds }
  if (!matchesScope(scopedProduct, input.assortmentScope)) {
    return rejectLine({ code: 'product_unavailable', lineId: existingLineId ?? null })  // existingLineId set for .update; null for a not-yet-created .add line
  }
}
// non-storefront channels (pos, pay_link, agent, api): no scope enforced — §6.4
```

Requiring the caller to *supply* `assortmentScope` (rather than `cart` re-deriving it) keeps `cart` free of any new dependency on `ecommerce` or `customer_groups` beyond what `cart-module.md` §3.1 already declares (`customer_groups.resolveTerms()`), and matches ADR-7 "resolved once at the edge": the storefront API route that proxies to `cart` has already called `storeContextService.resolve()` for pricing purposes and passes the same `buyer.assortmentScope` through unchanged. Making the field **required-when-`channel==='storefront'`** (validated, not merely optional) turns "the route layer forgot to pass it" into a `400` at cart, not a silent bypass — the same "forgot the clause" failure class `storefront-public-api.md` §3.3 already calls out for its own single scope-building helper, closed here the same way: by construction, not by code-review discipline alone.

### 6.2 Whole-cart re-visibility pass, at triggers 2 and 5

At `cart-module.md`'s re-pricing trigger 2 (buyer identity changes: login, logout, or a group membership change) and trigger 5 (checkout requests a lock — "mandatory, never skipped"), the whole-cart re-price already recomputes every line's price against a freshly-resolved buyer context. This spec adds a parallel re-*visibility* pass in the same code path, using the same freshly-resolved `assortmentScope`: every existing line is checked with `matchesScope`, exactly as in §6.1, but against lines that already exist rather than a line being added.

A line that fails the check is **not deleted** — deleting a buyer's line without disclosure is exactly the failure class `cart-module.md`'s own R2 (guest cart destroyed on merge) and R4 (undisclosed price increase) already exist to prevent, and this spec does not introduce a third instance of it. Instead, the line is flagged `product_unavailable` in the response's `warnings` array (§6.3), identically to how an out-of-stock line is already surfaced (`cart-module.md` §10.1). The difference from an ordinary add-time rejection is what happens at trigger 5 specifically: **the checkout lock (`active → locked`) MUST NOT succeed while any line carries an unresolved `product_unavailable` warning** — this is a new requirement on `cart-module.md` §9's lock transition, and it is what actually closes the TOCTOU window, mirroring how `requiresApproval` already blocks the same lock transition for an over-threshold B2B cart (`cart-module.md` §14's existing integration-coverage line: "Over `approval_required_above`... blocks the checkout lock"). The buyer must remove or replace the flagged line (or, if their access is restored, re-trigger a re-price) before checkout can proceed — the same recovery path they already have for an out-of-stock line.

Whether the eventual `checkout` spec's own submit step additionally re-checks visibility a third time (the way `availability`'s authoritative `reserveAvailability()` re-checks stock at submit independent of the cart's advisory state) is that spec's own decision to make when it exists; this spec's requirement is only that the lock transition — which `cart` itself owns — cannot be acquired over a flagged line.

### 6.3 Rejection shape — no new enumeration oracle on the write side

A restricted product and a nonexistent/deleted product id both return the identical `product_unavailable` warning (`cart-module.md` §10.1's existing `warnings` array shape, `{ code: 'product_unavailable', lineId, message }`), not a distinguishing error. This mirrors `storefront-public-api.md`'s handle-enumeration-oracle rule (§4.2, R4) applied to a mutation instead of a read: an authenticated buyer's own cart is not a public discovery surface, but an AI agent or script with cart-write access should not be able to distinguish "you can't have this" from "this doesn't exist" through the write path either, when the read path has already gone to the trouble of hiding that distinction.

This is a **non-fatal warning**, per `cart-module.md` §10.1's own convention for out-of-stock lines — the line is simply not added (or, for `.update`, the quantity/configuration change is rejected and the line stays at its prior state), and the response's `warnings` array carries the code so the client can show a generic "unavailable" message without the cart mutation itself erroring out the whole request (consistent with `bulkAdd` needing partial success across 50 lines, and with §6.2's whole-cart pass flagging rather than deleting).

### 6.3a Operational signal (added after `/om-pre-implement-spec` review)

A rising rate of `product_unavailable` rejections is exactly the kind of drift this suite already instruments elsewhere — `availability-contract.md`'s `availability.shortfall.detected` and `customer_groups`' `.credit.limit_exceeded` both exist because "nobody would know" is the wrong answer to "what if this starts happening a lot." Without an equivalent signal here, a merchant who narrows the default group's `assortment_scope` too far, or a channel misconfigured with `require_authentication`, surfaces only as scattered support tickets, not a trend anyone can see.

`cart-module.md`'s Events list (§11 of that document) gains one new event, additive per `BACKWARD_COMPATIBILITY.md` category 5: `cart.line.visibility_rejected`, emitted by both enforcement points (§6.1's per-line check and §6.2's whole-cart pass), payload `{ cartId, productId, variantId, reason: 'not_in_assortment', triggeredBy: 'add' | 'update' | 'bulkAdd' | 'reprice' | 'checkout_lock' }`. It is not `clientBroadcast` — this is an operator-facing signal, not something the buyer's own browser needs pushed to it (the buyer already sees the `product_unavailable` warning in the response body).

### 6.4 Non-storefront channels are exempt by construction, not by special case

`cart.channel` values other than `'storefront'` (`pos`, `pay_link`, `agent`, `api`) never have a `StoreContext` to resolve a scope from in the first place — there is no channel binding, no buyer digest, nothing to enforce. Rather than hard-coding "POS is exempt," the rule is general: **assortment-scope enforcement applies exactly to carts whose channel resolved a `StoreContext`**, which today is `storefront` alone. If a future channel gains its own `StoreContext` resolution, it inherits the same enforcement automatically because the check is keyed on "was a scope supplied," not on an enumerated channel list. An in-store POS sale by staff, or an AI agent operating on a merchant's behalf outside the storefront, is a deliberately different trust boundary — the same distinction `sales`/admin order creation already gets from the storefront's own read-side rules (an admin can sell any product to any customer manually; assortment scope is a self-service merchandising control, not a sales permission).

---

## 7) UI/UX

- **`customer_groups` group-terms form** (spec 1's existing `CustomerGroupTerms` CRUD): the `assortment_scope` field gains category/tag multi-select pickers (sourced from `catalog`'s existing category/tag list endpoints, via the same cross-module read pattern spec 1 §7.3 already uses for its group picker — a widget/read call, not an ORM relation) and product-exclude pickers for `excludeProductIds`/`excludeCategoryIds`/`excludeTagIds`. No new page; an addition to an existing one. New i18n keys live in `customer_groups`' existing `i18n/{en,pl}.json` namespace, alongside the rest of that form's labels.
- **`ecommerce` channel-binding form** (`SPEC-029` §7's existing "Channels" tab, already described as showing "a live count of matching products"): gains the same category/tag/exclude pickers for the channel's own `assortment_scope`, plus a `require_authentication` toggle. The existing live-count preview naturally reflects both without new work, since it already recomputes against whatever `assortment_scope` is currently configured. The toggle's label and help text are new keys in `ecommerce`'s own `i18n/{en,pl}.json` namespace.
- **Explainability tool (optional, nice-to-have — cut first if this spec needs to shrink), owned by `ecommerce`.** A small read-only admin panel under `ecommerce/backend/`, "why can/can't customer X see product Y," showing: which of the buyer's groups contributed (`sourceGroupIds` from §5.1), the channel's own scope, and the final verdict from `matchesScope`. `ecommerce` is the natural owner — it is already the module that composes both channel and group scope into `BuyerContext` (§5.2), so it is the only place both halves of the explanation are already in hand without a second cross-module read. Guarded by a new `ecommerce.visibility.diagnose` feature declared in `ecommerce/acl.ts` and granted to `admin` in `setup.ts` `defaultRoleFeatures`, matching the same pattern `pricing-engine.md`'s own optional diagnostic page uses for its `pricing.diagnostics.view` feature. Mirrors the explainability convention this suite already established twice — `ResolvedTerms.sourceGroupId` (spec 1 §6) and `AvailabilityPolicy.policySourceId` (`availability-contract.md` §5.2) — for the same reason: "why is this wrong" is the first support question in every one of these systems, and this is the third time this suite has needed the answer. The buyer-facing `product_unavailable` message shown by the write-path warning (§6.3) is a new key in `cart`'s own `i18n/{en,pl}.json` namespace, alongside its existing warning-code strings.

---

## 8) Edge Cases & Failure Scenarios

| Scenario | Behavior | Rationale |
|---|---|---|
| Buyer in two groups, one grants category A, the other grants tag B | Sees both (union, §3.1) | §1.1, §2 |
| Group's `assortment_scope` has `categoryIds: []` after a UI clear | Treated as "no restriction from this group," not "hide everything" | §3.2 empty-array convention |
| Channel `require_authentication = true`, anonymous request | Every product-returning endpoint behaves exactly as if the assortment were empty — identical to today's existing "no default channel binding" `503`/empty-listing shapes, not a new response shape | §3.4 |
| A product is in a group's `categoryIds` allow-list *and* that same group's `excludeCategoryIds` | Excluded — exclusion beats inclusion within one scope | §3.2, §2 (commercetools precedent) |
| Buyer's group membership expires while a restricted item sits in their cart | Not deleted immediately. Flagged `product_unavailable` at the next whole-cart re-price (trigger 2, membership/identity change) or, mandatorily, at checkout-lock (trigger 5) — the lock cannot succeed until the buyer resolves it | §6.0, §6.2 — closes the checkout-lock TOCTOU gap a review found in the first draft |
| Cart line added while storefront-visible, buyer's cart channel is `storefront`, caller forgets to pass `assortmentScope` | `400 assortment_scope_required_for_storefront_channel` | §6.1, forgot-the-clause closed by validation |
| POS sale of a product outside any storefront assortment scope | Succeeds — POS carts never carry a `StoreContext` scope to check against | §6.4 |
| `unionScopes([])` (buyer resolves to zero matching groups, e.g. anonymous with no default group) | Returns `null` (unrestricted) — matches spec 1 §6.2's existing "absence of a group MUST NOT be an error" for every other field | §3.1, §5.1 |
| A future third scope source (e.g. a per-customer override, if ever added) needs combining | `unionScopes`/`intersectScopes` are variadic/pure and compose without new call-site logic — the algebra does not assume exactly two sources | §3.3 design |

---

## 9) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Cart write path bypasses read-side visibility | **Critical** | `cart` | Exactly §1.2: a product hidden from browsing is still purchasable via direct cart API calls, because `cart-module.md` as written never checks assortment scope. | §6.1: mandatory, validated (not optional) `assortmentScope` input on `lines.add`/`.update`/`.bulkAdd` for storefront-channel carts; a `400` on omission rather than silent pass-through; §6.2's whole-cart re-visibility pass at checkout-lock closes the time-of-check/time-of-use window between add and submit (R7); integration test purchasing a restricted product end-to-end and asserting rejection | Low, once shipped — the residual is only "a future new cart mutation forgets the same check," mitigated by the general channel-keyed rule in §6.4 rather than an enumerated list |
| R2 | Multi-group union computed incorrectly reopens a cache-bleed-shaped disclosure | **High** | `ecommerce`, `customer_groups` | A first draft of this spec tried to merge every matching group's `categoryIds`/`tagIds` into one flat `AssortmentScope`, which a review found computes a wrong (over-narrow) AND instead of the intended OR whenever two groups restrict on different dimensions (§3.1) — the opposite-severity failure from R2's original framing, but equally a correctness defect: a merchant's second, more-permissive group grant silently fails to apply. | `EffectiveAssortmentScope` is an OR-list of AND-scopes (DNF, §3.3), not a merged object; `unionScopes`/`intersectScopes`/`matchesScope` are pure, independently unit-tested functions with a dedicated multi-group, cross-dimension test matrix (§11) that specifically exercises the category-vs-tag case that broke the first draft; the listing-query filter and the point-check are both built from the same `matchesScope` function, so they cannot silently diverge | Low |
| R3 | `require_authentication`'s deny-all value handled inconsistently by a future caller | Low | `ecommerce` | A first draft represented "deny all" as an ad hoc, undecided sentinel and left three incompatible sketches for it, which a review flagged as internally contradictory (§5.2 Changelog). Residual risk after the fix is only that some future caller of `matchesScope` outside `ecommerce`'s resolver mishandles an `EffectiveAssortmentScope` of `[]` as if it meant something other than "matches nothing." | `[]` is an ordinary, already-defined value of the shared type (§3.3), not a special case call sites must know about — `matchesScope`'s own implementation (`.some()` over an empty array) makes "matches nothing" the only possible reading; a unit test asserts `matchesScope(anyProduct, [])` is always `false` | Low |
| R4 | Empty-array UI footgun | Medium | `customer_groups`, `ecommerce` | An admin clears a multi-select down to zero items intending "no change" and it is interpreted as "show nothing" | §3.2's explicit empty-equals-absent convention; a UI confirmation is out of scope for this spec but the *data-layer* behavior is safe regardless of what the UI does | Low |
| R5 | New write-side rejection becomes its own enumeration oracle | Medium | `cart` | A distinguishable "restricted" vs. "not found" response on cart mutation lets a script map a competitor's private assortment through cart-add attempts, the write-side analogue of `storefront-public-api.md`'s own R4 | §6.3: identical `product_unavailable` warning for both cases | Low |
| R6 | `ResolvedTerms.assortmentScope` removal breaks a caller written against spec 1 as currently drafted | Low | `customer_groups` | Spec 1 is unimplemented; no real caller exists yet. Risk is purely "whoever implements spec 1 first, before reading this amendment, ships the now-superseded field." | §0's amendment table is the single source of truth read before implementation; both documents will carry a forward/backward cross-reference once merged | Low |
| R7 | Checkout-lock time-of-check/time-of-use gap | **High** | `cart` | A first draft of this spec's write-path fix checked visibility only at `lines.add`/`.update`/`.bulkAdd`. A membership can expire (`valid_until`, spec 1 §5.2) between add-time and checkout, and `cart-module.md`'s own checkout-lock re-price (trigger 5, "mandatory, never skipped") never re-checked visibility — so a line added while visible could still reach `SalesOrder` creation after becoming restricted, reopening R1/§1.2's exact scenario. Found by review. | §6.0/§6.2: the whole-cart re-visibility pass at triggers 2 and 5, with the lock transition blocked while any line is flagged `product_unavailable` — mirroring the existing `requiresApproval`-blocks-lock precedent in `cart-module.md` §14 | Low, once shipped |

---

## 10) Open Questions (remaining, non-blocking)

1. **Full site-wide access wall.** `require_authentication` (§3.4) gates catalog visibility, not the entire storefront (a fully private site with no public pages at all, including branding/marketing pages). That is a `customer_accounts`/portal-auth-wall feature, not a catalog-visibility one, and is out of scope here.
2. **Per-customer override below the group level.** Everything in this spec resolves at the group level (§3.1) or the channel level. A single named customer needing a scope wider or narrower than every one of their groups (distinct from personal *pricing*, which `catalog`'s pricing resolver already supports per-customer) has no mechanism here. Not raised as a requirement by any sibling spec; noted so it is a deliberate omission, not an oversight.
3. **Checkout-submit re-check.** §6.2 requires `cart`'s own lock transition to block on a flagged line, but whether the (not-yet-in-front-of-this-spec) `checkout` spec's submit step should *additionally* re-check visibility independent of the cart's advisory state — the same defense-in-depth `availability`'s authoritative `reserveAvailability()` applies on top of the cart's advisory stock state — is that spec's own decision, not resolved here.

---

## 11) Integration Coverage

**Combination algebra (pure-function unit tests, no fixtures needed):**
- `unionScopes([{categoryIds:[A]}, {tagIds:[B]}])` (the exact case a first draft got wrong, §3.1/R2): a category-A/no-tag-B product matches, AND a tag-B/not-category-A product also matches — proving genuine OR across dimensions, not the flattened-AND regression a review caught
- `matchesScope` composed via `intersectScopes(channel, unionScopes([g1, g2]))` distributes correctly: equals `matchesOne(product, channel) && matchesScope(product, unionScopes([g1, g2]))` for every fixture (the distributive-law property §3.3 requires)
- `unionScopes([null, A])` returns `null`; `unionScopes([])` returns `null`
- `intersectScopes(A, null)` returns `[A]`-equivalent (matches iff `matchesOne(product, A)`); `intersectScopes(null, null)` returns `null`
- `matchesScope(anyProduct, [])` is always `false` (R3's deny-all property)
- Within one `AssortmentScope`: `categoryIds` OR-matches; `categoryIds` AND `tagIds` both required when both present; `excludeProductIds`/`excludeCategoryIds`/`excludeTagIds` each independently veto a match already granted by inclusion
- Empty array behaves identically to an absent key on every field, within one scope object

**Multi-group resolution (`customer_groups`):**
- A buyer in two groups with disjoint scopes (one category-scoped, one tag-scoped) sees the union of both, regardless of which group has higher `priority` (R2) — the fixture that specifically exercises the bug a review found
- A buyer in zero matching groups (including anonymous with no default group) resolves to `null` (unrestricted) — not an error
- `sourceGroupIds` names every contributing group

**Buyer-context composition (`ecommerce`):**
- Channel scope ∩ group union scope, verified against `storefront-public-api.md`'s own existing cross-context isolation suite (no regression to that suite is introduced)
- `require_authentication = true`, anonymous request: `buyer.assortmentScope` resolves to `[]`, without calling `customer_groups` at all (test asserts the call is skipped, not just that the result is empty — proves the short-circuit, not a coincidentally-empty group scope)
- `require_authentication = true`, authenticated request: resolves normally through §3.1/§3.3

**Write-path enforcement (`cart`) — the R1/R7 regression suite:**
- `lines.add` with a restricted product and a correctly-supplied `assortmentScope`: rejected with `product_unavailable`, cart totals unaffected
- `lines.add` for a `storefront`-channel cart with `assortmentScope` omitted: `400`, no line added
- `lines.bulkAdd` with a mix of visible and restricted products: visible ones added, restricted ones reported per-line in `warnings` with the correct `lineId` where one exists, no whole-batch failure
- `lines.update` changing quantity/configuration on an existing line whose product has since become restricted: rejected, existing line untouched (not deleted), `lineId` populated in the warning
- `pos`/`agent`/`api`-channel carts: no `assortmentScope` required, no rejection regardless of the product's storefront assortment status (R1/§6.4 boundary)
- **The R7 fixture**: add a line while the buyer is a member of a Wholesale-only group; expire the membership; trigger the checkout-lock (trigger 5); assert the lock transition fails/is blocked while the line remains flagged `product_unavailable`, and that the line is still present (not silently deleted)
- A membership change mid-session (trigger 2) re-runs the same whole-cart pass without waiting for checkout
- End-to-end: a product outside a buyer's assortment returns `404` from `GET /products/:idOrHandle` **and** is rejected from `POST /carts/:token/lines` with the identical class of "not distinguishable from nonexistent" response (R5)

**Enumeration safety:**
- A restricted and a nonexistent product id produce identical `cart.lines.add` responses (timing and body) — mirrors `storefront-public-api.md`'s own R4 test, applied to the write path

**UI paths (added after `/om-pre-implement-spec` review — every sibling spec in this suite lists these explicitly and this one had not):**
- `customer_groups` group-terms form: the new category/tag/exclude pickers save correctly and round-trip through `resolveAssortmentScope`
- `ecommerce` channel-binding form: the `require_authentication` toggle and the new exclude pickers both update the existing live product-count preview
- Explainability panel (`ecommerce/backend/`, if built): renders a correct multi-group trace — `sourceGroupIds` naming every contributing group, the channel's own scope, and the final `matchesScope` verdict — for a fixture where two groups each contribute a different branch of the union (the same fixture §11's algebra tests use)

---

## 12) Implementation Phases

### Phase 1 — Shared contract and `customer_groups` resolution
`packages/shared/src/lib/catalog-visibility/` (`AssortmentScope`, `EffectiveAssortmentScope`, `matchesOne`, `matchesScope`, `unionScopes`, `intersectScopes`); `customerGroupsService.resolveAssortmentScope()`; `ResolvedTerms.assortmentScope` removed. Add a `catalog-visibility` row to `packages/shared/AGENTS.md`'s Library Directory table (per `/om-pre-implement-spec` review — every existing `src/lib/` subdirectory is listed there, and this one should not be the exception a future spec author has to discover by grepping). Independently shippable — no dependency on `ecommerce` or `cart`.

**Gate:** the pure-function unit-test matrix (§11) passes, including the category-vs-tag disjoint-dimension fixture that specifically exercises the union defect a review found in this spec's first draft (R2).

### Phase 2 — `ecommerce` composition and the authentication gate
`BuyerContext.assortmentScope` computed via `intersectScopes`; `require_authentication` column and resolver short-circuit (`[]`, R3); admin UI additions to the channel-binding form.

**Gate:** `storefront-public-api.md`'s existing cross-context isolation suite still passes unmodified; the new authentication-gate test (§11) passes.

### Phase 3 — Cart write-path enforcement
`assortmentScope` input on `lines.add`/`.update`/`.bulkAdd` (§6.1); validation requiring it for `storefront`-channel carts; `product_unavailable` warning code with correct `lineId`; the whole-cart re-visibility pass at triggers 2 and 5, and the checkout-lock block while a line is flagged (§6.2, closing R7); admin group-terms/channel-binding pickers for the new exclude fields.

**Gate:** the R1/R7 regression suite (§11) passes in full — this is the phase that closes the write-side gap and is the highest-priority phase of the three if only one can ship first.

**On not splitting this into separate specs.** §12's own phase gates show Phases 1–3 are independently deployable, and Phase 3 alone is what removes the live exposure (§1.2) — a fact this document states plainly rather than hides. That is not, by itself, a reason to split into three documents: this suite already phases single conceptual capabilities within one spec rather than one-spec-per-phase (`availability-contract.md`'s three phases are one document; so is `customer-groups-and-b2b-terms.md`'s four). The read-side algebra fix (Phases 1–2) and the write-side enforcement (Phase 3) are one capability — a visibility control whose read half and write half must agree, the same way `cart-module.md`'s own ADR-2 treats cart and order totals as one correctness requirement rather than two specs that happen to compute the same number. What would justify a split is if Phase 3 depended on a module this document does not already assume; it does not — it amends `cart-module.md`, already a dependency.

---

## 13) Final Compliance Report

| Requirement | Status |
|---|---|
| Scope cohesion | Three phases, each independently shippable per §12's own gates — the spec states this plainly rather than papering over it. Bundled as one document because they are facets of one capability (a visibility control whose read and write halves must agree), following this suite's own precedent of phasing one capability within one spec (`availability-contract.md`, `customer-groups-and-b2b-terms.md`) rather than one spec per phase — not because the phases are inseparable |
| Canonical mechanisms reused | `buildStorefrontProductScope` (spec 4) unchanged; `intersectScopes`/`unionScopes`/`matchesScope` follow the `availability` contract's base-in-shared precedent exactly; category/tag matching reuses `CatalogProductCategoryAssignment`/`CatalogProductTagAssignment`, the same tables `catalog`'s own `buildProductFilters` already joins against (verified by direct read of `catalog/api/products/route.ts`) |
| No cross-module ORM relations | `AssortmentScope` operates on plain ids (`categoryIds`, `tagIds`, `excludeProductIds`); `cart`'s new field is a plain value passed by the caller, not a live reference; `customer_groups`/`ecommerce`/`cart` remain coupled only via DI services and FK ids |
| Contracts and compatibility | `AssortmentScope` gains two optional keys (additive, jsonb, no migration); `ResolvedTerms.assortmentScope` removal is a change to an *unimplemented* sibling spec's contract, not a shipped one — no `BACKWARD_COMPATIBILITY.md` surface is broken since nothing here exists on `develop` yet; `cart.lines.add`/`.update`/`.bulkAdd` gain a new optional-then-conditionally-required field, additive to an unimplemented command signature |
| Reversibility | `require_authentication` is a boolean an operator can flip back; nothing here is a destructive migration |
| Sensitive data | No new PII surface; `AssortmentScope` carries only catalog ids |
| Failure scenarios | §8, §9 — every new branch (union, authentication gate, write-path check, checkout-lock TOCTOU) has a stated behavior and a test |
| Testability | Every Implementation Plan phase has an associated gate in §11/§12 |
| Cache-key contract | No new cache-key dimension: `assortmentScopeHash` already exists in `SPEC-029` §6.1's digest; this spec supplies a correctly-computed value for that existing slot and does **not** build new shared cache-key infrastructure — that primitive was already built by `SPEC-029` itself, so nothing here is deferred |
| Handle-enumeration-oracle rule | Read side untouched (still `storefront-public-api.md` §4.2's existing behavior); write side gets the equivalent treatment (§6.3, R5) |
| Citation accuracy | A fresh-context adversarial review (§14) found and this revision corrected two miscited sibling-document claims — a nonexistent cache-related "deferral" attributed to `pricing-engine.md`, and a "provenance note" wrongly attributed to `ecommerce-suite-roadmap.md` instead of `pricing-engine.md`'s own — and confirmed every other citation (the `cart-module.md` assortment-scope gap, the digest slot, the availability-contract precedent, the OR-facet grammar) against the actual sibling-document text |

---

## 14) Changelog

- **2026-08-21** — Initial skeleton with Open Questions Q1 (multi-group combination), Q2 (whole-channel authentication toggle), Q3 (cart re-validation contract). Grounded against direct reads of `2026-08-14-ecommerce-suite-roadmap.md`, `2026-08-14-customer-groups-and-b2b-terms.md`, `2026-08-14-storefront-public-api.md`, `2026-08-14-storefront-merchandising.md`, `SPEC-029-2026-02-17-ecommerce-storefront-module.md`, and current `develop` code in `packages/core/src/modules/catalog/` and `packages/core/src/modules/customer_accounts/` (confirmed: no product-level channel/visibility concept exists today, only offer- and price-scoped channel ids; no `CustomerGroup` table exists yet, confirming the roadmap's own claim; category/tag assignment tables already exist and are reused here).
- **2026-08-21** — Q1 resolved: union across groups, confirmed by the user and cross-checked against commercetools' multi-selection combination and Shopify's multi-catalog-per-location model (§2). Q2 resolved: add the explicit `require_authentication` toggle, confirmed configurable per the user's answer. Q3 resolved: `2026-08-14-cart-module.md` exists in the same PR (the user pointed to it, not found by this spec's own initial branch listing) — read in full; confirmed it specifies `lines.add`/`.update`/`.bulkAdd` calling pricing and availability but never assortment scope, which promoted the write-side gap from a hypothetical risk to a concretely-evidenced one (§1.2, R1). Full spec drafted: field-combination semantics (§3.2), a shared pure-function contract mirroring the `availability` contract's precedent, an authentication-gate design, and a write-path enforcement contract closing R1.
- **2026-08-21** — Fresh-context adversarial review (per `om-spec-writing` step 8; reviewer had no prior context and independently re-fetched and read every cited sibling document and the current `develop` code). Findings applied:
  - **Critical**: the draft's `unionScopes` merged every matching group's `categoryIds`/`tagIds` into one flat `AssortmentScope`, which computes an AND where a union requires an OR — demonstrably wrong on the spec's own worked example (a category-scoped group and a tag-scoped group), and would have silently narrowed exactly the grant Q1 exists to widen. Fixed by introducing `EffectiveAssortmentScope` (§3.3) as an OR-list of AND-scopes (DNF) instead of a second value of the same flat type; `unionScopes`/`intersectScopes`/`matchesScope` rewritten around it; R2 rewritten to describe the actual defect found and its fix.
  - **Critical**: two fabricated citations — a nonexistent "cache-key deferral" attributed to `pricing-engine.md` (that document never discusses caching; verified by direct grep), and a "provenance note" wrongly attributed to `ecommerce-suite-roadmap.md` instead of `pricing-engine.md`'s own section of that name. Both corrected (§0, §13).
  - **High**: the write-path fix checked visibility only at `lines.add`/`.update`/`.bulkAdd`, leaving `cart-module.md`'s own mandatory checkout-lock re-price (trigger 5) and identity-change re-price (trigger 2) unchecked — a membership expiring between add and checkout let a now-restricted line still reach `SalesOrder` creation, reopening §1.2's own motivating scenario. Fixed by adding §6.0/§6.2: a mandatory whole-cart re-visibility pass at those two triggers, blocking the checkout-lock transition while any line is flagged — new risk R7.
  - **High**: §5.2's `require_authentication` short-circuit described three mutually incompatible ideas for a "deny-all" value (a rejected sentinel UUID, a "package-private third state" contradicting the type's own two-state definition). Resolved for free by the `EffectiveAssortmentScope` redesign above: `[]` (the vacuous OR) is already a well-typed "matches nothing," needing no sentinel or hidden state. R3 rewritten accordingly.
  - **Medium**: the commercetools "exclusion beats inclusion" citation overstated equivalence to this spec's own (narrower, within-one-scope) exclusion rule — corrected to state the mechanisms differ while the underlying principle is shared (§2). `rejectLine`'s pseudocode hardcoded `lineId: null` for all three commands, wrong for `.update`; fixed to pass the existing line id when known (§6.1). Added an explicit note on scope cohesion (§12, §13) rather than letting the Compliance Report's "one capability" claim stand uncontested against the Phasing section's own admission that phases are independently shippable.
- **2026-08-21** — `/om-pre-implement-spec` analysis (`ANALYSIS-2026-08-21-buyer-scoped-catalog-visibility.md`). No Backward Compatibility violations or Critical gaps found — verified by direct repo grep that nothing this spec amends exists on `develop` yet, and no naming collision for any new identifier this spec introduces. Three Important gaps applied:
  - No ACL feature or owning module named for the optional explainability tool. Fixed: assigned to `ecommerce` (§7 — it already composes both halves of the explanation into `BuyerContext`), new feature `ecommerce.visibility.diagnose`, matching `pricing-engine.md`'s own `pricing.diagnostics.view` precedent.
  - No operational signal for a rising rate of visibility rejections, unlike this suite's own `availability.shortfall.detected` and `customer_groups`' `.credit.limit_exceeded` precedents for analogous gates. Fixed: new event `cart.line.visibility_rejected` (§6.3a), amending `cart-module.md`'s Events list (§0 table updated).
  - §11 lacked the UI-paths test list every sibling spec in this suite carries for its own admin-UI work. Fixed: added (§11).
  - Nice-to-have gaps also applied: a `packages/shared/AGENTS.md` Library Directory table update noted in Phase 1 (§12); an explicit no-circular-dependency statement in §3.3, mirroring `availability-contract.md`'s own precedent; named i18n key namespaces for the two new user-facing strings (§7).
