# Pre-Implementation Analysis: Cart Module

**Source:** `2026-08-14-cart-module.md`, spec 5 of the Ecommerce Suite Roadmap (Phase 2), from `adeptofvoltron/open-mercato` PR #9 (`spec/ecommerce-module-suite`), a spec-only fork PR proposing a suite of ecommerce modules.
**Depends on (per roadmap):** Customer Groups & B2B Terms, Availability Contract, SPEC-029 Ecommerce Store Module — all three already reviewed/fixed in prior passes of this audit series.
**Analyst:** `om-pre-implement-spec` skill, run against this repo's actual code at the `62e2b7af` worktree.

---

## Executive Summary

The cart module's *domain design* is strong — ADR-1/ADR-2 discipline (cart never computes totals, always delegates to `salesCalculationService`) is followed faithfully, and every `SalesLineSnapshot`/`SalesAdjustmentDraft`/`SalesDocumentKind` claim was verified byte-for-byte against the actual sales module types. However, the spec has **two Critical architectural defects that repeat mistakes already found and fixed elsewhere in this same suite**: (1) `Cart.version: integer` is a bespoke optimistic-locking mechanism the platform does not support — it is the *third* appearance in this suite of the same v3-legacy `version`-counter pattern already rejected for `CustomerCreditAccount`/`CustomerPurchaseApproval` and for the SPEC-029 v3 checkout session; and (2) **every cart mutation in §8/§10 bypasses the Command pattern entirely** — no `registerCommand`, no undo/audit capture, nothing — despite root `AGENTS.md` and `packages/core/AGENTS.md` mandating commands for all domain writes, and despite `sales` itself (the module cart depends on) implementing every line/adjustment mutation as a registered command. Both defects are fixable without touching the domain model (Cart already gets `updated_at` for free as a "standard scoped column"), but §8.1's entire concurrency contract and §10's route-implementation assumptions need a rewrite before implementation starts. The BC audit is otherwise clean — a fresh, whole-repo collision sweep on `cart.*` events/ACL, `/api/cart/*` routes, `carts`/`cart_*` tables, and `cart*` DI keys found **zero** collisions. **Recommendation: Needs spec updates before implementation** (not a major revision — the fixes are additive/mechanical, following the exact pattern already applied to the customer-groups sibling spec).

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | Database Schema (anti-pattern, not a BC break) | `Cart.version: integer` (§4.1) duplicates a concurrency mechanism the platform already provides via `updated_at`, and is never read/written by any existing platform helper — it is inert unless the module hand-builds its own guard, header, and 409 shape from scratch. Not a *backward-compat* violation (brand-new column on a brand-new table) but a **forward-compat anti-pattern**: any future consumer built against the platform's standard conflict contract (`OptimisticLockConflictBody` = `{ error, code, currentUpdatedAt, expectedUpdatedAt }`, header `x-om-ext-optimistic-lock-expected-updated-at`) will not recognize cart's bespoke shape. | **Critical** | Drop `version`; rely on `updated_at`. Use `enforceCommandOptimisticLock`/`enforceCommandOptimisticLockWithGuards` from `packages/shared/src/lib/crud/optimistic-lock-command.ts` for every mutating route. |
| 2 | — | No other BC violations found. Full collision sweep confirms this is a clean greenfield addition. | — | — |

### Fresh-Repo Collision Sweep

| Surface | Result |
|---|---|
| Event IDs `cart.*` | No collision |
| ACL feature IDs `cart.*` | No collision |
| API routes `/api/cart/*` | No collision |
| DB tables `carts`, `cart_lines`, `cart_promotion_applications`, `cart_merge_logs` | No collision |
| DI keys containing `cart` | No collision |

A broader `\bcart\b` sweep (28 hits) turned up only incidental uses (lucide icon literals, an unrelated local variable name) — none are module-namespaced identifiers that would clash.

### Missing BC Section

No dedicated "Migration & Backward Compatibility" section — unlike sibling specs in this suite (`customer-groups-and-b2b-terms.md` §8, `availability-contract.md` §15). Not a blocker: §17's one-line claim is factually correct. Worth adding: ADR-1/ADR-3 withdraw SPEC-029 v3's cart-as-checkout-session model, and SPEC-055 Promotions must be amended to align its cart-interaction API to this spec.

---

## Spec Completeness

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| §17 "Encryption" row | Claims `email` "uses the encryption helpers; reads via `findWithDecryption`" but no `encryption.ts`/`defaultEncryptionMaps` export is declared anywhere — same "unverified assertion" pattern already caught for `customer-groups-and-b2b-terms.md`'s `version` column. | Add `[{ entityId: 'cart:cart', fields: [{ field: 'email' }] }]`. Flag `CartLine.configuration` and `CartMergeLog.source_snapshot` as candidates worth an explicit decision. |
| §17 "Queue usage" row | Claims sweepers use "the queue worker contract, not custom timers" but §12's four cadence jobs are never backed by a `workers/*.ts` listing, and `workers/*.ts` auto-discovery registers a handler, not a cadence trigger — nothing names what actually enqueues these jobs on schedule. | Name the scheduling primitive and sketch the four workers' metadata. |
| §10.3 ACL | No `setup.ts` `defaultRoleFeatures` mapping shown (same omission as the sibling customer-groups spec). | Add a one-line sketch for `admin`/`employee`. |

---

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| "Implement domain writes through commands so audit, undo, cache, events, and indexing stay consistent" (`packages/core/AGENTS.md` § Command Side Effects) | §8.1, §10 (every mutating route), §17 (no "Commands" row at all) | Zero mentions of `registerCommand`/"Command pattern"/`extractUndoPayload` anywhere. Every mutating `/api/cart/*` route is a plain HTTP handler with a raw conditional SQL update. `sales` — the module cart is architecturally paired with — implements the identical operation shape via registered commands (`packages/core/src/modules/sales/commands/documents.ts`). §7.2's "undo-merge" is a different concept (domain restore from `CartMergeLog`) and doesn't substitute for Command-pattern undo. Fix: wrap every mutation (`cart.lines.add/update/remove`, `cart.promotions.apply/remove`, `cart.merge`, `cart.approval.request`) as a registered command. |
| "NEVER run raw `em.find`/`em.findOne` between scalar mutations and `em.flush()` … without `withAtomicFlush`" (`packages/core/AGENTS.md` § Entity Update Safety) | §8.1: "conditional update (`WHERE version = $expected`) and increments atomically" | As written this is a hand-rolled raw-SQL UPDATE outside MikroORM's entity manager. Cart's real write flow (load cart+lines → call `catalogPricingService`/`promotionsService` → call `salesCalculationService.calculateDocumentTotals` → persist totals → bump lock token) is exactly the multi-phase shape `withAtomicFlush` exists to protect. Fix: pre-check via `enforceCommandOptimisticLock`, then entity writes through `withAtomicFlush`/`runCrudCommandWrite`, side effects after commit. |
| Optimistic locking must use `updated_at`, not an ad hoc `version` counter | §4.1, §5.3, §8.1, §10.1, §17 | See dedicated writeup below. |

No other AGENTS.md violations found. Events, ACL naming, tenant/org scoping, zod-validation intent, and cross-module DI-service coupling all check out clean.

---

## The `version` vs `updated_at` Finding — Formal Verdict

**Verdict: Critical.** `Cart.version: integer` cannot reuse the platform's optimistic-locking mechanism as designed, and there is no legitimate technical reason it needs to be an integer rather than `updated_at`. Fixable additively without domain-model rework.

**Why it cannot work as written.** `packages/shared/src/lib/crud/optimistic-lock-command.ts` (`enforceCommandOptimisticLock`, `assertOptimisticLock`) is hard-coded end to end to ISO-timestamp comparison via `toIsoOrNull()`; the client token travels in a fixed header (`x-om-ext-optimistic-lock-expected-updated-at`); a mismatch throws a fixed 409 body `{ error, code, currentUpdatedAt, expectedUpdatedAt }`. None of this accepts a generic integer counter. Cart's mutating routes are custom action routes, not `makeCrudRoute` — exactly the scenario `enforceCommandOptimisticLock` exists for.

**Third appearance of the same mistake in this suite.** `customer-groups-and-b2b-terms.md` already removed an identical inert `version` column; SPEC-029 v3's `EcommerceCheckoutSession` "version optimistic locking" was superseded and its reasoning explicitly handed off to *this* cart spec — which then re-imported the pre-rejected v3 pattern instead of the corrected platform mechanism (confirmed by this spec's own changelog: "carried forward v3's idempotency and optimistic-locking reasoning").

**Is there a legitimate reason for an integer over a timestamp? No.** The cited goal (`versionBumpReason: 'repricing'` distinguishability) is orthogonal to the CAS token's type and works identically either way. Cart already gets `updated_at` for free.

**Concrete fix:**
1. Drop `Cart.version` from §4.1; keep `updated_at`.
2. Every mutating route calls `enforceCommandOptimisticLock({ resourceKind: 'cart.cart', resourceId, current: cart.updatedAt, request })`.
3. Clients may still send a field named `version` on the wire for ergonomics; server-side it's read as the expected `updated_at` ISO string.
4. On conflict, embed the full current cart state + `versionBumpReason` as **additional** fields alongside the standard body — loses nothing versus the original design.

---

## `withAtomicFlush` Applicability — Formal Answer

**Does `withAtomicFlush` support "conditional update WHERE version = $expected"? No** — that isn't its job; it sequences ordinary mutations across phases with per-phase flush plus a commit-boundary guard, no conditional-write primitive. That's `enforceCommandOptimisticLock`'s job, as a pre-check before any phase runs.

**Would cart's DIY approach risk the exact pitfall `withAtomicFlush` prevents? Yes, if implemented literally.** Cart's flow (query → external pricing/promotion calls → write totals → bump lock) is precisely the "mutate → external work → mutate again" shape that silently drops a scalar UPDATE under MikroORM v7 without phase separation, and a raw conditional SQL UPDATE bypasses the entity manager entirely.

**Recommendation:** reframe §8.1 as (1) synchronous optimistic-lock pre-check, (2) entity writes via `withAtomicFlush`/`runCrudCommandWrite`, (3) side effects after commit.

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Cart mutations bypass the Command pattern entirely | No audit trail; no framework-guaranteed cache/index invalidation consistency for cart writes | `registerCommand` for every mutation, mirroring `sales/commands/documents.ts` |
| `version`-based locking is unusable against the platform's conflict-bar UI | §10.2's admin UI needs duplicated custom conflict handling or silently mishandles conflicts | Switch to `updated_at` |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Bespoke conditional-SQL write bypasses `withAtomicFlush` protections | Interleaved entity mutation + external calls risks silently dropping a scalar UPDATE | Route through `withAtomicFlush`/`runCrudCommandWrite` |
| Four sweeper jobs (§12) have no stated scheduling mechanism | `workers/*.ts` registers a handler, not a cron trigger | Name the cadence-scheduling primitive |
| Idempotency-key storage (§8.2) ties to the broken `version` column | Minor — replay logic doesn't strictly need it | Reword to `updatedAt` once §4.1/§8.1 are fixed |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `Cart.email` encryption claim (§17) has no backing declaration | Trivial additive fix | Add `defaultEncryptionMaps` sketch |
| `CartLine.configuration`/`CartMergeLog.source_snapshot` may carry incidental PII with no recorded decision | Genuinely open design question | State the decision explicitly |

All other risks in the spec's own §13 table are adequately identified and mitigated — no additional findings.

---

## Gap Analysis

### Critical Gaps (Block Implementation)
- Command-pattern integration for every cart mutation.
- `version` → `updated_at` migration across §4.1/§5.3/§8.1/§10.1/§17.

### Important Gaps (Should Address)
- `encryption.ts` declaration for `Cart.email` (+ decision on `configuration`/`source_snapshot`).
- Scheduling mechanism + worker metadata sketch for the four §12 sweepers.
- `setup.ts` `defaultRoleFeatures` for the three ACL features.

### Nice-to-Have Gaps
- Migration & Backward Compatibility section naming the ADR-1/ADR-3 withdrawal and pending SPEC-055 amendment.
- Notification types for R2/R4/R8.

---

## Remediation Plan

### Before Implementation (Must Do)
1. Rewrite §4.1, §5.3, §8.1, §10.1, §17 to replace `Cart.version: integer` with `updated_at` + `enforceCommandOptimisticLock`.
2. Add a `commands/` sketch naming every mutating operation as a `registerCommand` handler; restate §8.1's write flow as pre-check → `withAtomicFlush`/`runCrudCommandWrite` → post-commit side effects.

### During Implementation (Add to Spec)
1. Add `encryption.ts` for `Cart.email`; record a decision on `configuration`/`source_snapshot`.
2. Name the sweeper-job scheduling mechanism.
3. Add `setup.ts` `defaultRoleFeatures`.

### Post-Implementation (Follow Up)
1. Add the migration-note subsection.
2. Consider notification types for R2/R4/R8.

---

## Recommendation

**Needs spec updates before implementation.** The domain design is sound and doesn't need rework. The two Critical findings are concentrated in §8/§10 and both have concrete, additive fixes already proven out on the sibling `customer-groups-and-b2b-terms.md` spec in this same suite.

---

## Changelog

### 2026-08-17
- Initial pre-implementation analysis, performed against fork PR #9 (`adeptofvoltron/open-mercato`, branch `spec/ecommerce-module-suite`) and this repo's `develop` worktree, per the `om-pre-implement-spec` skill workflow.
