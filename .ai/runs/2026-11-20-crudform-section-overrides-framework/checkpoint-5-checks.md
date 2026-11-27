# Checkpoint 5 — Framework fixture and compatibility gates

Runner: local. Checked `6f500849aa` with the configured base sync at `51e36458c5`. This checkpoint covers the test-only fixture, compatibility proof, and published authoring contract from Steps 4.1–4.4.

| Check | Exit | Evidence |
| --- | --- | --- |
| `yarn build:packages` | 0 | All package build tasks completed |
| `yarn generate` | 0 | Paired registries and OpenAPI generated with a clean diff |
| `yarn build:packages` after generation | 0 | All package build tasks completed |
| `yarn i18n:check-sync` | 0 | Locale keys synchronized |
| `yarn i18n:check-usage` | 0 | Usage check passed |
| `yarn typecheck` | 0 | Full repository typecheck passed |
| `yarn test` | 0 | All 51 workspace tasks completed after rerun |
| `yarn build:app` | 0 | Production application build passed |
| `yarn workspace @open-mercato/shared test --runInBand` | 0 | 3,609 passed, 35 skipped |
| `yarn workspace @open-mercato/shared build` | 0 | Shared build passed |
| `yarn workspace @open-mercato/ui test --runInBand` | 0 | 3,162 passed |
| `yarn workspace @open-mercato/ui build` | 0 | UI build passed |
| `yarn check:client-boundaries` | 0 | Advisory report emitted |
| `yarn template:sync` | 0 | Template and dependency parity passed |
| `git diff --check` | 0 | Clean whitespace check |
| `yarn workspace open-mercato-docs build` | 0 | Docusaurus build and rendered doc checks passed |
| `yarn agents:check-budget` | 0 | Root and nested instruction budgets passed |

The first `yarn test` attempt hit the Unix socket path limit in two `tsx` child-process tests. The same affected tests passed with a short temporary directory inherited through Turbo. Subsequent runs found implicit string sorts in the framework and six standalone context limits that needed the measured source deltas. The comparator follow-up preserved canonical ordering. The budget follow-up adjusted only five total-byte caps and one example root cap, preserving the prior margins and file allowlists. All 73 focused tests passed for that change.

An unchanged Promotions benchmark missed its threshold during the next run. It passed in isolation at 29.523 ms p95 against a 150 ms cap. The final unchanged `yarn test` run with short temporary paths passed all 51 workspace tasks. Core passed 30,476 and skipped 366 tests. The standalone package passed 1,262 and skipped six tests. CLI passed 2,681 tests.

The fixture tests exercise real manifests and browser runtime composition with stubbed transport. The CLI verifies descriptor drift, public gate compatibility and paired registry IDs. No new production-host flow is enabled in this checkpoint. The earlier [Todo browser evidence](https://github.com/open-mercato/open-mercato/pull/10067#issuecomment-7039635598) covers the default path. Phase 6 owns the configured Todo and persisted C3 browser cases.
