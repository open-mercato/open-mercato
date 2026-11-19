# Notify — 2026-11-19-r5-ca0-cart-lock-hardening

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-19T19:14:28Z — run started
- Brief: eComm Release 5 step CA0 — serialize cart.lock, line writes, login merge and merge undo on the per-cart advisory lock; guarded active → locked.
- External skill URLs: none

## 2026-11-19T19:14:28Z — decision: plan file missing
- .ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md not found anywhere; user instructed to proceed autonomously. Binding sources used: spec rev 10.1 (§8.1, §15 CA0, D-R5-CA*) and the brief's card.

## 2026-11-19T19:14:28Z — decision: status re-check order
- Line writes re-check assertCartNotLocked (423) before cart_not_active (409), per TC-CART-CONC-06; the reference checked 409 first.

## 2026-11-19T19:42:44Z — checkpoint 1
- Steps 1.1–2.1 done; cart unit, pg and typecheck green (checkpoint-1-checks.md).

## 2026-11-19T19:42:44Z — Playwright
- TC-CART-CONC-01-05 + TC-CART-PRICE-01-02 via `yarn test:integration:ephemeral`: 10 passed (4.7m). First attempt failed at initialize because dist predated `yarn generate`; rebuilt and reran.

## 2026-11-19T20:19:06Z — final gate
- Gate green except create-mercato-app#test (known local harness failure; package untouched). pg-integration 297 passed; Playwright 10 passed. Full Playwright suite skipped (brief names the two cart specs).
