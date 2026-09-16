# Data Sync — Retry vs Resume: requirements and story map

Derived from the "Retry vs Resume" design conversation and verified against the code on
`jtomaszewski/data-sync-retry-vs-resume`. This document is the input the prototype under
`.ai/prototypes/data-sync-retry-resume/` illustrates. It is **not** a spec — it fixes the
vocabulary and the per-state behavior so the prototype has something to be checked against.

## §1 Problem

`POST /api/data_sync/runs/[id]/retry` is a **resume**, labelled "Retry".

- The endpoint starts the new run from `previous.cursor` — the last committed batch cursor of
  the failed run — unless the body carries `fromBeginning: true`
  (`packages/core/src/modules/data_sync/api/runs/[id]/retry.ts:121`).
- Both UI call sites hardcode `fromBeginning: false`
  (`backend/data-sync/page.tsx:398`, `backend/data-sync/runs/[id]/page.tsx:273`).
  Nothing in the app ever sends the from-scratch flag.
- The run detail page renders neither `cursor` nor `initialCursor`, although the detail API
  returns both. An operator therefore has no way to learn that Retry resumes, nor from where.
- A full replay is reachable only through the **Start a run** form's "Run as full sync" switch,
  which does not inherit the failed run's stored `parameters` — the operator retypes them.
- The retry endpoint runs no `supportsStartControl('fullSync', entityType)` check, so it accepts
  `fromBeginning: true` even for entity types whose adapter declared full sync inapplicable.
  That is a server-side hole independent of any UI decision.

## §2 Decision being prototyped

Not two peer buttons named Resume and Retry — those are near-synonyms to an operator. The rare
action reads as a *modifier* of the common one:

| Run state | Primary | Overflow | Cursor sent |
|---|---|---|---|
| `failed`, `cancelled` | **Retry** | **Retry from the beginning** (confirm) · **Run again** | last committed batch / `null` |
| `completed` | **Run again** | — | n/a — navigates to the Start form |
| `running`, `pending` | **Cancel** | — | n/a |
| `paused` | — | — | vestigial status; nothing sets it today |

Three supporting rules:

1. **The resume point is shown before the button is pressed**, on the detail page and in the
   list row-action menu. This is the actual fix for the confusion, whatever the button shape.
2. **"Retry from the beginning" is gated on the adapter** — hidden in the UI and rejected by the
   endpoint when `supportsStartControl('fullSync', entityType)` is `false`.
3. **"Run again" needs no endpoint** — it navigates to the Start-a-run form prefilled from the
   run's integration, entity type, direction, and stored `parameters`.

## §3 Story map

### Epic A — Know what the button will do before pressing it

- **US-A1** As a sync operator looking at a failed run, I want the run detail page to tell me
  where a retry would resume from, so that I do not have to guess whether records will be
  reprocessed.
  - AC: a failed or cancelled run with a committed cursor shows the batch count and the cursor
    value verbatim, in a monospace face, next to the Retry action.
  - AC: a run that failed before committing any batch says so explicitly and states that Retry
    is equivalent to starting from the beginning.
  - AC: the cursor is never rendered for `pending` (nothing committed yet) or as a claim about
    a `completed` run's next run.
  - AC: an operator without `data_sync.run` sees the resume point but no action buttons.

- **US-A2** As a sync operator scanning the runs list, I want each row's action menu to name the
  effect rather than the verb alone, so that a one-click menu item cannot surprise me.
  - AC: the menu item reads "Retry (resume from batch N)" when a cursor exists.
  - AC: the list row menu never opens a destructive path without a confirm step.

### Epic B — Replay a run from scratch on purpose

- **US-B1** As a sync operator whose incremental run is producing wrong data, I want to re-run
  it from the very beginning, so that I can repair the dataset without retyping parameters.
  - AC: "Retry from the beginning" sits in the overflow menu, never as a peer of Retry.
  - AC: selecting it opens a confirm dialog naming the integration, entity type and the fact
    that the whole source is reprocessed.
  - AC: the dialog's confirm button is the only from-scratch path in the UI.
  - AC: the action is hidden entirely when the adapter declares `fullSync` inapplicable for that
    entity type, and the endpoint rejects it with 422 for a direct API caller.

- **US-B2** As a sync operator, I want a completed run's settings to seed a new run, so that
  "do that again" does not mean re-deriving parameters by hand.
  - AC: "Run again" navigates to the Start-a-run form with integration, entity type, direction,
    and every stored parameter prefilled.
  - AC: the form states which run it was seeded from and offers a link back to it.
  - AC: prefill drops parameters the adapter no longer declares, and says it did.

### Epic C — Fail honestly when a retry cannot happen

- **US-C1** As a sync operator, I want a rejected retry to explain itself in my language and
  point at the way out, so that a 422 is not a dead end.
  - AC: stale stored parameters (`code: 'parametersStale'`) surface as an error with a "Start a
    new run" affordance that lands on the prefilled form.
  - AC: an overlapping in-progress run surfaces as an error naming the run that blocks it, with
    a link to it.
  - AC: a from-scratch retry for an entity type that forbids full sync surfaces the adapter's
    restriction rather than a generic validation failure.

### Cross-cutting rules

- Every action is feature-gated on `data_sync.run`; `data_sync.view` sees state but no buttons.
- Retry always creates a **new** `SyncRun` row. No screen may imply the original row changes.
- Copy uses "resume"/"from the beginning" for mechanism and "Retry"/"Run again" for intent.
- All strings route through `useT()` in the implementation; the prototype hardcodes English.

## §4 Known gaps this document does not settle

- Whether the new run should link back to the run it retried (no `retriedFromRunId` column
  exists today), so the list cannot group a logical sync across its retry chain.
- Whether `paused` should be removed from the status union or finally be produced by something.
- Whether "Run again" should also appear on `failed` runs, or only `completed`. The prototype
  shows it on both; that is a rejectable proposal.
