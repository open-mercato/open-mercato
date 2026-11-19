# Notify — 2026-11-19-r5-f4-base-currency-tx-connection

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-19T20:04:02Z — run started
- Brief: Re-landing step F4 — BaseCurrencyService reads on the caller's transaction connection; add baseCurrencyServiceFactory DI key.
- External skill URLs: none

## 2026-11-19T20:04:02Z — decision
- Binding plan .ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md missing everywhere; the user told the run to proceed autonomously, so it follows the brief, the spec and reference fd8452e911/bdb747c36a. The spec has no F4 slice row; the difference is logged in PLAN.md.

## 2026-11-19T20:12:53Z — final gate
- currencies tests 235/235 ✅, typecheck 42/42 ✅; integration and DS passes skipped (no API/UI change). Draft PR #10015.
