# Final gate — r5-ch0a-rate-limit-fail-closed

Runner: local mode (no compose `app` container).

| Check | Result |
|---|---|
| `yarn build:packages` → `yarn generate` → `yarn build:packages` | pass |
| `yarn workspace @open-mercato/checkout test` | pass — 47/47 suites, 408 passed, 1 skipped |
| `yarn workspace @open-mercato/checkout typecheck` | pass |
| Targeted: `rateLimiter` + `pay/[slug]` suites | pass — 66/66 |

- The brief names the gate as the checkout workspace test + typecheck; the repo-wide `validation.commands` (`yarn test`, `yarn build:app`, i18n checks) are left to CI. No i18n, UI, or app file changed.
- Integration suite: not run. No UI and no integration-test change; the `503` behaviour is covered at route level by the submit and verify-password route tests. Booting an app without a registered limiter needs an invalid `RATE_LIMIT_*` configuration, which the shared ephemeral environment does not offer.
- Design-system pass: not applicable (no UI touched).
- First test run failed one unrelated suite (`payPageContracts.backwardCompat`, `Cannot find module '#generated/entities.ids.generated'`) because `build:packages` ran before `generate` in the fresh worktree; the second `build:packages` fixed it.
