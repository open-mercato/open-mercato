# Deduplicate create-command / redo-handler logic (PR #2552)

| Field | Value |
|-------|-------|
| **Spec** | [`.ai/specs/2026-06-05-dedup-create-redo-handlers.md`](../../specs/2026-06-05-dedup-create-redo-handlers.md) |
| **PR** | #2552 |
| **Branch** | `fix/issue-2506-redo-create-keep-id` |
| **Started** | 2026-06-05 |
| **Goal** | Remove the create↔redo code duplication introduced by PR #2552 with zero behavior change. |

## Goal

Each undoable `*.create` command currently encodes its field set up to four times
(snapshot type, snapshot loader, redo seed/restore mapping, `execute` create
mapping). Declare the row mapping once and reuse it from both `execute` and
`redo`: snapshot-as-seed for single-row creates (delete `xSeedFromSnapshot`
helpers), and a shared per-command graph builder for multi-row creates. Pure
internal refactor — same ids, side effects, snapshots, undo tokens, tests.

## How to resume

1. Read this file, then the spec.
2. Find the first unchecked `[ ]` item in **Progress** and continue from there.
3. After each step: `- [x]` it and append ` — <commit sha>`. Do not rename titles.
4. Behavior must not change. Re-run `yarn typecheck` after every command file edit;
   run the full gate + the three integration specs at the end.

## Non-goals

- No change to the redo route, command bus, undo/snapshot plumbing, or the
  `CommandHandler.redo` contract.
- No change to which commands are undoable or to integration-test expectations.
- Do not migrate intentional delegating redos (e.g. `customers.todos` →
  `customers.interactions`).

## Verification gate (run at completion)

- [ ] `yarn build:packages`
- [ ] `yarn generate`
- [ ] `yarn typecheck`
- [ ] `yarn lint`
- [ ] `yarn i18n:check-sync` && `yarn i18n:check-usage`
- [ ] shared unit tests (`yarn workspace @open-mercato/shared test`)
- [ ] `currencies/__integration__/TC-CUR-REDO-409.spec.ts`
- [ ] `customers/__integration__/TC-UNDO-003-redo-keeps-id.spec.ts`
- [ ] `customers/__integration__/TC-UNDO-004-bridge-undo.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Framework — snapshot-as-seed in `makeCreateRedo`

- [x] 1.1 Make `seedFromSnapshot` and `getSnapshotId` optional in `CreateRedoConfig`; default `getSnapshotId` to `(s) => s.id`. — 74219116d
- [x] 1.2 Add `dateFields?: string[]` and a default date-reviving seed (clone snapshot, convert declared/common date keys from ISO string to `Date`); override wins when `seedFromSnapshot` is provided. — 74219116d
- [x] 1.3 Add `serializeRowSnapshot(entity, { dateFields })` helper for clean 1:1 column-copy loaders. — 74219116d
- [x] 1.4 Add shared unit tests for the default seed, `dateFields`, and `getSnapshotId` default. Gate: `build:packages` + shared unit + typecheck. — 74219116d

### Phase 2: Single-row migration — existing `makeCreateRedo` callers

- [x] 2.1 `currencies.currencies`, `currencies.exchange_rates` — dropped `seedFromSnapshot` (exchange_rates declares `date`). — 5e81e2454
- [x] 2.2 catalog: `priceKinds`, `optionSchemas` → snapshot-as-seed (Option A). `prices`/`offers`/`categories`/`productUnitConversions` left as-is (execute resolves relation entities vs redo id; hierarchy rebuild) — not cleanly dedupable. — 145061e7f
- [x] 2.3 staff: `teams`, `team-roles` → snapshot-as-seed (Option A). `leave-requests`/`timesheets-projects`/`timesheets-entries` left as-is (resolved-entity relation / defensive `?? default` casts). — 145061e7f
- [ ] 2.4 `sales.configuration`, `planner.availability-rule-sets`, `scheduler.jobs`. Gate: typecheck + affected unit tests.

### Phase 3: Single-row migration — convertible hand-rolled redos → factory

- [ ] 3.1 `customers`: `tags`, `labels`, `dictionaries`, `entity-roles`, `deals`, `comments`, `addresses`, `personCompanyLinks`, `activities` (only where single-row + clean snapshot).
- [ ] 3.2 `resources`: `activities`, `comments`, `resource-types`, `resources`, `tag-assignments` (single-row ones).
- [ ] 3.3 `staff`: `activities`, `addresses`, `comments`, `job-histories`, `tag-assignments` (single-row ones).
- [ ] 3.4 `sales`: `notes`, `payments`, `shipments`; `directory.organizations`, `feature_toggles.global` (only if cleanly single-row). Leave non-convertible cases as-is with a one-line note. Gate: typecheck.

### Phase 4: Multi-row migration — shared `buildXGraph` for execute + redo

- [x] 4.1 `customers.people` — extracted `buildPersonGraph(em, values)`; called from `execute` and `redo` recreate branch. — 319676f23
- [ ] 4.2 `customers.companies` — extract `buildCompanyGraph`.
- [ ] 4.3 `customers.interactions` — extract shared interaction graph builder.
- [ ] 4.4 `catalog.products`, `catalog.variants` — extract shared graph builders.
- [ ] 4.5 `sales.returns`, `staff.team-members` — extract shared graph builders. Gate: typecheck + `customers.people` redo integration smoke.

### Phase 5: Full verification

- [ ] 5.1 Run the full verification gate (above) and tick its boxes.
- [ ] 5.2 Update the spec changelog with the implementation summary and any deviations.
