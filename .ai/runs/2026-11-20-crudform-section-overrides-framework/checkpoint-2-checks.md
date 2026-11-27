# Checkpoint 2 — Resolver and ambient command lifecycle

Runner: local packages and isolated ephemeral Playwright app

| Check | Result |
| --- | --- |
| `yarn build:packages` | Pass |
| `yarn generate` | Pass |
| `yarn typecheck` | Pass |
| `yarn workspace @open-mercato/shared test --runInBand` | 3,562 passed, 35 skipped |
| `yarn check:client-boundaries` | Pass with existing advisory findings |
| `yarn template:sync` | Pass |
| `git diff --check` | Pass |
| `PW_CAPTURE_SCREENSHOTS=1 yarn test:integration:ephemeral TC-EXAMPLE-001` | 2 passed on `744cddf999` |
| Ambient custom entity and effect isolation review fixes | 30 focused tests and shared typecheck passed |

The Todo edit check verified notes-only saves, clearing empty custom fields, label hydration, and search token replacement. Its app build predates the engine-only review fix. [Playwright screenshots](https://github.com/open-mercato/open-mercato/pull/10067#issuecomment-7037126028).
