# Checkpoint 1 — Data-only contract and discovery

Runner: local

| Check | Result |
| --- | --- |
| `yarn build:packages` | Pass, 42 tasks |
| `yarn generate` | Pass, paired server facts and browser runtime outputs present |
| Focused shared override, fact-boundary and handle tests | Pass, 11 tests |
| Focused CLI paired-registry tests | Pass, 8 tests |
| `yarn check:client-boundaries` | Pass |
| `yarn template:sync` | Pass |
| `yarn agents:check-budget` | Pass |
| `git diff --check` | Pass |

The full shared workspace run at Step 1.1 passed 3,475 tests with 35 skips. Phase 1 changes no rendered flow, so the checkpoint has no browser or integration evidence.
