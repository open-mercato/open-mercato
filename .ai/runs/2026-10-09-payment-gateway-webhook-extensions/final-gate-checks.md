# Final gate — payment-gateway-webhook-extensions

- **Timestamp:** 2026-10-09T17:27:17Z
- **Head:** `208994d5c` (all Tasks rows done)
- **Runner:** local; integration via ephemeral environment

| Command | Result | Notes |
|---------|--------|-------|
| `yarn build:packages` | ✅ | |
| `yarn generate` | ✅ | |
| `yarn build:packages` | ✅ | |
| `yarn i18n:check-sync` | ✅ | |
| `yarn i18n:check-usage` | ✅ | |
| `yarn typecheck` | ✅ | |
| `yarn test --continue` | ❌ (pre-existing/flaky) | 45/47 tasks. `core/progressService` fails the same way in upstream CI on `develop`. `cli` module-facts suites and `core` staff `page.employeeMutations` failed under full-run load and pass in isolation (13/13, 2/2). `create-mercato-app` task passed (its `FAIL source-link-inventory` lines are negative-case fixtures). |
| `yarn build:app` | ✅ | |
| `payment_gateways` Jest after review fixes | ✅ | 180/180 |

## Integration

Scoped Playwright run on a fresh ephemeral app (`payment_gateways` + `checkout` specs, built before `208994d5c`; that commit only changes failure classification covered by unit tests): 108 passed, 2 failed. The failures (`TC-CHKT-EMAIL-001` "DATABASE_URL is not set", `TC-PGWY-024`) need direct DB access that a manual `npx playwright` run does not provide; both passed in the full ephemeral suite earlier today and do not touch the webhook route.

## Design-system pass

Skipped: no UI files changed.
