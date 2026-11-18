# Pre-Implementation Analysis: Pricing Engine

*Updated after the spec reached its final form (Architecture, Data Model, API Contracts, Phasing, Implementation Plan, plus a fresh-context adversarial review and its follow-up corrections). This supersedes the original skeleton-stage pass; the original findings are kept below marked **[resolved]** where the finished spec addresses them, so the trail of what changed and why stays visible.*

## Executive Summary

The spec is now complete: Problem Statement, Proposed Solution (with a market-leader research pass against Medusa.js and commercetools), Architecture, Data Model, API Contracts, UI/UX, Edge Cases, Risks, Phasing, Implementation Plan, Integration Test Coverage, Final Compliance Report, and Changelog. Every Open Question from the skeleton stage is resolved and recorded. A fresh-context adversarial review (per `om-spec-writing` step 8) caught two Critical issues — unverifiable citations to sibling specs that don't exist on `develop`, and a `PricingContext` diagram that had silently drifted from the real type — both fixed in the spec directly, with the corrections themselves logged in its Changelog. **Recommendation: ready for phased implementation**, with one implementation-time decision still explicitly open (the resolver-chain same-priority tie-break rule, Phase 2 Step 4a) and one deliberately-deferred scope item worth naming here (see Gap Analysis).

## Backward Compatibility

### Violations Found

No violations. Every proposed change to `PricingContext` and `registerCatalogPricingResolver` is additive, verified against the actual current code (not assumed) after the adversarial review caught and corrected two places where the draft had drifted from what the code actually does:

| # | Surface | Original finding | Current status |
|---|---------|-------------------|------------------|
| 1 | Event IDs (FROZEN) | `catalog.pricing.resolve.before/after` must not be renamed/repurposed. | **[resolved]** — spec's Architecture section only extends the existing resolver chain; no event ID touched. |
| 2 | Type Definitions | `PricingContext` changes must stay additive. | **[resolved, after a correction]** — the spec's first Data Model draft *claimed* additive-only but the diagram itself silently flipped `quantity`/`date` from required to optional and dropped `\| null` from six existing fields. The adversarial review caught this against the real type (`catalog/lib/pricing.ts:10-19`); the spec's Data Model section now shows the actual current type alongside the corrected, genuinely-additive diff (only `currencyCode` and `customerGroupIds` are new). |
| 3 | Function Signatures (STABLE) | Not identified in the original pass — surfaced during the finished spec's review. | **[new, resolved]** — the spec's first API Contracts draft stated `registerCatalogPricingResolver(resolver, options: { priority: number; id?: string })` with `options`/`priority` non-optional, stricter than the real `options?: { priority?: number }`. Corrected to `options?: { priority?: number; id?: string }`, matching the real signature with only `id` newly appended. |
| 4 | DI Service Names (STABLE) | New module needs a distinct DI key. | **[resolved]** — Phase 3's `pricing` module registers via the existing `registerCatalogPricingResolver` extension point rather than a competing DI-resolved pricing service; no new service name collides with `catalogPricingService`. |
| 5 | Database Schema (ADDITIVE-ONLY) | "No new columns" claim needed verification. | **[resolved]** — Data Model states this explicitly for all three phases; zero migrations across the whole initiative, confirmed against `catalog/data/entities.ts:788+`. |

### Missing BC Section

**[resolved]** — the spec doesn't carry a single "Migration & Backward Compatibility" heading verbatim, but Data Model, API Contracts, and Risks jointly cover every required element: the additive-only field diff, the corrected function-signature diff, and the one flagged strictly-safer behavior change (currency mismatch now returns "no price found" instead of a silent cross-currency match) with an `UPGRADE_NOTES.md` entry named in Phase 2 Step 6.

## Spec Completeness

### Sections — all present

Every section the original pass listed as missing now exists: Architecture, Data Model, API Contracts, UI/UX, Edge Cases & Failure Scenarios, Risks & Impact Review, Phasing, Implementation Plan, Integration Test Coverage, Final Compliance Report, Changelog.

### Notable completeness findings from the adversarial review (not in the original pass)

| Finding | Status |
|---|---|
| Edge Cases table gave currency a full caller-contract treatment but omitted the equivalent tenant/organization-scoping contract for the rows a resolver runs over, despite root `AGENTS.md`'s "Never expose cross-tenant data" being a higher-severity rule than most in the document. | **[resolved]** — added as an explicit Edge Case row: every caller (today and Phase 3's `pricing` module) MUST pre-scope rows by `organization_id`/`tenant_id` before calling the resolver; the resolver itself has no scoping check of its own, which was already true and is now documented rather than implicit. |
| Phase 2 Step 4 ("document and test the resolver-chain same-priority tie-break behavior") was circular — you cannot test a rule that hasn't been decided yet. | **[resolved, but still open at implementation time]** — split into Step 4a (decide and document the rule) and Step 4b (test it). The *decision itself* remains open until Phase 2 implementation — see Gap Analysis. |
| Citations to `2026-08-14-ecommerce-suite-roadmap.md` (ADR-4), `2026-08-14-cart-module.md`, and `2026-08-14-customer-groups-and-b2b-terms.md` read as settled facts but none exist in `.ai/specs/` on `develop`. | **[resolved]** — a provenance note at the top of the spec marks all three as forward references to unmerged branch `spec/ecommerce-module-suite` (PR [#5384](https://github.com/open-mercato/open-mercato/pull/5384)), not settled dependencies. |

## AGENTS.md Compliance

### Violations

None. Every compliance obligation the original pass flagged as "the Architecture section must satisfy" is satisfied, verified against real code by the adversarial review rather than left as a self-check:

| Rule | Verdict |
|------|---------|
| "Never reimplement catalog pricing inline." (`catalog/AGENTS.md` § Never) | **Pass** — Phase 3's `lib/resolver.ts` imports and composes `matchesContext`/`scorePrice`/`selectBestPrice`; confirmed by the reviewer as genuinely reused, not reimplemented. |
| "Ask before changing price-layer precedence, resolver priority semantics" (`catalog/AGENTS.md` § Ask First) | **Pass** — the spec explicitly declines to touch `scorePrice`'s existing weights (Research section notes commercetools' different precedence but keeps OM's own, citing this exact rule as the reason not to change it without asking). |
| "Put core platform features in `packages/<package>/src/modules/<module>/`" | **Pass** — `packages/core/src/modules/pricing/`, closed by rule in the Locked-decisions stage. |
| Cross-Module Coupling — optional-integration direction (`packages/core/AGENTS.md` § Cross-Module Coupling) | **Pass** — Architecture explicitly reasons through why the push-based `registerCatalogPricingResolver` extension point (rather than a pull-based `tryResolve`) still keeps `catalog` upstream and unaware of `pricing`; the adversarial review confirmed this was checked against the rule's actual text, not just asserted. |
| Command pattern for writes (`packages/core/AGENTS.md` § Command Side Effects) | **Pass, N/A** — Phase 1's admin UI writes exclusively through the already-existing `catalog.prices.create/update/delete` commands; no new write path is introduced. |
| `setup.ts`/`acl.ts` sync | **Pass** — Phase 3's optional diagnostic route now has a named `pricing.diagnostics.view` feature, added after the adversarial review caught it was missing; granted to `admin` in `setup.ts`. |
| Encryption | **Pass, no new surface** — confirmed no PII in price rows. |

## Risk Assessment

The spec's own Risks & Impact Review is now the authoritative version; this section only tracks what changed relative to the original pass.

### Carried forward, unchanged in substance
- Registry `globalThis` fix remains the High risk it was identified as — now Phase 2 Step 1 with a named regression test, not a footnote.
- `sales/AGENTS.md`'s `selectBestPrice` overclaim remains High — now Phase 2 Step 5, fixed regardless of the sales/cart wiring decision (Q1 = engine-only).
- `customerGroupIds` shape-ownership coordination with the sibling spec remains Medium — now explicitly the spec's own shape to originate (Q4 decision), with the sibling spec expected to defer.

### New, found during the finished-spec review
- **Bundling friction (High, new).** Phase 1 (catalog UI) and Phase 3 (new module) were kept as two phases of one spec by explicit user decision rather than split. The adversarial review named the real cost of that choice — reviewer-skill mismatch, zero sequencing benefit since Phase 1 has no dependency on Phase 2/3, and reduced discoverability for the sibling spec's author trying to find the `customerGroupIds` shape decision. Not re-litigated; recorded as a named risk in the spec so the cost is visible rather than silently absorbed.
- **Tenant/org-scoping caller contract (folded into Edge Cases, not a separate Risk row, since it describes existing—not new—behavior).** See Spec Completeness above.

### Deliberately not carried forward
- **Cache-bleed / `contextCacheKey` primitive (originally Medium).** The first pass recommended the engine expose a canonical `contextCacheKey(context)` primitive so future callers (storefront, cart, POS) don't re-discover the buyer-context cache-bleed bug independently found twice in the sibling ecommerce-suite branch. The finished spec does **not** include this — it isn't mentioned anywhere in the final Architecture or API Contracts. This is consistent with the now-locked narrow scope (Q1 = resolution only, no HTTP-facing surface, no caching of any kind in this spec), and caching genuinely belongs to whichever module actually serves buyer-context-priced payloads over HTTP (`storefront-public-api`, `cart-module` — both out of scope here). Recorded here as a **deliberate scope choice, not an oversight** — but worth flagging explicitly to whoever picks up `cart-module`'s or a future `storefront`'s caching design, since the underlying risk (documented twice already) doesn't go away just because this spec doesn't own it.

## Gap Analysis

### Still open at implementation time (not blockers, but must not be forgotten)
- **Phase 2 Step 4a — the resolver-chain same-priority tie-break rule is not yet decided.** The spec is honest about this (split into a decide-then-test pair rather than a circular single step), but it means Phase 2 cannot be marked done on Implementation Plan alone; the decision itself needs to happen and get written down before Step 4b's test can exist.
- **Cache-key contract for buyer-context-priced payloads (see Risk Assessment above) has no explicit owner named.** Neither this spec nor (as far as this analysis can verify, since it lives on an unmerged branch) `storefront-public-api.md` is confirmed to own it. Worth a one-line flag when `cart-module`/`storefront` work actually starts, so it isn't assumed solved by proximity to this spec.

### Resolved from the original pass
- Registry `globalThis` fix — now explicit, phased, tested.
- Q1 (module location) — closed by rule.
- Admin UI ownership (originally ambiguous between `catalog` and `pricing`) — resolved to `catalog` (Phase 1), since the underlying API/commands/schema were already complete and the gap was UI-only.
- Explainability output contract for `cart-module`'s line-item snapshot — resolved as "no new contract needed," since the existing `PriceRow` return already carries `id`/`minQuantity`.
- Resolver-chain takeover test scenarios — now explicit in both Implementation Plan (Phase 3 Step 4) and Integration Test Coverage.
- Resolver registration observability — the optional diagnostic page (Phase 3 Step 5) addresses this, now with a named ACL feature.

## Recommendation

**Ready for phased implementation.** Phase 1 (catalog UI) and Phase 2 (resolver hardening) can start immediately and independently; Phase 3 (the `pricing` module) should start once Phase 2 lands, per the spec's own dependency ordering. The one remaining implementation-time decision (Phase 2 Step 4a's tie-break rule) is correctly scoped as an implementation task, not a spec-readiness blocker. The deliberately-deferred cache-key ownership question is not this spec's to resolve, but should travel with whoever picks up `cart-module`'s or `storefront-public-api`'s eventual implementation.
