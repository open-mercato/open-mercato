# Execution plan — r5-ch0a-rate-limit-fail-closed

- **Brief:** eComm Release 5 re-landing step CH0a — a fail-closed checkout route answers `503` when no rate limiter is registered.
- **Binding spec:** `.ai/specs/2026-03-19-checkout-simple-checkout.md` as on #9998 (`2025d4a181`): §3.2 item 1, §13, §14a row 14, §17 card CH0a.
- **Reference:** closed PR #8268 at `bdb747c36a`, diff base `b7b5309ccc`.
- **Branch:** `fix/r5-ch0a-rate-limit-fail-closed`, from `refs/remotes/pr/9998`; PR base `main` (stacked on #9998 and #9988).
- **Mode:** Spec-implementation run (linked spec).

## Tasks

| Phase | Step | Title | Exec | Status | Commit |
|---|---|---|---|---|---|
| 1 | 1.1 | `enforceCheckoutRateLimit` answers 503 under `fail-closed` without a limiter; rewrite the #5030 tests | inline | done | 05d89a21a8 |
| 1 | 1.2 | UPGRADE_NOTES: checkout half of "Rate limiting fails closed" | inline | done | 07c1d9e90e |

## Goal

`enforceCheckoutRateLimit` currently logs and skips the check when no `rateLimiterService` is registered, for both postures. Under `fail-closed` it must answer `503` instead; `fail-open` keeps skipping.

## Scope

- `packages/checkout/src/modules/checkout/lib/rateLimiter.ts` — only the `fail-closed` branch inside `if (!rateLimiter)` and the doc comment of `enforceCheckoutRateLimit`.
- Tests rewritten to expect `503`: `lib/__tests__/rateLimiter.test.ts`, `api/pay/[slug]/submit/__tests__/route.test.ts`, `api/pay/[slug]/verify-password/__tests__/route.test.ts`.
- `UPGRADE_NOTES.md` — the checkout half of "Rate limiting fails closed".

## Non-goals

- `keyOverride` and the session rate-limit configs → CH1b.
- `checkoutDeliveryOptionsRateLimitConfig` → CH2a.
- `checkoutSessionSubmitIpRateLimitConfig` → CH5a.
- The assisted-selling half of the upgrade note → AS5.

## Must keep

- `fail-closed` stays fail-closed when the limiter is absent, not only when it errors (f0fadba93d).
- `fail-open` reads (`checkoutPublicViewRateLimitConfig`, `checkoutStatusRateLimitConfig` callers) keep skipping.

## Audit findings and decisions for this step

- Audit `.ai/analysis/pre-implement-2026-03-19-checkout-simple-checkout-release-5.md` §14a-style row 7 (Warning): pay-link routes declared fail-closed answer `503` without a limiter; changes `POST /api/checkout/pay/[slug]/submit` and `/verify-password` and reverses #5030's tests. Remediation: recorded in spec §3.2 item 1 and §14a row 14 as an approved Phase A behaviour change, with an UPGRADE_NOTES entry.
- Audit S23: Phase A changes recorded (fail-closed 503 is one of them).
- Decision RL-7 (owner, 2026-11-19): accept `503` when no limiter is registered; settles the Ask First under `packages/checkout/AGENTS.md` and the public pay-page API contract.
- D-R5-CH1…CH8: none concern this step (order creation, payment selection, subscribers, delivery, service reads, money, trusted context, notifications).

## Deviations and notes

- The binding re-landing plan `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` was not present in the primary checkout, any git ref, or any worktree. Per the operator's instruction to continue autonomously, this run follows the brief and the spec's §17 card CH0a; rules R1–R14 and the plan's own CH0a card were not verified.
- Card vs spec: no difference found. The spec's §3.2 item 1 also names "every fail-closed session route"; those routes do not exist yet on this base and arrive with CH1b+, where they use the same helper.
- Reference port is verbatim for this slice; the three test files and `rateLimiter.ts` are unchanged between `b7b5309ccc` and the base, so the hunks apply as-is. The reference's `keyOverride` hunk is excluded (CH1b).

## Validation

- `yarn workspace @open-mercato/checkout test`
- `yarn workspace @open-mercato/checkout typecheck`
- No UI touched; no integration suite change (route behaviour covered by unit tests on both routes).

## Risks

- A deployment with an invalid `RATE_LIMIT_*` configuration (no `rateLimiterService` registered) now answers `503` on pay-link submit and password verification until the configuration is fixed. Accepted by RL-7; documented in UPGRADE_NOTES.
