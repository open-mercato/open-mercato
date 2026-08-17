# Pre-Implementation Analysis: Storefront Merchandising

Source document: `2026-08-14-storefront-merchandising.md` (spec 8 of the ecommerce suite, Phase 4), reviewed from `adeptofvoltron/open-mercato` PR #9 (`spec/ecommerce-module-suite`), a spec-only fork PR. Analysis performed against this repository's actual code and the sibling specs `SPEC-029-2026-02-17-ecommerce-storefront-module.md` (v4.1), `2026-08-14-storefront-public-api.md` (rev 2), and the umbrella `2026-08-14-ecommerce-suite-roadmap.md`.

## Executive Summary

The document is well-structured and internally consistent everywhere except one place — but that one place is a real, Critical-severity price-disclosure bug, the same class of defect this exact suite already found and fixed once in `storefront-public-api.md` §9.1. §7.1 defines three block types (`product_carousel`, `product_grid`, `collection_grid`) and the `/recommendations` endpoint as returning fully resolved, buyer-priced product payloads, but §8's cache table keys "Placement blocks" and "Recommendations" on `audienceDigest` alone — a digest that, per SPEC-029 §6.1, deliberately excludes `priceKindId` and `customerId`, the two fields that determine price. Two buyers in the same customer groups but on different contract prices would share a cached product-carousel or recommendations response and see each other's prices. This is not a hypothetical edge case — it is the document's own §7.1 and §8 directly contradicting each other, and it is not covered by either of the document's existing R1 (curation leaking restricted *products*, a visibility bug) or R2 (homepage becoming *uncacheable*, the opposite failure mode). It needs a new, Critical-severity risk entry and a concrete fix before implementation. Everything else in the document — BC surface, entity design, ACL, phasing, sanitization intent, optimistic locking, command pattern — is sound, and the optimistic-locking claim in particular genuinely holds (see below), making this the first clean pass on that specific defect in the suite. Recommendation: **Needs spec updates first** — the cache-split fix is a must-fix-before-implementation blocker; everything else is additive polish.

## Backward Compatibility

### Violations Found

None. This is a wholly new module (`merchandising`) with no existing contract surface to modify. A full sweep of the actual codebase found:

| Surface checked | Result |
|---|---|
| `merchandising_*` DB tables | Zero matches anywhere in `packages/` or `apps/` |
| `/api/merchandising/*` routes | Zero matches |
| `merchandising.*` ACL feature ids | Zero matches |
| `merchandising` module directory / module id | Zero matches |
| `merchandising` DI registration keys | Zero matches |
| `merchandising.*` event IDs | Zero matches |

The one near-miss — `catalog.merchandising_assistant`, an existing AI agent id in `packages/core/src/modules/catalog/ai-agents.ts` — lives in the `catalog.*` ACL/agent-id namespace, not `merchandising.*`, and is functionally unrelated (admin bulk-edit/pricing copilot vs. this spec's storefront navigation/composition module). Confirmed not a collision.

### Missing BC Section

Not required — this spec only adds new contract surfaces. §13's "New module; no existing contract surface changes" line matches the precedent set by SPEC-029 §20 and `storefront-public-api.md` §15.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Module File Structure | No equivalent to SPEC-029 §10. An implementer has to guess where the materialization job, cache-invalidation subscriber, and structural cache-key guard test live, and whether the public routes under `/api/ecommerce/storefront/*` are implemented inside `merchandising`'s own `api/` tree or `ecommerce`'s. | Add a section mirroring SPEC-029's, placing `lib/menuResolver.ts`, `lib/placementResolver.ts`, `lib/collectionMaterializer.ts`, `lib/cacheKeys.ts`, the public routes, `workers/materialize-collections.ts`, and `subscribers/merchandising-cache-invalidation.ts`. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| §6 Rule Collection Materialization | No queue name, concurrency, or idempotency statement for the hourly job; no stated execution model (sync vs. queued) for the on-demand materialize endpoint. | Declare `workers/materialize-collections.ts` with explicit queue/concurrency; state idempotent replace-in-place semantics; state the on-demand endpoint enqueues rather than blocks. |
| §8 Caching | Invalidation column names triggers ("Menu or item write") but never concrete cache tag names, unlike `storefront-public-api.md` §9.1. | Add a tag list: `merchandising-menu:{menuId}`, `merchandising-placement:{placementId}`, `merchandising-block:{blockId}`, `merchandising-collection:{collectionId}`. |
| §4.5 `rule_query` / sort interplay | `sort_strategy` coexists with `rule_query`'s own `sort` parameter (from spec 4's grammar) with no stated precedence. | State that `rule_query.sort` is ignored at save time; `sort_strategy` is the single source of ordering truth. |
| §9 Risks | Missing risk category entirely — price bleed via block/recommendation cache (as opposed to R1's visibility leak). | Add R9 per the Remediation Plan. |
| Materialization failure handling | R5 covers staleness, not failure (malformed `rule_query`, timeout). | Nice-to-have: add a notification type or explicitly scope out. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| `packages/shared/AGENTS.md` "MUST check for existing utilities before adding new helpers" | §13 "Sanitization" row, R3's mitigation | The platform already has a canonical, reusable HTML-sanitization helper: `sanitizeRichTextHtml` (`packages/shared/src/lib/html/sanitizeRichText.ts`), already consumed by `entities/lib/htmlRichTextSanitizer.ts`, `messages/lib/actions.ts`, `packages/ui/src/backend/utils/richTextSanitizer.ts`. Neither this spec's nor `storefront-public-api.md`'s sanitization mitigation names it — both describe "server-side allowlist sanitization" generically, risking two independently hand-rolled allowlists drifting apart. Point both specs at `sanitizeRichTextHtml`, or state a documented reason for divergence. |

### Confirmed Correct (no violation)

- **Command pattern**: `makeCrudRoute` correctly assumed for all admin CRUD — matches sibling-spec precedent; no separate "commands" section needed.
- **Optimistic locking — genuinely holds.** All eight entities in §4 rely on `updated_at` via "Standard scoped columns throughout"; none defines a `version` counter. **First clean pass on the `version`-vs-`updatedAt` mistake in this suite** (found and fixed four times elsewhere: `customer-groups-and-b2b-terms.md`, `cart-module.md`, and implicated in `SPEC-055`/checkout).
- **Encryption — correctly assumed absent.** No field in this module's data is PII per `packages/core/AGENTS.md`'s trigger list; no `encryption.ts` warranted.
- **`rule_query` grammar reuse — no drift found.** Delegates to spec 4 §4.1 by pointer rather than restating, so there's no independent parameter list to drift.

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| No structural CI guard on the merchandising cache-key helper, unlike `ecommerce`'s R1 mitigation (SPEC-029 §6.1's `no-raw-cache-calls.test.ts`) | A future block type or recommendation strategy could reintroduce the cache-split bug by building a key from `audienceDigest` alone. | Add an equivalent structural test to `merchandising/__tests__/`, registered in `scripts/repo-wide-guards.mjs`. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Materialization worker undefined | Duplicate `MerchandisingCollectionItem` rows risk if two runs overlap. | Declare idempotent replace-in-place semantics, explicit queue/concurrency. |
| `category_grid` block type's cache-safety unstated | Listed alongside the three explicitly-priced block types with no stated price-independence; a future addition of pricing to it would silently inherit the bug. | State `category_grid` is price-independent by design, or fold it into the price-bearing set. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Sanitization allowlist duplication | Two independently maintained allowlists could diverge over time. | Point both at `sanitizeRichTextHtml`. |
| No admin notification on materialization failure | Operator has no signal beyond a stale `materialized_at`. | Add a notification type or scope out explicitly. |

## Critical Cache-Split Finding — Formal Verdict

**Severity: Critical.** Formally equivalent to `ecommerce`'s R1 and `storefront-public-api`'s R1, both rated Critical, and directly the same defect class this suite already found and fixed once, in this same PR, in `storefront-public-api.md` §9.1's "Facet cache split."

**What's contradictory.** §7.1: "a block referencing products returns them resolved — full `StorefrontProductListItem` payloads, priced for the buyer." `product_carousel`/`product_grid`/`collection_grid` are product-referencing by §4.4's own type list; R4's mitigation confirms every block-fan-out request performs buyer-specific price resolution. `/recommendations` is entirely product-shaped output, including `higher_tier`'s explicit purpose of showing B2B quantity-tier pricing.

§8 nonetheless keys "Placement blocks" (120s) on `audience digest + slot + context` and "Recommendations" (300s) on `audience digest + slot + source` — never the full buyer digest. Per SPEC-029 §6.1's digest formula, `audienceDigest`-equivalent fields exclude exactly `priceKindId` and `customerId ?? '-'` — the two fields that determine price. A B2B buyer with a personal contract price and their group peer on the standard group price (personal price beats group price, per `customer-groups-and-b2b-terms.md`) share every audience field but differ in `priceKindId`/`customerId` — and would share a cached response and see each other's negotiated prices.

**Why this isn't already covered.** R1 covers a *visibility* leak; this is a *pricing* leak on a product both buyers may legitimately see, at the wrong price. R2 covers the *opposite* failure mode. Neither catches this specific defect.

**Evidence the author already knows the correct pattern.** §8's "Collections" rows get this right: "Collection membership" is keyed on `collection id` alone; "Collection products" is keyed on `full buyer digest + collection + page`. The same split was simply not applied to "Placement blocks" or "Recommendations."

**Concrete fix**, mirroring both the Collections split already in this document and the `storefront-public-api.md` §9.1 precedent:

1. Split "Placement blocks" into two cache layers: **structure layer** (block ordering, editorial content, unresolved references) keyed on `audienceDigest + slot + context`, 120s, unchanged; **resolved-product layer** (the `StorefrontProductListItem[]` payloads product-referencing blocks embed) keyed on `full buyer digest + slot + block id + context + page`, 30s (mirroring "Collection products").
2. Apply the identical split to "Recommendations": rule selection cacheable on `audienceDigest + slot + source`; priced response items on the full buyer digest.
3. Add the structural CI guard (Risk Assessment above).
4. Add a new §9 risk row (**R9, Critical**).
5. Add a regression test to §10 Integration Coverage.
6. Tighten §8's explanatory paragraph: `audienceDigest` is safe only for the *structural* portion of a cached surface; any surface embedding resolved product/price payloads must key on the full buyer digest, regardless of which cache row it lives in.

## Gap Analysis

### Critical Gaps (Block Implementation)
- The cache-split defect above — must be closed before Phase 2 (blocks) and Phase 4 (recommendations).

### Important Gaps (Should Address)
- Missing worker/queue definition for collection materialization.
- Missing Module File Structure section.
- Missing concrete cache invalidation tag names.
- Sanitization helper reuse (`sanitizeRichTextHtml`).

### Nice-to-Have Gaps
- `rule_query.sort` vs. `sort_strategy` precedence statement.
- `category_grid`'s price-independence stated explicitly.
- Materialization-failure notification.

## Remediation Plan

### Before Implementation (Must Do)
1. Fix the §8/§7.1 cache-split contradiction: apply the concrete fix above, add R9, add the regression test.
2. Point the sanitization mitigation at `sanitizeRichTextHtml`, or state a justified reason for divergence.

### During Implementation (Add to Spec)
1. Add a Module File Structure section.
2. Declare the materialization worker (queue, concurrency, idempotency, sync-vs-queued).
3. Add concrete cache invalidation tag names.
4. State the `rule_query.sort` vs. `sort_strategy` precedence rule.
5. State `category_grid`'s price-independence.

### Post-Implementation (Follow Up)
1. Consider a materialization-failure notification type.

## Recommendation

**Needs spec updates first.** The document is otherwise implementation-ready — clean BC sweep, sound entity design, correct optimistic-locking and command-pattern assumptions, no encryption gap, no grammar drift. The single blocking item is the §7.1/§8 cache-split contradiction (proposed R9, Critical), which must be resolved before Phase 2 and Phase 4 implementation begins.

## Changelog

### 2026-08-17
- Initial pre-implementation analysis, performed against fork PR #9 (`adeptofvoltron/open-mercato`, branch `spec/ecommerce-module-suite`) and this repo's `develop` worktree, per the `om-pre-implement-spec` skill workflow.
