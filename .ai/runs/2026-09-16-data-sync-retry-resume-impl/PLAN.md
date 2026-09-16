# Plan — 2026-09-16-data-sync-retry-resume-impl

**Run mode:** Spec-implementation run
**Branch:** `jtomaszewski/data-sync-retry-vs-resume`
**Base branch:** `develop` — **on `fullstackhouse/open-mercato` (remote `fsh`), not upstream**
**Source spec:** `.ai/specs/2026-09-16-data-sync-retry-resume-actions.md` (§ Implementation Plan is authoritative)
**Prototype:** `.ai/prototypes/data-sync-retry-resume/`
**Design run that produced the spec:** `.ai/runs/2026-09-16-data-sync-retry-resume-spec/`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add `lib/resume-point.ts` and its unit tests | inline | done | pending |
| 1 | 1.2 | Render the resume point on the run detail page | inline | todo | — |
| 1 | 1.3 | Render the resume point in the list row menu | inline | todo | — |
| 1 | 1.4 | Relabel the `cancelled` primary action to Resume | inline | todo | — |
| 1 | 1.5 | Integration coverage `TC-DS-012` | dispatch | todo | — |
| 1 | 1.6 | Gate the action affordances on `data_sync.run` | inline | todo | — |
| 1 | 1.7 | Document the cursor-visibility contract for adapter authors | inline | todo | — |
| 2 | 2.1 | Add the overflow action and its confirm on the detail page | inline | todo | — |
| 2 | 2.2 | Hide the action when the adapter declares full sync inapplicable | inline | todo | — |
| 2 | 2.3 | Add the same action to the list row menu | inline | todo | — |
| 2 | 2.4 | Integration coverage `TC-DS-013` | dispatch | todo | — |
| 3 | 3.1 | Add the "Run again" action on completed runs | inline | todo | — |
| 3 | 3.2 | Seed the start form from `?from=<runId>` | inline | todo | — |
| 3 | 3.3 | Route the stale-parameter 422 to the prefilled form | inline | todo | — |
| 3 | 3.4 | Integration coverage `TC-DS-014` | dispatch | todo | — |

## Goal

Implement the retry / resume / run-again specification end to end, so that an operator can see where a
retry will resume before pressing it, deliberately replay a run from the start, and re-run a completed
run's settings without retyping them.

## Scope

- **New:** `packages/core/src/modules/data_sync/lib/resume-point.ts` and its unit tests.
- **Changed:** `backend/data-sync/runs/[id]/page.tsx`, `backend/data-sync/page.tsx`, both
  `page.meta.ts` files, the five `i18n/*.json` locale files, `data_sync/AGENTS.md`,
  `apps/docs/docs/framework/modules/integrations-data-sync.mdx`, `BACKWARD_COMPATIBILITY.md`.
- **New tests:** component tests beside both pages, integration specs `TC-DS-012`, `TC-DS-013`,
  `TC-DS-014`.

## Non-goals

Carried verbatim from the spec's § Non-goals — these are decided, not open:

- **No API contract change.** No new endpoint, request field, response field, status code or error code.
- **No schema change.** `sync_runs` gains no columns. The prefill therefore seeds only integration,
  entity type, direction and stored `parameters` — never `fullSync` or batch size.
- **No batch denominator** anywhere: "batch 41", never "batch 41 of ~118".
- **No new prop on a shared UI primitive.** The row menu's resume point goes inside
  `RowActionItem.label`, which is a `string`; `ConfirmDialog` gains no `body`/`children` slot.
- No cursor semantics, engine, or run-lifecycle change.
- No `retried_from_run_id`, `full_sync`, `batch_size`, `cancelled_by` column; no additive
  `retryStartCursor` field.

## The two traps this plan must not fall into

Both were found by the specification review that preceded it, and both are easy to reintroduce:

1. **Never render a "starts from the beginning" claim for a run that committed no batch.** The endpoint
   resolves `previous.cursor ?? resolveStartCursor(...)`, so it may still resume at a shared cursor.
   The copy stays non-committal, and "Retry from the beginning" stays **visible** in that case — it is
   the only control that guarantees a replay.
2. **Never gate the from-scratch action closed when the options fetch fails.** It fails **open**, to
   match `applicableStartControls`, whose documented default for an unknown entity type is "every
   control applies".

## Deviations from the skill's defaults

- **Target repository.** The PR goes to `fullstackhouse/open-mercato`, base `develop`. The user does
  not want this upstream yet; the prematurely-opened `open-mercato/open-mercato#6154` is closed.
- **Branch.** Continues on `jtomaszewski/data-sync-retry-vs-resume` rather than a fresh `feat/` cut, on
  the user's explicit instruction — the spec, prototype and design-run folder exist only there.
- **Spec and implementation share one PR.** `om-auto-implement-spec` normally keeps a spec PR
  design-only. The user asked for "a PR with the whole spec implemented", which overrides that default.
- **Worktree.** The session is already inside a linked worktree, so it is reused and nothing is created
  or cleaned up.

## Risks

| Risk | Mitigation |
|---|---|
| The resume-point line states a position the endpoint will not use | One pure helper feeds both surfaces; the `noCommittedBatch` case makes no positional claim at all |
| Client-side feature gating does not exist in this codebase | Step 1.6 is the only step that may need a new mechanism; if none exists it is re-scoped and reported rather than invented silently |
| The `?from=` seed is clobbered by the two existing reset effects | Step 3.2 implements the sequencing contract the spec spells out, and tests a late options resolution explicitly |
| Locale key drift across five files | `yarn i18n:check` runs in the final gate |

## External references

None. No `--skill-url` was passed.

## Implementation Plan

The spec's § Implementation Plan is authoritative and is not duplicated here. Each Step below names
only what this run adds to it.

### Phase 1 — Surface the resume point

- **1.1** Pure module first, no UI. Unit tests cover every status, the null cursor, and a non-null
  cursor with zero `batchesCompleted`.
- **1.2** Detail page: type fields, the line beneath the action row, the Started-from / Committed-through
  block for every state, locale keys in all five files.
- **1.3** List page: three fields on `SyncRunRow`, resume point folded into the Retry item's `label`.
- **1.4** `Resume` for `cancelled`, `Retry` for `failed`, on both surfaces.
- **1.5** `TC-DS-012`. Dispatched — a self-contained new file against an existing template.
- **1.6** Feature gating. Depends on what the research turns up about client-side feature resolution.
- **1.7** The adapter cursor-visibility contract line, plus the `BACKWARD_COMPATIBILITY.md` ADDITIVE row
  for `lib/resume-point.ts` (§2 type, §4 import path), following the `lib/start-controls.ts` precedent.

### Phase 2 — Retry from the beginning

- **2.1** Overflow + `useConfirmDialog` with a plain-text body; request through `useGuardedMutation`.
- **2.2** Adapter gating on the detail page, failing open.
- **2.3** The same on the list row menu, with no explanatory footnote.
- **2.4** `TC-DS-013`. Dispatched.

### Phase 3 — Run again

- **3.1** Completed-run action on both surfaces, navigating to `?from=<runId>`.
- **3.2** The seeding contract, including the ref guard, the suppressed reset effects, and the
  `router.replace` strip.
- **3.3** The `parametersStale` way out.
- **3.4** `TC-DS-014`. Dispatched.

## Verification

Full `validation.commands` gate at completion — this is a code change, so no docs-only shortcut — plus
the full integration suite and a UI pass with screenshots on the PR.
