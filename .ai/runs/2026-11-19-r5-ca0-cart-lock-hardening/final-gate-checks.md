# Final gate — r5-ca0-cart-lock-hardening

**Runner:** local mode (no compose `app` container running).

## validation.commands
| Command | Result |
|---------|--------|
| `yarn build:packages` | ✅ |
| `yarn generate` | ✅ |
| `yarn build:packages` | ✅ |
| `yarn i18n:check-sync` | ✅ |
| `yarn i18n:check-usage` | ✅ |
| `yarn typecheck` | ✅ |
| `yarn test` | ❌ only `create-mercato-app#test`: harness suites (`agent-harness-*`, `*-oracles`) shell out to the live `codex`/`claude` CLIs and a scaffolded `yarn typecheck` against a 120 s budget; known local failure (see the agent memory note), package untouched by this PR. The abort stopped `@open-mercato/core#test`, so I reran `turbo run test --filter='!create-mercato-app' --continue`: 44/45 passed; core 2,938 suites / 30,184 tests passed. The one rerun failure was `ai-assistant` `package-exports.test.ts` taking 46 s under the higher concurrency; in the gate run the full `ai-assistant` suite (2,668 tests) had passed. |
| `yarn build:app` | ✅ |

## Step gate (brief)
| Check | Result |
|-------|--------|
| Core unit tests | ✅ (above) |
| `OM_PG_INTEGRATION=1 yarn workspace @open-mercato/core test:pg-integration` | ✅ 24 suites, 297 tests (includes `statusTransitionRaces` and `promotionContext`) |
| Playwright `TC-CART-CONC-01-05`, `TC-CART-PRICE-01-02` (`yarn test:integration:ephemeral`) | ✅ 10 passed (4.7m) |

## Integration suite
Full Playwright suite not run (~53 min locally); the brief names the two cart specs above as the gate. No template-synced surface touched, so `test:create-app:integration` does not apply.

## Design-system pass
Skipped — no UI file touched.
