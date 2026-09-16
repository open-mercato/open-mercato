# Data Sync — retry, resume, and run-again as three distinct operator actions

**Status:** draft
**Module:** `packages/core/src/modules/data_sync`
**Related:**
`.ai/specs/2026-09-02-data-sync-adapter-start-controls.md` (§ `POST /api/data_sync/run` — unchanged),
`.ai/specs/2026-08-12-data-sync-run-scoped-cursor.md` (§ 2 — `resolveResumeCursor`),
`.ai/prototypes/data-sync-retry-resume/` (requirements, story map, and 13 reviewed screens)

## TLDR

`POST /api/data_sync/runs/[id]/retry` is a **resume**, labelled "Retry", and the UI never says so —
neither call site offers anything but `fromBeginning: false`, and the run detail page renders neither
`cursor` nor `initialCursor` although the API already returns both. This spec surfaces the resume
point wherever Retry is offered, adds a from-the-beginning retry behind an overflow and a confirm,
and turns "do that again" on a finished run into a prefilled start form rather than a retyping
exercise. Operator-facing throughout; the engine, the cursor semantics and the run lifecycle are
untouched.

## 📝 Decisions taken

Both questions this spec opened with were answered before it was written. They are recorded here
rather than deleted, because each one is a place a future reader will be tempted to change something
and needs to know why it is the way it is.

### D0 — Neither `run` nor `retry` enforces `supportsStartControl('fullSync', entityType)`

The adapter's start-control declaration stays what `2026-09-02-data-sync-adapter-start-controls.md`
made it: a statement about **the operator's form**, not about what the endpoint permits. That spec
settled the sibling case explicitly:

> ### `POST /api/data_sync/run` — unchanged
> A client that posts `fullSync: true` for an entity type whose adapter declares the control
> inapplicable still gets a `null` start cursor. **This is a UI-applicability change, not a behaviour
> change** — covered by a test.

Its risk table carries the same stance twice over: the API keeps accepting the field on purpose so
"a scripted or API client can still send it", and the residual risk it accepts is that "an adapter can
misdeclare its own UI".

`fromBeginning: true` on `retry` and `fullSync: true` on `run` request the identical thing — a `null`
start cursor — so they must answer identically. Making `retry` strict while `run` stays permissive
would leave two sibling endpoints disagreeing about what one declaration means, for no reason a caller
could discover from either. Making **both** strict is coherent but reverses an accepted decision and
breaks `run` for any API caller using the documented escape hatch, which needs a deprecation window
under `BACKWARD_COMPATIBILITY.md` §7 rather than a line in this spec.

**Consequences, which shape everything below:**

- This feature changes **no API contract at all**. No new status code, no new error code, no request or
  response field anywhere.
- The originally planned phase "server-side full-sync gate + a new `422 fullSyncUnsupported`" **does not
  exist**. Hiding the action for an entity type whose adapter declares full sync inapplicable is
  ordinary UI gating, and it belongs to Phase 2 alongside the action it hides.
- An earlier draft of this work, and the prototype as first drawn, described the missing check as a
  "server-side hole". **That framing is withdrawn** — the permissiveness is a documented decision, not
  an oversight. The prototype is corrected in the same change that lands this spec.

### D1 — One spec, not two

Phase 1 (surface the resume point) is read-only, changes no contract, and ships alone. Phases 2–3 (the
new actions) depend on none of Phase 1's code. They are nonetheless one specification, because they are
one operator-facing capability — *understand and control how a failed run is retried* — and because the
helper-line copy Phase 1 introduces only reads correctly once the reader knows the overflow menu
exists. Split, the actions spec would spend its first page re-deriving the vocabulary this one
establishes.

## 📝 Problem Statement

Verified on `jtomaszewski/data-sync-retry-vs-resume`:

- `api/runs/[id]/retry.ts:121` resolves the new run's start cursor as `previous.cursor ?? resolveStartCursor(...)`
  unless the body says `fromBeginning`, so a run that died at batch 40 resumes at batch 40.
- `backend/data-sync/page.tsx:398` and `backend/data-sync/runs/[id]/page.tsx:273` both hardcode
  `fromBeginning: false`. Nothing in the app sends the from-scratch flag.
- `api/runs/[id]/route.ts` returns `cursor` and `initialCursor`; the detail page's `SyncRunDetail` type
  declares neither and the page renders neither. **The operator has no way to learn that Retry resumes.**
- A full replay is reachable only through the start form's "Run as full sync" switch, which does not
  inherit the failed run's stored `parameters` — the operator retypes them by hand.
- `paused` is in the status union, the validator, the entity and the badge map, and nothing in
  `sync-engine.ts` or `sync-run-service.ts` ever writes it.

## 📝 Proposed Solution

Not two peer buttons named Resume and Retry — to an operator those are synonyms. The rare action is a
*modifier* of the common one, and the common one explains itself:

| Run state | Primary | Overflow | Resume-point line |
|---|---|---|---|
| `failed` | **Retry** | Retry from the beginning · — | "Resumes from batch 41 of ~118 — `<cursor>`" |
| `cancelled` | **Resume** | Retry from the beginning · — | "Resumes from batch 3 of ~26 — `<cursor>`" |
| `completed` | **Run again** | — | "Opens the start form with this run's settings" |
| `running` / `pending` | **Cancel** | — | — |
| `paused` | — | — | — (never produced; see Non-goals) |

Decisions already taken, carried from the prototype review:

1. `cancelled` reads **Resume**, not Retry — nothing went wrong, and the two states differ in intent.
   One conditional string, both on the detail page and in the row menu.
2. **"Run again" is offered on `completed` only.** On a failed run it is a near-duplicate of
   retry-from-the-beginning that differs only in offering an edit step.
3. **"Retry from the beginning" is hidden when no batch was committed**, where it is byte-for-byte the
   same request as the primary action.
4. The prefilled start form **copies the source run's `fullSync` faithfully** rather than defaulting it
   on. Guessing intent is how a prefill surprises someone.
5. The row-action menu carries **no** "this feed is delta-only" footnote; the detail page states it.

Items 2–5 reverse what the prototype draws. The prototype is the argument, not the conclusion; its
`.notes` flag each one as rejectable and its README lists them.

### Surface cost

Nothing. Under D0 there is no API change at all, and every value the new UI needs is already on
the wire:

| Need | Already available? |
|---|---|
| Detail resume point | `cursor`, `initialCursor`, `batchesCompleted` on `GET /api/data_sync/runs/[id]` |
| List row resume point | `cursor`, `initialCursor`, `batchesCompleted` on `GET /api/data_sync/runs` |
| `~118` denominator | Progress job `totalCount` — **detail only**; list rows show "batch 41" with no denominator rather than joining progress jobs into the list query |
| "Run again" prefill | `?from=<runId>` on `/backend/data-sync`; the start form fetches the run itself, so the list payload does not grow `parameters` |

## 📝 Non-goals

- Cursor semantics, engine behaviour, and the run lifecycle — untouched.
- Linking a retry to the run it retried. No `retried_from_run_id` column exists, so no screen can show
  a logical sync's true totals. Recorded as a known gap, not solved here.
- Deciding the fate of the vestigial `paused` status. Flagged for a separate issue.
- The schedule-level full-sync switch and `buildDefaultScheduleState`.
