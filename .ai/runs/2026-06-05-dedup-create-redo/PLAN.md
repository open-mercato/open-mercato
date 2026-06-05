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

- [x] `yarn build:packages` ✓
- [x] `yarn generate` ✓
- [x] `yarn typecheck` ✓ (21/21)
- [~] `yarn lint` — app-level ESLint rule-loading crash is pre-existing/env (unrelated; changes are in core/shared)
- [ ] `yarn i18n:check-sync` && `yarn i18n:check-usage`
- [x] unit tests ✓ — core 5428, shared 1162 (enterprise flaky worker-exit, green on re-run)
- [x] `currencies/__integration__/TC-CUR-REDO-409.spec.ts` ✓ 4/4 (ephemeral)
- [x] `customers/__integration__/TC-UNDO-003-redo-keeps-id.spec.ts` ✓ (ephemeral)
- [x] `customers/__integration__/TC-UNDO-004-bridge-undo.spec.ts` ✓ (ephemeral)

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
- [~] 2.4 `sales.configuration` (×5), `planner.availability-rule-sets`, `scheduler.jobs` — all skipped: cloneJson / mergeProviderSettings / fresh-timestamps-without-onCreate / non-column `custom` snapshot keys. Left as original custom seeds.

### Phase 3: Single-row migration — convertible hand-rolled redos → factory

_Status: framework hooks added (`95e1a88fe`). Converted: tags, labels, resource-types, customers/comments, resources/comments, sales/notes, staff/comments. All other hand-rolled redos enumerated as residual blockers in HANDOFF.md (multi-entity / no-deletedAt / no-side-effects / in-tx fixup / syncOrigin / bridges) — left as-is by design._

- [~] 3.1 `customers`: `tags`, `labels` → factory (Option A / explicit seed). `dictionaries` (upsert), `deals` (multi-entity), `comments`/`addresses`/`entity-roles`/`activities` left hand-rolled (relation validation, encryption, custom-field payload, deprecated bridge — see HANDOFF). `personCompanyLinks`, `todos` not yet evaluated. — 579711fe2
- [~] 3.2 `resources`: `comments`/`resource-types` evaluated, left hand-rolled (relation validation; custom-field on undo payload). `activities`/`resources`/`tag-assignments` not yet evaluated.
- [ ] 3.3 `staff`: `activities`, `addresses`, `comments`, `job-histories`, `tag-assignments` (single-row ones).
- [ ] 3.4 `sales`: `notes`, `payments`, `shipments`; `directory.organizations`, `feature_toggles.global` (only if cleanly single-row). Leave non-convertible cases as-is with a one-line note. Gate: typecheck.

### Phase 4: Multi-row migration — shared `buildXGraph` for execute + redo

- [x] 4.1 `customers.people` — extracted `buildPersonGraph(em, values)`; called from `execute` and `redo` recreate branch. — 319676f23
- [~] 4.2 `customers.companies` — skipped: create is interleaved with the surviving-row update branch (persists outside withAtomicFlush); not a clean extraction.
- [x] 4.3 `customers.interactions` — `buildInteractionGraph` shared by execute + redo. — 5f67773ff
- [~] 4.4 `catalog.products`/`variants` — skipped: redo already factors via `restoreCreatedRow` + `applyXSnapshot` (no duplicated create block).
- [~] 4.5 `sales.returns` skipped (recompute-vs-snapshot values + find-or-create header); `staff.team-members` skipped (already factored via seed). Gate: typecheck ✓.

### Phase 5: Full verification

- [ ] 5.1 Run the full verification gate (above) and tick its boxes.
- [ ] 5.2 Update the spec changelog with the implementation summary and any deviations.
