# Pre-Implementation Analysis: SPEC-029 Ecommerce Store Module (v4, rescoped)

> **Source**: `adeptofvoltron/open-mercato` fork, PR #9, branch `spec/ecommerce-module-suite` — file `SPEC-029-2026-02-17-ecommerce-storefront-module.md` (v4, "rescoped" 2026-08-14). Spec-only PR; no code from it exists in this repo. Companion documents reviewed for ADR cross-references: `2026-08-14-ecommerce-suite-roadmap.md` (ADR-1..ADR-8), `2026-08-14-customer-groups-and-b2b-terms.md` (already audited separately, see `ANALYSIS-2026-08-14-customer-groups-and-b2b-terms.md`), `2026-08-14-availability-contract.md` (already audited separately, see `ANALYSIS-2026-08-14-availability-contract.md`).
> **Analyzed against**: this repo's own `develop` (worktree `62e2b7af`), verified via direct grep/read plus two independent Explore-agent codebase surveys.

---

## Executive Summary

The spec is well-scoped, accurately grounded in the real codebase (`DomainMapping`, `SalesChannel`, `CatalogPriceKind` field shapes all verified exact), and its central BC claim — that v3's withdrawn `EcommerceStoreDomain` entity and `ecommerce.checkout.manage`/`ecommerce.orders.view`/`ecommerce.storefront.*` ACL features were never implemented and so trigger no deprecation protocol — is **confirmed true**: zero references to any of these names, or to any `ecommerce_*` table, `/api/ecommerce/*` route, or `ecommerce.*` ACL feature, exist anywhere in this repo today. The module is genuinely greenfield. It is **not ready to implement as written**, for one dominant reason: `BuyerContext.taxMode: 'gross'|'net'` is resolved **independently** of `priceKindId`, but this repo's only real gross/net computation path (`sales.taxCalculationService`) derives that mode **exclusively** from the selected price kind's `displayMode` (`'including-tax'|'excluding-tax'`) — there is no precedent anywhere in the codebase for an independently-set buyer-level tax-display preference, and the spec never states how a mismatch (e.g. `price_kind_id` resolving to an `excluding-tax` kind while `taxMode` says `'gross'`) is reconciled. This is a genuine, unreconciled dual-source-of-truth defect that will mis-render or mis-calculate storefront prices, not a documentation gap. Secondary blocker-adjacent findings: R1 (the spec's own Critical risk, buyer-context cache bleed) is currently mitigated by TypeScript typing and review discipline alone, when this repo has a direct, low-cost, idiomatic precedent (`optimistic-lock-editable-entities.test.ts`) for a grep-based structural guard that would meaningfully raise confidence at negligible cost; the admin `notifications.ts`/`search.ts` module files the spec's own §6.2 and R7 promise are missing from its file structure; and the `POST .../preview-branding` action route's mutation-guard-registry status is ambiguous under `packages/core/AGENTS.md` § API Routes. **Recommendation: needs spec updates before implementation**, concentrated on the taxMode/displayMode reconciliation, the R1 structural guard, and the two module-file-structure gaps.

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | 10 (ACL Feature IDs) — self-audit claim | Spec §15/§20/§21 claims `ecommerce.checkout.manage`, `ecommerce.orders.view`, `ecommerce.storefront.view`/`.manage` were "removed" from v3 with "no deprecation protocol" triggered because v3 was never implemented. **Verified true**: grep across all 53 `acl.ts` files plus every `.sql` migration and `.snapshot-open-mercato.json` found zero matches for any of these strings. | None (confirmed compliant) | No action needed. Cite this verification in the spec's own §21 changelog for future auditors. |
| 2 | 8 (Database Schema) — self-audit claim | Spec §5.2/§18 claims `EcommerceStoreDomain` (v3) never shipped, so its replacement by `EcommerceStoreDomainBinding` is a spec change, not a schema/deprecation event. **Verified true**: zero matches for `EcommerceStore`, `EcommerceStoreDomain`, `EcommerceStoreDomainBinding`, `EcommerceStoreChannelBinding`, or tables `ecommerce_stores`/`ecommerce_store_domain_bindings`/`ecommerce_store_domains`/`ecommerce_store_channel_bindings` anywhere in entities, migrations, or snapshots. | None (confirmed compliant) | No action needed. |
| 3 | 7 (API Route URLs) — self-audit implicit claim | No route under `/api/ecommerce/*` exists today (verified: zero hits repo-wide, including `apps/mercato`). All routes in spec §9 are genuinely new. | None (confirmed compliant) | No action needed. |
| 4 | 2 (Type Definitions), 9 (DI Service Names) | `BuyerContext.taxMode`/`priceKindId` and the `StoreContextService.resolve()` contract are brand-new — no existing type to collide with. However, this spec's `BuyerContext` shape (§6) already diverges from the roadmap's own `ADR-7 BuyerContext` shape (roadmap §5 ADR-7: `channelId`, `currencyCode`, `locale`, `purchaseOnAccount` vs. this spec's `assortmentScope`, `allowPurchaseOnAccount`, `approvalRequiredAbove`, no top-level `currencyCode`/`locale`). Neither is implemented yet, so this is not a break *today*, but the umbrella roadmap explicitly states child specs "MUST conform to the decisions recorded in §5" and "a child spec that needs to deviate MUST amend this document first" (roadmap §1) — this spec does not amend it. | Warning | Before implementation, reconcile this spec's `BuyerContext` field list against roadmap ADR-7's, and update whichever document is stale. Add a one-line changelog note recording the reconciliation. |

### Missing BC Section

Not missing — §18 "Migration Path" exists and functionally covers the deprecation-protocol question, though it is not titled "Migration & Backward Compatibility" as the spec-writing checklist expects. Minor naming nit only; content is present and accurate.

---

## Spec Completeness

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| §5.1.1 `display.priceDisplayModeDefault` / §6 `BuyerContext.taxMode` | See "taxMode vs. displayMode" finding below (Gap Analysis — Critical). No reconciliation rule stated between the two independently-resolved gross/net signals. | Derive `taxMode` from the resolved price kind's `displayMode` rather than resolving it independently. |
| §10 Module File Structure | Omits `notifications.ts` / `notifications.client.ts` / `widgets/notifications/`, despite §6.2 explicitly promising "an admin notification" on a missing default channel binding and R7 explicitly promising "an empty effective assortment... emits a warning event." Per `packages/core/src/modules/customers/AGENTS.md` § Module Files Checklist, a module promising in-app notifications needs the file. | Add `notifications.ts` declaring a type for the missing-channel-binding notification, a subscriber, and `notifications.client.ts` renderer. |
| §10 Module File Structure | No `search.ts`. Stores are an admin-searchable entity (name/code/slug) with no other stated discovery path. | Nice-to-have; add or explicitly scope out with a stated reason. |
| §9.2 `POST /api/ecommerce/stores/:id/preview-branding` | Validates and returns CSS **without persisting**, but never states whether it goes through the mutation-guard registry per `packages/core/AGENTS.md` § API Routes. Verified against this repo's own precedent for "preview/validate without persisting" endpoints (`messages/api/[id]/forward-preview/route.ts`, `sync_excel/api/preview/route.ts`) — **both are `GET` routes**, not `POST`. | State explicitly either: (a) switch to `GET`, matching house precedent exactly; or (b) keep `POST` but state it is exempt from `runMutationGuards` because it performs no domain write. |
| §20 Final Compliance Report | No "Encryption" row, unlike the sibling customer-groups spec's §16. `EcommerceStoreSettings.contact` (§5.1.1) stores `email`, `phone`, `address` — fields explicitly named in root `AGENTS.md`'s encryption-maps trigger list. | Add an Encryption row stating the rationale: public store contact info displayed on the storefront, not personal customer data — analogous to `sales.SalesChannel` contact fields (verified plaintext). |
| §8.1 "one joined query" / §11 "lists bindings joined to their `DomainMapping`" | Never states explicitly that the join is a query-builder/raw SQL read rather than a MikroORM cross-module relation, which root `AGENTS.md` flags as a Critical anti-pattern. | Add one clarifying sentence to preempt reviewer ambiguity. |

---

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| `packages/core/AGENTS.md` § API Routes — custom POST/PUT/PATCH/DELETE routes not using `makeCrudRoute` MUST wire the mutation guard registry | §9.2 `POST .../preview-branding` | State guard-wiring status explicitly, or switch to `GET` matching house precedent. |
| `packages/core/src/modules/customers/AGENTS.md` § Module Files Checklist | §6.2, R7, §10 | Add `notifications.ts` / `notifications.client.ts`. |
| Root `AGENTS.md` § Data & Security — PII/GDPR column declaration or explicit justification | §5.1.1 `contact`, §20 | Add an explicit Encryption row to §20. |
| `packages/core/AGENTS.md` § Cross-Module Coupling — "No direct ORM relationships between modules" (ambiguity, not a confirmed violation) | §8.1, §11 | Clarify the joined query is query-builder/raw SQL, not an ORM relation. |

**Optimistic locking — confirmed compliant.** §20 states all three entities expose `updatedAt` with `CrudForm` auto-derivation and no `version` counter — unlike the customer-groups spec's original (now-fixed) mistake.

**Widget injection — confirmed not applicable.** The module reads `customer_accounts.DomainMapping` read-only for its Domains tab rather than injecting into another module's UI.

**Cache DI usage — confirmed compliant.** §8's tag/TTL model matches `packages/cache/AGENTS.md` exactly.

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **R9 (new) — `taxMode`/`displayMode` dual-source mismatch.** `BuyerContext.taxMode` (resolved via `customerGroupsService.resolveTerms()` → `CustomerGroupTerms.tax_display_mode`) and `channel.priceKindId` (channel binding, group-overridable) are two independently-resolved gross/net signals with no stated reconciliation rule. Verified against actual code: `catalog/lib/pricing.ts` never reads `displayMode` — it only selects a raw stored price row; `sales`'s real gross/net recomputation is, in every existing call site, derived 1:1 from the selected price kind's `displayMode` at selection time (`LineItemDialog.tsx:1146-1147`: `mode = selected.displayMode === "excluding-tax" ? "net" : "gross"`) — never set independently by a buyer-level preference. Zero precedent anywhere in this codebase for an independently-set `taxMode`. | Derive `BuyerContext.taxMode` FROM the resolved price kind's `displayMode` at resolution time, mirroring `LineItemDialog.tsx`'s existing translation — rather than resolving it independently. Requires a coordinated fix in `customer-groups-and-b2b-terms.md` §5.3 too. |
| **R1 residual-risk overstatement.** Spec's own R1 (Critical, buyer-context cache bleed) claims residual risk "Low" resting on TypeScript typing plus code review and tests — no automated structural guard. | Add a grep-based Jest structural guard as an explicit Phase 1 gate criterion. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `BuyerContext` shape drift from roadmap ADR-7 | Downstream specs 4/5/7 risk being written against divergent shapes | Reconcile explicitly before spec 4/5/7 are written. |
| Missing `notifications.ts` | §6.2's admin notification and R7's warning event are unimplementable as promised | Add `notifications.ts`. |
| `preview-branding` mutation-guard ambiguity | Low severity but inconsistent with house GET-based preview convention | Resolve per Spec Completeness table. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| §18 titled "Migration Path" not "Migration & Backward Compatibility" | Naming convention mismatch only | Rename heading. |
| No `yarn mercato auth sync-role-acls` follow-up mentioned | Same gap flagged for the sibling customer-groups spec | Add one sentence to §18/§9.3. |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

- **`taxMode`/`displayMode` reconciliation (R9)**: `BuyerContext.taxMode` must be derived from the resolved price kind's `displayMode`, not resolved independently. Requires a coordinated fix in both this spec and `customer-groups-and-b2b-terms.md` §5.3. Blocks Phase 1's own gate criterion.

### Important Gaps (Should Address)

- **R1 structural guard**: grep-based Jest test banning raw `cache.resolve('cache').set/get(...)` calls in `ecommerce` route files outside `lib/cacheKeys.ts`, following `optimistic-lock-editable-entities.test.ts`'s template. Must be registered in `scripts/repo-wide-guards.mjs` or turbo silently skips it on PRs touching only `ecommerce` route files.
- `notifications.ts` / `notifications.client.ts`.
- `preview-branding` mutation-guard / HTTP-method decision.
- Encryption stance for `settings.contact`.
- `BuyerContext` shape reconciliation against roadmap ADR-7.

### Nice-to-Have Gaps

- `search.ts` for admin-searchable stores.
- Explicit statement that §8.1's joined query is query-builder/raw SQL, not an ORM relation.
- `yarn mercato auth sync-role-acls` follow-up note.
- Rename §18 heading.

---

## Remediation Plan

### Before Implementation (Must Do)

1. **Reconcile `taxMode` with `displayMode`**: derive from the resolved price kind's `displayMode`, matching `LineItemDialog.tsx`'s pattern; coordinate the fix with `customer-groups-and-b2b-terms.md` §5.3.
2. **Add a Phase 1 gate: structural cache-key guard** (grep-based Jest test, registered in `scripts/repo-wide-guards.mjs`).
3. **Resolve the `preview-branding` mutation-guard/HTTP-method question** explicitly.
4. **Add `notifications.ts` / `notifications.client.ts`** to §10.

### During Implementation (Add to Spec)

1. Add an Encryption row to §20.
2. Clarify §8.1's joined query is query-builder/raw SQL, not an ORM relation.
3. Add `search.ts` or scope it out with a stated reason.
4. Rename §18 and add the `sync-role-acls` follow-up sentence.

### Post-Implementation (Follow Up)

1. Reconcile `BuyerContext`'s field list against roadmap ADR-7, or amend the roadmap per its own §1 rule.
2. Once spec 4 is written, verify its `taxMode` consumption matches the derived-not-independent model adopted here.

---

## Recommendation

**Needs spec updates before implementation.** Module boundaries, ownership decisions, and the BC self-audit are sound and independently verified accurate. The blocking issue is a genuine data-model defect — `taxMode` resolved independently of `priceKindId` with no reconciliation rule and no codebase precedent for that independence — plus a cluster of lower-severity but concrete completeness gaps that should be resolved in the spec text before Phase 1 begins.

---

## Changelog

### 2026-08-17
- Initial pre-implementation analysis, performed against fork PR #9 (`adeptofvoltron/open-mercato`, branch `spec/ecommerce-module-suite`) and this repo's `develop` worktree, per the `om-pre-implement-spec` skill workflow. Verified BC self-audit claims via two independent Explore-agent codebase surveys.
