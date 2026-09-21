# Checkpoint 1 — Phase 0 debt burn-down complete (steps 0.1–0.6)

- Date: 2026-07-28 (UTC) · Runner: local

| Step | Commit | Defect fixed |
|------|--------|--------------|
| 0.1 | 144e1d1da | A1 — `userTaskConfigSchema` stripped `assignedToRoles`/`formKey`/`allowedActions`, so Studio role assignment was silently discarded on save |
| 0.2 | 3427ae5b1 | A9 — naive duration regex turned `PT30M` into +1 day; consolidated onto the module's existing `lib/duration.ts` |
| 0.3 | caac9bcab | A4+A5 — `workflows.task.assigned` was declared and subscribed but never emitted; role-assigned tasks notified nobody; deep links pointed at a non-existent route |
| 0.4 | 74c515f22 | A6 — the inbox defaulted to "My Tasks" but never sent the filter, so it showed every task in the org |
| 0.5 | 9b39f0a68 | A8 — raw entity dump meant the enterprise "Review proposal" action read a field that was nested, silently doing nothing |
| 0.6 | f63c88a01 | Module MUST #1 — task routes imported lib functions instead of resolving `taskHandler` via DI |

## Checks

- **161 suites / 1983 tests passing** (`modules/workflows`), stable across three consecutive runs.
- `yarn typecheck` green across 22 packages; `yarn generate` no tracked churn; `yarn lint` clean.
- **Every step verified its tests bite**: the fix was stashed, the suite re-run, failures confirmed, then restored. For "this silently did nothing" fixes that check is the whole point — a test that passes against the broken code proves nothing.

## Corrections to the research briefing (verified against code, not assumed)

- **Role names are not spoofable.** The briefing (and my relay of it) called `auth.roles` "mutable and spoofable". It is derived server-side from the user's role records and never accepted from the client. The real exposure is narrower: a role **rename** orphans existing assignments. Deferring the names→ids migration is therefore a data-modelling cleanup, not a security fix.
- **Only two of the four `api/tasks/**` routes** imported the lib directly; the list and detail routes query the EM themselves and were left alone.

## Deliberate deferral

`assignedToRoles` stores role **names** end to end — `RolesMultiSelect` emits them, `step-handler` copies them, `claimUserTask` compares them, shipped `examples/*.json` carry them, and live `user_tasks` rows hold them. Migrating to ids means changing all of it plus a data migration and an authored-definition migration; changing only the query side would match nothing. Recorded as a PLAN risk rather than half-done.

## Note for step 1.2

The 0.5 serializer derives `proposalId`/`kind`/`priority`/`entityBindings` from `formSchema`, so promoting them to real columns in 1.2 will not break the wire shape.
