# Notify — 2026-10-09-tpay-notifications-and-reconciliation

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-09T17:52:53Z — run started
- Brief: implement Tpay notification settlement and status reconciliation up to (not including) live sandbox acceptance.
- Decisions (user-directed): stacked branch on fork PRs #1 and #2; tunnel handled later with the user.
- Decision: one PR for both specs.

## 2026-10-09T18:06:12Z — checkpoint 1
- Phase 1 (notification settlement) verified: package 260 tests, core payment_gateways 180 tests, typecheck, eslint, i18n green.
- Delegations: 1.1 and 1.3 standard executors, 1.2 capable executor.
- Decision: payment locator reads only `tr_crc`; malformed bodies with a valid `tr_crc` get `400 FALSE` (no infinite retries).
