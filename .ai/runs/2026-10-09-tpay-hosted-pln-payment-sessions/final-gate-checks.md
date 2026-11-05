# Final gate — tpay-hosted-pln-payment-sessions

- **Timestamp:** 2026-10-09T15:48:57Z
- **Head:** `71a6ed1e3` (all Tasks rows done)
- **Runner:** local (no Open Mercato app container); integration via ephemeral environment (Docker/OrbStack)

## Validation commands (in order)

| Command | Result | Notes |
|---------|--------|-------|
| `yarn build:packages` | ✅ pass | |
| `yarn generate` | ✅ pass | |
| `yarn build:packages` | ✅ pass | |
| `yarn i18n:check-sync` | ✅ pass | |
| `yarn i18n:check-usage` | ✅ pass | |
| `yarn typecheck` | ✅ pass | |
| `yarn test` | ❌ fail (pre-existing) | Only `@open-mercato/core` `progress/__tests__/progressService.test.ts` (2 tests, "Progress job job-1 not found") fails; the same suite fails in upstream CI "CI for Develop&Main" on `develop` `3b02dd5ee`, which this branch is based on, and this branch does not touch `progress`. Jest worker SIGSEGVs in `cli` and `channel-apns` were local flakes (suites pass in isolation). `gateway-tpay` (9 suites) and `checkout` (incl. 2 new submit-route tests) pass. |
| `yarn build:app` | ✅ pass | |

## Integration suite

- Full run `yarn test:integration:ephemeral`: 2459 passed, 40 failed, 3 flaky, 78 skipped (1.4h). The app stopped answering within timeouts from the `documents` specs onward; `TC-TPAY-001..003` failed at `POST /api/auth/login` (20s timeout) before reaching Tpay code. Other failures (`documents`, `scheduler`, `TC-START-001`, `TC-SALES-ADDR-CONTACT-002`, `TC-WF-037`) are outside this change and were not investigated.
- Scoped re-run on a fresh ephemeral app (`gateway-tpay`, `payment_gateways`, `checkout` specs): 111 passed, 2 failed, 1 skipped. `TC-TPAY-001`, `TC-TPAY-002`, `TC-TPAY-003` pass. The 2 failures (`TC-CHKT-EMAIL-001` "DATABASE_URL is not set", `TC-PGWY-024`) need direct DB access that the manual `npx playwright` invocation did not provide; both passed in the full ephemeral run with this branch's code.

## Design-system / style pass

Skipped: no UI-rendering files changed (`om-ds-guardian` not applicable).

## Not verified

- Live Tpay sandbox payment (no credentials): hosted request body without `pay`, redirect → `captured` path.
