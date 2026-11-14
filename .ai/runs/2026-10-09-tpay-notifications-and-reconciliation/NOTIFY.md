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

## 2026-10-09T20:50:30Z — sandbox acceptance and final gate
- Live sandbox: notification-only capture, duplicate resend, reconciliation repair verified. Found: hash-shaped schedule ids rejected by scheduler trigger (fixed in provider; core fix via om-auto-fix-issue upstream), core webhook dedup index is non-unique (om-auto-fix-issue upstream), `mercato scheduler run` cannot resolve `queueService` (pre-existing, not addressed).
- Upstream: Tpay sessions open-mercato/open-mercato#7153, webhook extensions #7154 (CLA accepted by the user). Fork PRs #1/#2 closed with links.
- Tunnel container and ephemeral env stopped.
