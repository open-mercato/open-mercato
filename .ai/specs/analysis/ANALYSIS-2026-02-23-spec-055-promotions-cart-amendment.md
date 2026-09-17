# Pre-Implementation Analysis: SPEC-055 Promotions Module — Amendment (2026-08-14, reconciled 2026-08-17)

**Scope note**: This analysis targets the "Amendment — 2026-08-14: Alignment with the `cart` Module" (§A.1–A.9) and its interaction points with the rest of the document and with the `cart` module spec, per the suite-alignment pass. The pre-existing 1.0–1.4 body (rule engine, three-pass evaluator, extensibility registry internals) was reviewed only where it interacts with or is contradicted by the Amendment. The already-applied 2026-08-17 fix to §A.3's route-rename table was verified, not re-audited.

## Executive Summary

The Amendment's core architectural moves (DI-first integration, namespace move to resolve the `cart` collision, cart-line-id targeting, net/gross basis, code-reservation lifecycle tied to cart) are sound and internally consistent within §A.1–A.9 itself. However, the 2026-08-17 fix to §A.3 was **incomplete at the document scope it claimed to cover**: it fixed the route table, the module file structure, the *API Contracts* headers, and the Phase 3 implementation-plan steps, but **eight other occurrences of the pre-amendment `/api/cart/*` namespace and old operation names (`add-code`, `apply-promotion`, `use-code`, `delete-code`, `register-usage`) remain uncorrected** elsewhere in the document — in the Proposed Solution summary, the Evaluation Engine Data Flow diagram, the Code Lifecycle and Promotion Usage Lifecycle diagrams, the Extensibility section (twice), the Phase 5 implementation-plan step, and a Risk scenario. §A.3 itself states plainly that any such leftover "is a defect, not an alternative" — so this is squarely in scope and not a matter of interpretation. Separately, the Amendment's own new DI contract (§A.2) has a real completeness gap: two of the seven renamed routes (`codes/validate`, `codes/use`) have **no corresponding method** on `PromotionsService`, which contradicts §A.2's own rule that in-process callers must not go through HTTP. The promotions module is confirmed **greenfield** in this repository (no `packages/core/src/modules/promotions/` exists, no `promotion_*` tables), so the route rename itself carries no BC severity — but the missing-DI-method gap and the Command-pattern bypass for financially consequential writes (`reserveCode`/`releaseCode`/`registerUsage`/`revertUsage`/`useCode`) are real pre-implementation risks that should be closed before Phase 2/3 work begins, especially since the sibling `cart` module spec was already caught and fixed for the exact same class of Command-pattern omission.

**Recommendation**: Needs spec updates before implementation — not a major revision, but the leftover route references and the DI-contract gap should be closed in the same pass, and the Command-pattern question should be resolved explicitly (even if the resolution is "documented exception, and here is why").

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|---------------|
| 1 | 7 — API Route URLs | §A.3's route-rename table is correct and complete (verified: all 7 real cart-facing routes present, `remove-code` typo gone). However **8 other locations in the document still reference the pre-amendment `/api/cart/*` paths or old operation names** that §A.3 explicitly designates as defects when left unreconciled. See list below. | Warning (self-flagged by the spec's own §A.3 rule; not a runtime BC break since nothing is deployed) | Update all 8 locations to the `/api/promotions/*` paths / new operation names (see Gap Analysis for the exact list) |
| 2 | 9 — DI Service Names | §A.2's `PromotionsService` interface omits `useCode` and `validateCode`. Every other renamed cart-facing route (`evaluate`, `reserve`, `release`, `register`, `revert`) has a matching DI method; these two do not. Any in-process caller (e.g. `checkout`, when finalizing a code at order confirmation) has no DI path and must fall back to the HTTP adapter — which §A.2 itself says "would lose the request-scoped container, the transaction and the tenant scope" for in-process callers. | Critical (blocks a real Phase 3 integration point once `checkout` is specified) | Add `useCode(input: UseCodeInput): Promise<UseCodeResult>` and (if genuinely needed in-process) `validateCode(...)` to `PromotionsService` in §A.2, mirroring the other five methods |
| 3 | 2 — Type Definitions | `ResolvedEffect` gains a **required** `basis: 'net' \| 'gross'` field (§A.5). Not a breaking change today (module is greenfield, nothing shipped), but flagging so implementation doesn't treat it as optional-by-habit once the type ships. | Low (informational) | Add a one-line note to Migration & Compatibility confirming `basis` ships as required from v1 of the implementation |

### Missing BC Section

The spec's existing "Migration & Compatibility" section (pre-Amendment, unchanged by 2.0.0/2.0.1) states "Cart-facing API is additive; existing cart/POS integrations are unaffected until they opt in" — stale relative to the Amendment, which is a **breaking rename** justified only by nothing being deployed yet. Recommend one added sentence cross-referencing §A.3's "no deprecation protocol triggered" reasoning.

---

## Spec Completeness

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|-----------------|
| Final Compliance Report (dated 2026-02-23) | Never updated for the 2.0.0 Amendment or the 1.4.0 usage-ledger addition. No row on Command-pattern coverage for `registerUsage`/`revertUsage`/code-reservation lifecycle, no row on the optional-vs-hard DI classification for `promotionsService` as consumed by `cart`. | Add addendum rows |
| §A.2 (DI contract) | Silent on whether `PromotionsService` methods execute through the Command pattern (`registerCommand`, undo, `withAtomicFlush`) or the plain service-layer transaction code already described in "Code Lifecycle" / "Promotion Usage Lifecycle." | State explicitly, or document a justified exception |
| §A.2 / §A.6 | Neither the Amendment nor `cart-module-fork.md` states whether `cart` treats `promotions` as an **optional** peer (`tryResolve`-style, per `packages/core/AGENTS.md` § Cross-Module Coupling) or a **hard** dependency. Cart's §3.1 diagram lists `promotions` alongside `catalog`/`sales` with no "advisory" qualifier (contrast with `availability`, explicitly marked advisory). | Declare hard-dependency-with-rationale, or specify graceful degradation |

---

## AGENTS.md Compliance

### Violations / Open Questions

| Rule | Location | Fix |
|------|----------|-----|
| `packages/core/AGENTS.md` § Command Side Effects — write operations via Command pattern, reference `customers/commands/*` | `lib/code-service.ts` (reserve/validate/use/release) and `lib/promotion-usage-service.ts` (registerUsage/revertUsage) back 5 of the Amendment's 6 DI methods, all financially/budget consequential, none wired through `commands/*.ts` / `registerCommand`. Only `Promotion`/`Code` CRUD go through commands. | Route through registered commands (mirroring `cart-module-fork.md`'s own 2026-08-17 fix for the identical omission), or document a justified exception in the Final Compliance Report |
| `packages/core/AGENTS.md` § Cross-Module Coupling — optional peer via `tryResolve`, never unconditional hard `container.resolve()` | §A.2 / cart §3.1, §6 | Resolve the hard-vs-optional ambiguity explicitly |
| Root `AGENTS.md` / §A.3's own consistency rule | 8 leftover `/api/cart/*` and old-operation-name references (list below) | Update to post-Amendment naming |

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `PromotionsService` DI contract missing `useCode` (and possibly `validateCode`) | When `checkout` (spec 7, not yet written) needs to finalize a reserved code at order confirmation in-process, it has no compliant path. Same *class* of defect as the already-fixed §A.3 omission, one layer down at the DI-contract level instead of the route-table level. | Add the missing method(s) to §A.2 before Phase 2/3 implementation locks the interface |
| Financially consequential writes bypass the Command pattern | No audit-log wiring, no mutation-guard/interceptor support, no consistent index/cache-invalidation ordering guarantee — and this integration point is now load-bearing for `cart`'s per-mutation evaluation loop (A.1), not just an optional external adapter as in v1.0. | Resolve per AGENTS.md Compliance table |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Leftover `/api/cart/*` references across 8 locations | Low runtime risk (nothing shipped), but real implementation risk: an engineer working from the still-stale diagrams or Phase 5 step list could wire the wrong route/schema target. | Fix all 8 before Phase 2/5 implementation |
| `promotions` as hard vs. optional peer of `cart` left unstated | If `promotions` is ever disabled (module-decoupling test scenario), `cart`'s per-mutation `evaluate()` call has undefined behavior. | Add the explicit statement recommended above |
| A.1/A.2 framing implies `cart` is the sole in-process caller | `registerUsage`/`revertUsage`/`useCode` are architecturally destined to be called by `checkout` at order confirmation (a module not yet specced), not `cart`. | Minor wording fix |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Final Compliance Report not updated for 2.0.0/2.0.1/1.4.0 | Documentation drift only | Add addendum rows, low priority |
| Pre-existing "Budget Cap Race Window" / "Cross-Tenant Code String Collision" risks (1.0–1.4 body) | Both remain valid and unaffected by the Amendment | No action needed; confirmed still accurate |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

- **§A.2 `PromotionsService` interface missing `useCode`** (and `validateCode` if genuinely needed in-process).

### Important Gaps (Should Address)

- **8 leftover `/api/cart/*` / old-operation-name references** — exact locations:
  1. "Proposed Solution," item 3: `/api/cart/apply-promotion` → `/api/promotions/evaluate`
  2. "Evaluation Engine Data Flow" ASCII diagram header
  3. "Code Lifecycle" ASCII diagram: `add-code`, `validate-code`, `apply-promotion`, `use-code`, `delete-code`
  4. "Promotion Usage Lifecycle" ASCII diagram: `register-usage`, `revert-usage`
  5. "Extensibility → Extension Registry (Server-Side)" note
  6. "Extensible Cart Context" section intro
  7. Phase 5 implementation-plan, step 6
  8. Risks & Impact Review → "Concurrent Code Reservation" scenario
- **Command-pattern classification for reservation/usage writes** — resolve explicitly.
- **Optional-peer vs. hard-dependency classification for `promotions` relative to `cart`** — resolve explicitly.
- **Final Compliance Report addendum** for 2.0.0/2.0.1/1.4.0 changes.

### Nice-to-Have Gaps

- A.1/A.2 wording tweak to avoid implying `cart` is the sole in-process caller.
- One-sentence Migration & Compatibility cross-reference to §A.3's reasoning.

---

## Verification Against This Repository

- **Promotions module status: confirmed greenfield.** No `packages/core/src/modules/promotions/` directory or any other promotion-related module code exists in this worktree.
- **Cart module status: also greenfield.**
- **Namespace collision claim verified**: `cart-module-fork.md` §10 confirms `POST /carts/:token/promotions` under base `/api/cart`, colliding with the pre-Amendment namespace exactly as §A.3 states.
- **DI service pattern precedent**: `packages/core/AGENTS.md` § Cross-Module Coupling documents the sanctioned optional-peer pattern (`tryResolve`), with real examples at `payment_gateways`, `shipping_carriers`, `inbox_ops`. Neither document states which pattern `cart`'s consumption of `promotionsService` should follow.
- **Command-pattern precedent**: `cart-module-fork.md` was independently caught and fixed for exactly this omission on 2026-08-17. SPEC-055's reservation/usage service layer has the identical shape and was not caught by an equivalent pass.

---

## Remediation Plan

### Before Implementation (Must Do)
1. Add `useCode` (and decide on `validateCode`) to §A.2's `PromotionsService` interface.
2. Fix the 8 leftover `/api/cart/*` / old-operation-name references.
3. Add an explicit Command-pattern classification statement to §A.2.
4. Add an explicit hard-vs-optional dependency statement to §A.2 for `promotions` relative to `cart`.

### During Implementation (Add to Spec)
1. Update the Final Compliance Report once the above decisions are made.
2. Cross-reference the future `checkout` spec's caller expectations for `registerUsage`/`revertUsage`/`useCode` back into §A.2.

### Post-Implementation (Follow Up)
1. Once implemented, `basis` on `ResolvedEffect` and the `PromotionsService` DI contract become FROZEN/STABLE — future additions must be additive.

## Recommendation

**Needs spec updates before implementation.** The Amendment's architecture is sound; outstanding items are a bounded, mechanical list (8 stale references, one missing DI method, two explicit-decision gaps), not a design rework.

---

## Changelog

### 2026-08-17
- Initial pre-implementation analysis, performed against fork PR #9 (`adeptofvoltron/open-mercato`, branch `spec/ecommerce-module-suite`) and this repo's `develop` worktree, per the `om-pre-implement-spec` skill workflow, scoped to the Amendment section.
