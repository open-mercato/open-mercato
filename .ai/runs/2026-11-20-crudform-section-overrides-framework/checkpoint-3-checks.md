# Checkpoint 3 — Section persistence and server routes

Runner: local

| Check | Result |
| --- | --- |
| `yarn build:packages`, `yarn generate`, `yarn typecheck` at `2ce5c71565` | Pass |
| CLI rebuild, generation, repository typecheck and whitespace check after outbox review | Pass |
| `yarn check:client-boundaries` and `yarn template:sync` | Pass |
| Local sink implementations and review regressions | 266 focused tests, followed by 56 review tests |
| Derived route implementations and review regressions | 148 focused tests, followed by 146 review tests |
| Outbox implementation and durable recovery review regressions | 172 focused tests, followed by 166 review tests |
| Opt-in field contracts and legacy UI resource identity | 36 focused tests, UI build and typecheck |

The browser application layout and rendered flow stayed the same through these steps. Production-host adapters, actual mirror migrations, and the new Todo browser flows are scheduled for the later showcase step.

The generated adapter uses exact static source route binding and an explicit delete mode. A combined update/delete declaration requires the same feature grants. Sink undo rechecks the current accepted feature contract and revision. Sink-bearing redo requires an atomic redo contract. External persistence uses one scoped mirror identity across form variants.
