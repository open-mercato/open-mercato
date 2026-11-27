# Final gate — r5-f2-subscriber-real-container

**Run:** 2026-11-19T22:30:14Z, local mode (no compose `app` container running).

## Brief gate
| Check | Result |
|---|---|
| `packages/shared` scopedContainer.test.ts | pass (5/5) |
| `packages/core` promotionsDiContainerScope.test.ts + forms invitation-email-source.test.ts (RL-11) | pass (6/6) |
| `packages/events` full suite | pass (17 suites, 180 tests) |
| `packages/cli` full suite | pass (126 suites, 2640 tests) |
| TC-FORMS-EXP-010 (`yarn test:integration:ephemeral TC-FORMS-EXP-010`) | pass (1 passed, 3.7m) |
| UPGRADE_NOTES.md entry | added |

## validation.commands
| Command | Result |
|---|---|
| yarn build:packages | exit 0 |
| yarn generate | exit 0 |
| yarn build:packages | exit 0 |
| yarn i18n:check-sync | exit 0 |
| yarn i18n:check-usage | exit 0 |
| yarn typecheck | exit 0 |
| yarn test | exit 1 — 49/51 turbo tasks ok; only `create-mercato-app#test` failed: 81/1253 cases, all in the live Codex/Claude agent-harness adapter / writable-oracle suites, which need local agent CLIs. Known to fail locally; this branch changes only a comment in the create-app template. Not re-measured on the base this run. |
| yarn build:app | exit 0 |

## Integration suite / DS pass
- Full integration suite not run: the change has no UI and no new API route. The brief names TC-FORMS-EXP-010 as the integration gate (passed above).
- DS pass skipped: no UI files touched.
