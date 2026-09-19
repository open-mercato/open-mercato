# Pre-Implementation Analysis: Storefront Customer Account

Source document: `2026-08-14-storefront-customer-account.md`, PR adeptofvoltron/open-mercato#9 (branch `spec/ecommerce-module-suite`), spec 9 of 9 in the Phase 4 ecommerce suite. Spec-only PR. This document extends the real, already-shipped `packages/core/src/modules/customer_accounts/` module — verified against that source, not against convention alone.

## Executive Summary

The document is well-architected at the level of module boundaries (query-engine reads of `sales`, event-driven back-in-stock triggers, no ORM cross-module relations) and its central risk analysis (order-visibility scoping) is sound in design. But it was written without reading the real `customer_accounts` module it extends, producing the same class of defect this audit series found and fixed in `checkout-simple-checkout.md`: §8.1 invents nine `portal.account.*` ACL feature ids, one of which (`portal.account.orders.view`) directly duplicates an already-shipped, already-seeded, already-tested flat feature (`portal.orders.view`), and several more shadow or should be split against other already-shipped flat `portal.*` features. Beyond that, the spec asserts a "GDPR erasure surface" and unspecified encryption-map additions that name mechanisms not present anywhere in this codebase, and leaves `POST /approvals/:id/decide`'s relationship to `customer_groups`'s already-implemented, optimistic-locked decide command unstated. The optimistic-locking claim, by contrast, holds under full per-entity verification. **Recommendation: needs spec updates before implementation** — the ACL fix is mechanical and low-risk, same shape as the already-applied `checkout-simple-checkout.md` precedent, but must land before Phase 1, since ACL feature ids are DB-stored and namespace collisions are expensive to unwind post-launch.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | ACL feature IDs | `portal.account.orders.view` (§8.1) duplicates the already-shipped, already-seeded `portal.orders.view` (`customer_accounts/setup.ts:112,132`, exercised in `TC-CACC-CRUDFORM-001.spec.ts`). | **Critical** | Delete; `GET /orders`, `GET /orders/:id` gate on the existing `portal.orders.view` unchanged. |
| 2 | ACL feature IDs | The "Buyers" roster (§6.2/§8) is functionally identical to the already-shipped team-member management surface (`api/portal/users.ts` → `portal.users.view`; `users-invite.ts`/`users/[id].ts` → `portal.users.manage`; `users/[id]/roles.ts` → `portal.users.roles.manage`). The spec's single `portal.account.company.manage` conflates company-profile management with buyer-roster management. | **Critical** | Split: buyer roster reuses `portal.users.view`/`.invite`/`.manage`/`.roles.manage` unchanged; mint a narrower new `portal.company.manage` scoped only to profile/billing/payment-terms. |
| 3 | ACL feature IDs | The remaining 7 of 9 new ids are genuinely new (no existing coverage under any name — exhaustively grepped) but all namespaced `portal.account.<resource>.<action>`, which doesn't match the real, shipped flat convention (`portal.<resource>.<action>` — see `portal.orders.view`, `portal.quotes.view`, `portal.invoices.view`, `portal.users.manage`). | **Critical** | Rename all 7 to the flat convention (see reconciliation table below). |
| 4 | ACL feature IDs | Profile page/route (§6.1, §8) has no named ACL feature; real `api/portal/profile.ts` already guards the equivalent with `portal.account.manage`. | Warning | Cite `portal.account.manage` explicitly. |
| 5 | ACL feature IDs | Addresses page/API ignores already-declared-but-unseeded `portal.addresses.view`/`portal.addresses.manage` (`backend/customer_accounts/roles/[id]/page.tsx:40-41`). | Warning | Gate address reads/writes on these instead of an unnamed "own" check. |

#### Full ACL reconciliation table (§8.1, all 9 ids)

| Spec's id | Verdict | Fix |
|---|---|---|
| `portal.account.orders.view` | **Duplicate** of real `portal.orders.view` | Delete; reuse `portal.orders.view` |
| `portal.account.orders.reorder` | New | Rename → `portal.orders.reorder` |
| `portal.account.documents.download` | New | Rename → `portal.documents.download` |
| `portal.account.quotes.accept` | New | Rename → `portal.quotes.accept` |
| `portal.account.wishlists.manage` | New | Rename → `portal.wishlists.manage` |
| `portal.account.company.manage` | **Split** | Company profile/billing → new `portal.company.manage`. Buyer roster → reuse `portal.users.*` |
| `portal.account.approvals.decide` | New (distinct from admin-facing `customer_groups.approvals.decide`) | Rename → `portal.approvals.decide` |
| `portal.account.credit.view` | New | Rename → `portal.credit.view` |
| `portal.account.pricelist.view` | New | Rename → `portal.pricelist.view` |

Net: 1 of 9 is a straight duplicate, 1 of 9 splits into new+reuse, 7 of 9 are genuinely new but must move off the fabricated `portal.account.*` namespace.

### Other BC categories checked — no violations

Event IDs (all 8 new `customer_accounts.*` events checked against the real 29 existing ids — no collision), API routes (no existing route under `/api/portal/account/*`, though the base path itself diverges from the real flat `/api/portal/*` convention — a consistency gap, not a collision), DB schema (`customer_saved_carts`, `customer_back_in_stock_subscriptions`, `customer_order_visibility_policies` — no collisions; `CustomerWishlist`/`CustomerWishlistItem` uniquely lack a stated table name among §5's entities).

### Missing BC Section

No dedicated "Migration & Backward Compatibility" section; §14's "Additive... no existing contract surface changes" is inaccurate given the ACL findings above.

## Spec Completeness

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| §5.1 | `CustomerWishlist`/`CustomerWishlistItem` never state table names, unlike every other §5 entity. | Add `customer_wishlists`/`customer_wishlist_items`. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| ACL ids must not shadow/duplicate existing ones | §8.1 | Apply reconciliation table |
| Encryption maps mechanism | `CustomerBackInStockSubscription.email` (§5.3) — §14 claims encryption with no named declaration | Add `{ entityId: 'customer_accounts:customer_back_in_stock_subscription', fields: [{ field: 'email', hashField: 'email_hash' }] }` to `customer_accounts/encryption.ts` — a `hashField` is required for the double-opt-in/dedup equality lookup |
| Cross-module coupling — soft dependency via service call, not a parallel implementation | `POST /approvals/:id/decide` (§8) | See Risk Assessment |
| Commands / `withAtomicFlush` for cross-module writes | Reorder confirm (§7 step 5), wishlist add-to-cart, saved-cart resume (§8) | Name the exact `cart` module command each invokes |
| `makeCrudRoute` vs. custom-action-route split unstated | §8 | State explicitly per route |

### GDPR "erasure surface" — unbacked mechanism claim

§10 (R8), §11 and §14 assert registration with a "GDPR erasure surface." **No such mechanism exists anywhere in this codebase.** The real, shipped pattern for this exact problem is a per-module event subscriber on a lifecycle-deletion event — `packages/core/src/modules/communication_channels/subscribers/user-deleted-cascade.ts`, listening on `auth.user.deleted`, cascading cleanup (soft-disconnect, not hard-delete) of that module's own rows. `customer_accounts/events.ts` already emits the analogous `customer_accounts.user.deleted`.

**Fix**: replace with a concrete `customer_accounts/subscribers/user-deleted-cascade.ts` listening on `customer_accounts.user.deleted`, deleting/anonymizing `CustomerWishlist`/`CustomerWishlistItem`/`CustomerSavedCart` and nulling the `customer_user_id` FK on `CustomerBackInStockSubscription` rows — following the `communication_channels` precedent. The spec should decide explicitly whether this hard-deletes or soft-anonymizes.

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| ACL namespace fork | A tenant that already granted `portal.orders.view` silently loses coverage for the new order-history page until re-granted under the new id — a functional regression disguised as a new feature. | Apply reconciliation table before Phase 1 |
| `POST /approvals/:id/decide` — undisclosed second mutation path | `customer_groups` already ships `POST /api/customer-groups/approvals/:id/decide` under `enforceCommandOptimisticLock`. This spec's §8 lists a second route at a different path/ACL id with no stated relationship. If the portal route reimplements status-transition + optimistic-lock logic independently, two divergent code paths can decide the same approval differently, defeating `customer_groups`' own R8 mitigation (approval double-decision), which assumed a single command. | State explicitly: the portal route resolves visibility scope only, then delegates the actual decision-recording to `customer_groups`'s existing service/command — never reimplementing the optimistic lock a second time |
| Reorder/wishlist-add-to-cart/saved-cart-resume — unnamed cart-module command | Left unnamed, an implementer could write directly against `Cart`/`CartLine`, violating the same ORM-coupling rule §3's own diagram forbids for `sales`. | Name the exact command: reorder-confirm and wishlist-add-to-cart both call `cart.lines.bulkAdd`; saved-cart resume needs its own primitive in `cart-module.md` if "copy, not reuse" has no existing equivalent — log as a cross-spec gap if so |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| R1's mitigation lacks the structural CI guard 2 of 3 directly comparable sibling specs added (SPEC-029, storefront-merchandising; storefront-public-api relied on tests alone and that was accepted) | Given this spec's own TLDR calls order-visibility "the sharpest risk" and R1 is Critical — arguably higher-stakes than storefront-public-api's (colleagues' negotiated financial terms, not catalog pricing) | Recommended: add a structural guard banning any query-engine read of `sales` order/quote entities from `customer_accounts` outside a call chain rooted in `buildOrderVisibilityFilter`, registered in `scripts/repo-wide-guards.mjs` |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| §5.1 missing table names | Minor | Add explicitly |
| `/api/portal/account/*` base-path divergence | No collision, consistency question only | Justify or flatten at implementation time |

## Gap Analysis

### Critical Gaps (Block Implementation)
- ACL reconciliation (full 9-id table) — must apply before any code lands.
- `POST /approvals/:id/decide` delegation must be stated explicitly.

### Important Gaps (Should Address)
- GDPR erasure mechanism — concrete subscriber design.
- `CustomerBackInStockSubscription.email` encryption — name the exact addition.
- Reorder/wishlist-add-to-cart/saved-cart-resume write paths — name the exact `cart` command(s).
- Profile/Addresses guards — cite existing real features.
- Structural CI guard for `buildOrderVisibilityFilter`.
- `makeCrudRoute` vs. custom-action-route split stated per route.

### Nice-to-Have Gaps
- Table names in §5.1 (already listed above).
- `/api/portal/account/*` base-path rationale.

## Remediation Plan

### Before Implementation (Must Do)
1. Apply the full ACL reconciliation table.
2. State `POST /approvals/:id/decide`'s delegation to `customer_groups`'s existing command.
3. Replace the "GDPR erasure surface" claim with a concrete subscriber design.

### During Implementation (Add to Spec)
1. Name the `customer_accounts/encryption.ts` addition for `CustomerBackInStockSubscription.email`.
2. Name the exact `cart` command(s) for reorder-confirm/wishlist-add-to-cart/saved-cart-resume.
3. Cite `portal.account.manage` and `portal.addresses.view`/`.manage` explicitly.
4. Add table names to §5.1.
5. Add the structural CI guard for `buildOrderVisibilityFilter`.
6. State `makeCrudRoute` vs. custom-action-route split per §8 route.

### Post-Implementation (Follow Up)
1. Log the saved-cart-resume gap against `cart-module.md` if no copy primitive exists there.
2. Confirm whether `/api/portal/account/*` should flatten to match the rest of the portal API.

## Recommendation

**Needs spec updates before implementation.** Architecture and the order-visibility risk model are sound; the optimistic-locking claim holds under full verification. Blockers are mechanical (ACL namespace fork, same shape as the already-applied `checkout-simple-checkout.md` fix) and a one-paragraph clarification (`approvals/:id/decide` delegation) — not a redesign.

## Changelog

### 2026-08-17
- Initial pre-implementation analysis, performed against fork PR #9 (`adeptofvoltron/open-mercato`, branch `spec/ecommerce-module-suite`) and this repo's `develop` worktree, per the `om-pre-implement-spec` skill workflow.
