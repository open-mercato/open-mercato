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
- **Visibility resolves per group *and* per customer** (§3.6, added 2026-09-16). A single named account can be granted more than its groups allow and restricted below what they allow, in the same row, and neither direction needs a new operator: the grant is one more branch of §3.1's union, the restriction one more layer of §3.3's intersection. The whole composition happens inside `resolveAssortmentScope()`, so the read seam, the cart write-side check and the cache-key contract are untouched. Per-customer *pricing* already worked this way (`CatalogProductPrice` carries `customer_id` and `customer_group_id` side by side); this brings visibility level with it.
- The cache-key primitive this needs **already exists** as shared infrastructure: `SPEC-029` §6.1's buyer-context digest already reserves an `assortmentScopeHash` slot. Nothing new is deferred here; this spec makes sure a correctly specified algorithm feeds that slot.
- Resolution: **base `AssortmentScope` type and pure algebra in `packages/shared`** (mirroring the `availability` contract's own base-in-shared / implementation-in-modules split), **storage and buyer-side resolution split between `customer_groups`** (group scope, union across memberships) **and `ecommerce`** (channel scope, intersection, the new authentication gate), **enforcement at both existing read seams (spec 4, unchanged) and a new write-side check added to `cart`'s three mutating line commands (spec 5, amended)**.

**Scope:**
- `AssortmentScope` type + `unionScopes` / `intersectScopes` / `matchesScope` pure functions, in `packages/shared/src/lib/catalog-visibility/`
- `customerGroupsService.resolveAssortmentScope()` — a new method, replacing `ResolvedTerms.assortmentScope` from spec 1 §6
- `EcommerceStoreChannelBinding.require_authentication: boolean` — new column, spec 3 §5.3
- `AssortmentScope` schema amendment (both spec 1 and spec 3 own a column of this shape): add `excludeCategoryIds` / `excludeTagIds` alongside the existing `excludeProductIds`
- A visibility check added to `cart.lines.add` / `.update` / `.bulkAdd` (spec 5, amended)
- `CustomerAssortmentOverride` — one sparse, optional row per customer carrying `grant_scope` and `restrict_scope`, owned by `customer_groups` and linked to the customer as an **entity extension** (§4.4), shipped last as Phase 4
- Admin: category/tag/product pickers on the existing group-terms and channel-binding forms, an injected "Assortment" section on the customer detail page, and a small "why can/can't this buyer see this product" explainability tool

**Concerns:**
- Getting the multi-group combination rule wrong either silently hides a product a merchant meant to grant (support ticket) or silently exposes one they meant to restrict (the more severe direction, same class as the suite's own cache-bleed findings)
- The write-side gap is the single highest-value fix in this spec — a read-side 404 that a cart mutation ignores is not a visibility control, it is a suggestion
- `require_authentication` and the multi-group union must not add a new cache-key dimension; they must resolve into the *existing* `assortmentScopeHash` input, or every fix here creates a second bleed vector
- The per-customer layer is the suite's first *widening* buyer-side grant, so layer order stops being cosmetic: it must stay inside the buyer layer, below the channel intersection and below `require_authentication`'s short-circuit, or one account's override silently outranks a channel-wide restriction (R8)
- Per-customer scoping costs cache sharing by construction; the requirement is that it costs it **only for the customers who have a rule**, which depends entirely on hashing the resolved value rather than the inputs (§3.7, R9)

---

## 0) Relationship to Sibling Specs — Amendments (applied 2026-09-06)

This document does not restate what is already decided. It amends three unimplemented sibling specs in the same suite. **Those amendments are applied in the sibling documents themselves**, not merely recorded here — all four files ship together, so a deferred amendment would leave an implementer working from `cart-module.md` alone building the exact Critical hole §1.2 describes. Each row below links to the section that now carries the change:

| Sibling spec | What changed | Applied in |
|---|---|---|
| `2026-08-14-customer-groups-and-b2b-terms.md` | §5.3 `CustomerGroupTerms.assortment_scope`: shape amended (§4 below). §6 `ResolvedTerms`: the `assortmentScope` field is **withdrawn** — it cannot follow the generic per-field highest-priority-wins algorithm §6.1 defines for scalar terms (see §2.2 below for why). §6 gains a new sibling method, `resolveAssortmentScope()` (§5 below), specified here because its algorithm is the entire subject of this spec, not a two-line addition to another document. | That spec's §5.3, §6, new §6.4, §17 US-C2, changelog `2026-09-06`. **2026-09-16:** new entity §5.7 `CustomerAssortmentOverride` (§4.4 below), `resolveAssortmentScope()` gains `sourceCustomerOverrideId`, §10 gains the override's CRUD events and their cache-invalidation duty |
| `SPEC-029-2026-02-17-ecommerce-storefront-module.md` | §5.3 `EcommerceStoreChannelBinding.assortment_scope`: same shape amendment. New column `require_authentication: boolean` (§4.2 below). §4.1 step 6 and §6 `BuyerContext.assortmentScope`: computed via the new `intersectScopes()` (§3 below) instead of ad hoc intersection prose. | That spec's §4.1, §5.3, §6, changelog `2026-09-06` (v4.2). **2026-09-16:** §4.1 step 6 and §6.1 note that the buyer-side scope now includes the per-customer override and that `assortmentScopeHash` hashes the canonicalized resolved value (§3.7) — no change to the composition line itself |
| `2026-08-14-cart-module.md` | §3.1a commands `cart.lines.add`, `cart.lines.update`, `cart.lines.bulkAdd`: gain a mandatory assortment-scope check (§6 below) when the cart's channel is store-bound. New request field, new rejection code, new integration tests. §9's lock transition (`active → locked`) gains a new precondition (§6.2). §11's Events list gains one new event, `cart.line.visibility_rejected` (§6.3a). No entity or column changes to `cart` itself. | That spec's new §6a, §9, §11, §13 (R11/R12), §14, changelog `2026-09-06` (rev 3). **2026-09-16:** §5.2's re-pricing trigger 2 is restated as "buyer identity, group membership **or per-customer assortment override** change" (§6.2 below) |

An earlier revision of this section recorded these amendments without applying them, on the reasoning that the siblings were unmerged work on another branch. That reasoning was wrong for this suite: the siblings are not on another branch, they are in the same directory and the same change. A recorded-but-unapplied amendment is invisible to anyone reading the amended document directly — which is how an implementer reads `cart-module.md`, a document marked "rev 2, pre-implementation fixes" that reads as complete. Applied 2026-09-06; this table is now a cross-reference index, not a to-do list.

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

## User Stories

Derived from §1's problem statement and §3–§7's proposed solution. Story IDs (`US-<epic>-<n>`) are referenced by the click-through prototype's `screen-refs` (see `om-mockup-prototype`). Epics D–F cover buyer-facing behavior this spec specifies but does not itself build UI for (the storefront/cart UI belongs to sibling specs); their stories are included so the prototype can illustrate the *consequence* of this spec's rules honestly, not as new UI scope.

### Epic A — Merchant grants group-level catalog visibility (`customer_groups`)

**US-A1** — As a merchant admin, I want to restrict a customer group's catalog to specific categories and tags, so that I can run a wholesale-only assortment without editing every product.
- Given the group-terms form (§7), when I open the "Assortment scope" section, I see category and tag multi-select pickers, empty by default (= unrestricted).
- Selecting one or more categories/tags saves as `AssortmentScope.categoryIds`/`tagIds`; clearing all selections back to empty saves as "no restriction," never as "hide everything" (§3.2, R4).
- Permission: only a user with the existing group-terms edit feature can change this field; a read-only viewer sees the pickers disabled, not hidden.
- Error: saving with a category/tag id no longer present in `catalog` shows an inline validation error naming the missing id, not a generic failure toast.

**US-A2** — As a merchant admin, I want to exclude specific products, categories, or tags from a group's grant, so that I can carve out exceptions without restructuring the whole scope.
- Given a group already has an inclusion scope, when I add an item to "Exclude products/categories/tags," that item is vetoed even if a category grant would otherwise include it (§3.2, exclusion beats inclusion).
- Empty exclude lists behave identically to absent (no vetoes) — same empty-array convention as inclusion.

**US-A3** — As a merchant admin, I want a buyer in two groups to see the union of what each group grants, so that adding a more permissive group only ever widens what that buyer can see, never narrows it based on a `priority` value set for an unrelated reason.
- Given a buyer in "Wholesale" (grants category A) and "Preview" (grants tag B), viewing the buyer's effective catalog (Epic C's explainability tool) shows both a category-A/no-tag-B product and a tag-B/not-category-A product as visible.
- Illustrative only in the prototype — §3.1's union algebra is not executed; a note says so explicitly and cites §3.1/R2.

**US-A4** — As a merchant admin, I want to widen *or* narrow one named customer's catalog independently of their groups, so that I can give a single account early access to a collection, or hold it to its contracted assortment, without creating a group of one.
- Given the customer detail page, the injected "Assortment" section shows two labelled blocks — "Also allow" and "Restrict to / exclude" — plus a validity window and a notes field (§7).
- Filling only "Also allow" widens: the customer sees everything their groups grant plus the added categories/tags, and nothing their groups already grant is lost (§3.6).
- Filling "Restrict to / exclude" narrows across *every* group grant, not only the products this override itself added — this is the direction a group-level scope cannot express.
- Setting both blocks to the same scope yields "this customer sees only this," with no separate mode switch to find (§3.6).
- Bounded by the channel: an override can never reveal a product the storefront channel's own scope excludes, and never reaches an anonymous visitor on a channel with `require_authentication` on (§3.6, R8).
- Empty state: a customer with no override shows the section with both blocks empty and a line stating their assortment comes entirely from their groups — the common case, and the one that keeps their cache sharing intact (§3.7).
- Permission: gated behind the same feature that gates group-terms editing; a viewer without it sees the section read-only, matching US-A1.

### Epic B — Merchant configures channel-level scope and the authentication gate (`ecommerce`)

**US-B1** — As a merchant admin, I want to restrict a storefront channel's own catalog independently of any customer group, so that I can run a public catalog with a narrower channel-wide assortment.
- Given the channel-binding "Channels" tab, setting category/tag/exclude pickers recalculates the existing live product-count preview to reflect the channel scope alone.
- Empty state: a channel with no scope configured shows "All products in this channel's catalog" and the full count.
- Permission: gated behind the existing `ecommerce.channels.manage` feature (`SPEC-029` §9.3), the same feature that already gates every other field on this binding — no new permission is introduced for the assortment-scope pickers or the authentication toggle in US-B2.

**US-B2** — As a merchant admin, I want to require login before any product is visible on a channel, so that I can run an invitation-only B2B portal with no public catalog at all.
- Default value: an existing or newly-created channel binding starts with the toggle off (`require_authentication: false`, §3.4) — a merchant who never opens this tab keeps today's public-catalog behavior.
- Given the channel-binding form, toggling "Require authentication" takes effect on save; the live count preview updates to "0 products visible to anonymous visitors" (§3.4, §8's edge-case row).
- The toggle's help text states it governs catalog visibility only, not the whole storefront, so an admin does not mistake it for a full site lockout (§3.4; full site lock is explicitly out of scope, §10 Q1).
- Keyboard: the toggle is reachable and operable via Tab/Space like any other form control — no custom widget.

### Epic C — Merchant diagnoses why a buyer can/can't see a product (optional explainability tool)

**US-C1** — As a merchant support agent, I want to look up one buyer and one product and see the verdict plus every contributing source, so that I can answer "why can't this customer see this item" without reading code or logs.
- Given the diagnose panel, entering a buyer and a product shows: the channel's own scope verdict, each of the buyer's matching groups (`sourceGroupIds`) with its individual grant/no-grant, and the final combined verdict.
- Field-combination example (§1.4/§3.2, the AND-of-dimensions rule the sibling specs left ambiguous): for a product in a group's granted category but *not* tagged with that same group's required tag, the trace shows that single group's own verdict as no-grant — category alone does not satisfy a scope that also specifies `tagIds` — while a sibling group whose scope only names the category still grants it independently (this is what makes the case legible as "one group's AND, several groups' OR" rather than one flattened rule).
- Permission: gated behind `ecommerce.visibility.diagnose`; a user without that feature does not see the panel or its menu entry at all — an absence, not a disabled state, matching this repo's RBAC convention.
- No-match state: a buyer with zero matching groups shows "no group grants — visibility depends on the channel's own scope only," not an empty or broken table.
- Error state: an unknown buyer or product id shows a clear "not found" message — distinguishable here, since this is an internal admin tool, not the public storefront oracle (§3.5 applies only to buyer-facing surfaces).
- Dependency: this panel is optional (§7 — "cut first if this spec needs to shrink"); US-A3's illustration of the union rule is written against this panel because it is the only surface that shows a multi-group verdict, so if Epic C is descoped the prototype substitutes a static annotated diagram for US-A3 rather than silently dropping that story.

### Epic D — Buyer browses a scoped storefront (read-side, illustrative)

**US-D1** — As a storefront buyer, I want a product I'm not permitted to see to behave exactly like a nonexistent product, so that I can't distinguish "restricted" from "deleted" by probing the storefront.
- Visiting a restricted product's detail page (or it appearing in a listing/facet/search) returns the same 404 / absence a deleted product would.
- Illustrative only — the prototype does not execute `matchesScope`; a note cites §3.5/R4 (handle-enumeration-oracle rule).

### Epic E — Buyer's cart mutation is checked at add time (write-side, illustrative)

**US-E1** — As a storefront buyer, I want adding a restricted product straight to my cart (a stale link, a scraped id) to be rejected the same way an out-of-stock item is, so a hidden catalog restriction can't be bypassed by calling the cart API directly.
- Adding a restricted product shows a non-fatal "unavailable" warning in the cart drawer; the line is not added; other lines in the same bulk-add are unaffected (§6.1, §6.3).
- The rejection is indistinguishable in class from an out-of-stock rejection and from a nonexistent-product rejection (§6.3, R5) — a note flags this as deliberate, not a bug.

### Epic F — Buyer's cart flags a line that became restricted mid-session (whole-cart re-visibility)

**US-F1** — As a storefront buyer, I want to be warned — not silently have my cart line deleted — if a product I already added becomes restricted before I check out, so that I keep control over resolving the conflict.
- If a buyer's group membership lapses (or the channel scope narrows) after a line was added while visible, the cart shows the line flagged "unavailable" instead of removing it (§6.2).
- With a flagged line present, attempting to lock the cart for checkout is blocked with an explanation naming the flagged line(s); removing or replacing the line (undo path) unblocks the lock.
- Illustrative only — the prototype shows the flagged-line and blocked-checkout states as static screens, not a live re-price trigger.

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

**"Single implementation" is a property held by a test, not by the code (clarified 2026-09-16).** A TypeScript predicate cannot run inside Postgres, so in practice there are two evaluators — `matchesScope` in memory and whatever SQL `buildStorefrontProductScope` emits — with an asserted equivalence between them. That is fine and is what §9/§11 already require, but it makes the equivalence test load-bearing rather than incidental, so it MUST be **property-based** over generated scopes and products rather than a fixture table. The failure this spec's own history predicts is a combination nobody enumerated — the flattened-union bug in §3.1 was exactly that — and a fixture table only ever covers what its author already thought of. The harness is in place (`.ai/specs/2026-04-24-agentic-property-based-testing.md`).

**What the SQL side evaluates against (added 2026-09-16).** `ScopedProduct` is already `{ id, categoryIds, tagIds }` — this contract has therefore already committed to a product's scope-relevant attributes being a small, flat, denormalizable set, which is what makes an efficient SQL side possible at all. `storefront-public-api.md` §3.3 takes that commitment and fixes the representation: a GIN-indexed `scopeKeys: text[]` (`cat:<uuid>` / `tag:<uuid>`, categories expanded to include ancestors) on the product's index document, so each DNF branch is an array-overlap test rather than a chain of `EXISTS` over `catalog_product_category_assignments` / `catalog_product_tag_assignments`. Category ancestor expansion is a lookup, not a recursive CTE, because `CatalogProductCategory` already maintains `ancestorIds`/`descendantIds` as `jsonb`. Nothing in §3.2's semantics changes — this is the physical representation the equivalence test above is asserted across, and it is named here so the pure contract and its SQL twin are not designed independently.

Per `packages/shared/AGENTS.md` § Before Adding a New Utility, step 5: `packages/shared/src/lib/catalog-visibility/` imports nothing from `catalog`, `customer_groups`, `ecommerce`, or `cart` — it operates only on plain ids and the `AssortmentScope`/`ScopedProduct` shapes defined here, so there is no circular dependency by construction, in either direction. This mirrors `availability-contract.md`'s identical shared/module split, which states the same property for its own base contract.

### 3.4 `require_authentication` (Q2)

New column, `EcommerceStoreChannelBinding.require_authentication: boolean`, default `false`. When `true` and the resolving request has no authenticated buyer (`BuyerContext.customerUserId === null`), `storeContextService.resolve()` (SPEC-029 §4.1 step 6) short-circuits: `buyer.assortmentScope` is set to `[]` (§3.3's own well-typed "matches nothing" value) **before** calling `customer_groups` at all. This is a plain, ordinary value of the already-defined `EffectiveAssortmentScope` type — not a sentinel or a third state layered on top of it, which is what an earlier draft of this section incorrectly proposed and a review caught (Changelog). `matchesScope(anyProduct, [])` is `false` by construction (§3.3's `.some()` over an empty array), so this composes through `intersectScopes` exactly like any other branch — no special-casing needed downstream in `cart` (§6) or anywhere else. This is a per-channel, admin-configured toggle (Q2: "configurable if that is going to appear or not") — most channels leave it `false` and rely on group-level scoping for the common partial-restriction case (§1.3 case a); an operator running an invitation-only B2B portal sets it `true` on that channel (§1.3 case b).

This governs **catalog visibility only** — not the whole storefront (branding, static pages, login page itself). A full site-wide access wall is a distinct, larger feature and explicitly out of scope (§10).

### 3.5 Enforcement — read side unchanged, write side closed

`buildStorefrontProductScope` (`storefront-public-api.md` §3.3) does not change its own logic; it changes only what feeds it. Its `product ∈ (channel.assortmentScope ∩ buyer.assortmentScope)` clause is now `matchesScope(product, intersectScopes(channel.assortmentScope, buyer.assortmentScope))`, computed once per request by `ecommerce`, same as today (`buyer.assortmentScope` here is already the `EffectiveAssortmentScope` produced by `resolveAssortmentScope()`, §5.1). The handle-enumeration-oracle rule (`storefront-public-api.md` §4.2, R4) is unaffected: this spec adds no new information channel, only a correctly-computed input to a check that already collapses "restricted" and "nonexistent" into an identical 404.

The write side is new (§6): `cart.lines.add`/`.update`/`.bulkAdd` gain a `matchesScope` check.

### 3.6 Per-customer overrides — both directions, no new operator (added 2026-09-16)

§10's open question 2 ("a single named customer needing a scope wider or narrower than every one of their groups") is now a requirement, and it is a requirement **in both directions**: a per-customer rule must be able to widen a buyer's assortment above what their groups grant (give this one account early access to a launch collection) *and* to narrow it below (hide a discontinued line from one account; hold an account to its contracted assortment only). Widening alone would have been the cheaper half — it is one more branch in the existing OR-list — but it is also the half merchants ask for less often, and shipping only it would leave "hide product X from customer Y" expressible nowhere in this suite.

Both directions fall out of the two operators §3.3 already defines. The override row carries **two independently nullable `AssortmentScope` fields**, one per direction:

| Field | Operator | Effect |
|---|---|---|
| `grantScope` | joins the buyer-side OR-list as one more branch (`unionScopes`, §3.1) | widens — can only add products, exactly like adding another group |
| `restrictScope` | ANDed into **every** branch of the unioned result (`intersectScopes`, §3.3) | narrows — applies to products granted by any group, not just by this customer's own branch |

```
// entirely inside customerGroupsService.resolveAssortmentScope(), §5.1
branches   = [ ...scopeOfEachMatchingGroup ]            // one branch per group, §3.1 — unchanged
if (override?.grantScope) branches.push(override.grantScope)   // absent grant is OMITTED, never pushed as null
unioned    = unionScopes(branches)
buyerScope = intersectScopes(override?.restrictScope ?? null, unioned)

// inside ecommerce's storeContextService.resolve(), §5.2 — UNCHANGED
effective  = intersectScopes(channel.assortmentScope, buyerScope)
```

**No new operator, no new type, and no change outside `customer_groups`.** `restrictScope` is applied with the same `intersectScopes` the channel layer already uses, for the same reason (§3.3's distributive law): a narrowing layer distributes across every OR-branch rather than merging arrays into one of them. Because the whole composition happens inside `resolveAssortmentScope()`, which already returns a finished `EffectiveAssortmentScope`, the read seam (`buildStorefrontProductScope`, §3.5), the write-side check (`cart`, §6) and the cache-key input (§3.7) require no change whatsoever — they consume a resolved value and have never known how many sources produced it.

**Why two fields rather than one scope doing double duty.** A single `AssortmentScope` on the customer row would already *contain* `excludeProductIds`/`excludeCategoryIds`/`excludeTagIds`, and it would be genuinely ambiguous whether those exclusions veto only the customer's own branch (§3.2's within-one-scope rule) or every branch including the groups'. Two named fields make the direction a data-layer fact instead of a convention someone has to remember: exclusions written inside `grantScope` scope that branch alone, exactly as §3.2 already specifies for every other source; exclusions written in `restrictScope` apply to the whole buyer.

**"This customer sees only their own assortment" needs no `mode` flag.** Setting `restrictScope` to the same value as `grantScope` produces replacement semantics by construction: every group branch is narrowed to the customer's own criteria and the customer's own branch survives intact, so the union collapses to exactly the customer's scope. An earlier sketch of this section proposed an explicit `mode: 'extend' | 'replace'` column for that case; it is redundant, and a redundant mode flag is a second source of truth that can disagree with the scopes beside it.

**A customer grant can never widen past the channel, and never re-opens a closed one.** The customer layer lives *inside* the buyer layer, which is then intersected with the channel's own scope — so `grantScope` is bounded above by the channel exactly as a group grant already is. `require_authentication` (§3.4) is stronger still: it short-circuits **before** `customer_groups` is called at all, so an anonymous visitor's `[]` is reached without the override ever being read, and `intersectScopes(anything, [])` stays `[]`. This ordering is the security property that makes a widening per-customer layer safe to add, and §11 asserts it as a property rather than a fixture.

### 3.7 Cache — the per-customer cost is paid only where a per-customer rule exists (added 2026-09-16)

A per-customer scope inevitably costs cache sharing: `assortmentScopeHash` is what lets buyers resolving to the same scope share the expensive count-facet entries (`storefront-public-api.md` §9.1), and a buyer with a scope of their own cannot share it with anyone. That cost is accepted — but it MUST be paid **only by the customers who actually have an override row**, which in B2B is a sparse minority. This is the identical trade `SPEC-029` §6.1 already made once, for `customerOverlayId` over `customerId`, for the identical reason: keying on "is this buyer authenticated" gives every authenticated buyer a private entry and collapses the hit rate on precisely the traffic that costs the most to serve.

Two requirements make that true rather than hoped-for:

1. **`assortmentScopeHash` MUST be a digest of the canonicalized *resolved* `EffectiveAssortmentScope`, never of its inputs** — not of `customerId`, not of the contributing group ids, not of "has an override" as a flag. A buyer with no override row resolves to a value byte-identical to their group-only result, so they keep sharing every scope-keyed cache entry with their group peers; only a buyer with an override diverges, and they diverge exactly as far as their override actually changes the answer. Canonicalization is load-bearing and is part of this requirement: id arrays sorted, object keys sorted, branches sorted by their own canonical form. Without it, two buyers with semantically identical scopes hash differently whenever their branches arrive in a different group-priority order — a silent, *performance-only* regression that every semantic test in §11 would still pass.
2. **"Does this customer have an override" is one indexed `EXISTS`, cached, not a denormalized flag.** `resolveAssortmentScope()` probes `customer_assortment_overrides` by `(tenant_id, customer_id)` — served by the unique partial index in §4.4 — and the result is cached per customer and invalidated on that row's own CRUD events, mirroring the `EXISTS`-over-`catalog_product_variant_prices` probe `SPEC-029` §6.1 specifies for `customerOverlayId`. A query rather than a column on the customer for the same reason that section gives: a stale `false` would serve a restricted buyer the unrestricted assortment, which is R1's failure direction, not a cosmetic one.

**No new cache-key dimension.** `SPEC-029` §6.1's digest is unchanged and gains no component; this section constrains how the existing `assortmentScopeHash` slot is computed. Roadmap ADR-7's rule — key on the narrowest named component that varies — is satisfied unchanged: a scope-only surface still keys on `assortmentScopeHash`, and that hash now happens to isolate override-carrying customers automatically.

---

## 4) Data Model

### 4.1 `CustomerGroupTerms.assortment_scope` (amends spec 1 §5.3)

Type becomes `AssortmentScope | null` (§3.3), i.e. the same jsonb column, with two new optional keys available: `excludeCategoryIds`, `excludeTagIds`. No migration beyond what spec 1 already specifies for this column — additive JSON keys inside an already-planned jsonb column require no schema change at all.

### 4.2 `EcommerceStoreChannelBinding` (amends `SPEC-029` §5.3)

| Column | Type | Notes |
|---|---|---|
| `assortment_scope` | jsonb, nullable | Unchanged column; type gains `excludeCategoryIds`/`excludeTagIds` per §4.1 |
| `require_authentication` | boolean | **New.** Default `false`. §3.4 |

### 4.3 One new entity (Phase 4 only), no changes to existing tables

Every field in §4.1 and §4.2 lives on a column two sibling specs already planned to create; the net-new schema for Phases 1–3 is one boolean. The per-customer override (§3.6) adds one small, sparse table in Phase 4 — §4.4 — and changes no existing table.

### 4.4 `CustomerAssortmentOverride` (`customer_assortment_overrides`, new — `customer_groups`, Phase 4)

One optional row per customer. Absent row — the common case — means "this customer is governed entirely by their groups," and resolves byte-identically to today's group-only result (§3.7).

| Column | Type | Notes |
|---|---|---|
| `customer_id` | uuid | `customers.CustomerEntity.id` — FK id only, no ORM relation, same convention as `CustomerGroupMembership.customer_id` (spec 1 §5.2) |
| `grant_scope` | jsonb, nullable | `AssortmentScope \| null` — the widening direction (§3.6); `null`/absent means "adds nothing" and is **omitted** from the union list, never passed to `unionScopes` as `null` |
| `restrict_scope` | jsonb, nullable | `AssortmentScope \| null` — the narrowing direction (§3.6); `null` means "narrows nothing" |
| `valid_from` | timestamptz, nullable | null = always; same semantics as a membership window (spec 1 §5.2) |
| `valid_until` | timestamptz, nullable | null = indefinite |
| `notes` | text, nullable | Why this account has a bespoke assortment — the first question support asks |
| `metadata` | jsonb, nullable | |

Standard columns per root `AGENTS.md` (`id`, `created_at`, `updated_at`, `deleted_at`, `organization_id`, `tenant_id`). It is a new user-editable entity, so optimistic locking is default ON: `updated_at` is returned by its list/detail API and the edit/delete form derives the header from `initialValues.updatedAt`.

Constraints and indexes: unique `(tenant_id, customer_id)` among rows with `deleted_at IS NULL` — this unique partial index is also what serves §3.7's `EXISTS` probe, so the probe needs no index of its own.

**Declared as an entity extension, not as a column on the customer.** Per root `AGENTS.md` ("When extending another module's data, add a separate extension entity and declare a link in `data/extensions.ts`"), the table is owned by `customer_groups` and linked to the base customer entity in `customer_groups/data/extensions.ts`, using the canonical shape already in `customers/data/extensions.ts` (verified by direct read):

```typescript
// customer_groups/data/extensions.ts
{
  base: 'customers:customer_entity',
  extension: 'customer_groups:customer_assortment_override',
  join: { baseKey: 'id', extensionKey: 'customer_id' },
  cardinality: 'one-to-one',
  description: 'Per-customer catalog assortment override, resolved alongside group scopes by resolveAssortmentScope()',
}
```

**Why `customer_groups` owns it despite the module name.** That module already owns `resolveAssortmentScope()` (§5.1) — the single buyer-side resolution seam — and already owns validity-windowed buyer rows with exactly these `valid_from`/`valid_until` semantics. Putting the override in `customers` instead would split one answer across two modules and force a second cross-module read on the hottest path in the suite, to save nothing.

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
    scope: EffectiveAssortmentScope   // the finished buyer-side scope: groups unioned (§3.1/§3.3), the customer's own grant unioned in and its restriction intersected over the result (§3.6); no groups and no override → null (unrestricted)
    sourceGroupIds: string[]          // every group that contributed a scope, for the explain tool (§7)
    sourceCustomerOverrideId: string | null   // the customer's own override row, or null — the common case (§3.6, Phase 4)
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
  ? { scope: [] as EffectiveAssortmentScope, sourceGroupIds: [], sourceCustomerOverrideId: null }   // §3.4 — the vacuous OR, not a sentinel; the whole buyer layer, per-customer override included, is skipped
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

Trigger 2 is stated in `cart-module.md` §5.2 as "buyer identity changes: login, logout, or a group membership change." A per-customer override (§3.6) is the same class of change and is read at the same seam, so that trigger's definition is amended to read "…or a group membership or per-customer assortment override change" — created, edited, deleted, or lapsing past its own `valid_until`. Without that clause the override's validity window would be the one buyer-side change that reaches checkout unchecked, which is R7's exact shape reintroduced through the new column.

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
- **Customer detail page — "Assortment" section (Phase 4, owned by `customer_groups`).** The per-customer override (§3.6) is edited where the customer already is, on `customers`' existing customer detail page, as a section **injected** by `customer_groups` through widget injection (`core` → Widget Injection) — never by editing a page another module owns, and never through an ORM relation. It carries the same category/tag/product pickers as the group-terms form, in two clearly separated blocks — "Also allow" (`grant_scope`) and "Restrict to / exclude" (`restrict_scope`) — plus the validity window and the `notes` field. The two blocks are labelled by direction rather than by field name, because the whole point of §3.6's two-field shape is that a merchant can see which way a rule cuts without reading the spec. Gated behind the same feature that already gates group-terms editing; a viewer without it sees the section read-only, matching US-A1's convention. New i18n keys live in `customer_groups`' existing namespace.
- **Explainability tool (optional, nice-to-have — cut first if this spec needs to shrink), owned by `ecommerce`.** A small read-only admin panel under `ecommerce/backend/`, "why can/can't customer X see product Y," showing: which of the buyer's groups contributed (`sourceGroupIds` from §5.1), the buyer's own override if any (`sourceCustomerOverrideId`, split into its widening and narrowing halves so the direction is visible), the channel's own scope, and the final verdict from `matchesScope`. `ecommerce` is the natural owner — it is already the module that composes both channel and group scope into `BuyerContext` (§5.2), so it is the only place both halves of the explanation are already in hand without a second cross-module read. Guarded by a new `ecommerce.visibility.diagnose` feature declared in `ecommerce/acl.ts` and granted to `admin` in `setup.ts` `defaultRoleFeatures`, matching the same pattern `pricing-engine.md`'s own optional diagnostic page uses for its `pricing.diagnostics.view` feature. Mirrors the explainability convention this suite already established twice — `ResolvedTerms.sourceGroupId` (spec 1 §6) and `AvailabilityPolicy.policySourceId` (`availability-contract.md` §5.2) — for the same reason: "why is this wrong" is the first support question in every one of these systems, and this is the third time this suite has needed the answer. The buyer-facing `product_unavailable` message shown by the write-path warning (§6.3) is a new key in `cart`'s own `i18n/{en,pl}.json` namespace, alongside its existing warning-code strings.

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
| A third scope source (the per-customer override) needs combining | Composed with **no new operator** — its grant is one more `unionScopes` branch, its restriction one more `intersectScopes` layer. This row previously read "if ever added"; added 2026-09-16 | §3.3 design, §3.6 |
| Customer has an override with `restrict_scope` only, and belongs to no group | `unionScopes([])` → `null` (unrestricted), then intersected with the restriction → `[restrictScope]`. The buyer is narrowed correctly rather than left unrestricted | §3.6, §3.3 |
| Customer's `grant_scope` is absent | Omitted from the branch list. It MUST NOT be pushed as `null` — `unionScopes` treats any `null` element as an unrestricted source and would silently unrestrict the entire buyer | §3.6, R10 |
| Customer's `grant_scope` names a category the channel's own scope excludes | Not visible. The channel layer is applied after the buyer layer, so a per-customer grant is bounded above by the channel exactly as a group grant is | §3.6 |
| Channel `require_authentication = true`, anonymous visitor who happens to have an override row | `[]` (deny-all); the override is never read, because the short-circuit skips the whole buyer layer before `customer_groups` is called | §3.4, §3.6 |
| Merchant wants "this customer sees only their own assortment," ignoring group grants | `restrict_scope` set to the same value as `grant_scope` — replacement falls out of the algebra, no `mode` column | §3.6 |
| Override lapses past `valid_until` while a restricted line sits in the buyer's cart | Identical handling to an expired group membership: flagged at the next whole-cart pass, checkout-lock blocked until resolved | §6.2, R7 |
| Buyer has no override row (the common case) | Resolves byte-identically to the group-only result, so they keep sharing every `assortmentScopeHash`-keyed cache entry with their group peers | §3.7 |

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
| R8 | A per-customer grant widens past the channel scope or re-opens a closed channel | **High** | `customer_groups`, `ecommerce` | §3.6 introduces the suite's first *widening* buyer-side source. A resolver that applied the customer grant after the channel intersection — or that read the override before the `require_authentication` short-circuit — would let one account see products the channel itself excludes, or let an anonymous visitor with a stale session reach a catalog the operator closed entirely. | Layer order is the mitigation and it is structural, not conventional: the override is resolved *inside* `resolveAssortmentScope()` (§5.1), whose result is then intersected with the channel by `ecommerce` (§5.2, unchanged); `require_authentication` short-circuits before that call is made at all. §11 asserts both as **properties** over generated inputs — `matchesScope(p, effective) ⇒ matchesOne(p, channel)` for every triple, and `[]` absorbs any override — not as fixtures | Low |
| R9 | Per-customer scope shatters the shared facet cache for buyers who have no override | Medium (performance, not disclosure) | `ecommerce` | `assortmentScopeHash` derived from inputs (`customerId`, group ids, an "has override" flag) rather than from the resolved value gives every authenticated buyer a private cache entry — exactly the hit-rate collapse `SPEC-029` §6.1 already had to fix once for `customerOverlayId`. A non-canonical serialization causes the same collapse more subtly: semantically identical scopes hashing differently because their branches arrived in a different group-priority order. | §3.7's two requirements — hash the canonicalized *resolved* scope, and probe for an override with a cached indexed `EXISTS`. Tested by asserting equal hashes for two buyers whose resolved scopes are semantically equal but built in different branch order, and distinct hashes only where the override actually changes the resolved value | Low |
| R10 | Absent grant passed as `null` silently unrestricts the buyer | Medium | `customer_groups` | `unionScopes` treats a `null` element as "this source is unrestricted," so a resolver that pushes a missing `grant_scope` into the branch list as `null` — the obvious way to write it — grants that buyer the entire catalog, in the permissive direction, with no error anywhere. | §3.6 states the omit-don't-push rule at the point the list is built; §8 carries it as an edge case; §11 carries it as a named regression test alongside the flattened-union fixture, since it is the same class of defect (a permissive failure produced by a plausible-looking one-liner) | Low |
| R7 | Checkout-lock time-of-check/time-of-use gap | **High** | `cart` | A first draft of this spec's write-path fix checked visibility only at `lines.add`/`.update`/`.bulkAdd`. A membership can expire (`valid_until`, spec 1 §5.2) between add-time and checkout, and `cart-module.md`'s own checkout-lock re-price (trigger 5, "mandatory, never skipped") never re-checked visibility — so a line added while visible could still reach `SalesOrder` creation after becoming restricted, reopening R1/§1.2's exact scenario. Found by review. | §6.0/§6.2: the whole-cart re-visibility pass at triggers 2 and 5, with the lock transition blocked while any line is flagged `product_unavailable` — mirroring the existing `requiresApproval`-blocks-lock precedent in `cart-module.md` §14 | Low, once shipped |

---

## 10) Open Questions (remaining, non-blocking)

1. **Full site-wide access wall.** `require_authentication` (§3.4) gates catalog visibility, not the entire storefront (a fully private site with no public pages at all, including branding/marketing pages). That is a `customer_accounts`/portal-auth-wall feature, not a catalog-visibility one, and is out of scope here.
2. ~~**Per-customer override below the group level.**~~ **Resolved 2026-09-16** (user decision): it is a requirement, in both directions, and it is specified in §3.6 (algebra), §3.7 (cache), §4.4 (storage as an entity extension) and §12 Phase 4. It needed no new operator and no change to the read seam, the write-side check or the cache-key contract. Per-customer *pricing* already worked this way — `CatalogProductPrice` carries `customer_id` and `customer_group_id` side by side — so this brings visibility level with pricing rather than inventing a pattern.
3. **Checkout-submit re-check.** §6.2 requires `cart`'s own lock transition to block on a flagged line, but whether the (not-yet-in-front-of-this-spec) `checkout` spec's submit step should *additionally* re-check visibility independent of the cart's advisory state — the same defense-in-depth `availability`'s authoritative `reserveAvailability()` applies on top of the cart's advisory stock state — is that spec's own decision, not resolved here.

---

## 11) Integration Coverage

**Combination algebra (property-based, plus the named regression cases below):**
- The in-memory `matchesScope` and the SQL emitted by `buildStorefrontProductScope` agree for every generated `(product, EffectiveAssortmentScope)` pair — property-based, not a fixture table (§3.3). This is the test that makes "one implementation" true; the cases below are the specific regressions worth naming, not the coverage itself

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

**Per-customer overrides (Phase 4, §3.6/§3.7):**
- Property: for every generated `(product, channelScope, groupScopes, override)`, `matchesScope(product, effective)` implies `matchesOne(product, channelScope)` — a customer grant can never widen past the channel (R8)
- Property: with `require_authentication = true` and an anonymous request, the resolved scope is `[]` for every generated override, and `resolveAssortmentScope` is asserted **not called** (R8, same short-circuit assertion style the §3.4 test already uses)
- Property: `assortmentScopeHash` is equal for two buyers whose resolved scopes are semantically equal but assembled in different branch order, and differs only where the override changes the resolved value (R9, canonicalization)
- A buyer with no override row resolves to a value byte-identical to the group-only result — the test that makes §3.7's "cost paid only where a rule exists" true rather than aspirational
- Named regression: an absent `grant_scope` is omitted from the branch list, not pushed as `null` — asserted by a buyer with a restricted group and an override carrying only `restrict_scope`, who must NOT become unrestricted (R10)
- Widening: a customer whose groups grant category A and whose override grants tag B sees both, exactly as a second group would have granted (§3.6)
- Narrowing across branches: a product granted by a *group* branch and excluded by `restrict_scope` is not visible — proving the restriction distributes over every branch rather than vetoing only the customer's own
- Replacement: `restrict_scope` equal to `grant_scope` collapses the union to exactly the customer's own scope regardless of group grants (§3.6)
- Validity window: an override past its `valid_until` contributes nothing in either direction; a cart line that depended on it is flagged at the next whole-cart pass and blocks the checkout lock (§6.2, R7's fixture re-run with an override instead of a membership)
- `sourceCustomerOverrideId` is populated for a buyer with an override and `null` otherwise, and the explainability panel renders both halves with their direction labelled (§7)
- The extension link resolves: `customers:customer_entity` → `customer_groups:customer_assortment_override` traverses through the data engine without an ORM relation (§4.4)

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

### Phase 4 — Per-customer overrides (§3.6)
`CustomerAssortmentOverride` entity, its migration and the `customer_groups/data/extensions.ts` link (§4.4); `resolveAssortmentScope()` extended to union the grant and intersect the restriction, returning `sourceCustomerOverrideId`; the cached `EXISTS` probe and the canonical-serialization rule for `assortmentScopeHash` (§3.7); the injected "Assortment" section on the customer detail page (§7); the override's own CRUD events wired to buyer-context cache invalidation and to `cart`'s trigger-2 re-visibility pass (§6.2).

**Deliberately last.** It depends on Phases 1–2 and on nothing in Phase 3, and Phase 3 is the phase that closes the live Critical exposure (R1). Sequencing the per-customer feature ahead of it would put a merchandising convenience in front of a security fix. Nothing in Phases 1–3 changes to accommodate it: that no read seam, write-side check or cache-key contract needs touching is the design property §3.6 is built around, and if that turns out not to hold during implementation it is a signal the composition was put in the wrong layer.

**Gate:** the per-customer block in §11 passes, including the two R8 properties (channel bound, closed-channel absorption), the R10 null-grant regression, and the R9 hash-stability assertion.

**On not splitting this into separate specs.** §12's own phase gates show all four phases are independently deployable, and Phase 3 alone is what removes the live exposure (§1.2) — a fact this document states plainly rather than hides. That is not, by itself, a reason to split into three documents: this suite already phases single conceptual capabilities within one spec rather than one-spec-per-phase (`availability-contract.md`'s three phases are one document; so is `customer-groups-and-b2b-terms.md`'s four). The read-side algebra fix (Phases 1–2) and the write-side enforcement (Phase 3) are one capability — a visibility control whose read half and write half must agree, the same way `cart-module.md`'s own ADR-2 treats cart and order totals as one correctness requirement rather than two specs that happen to compute the same number. What would justify a split is if Phase 3 depended on a module this document does not already assume; it does not — it amends `cart-module.md`, already a dependency.

---

## 13) Final Compliance Report

| Requirement | Status |
|---|---|
| Scope cohesion | Four phases, each independently shippable per §12's own gates (Phase 4, the per-customer layer, is sequenced last on purpose so it cannot precede Phase 3's Critical write-side fix) — the spec states this plainly rather than papering over it. Bundled as one document because they are facets of one capability (a visibility control whose read and write halves must agree), following this suite's own precedent of phasing one capability within one spec (`availability-contract.md`, `customer-groups-and-b2b-terms.md`) rather than one spec per phase — not because the phases are inseparable |
| Canonical mechanisms reused | `buildStorefrontProductScope` (spec 4) unchanged; `intersectScopes`/`unionScopes`/`matchesScope` follow the `availability` contract's base-in-shared precedent exactly; category/tag matching reuses `CatalogProductCategoryAssignment`/`CatalogProductTagAssignment`, the same tables `catalog`'s own `buildProductFilters` already joins against (verified by direct read of `catalog/api/products/route.ts`) |
| No cross-module ORM relations | `AssortmentScope` operates on plain ids (`categoryIds`, `tagIds`, `excludeProductIds`); `cart`'s new field is a plain value passed by the caller, not a live reference; `customer_groups`/`ecommerce`/`cart` remain coupled only via DI services and FK ids |
| Contracts and compatibility | `AssortmentScope` gains two optional keys (additive, jsonb, no migration); `ResolvedTerms.assortmentScope` removal is a change to an *unimplemented* sibling spec's contract, not a shipped one — no `BACKWARD_COMPATIBILITY.md` surface is broken since nothing here exists on `develop` yet; `cart.lines.add`/`.update`/`.bulkAdd` gain a new optional-then-conditionally-required field, additive to an unimplemented command signature |
| Reversibility | `require_authentication` is a boolean an operator can flip back; nothing here is a destructive migration |
| Sensitive data | No new PII surface; `AssortmentScope` carries only catalog ids |
| Failure scenarios | §8, §9 — every new branch (union, authentication gate, write-path check, checkout-lock TOCTOU) has a stated behavior and a test |
| Testability | Every Implementation Plan phase has an associated gate in §11/§12 |
| Cache-key contract | No new cache-key dimension, including for the per-customer layer: `assortmentScopeHash` already exists in `SPEC-029` §6.1's digest, and §3.7 constrains how that existing slot is computed (canonicalized resolved value, never inputs) so that only customers carrying an override lose cache sharing. No new shared cache-key infrastructure is built — that primitive was already built by `SPEC-029` itself, so nothing here is deferred |
| Handle-enumeration-oracle rule | Read side untouched (still `storefront-public-api.md` §4.2's existing behavior); write side gets the equivalent treatment (§6.3, R5) |
| Citation accuracy | A fresh-context adversarial review (§14) found and this revision corrected two miscited sibling-document claims — a nonexistent cache-related "deferral" attributed to `pricing-engine.md`, and a "provenance note" wrongly attributed to `ecommerce-suite-roadmap.md` instead of `pricing-engine.md`'s own — and confirmed every other citation (the `cart-module.md` assortment-scope gap, the digest slot, the availability-contract precedent, the OR-facet grammar) against the actual sibling-document text |

---

## 14) Changelog

- **2026-09-16** — **Per-customer visibility pass.** §10's open question 2 ("per-customer override below the group level," previously recorded as a deliberate omission) was raised as a requirement by the user, in **both directions** — a named account must be grantable more than its groups allow and restrictable below them. Three decisions were taken and are now specified:
  - **Algebra (§3.6).** The override carries two independently nullable scopes, `grant_scope` (joins the OR-list, widens) and `restrict_scope` (intersected over every branch, narrows). Both reuse operators §3.3 already defines; there is no new type, no new operator, and no change to the read seam (§3.5), the cart write-side check (§6) or the digest (§6.1) — the whole composition happens inside `resolveAssortmentScope()`, which already returned a finished `EffectiveAssortmentScope`. An explicit `mode: 'extend' | 'replace'` column was considered and rejected: `restrict_scope = grant_scope` already produces replacement semantics, and a redundant mode flag is a second source of truth that can disagree with the scopes beside it. Two fields rather than one were chosen because a single scope's own `exclude*` keys would be genuinely ambiguous about whether they veto one branch or all of them.
  - **Cache (§3.7).** The per-customer cost is accepted but must be paid only by customers who actually carry an override: `assortmentScopeHash` MUST digest the canonicalized *resolved* scope rather than its inputs, so a buyer with no override resolves byte-identically to the group-only result and keeps sharing the count-facet entries with their group peers. Mirrors `SPEC-029` §6.1's own `customerOverlayId`-not-`customerId` fix, including its cached indexed `EXISTS` probe rather than a denormalized flag. No new digest component.
  - **Storage (§4.4).** A new sparse table `customer_assortment_overrides` owned by `customer_groups` and linked to `customers:customer_entity` as an **entity extension** in `customer_groups/data/extensions.ts`, per root `AGENTS.md`'s rule for extending another module's data — not a column on the customer entity, and not an ORM relation.
  - Also added: US-A4; three new risks (**R8** a per-customer grant widening past the channel or a closed channel, mitigated structurally by layer order and asserted as a property; **R9** cache shattering from hashing inputs or a non-canonical serialization; **R10** the `unionScopes`-treats-`null`-as-unrestricted footgun when an absent grant is pushed instead of omitted); eight edge-case rows; a per-customer §11 block; and **Phase 4**, sequenced deliberately last so a merchandising convenience does not ship ahead of Phase 3's Critical write-side fix.

- **2026-09-16** — Read-path representation pass, part of the suite-wide amendment recorded as roadmap ADR-9. Two clarifications to §3.3, no semantic change to §3.1/§3.2:
  - Stated that "`matchesScope` is the single implementation both sides are built from" is a property held by an **equivalence test**, since a TypeScript predicate cannot run in Postgres — and that the test must therefore be property-based rather than a fixture table. The spec's own history is the argument: the flattened-union bug a review caught in §3.1 was precisely a combination nobody had enumerated.
  - Named the physical representation the SQL side evaluates against — a GIN-indexed `scopeKeys` array on the product's index document, specified in `storefront-public-api.md` §3.3 — rather than leaving the pure contract and its SQL twin to be designed independently. `ScopedProduct = { id, categoryIds, tagIds }` had already committed to the shape; this only records where it lands and why the DNF is affordable in front of every product query and facet aggregation.

- **2026-09-06** — Amendment-application pass, after a specification review of PR #5384. §0's three sibling amendments were recorded but never applied, on the reasoning that the siblings were unmerged work on another branch — they are in the same directory and the same change. The gap was not cosmetic: `cart-module.md`, the document that actually owns the `cart` module and reads as complete, contained no assortment check anywhere, so an implementer building from it would have shipped exactly the Critical write-side hole §1.2 and R1 exist to close. All three amendments are now applied in the sibling documents (`customer-groups-and-b2b-terms.md` §5.3/§6/new §6.4/§17, `SPEC-029` §4.1/§5.3/§6, `cart-module.md` new §6a/§9/§11/§13/§14), and §0 is now a cross-reference index rather than a to-do list. No design change — the amendments applied are the ones §0 already specified.

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
- **2026-08-31** — Added a **User Stories** section (Epics A–F, role-goal-outcome stories with acceptance criteria) as prep for `om-mockup-prototype`, per `AGENTS.md`'s `om-mockup-prototype` requirement that requirements contain user stories before a click-through prototype is built. Epics A–C cover the merchant-facing admin UI already described in §7 (group-terms pickers, channel-binding form + `require_authentication` toggle + live count preview, optional explainability panel); Epics D–F cover buyer-facing consequences of this spec's rules (storefront 404, cart `product_unavailable` warning, flagged-line/blocked-checkout state) so the prototype can illustrate them honestly as static, non-executed screens rather than omitting them. No other section changed.
- **2026-08-31** — `/om-spec-writing` quality-bar pass over the User Stories section only (per `AGENTS.md`'s `om-mockup-prototype` requirement, applied before the click-through prototype is built). Three gaps found and fixed, none requiring a new epic:
  - Epic B had zero permission-state acceptance criteria while Epic A had one for the equivalent group-terms form. Fixed: added a permission bullet to US-B1 naming the existing `ecommerce.channels.manage` feature (`SPEC-029` §9.3) that already gates this binding, rather than inventing a new one.
  - US-B2 never stated the `require_authentication` toggle's default value, even though §3.4 specifies it (`false`) and the om-mockup-prototype checklist requires default-value coverage. Fixed: added a default-value bullet.
  - §1.4's field-combination ambiguity names two sub-problems — the empty-array convention (already covered by US-A1/US-A2) and the AND-between-`categoryIds`/`tagIds` rule (§3.2) — but only the first had a demonstrating story; the AND rule, arguably the more novel of the two hard-won rules in this spec alongside §3.1's union, had no story showing it. Fixed: added a worked-example acceptance criterion to US-C1 showing one group's AND-of-dimensions verdict alongside a sibling group's independent OR-branch, and noted US-A3's dependency on the (optional, §7) explainability panel plus its fallback if that panel is cut.
