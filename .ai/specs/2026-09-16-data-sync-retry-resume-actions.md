# Data Sync — retry, resume, and run-again as three distinct operator actions

**Status:** skeleton — blocked on Open Questions
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

## 📝 Open Questions

**Q1 — Does the `retry` endpoint enforce `supportsStartControl('fullSync', entityType)`, and if so,
does `run` start enforcing it too?**

This is the one that blocks. `2026-09-02-data-sync-adapter-start-controls.md` decided the sibling
case explicitly and in the opposite direction:

> ### `POST /api/data_sync/run` — unchanged
> A client that posts `fullSync: true` for an entity type whose adapter declares the control
> inapplicable still gets a `null` start cursor. **This is a UI-applicability change, not a behaviour
> change** — covered by a test.

Its risk table reinforces the stance: the declaration is a statement about *the operator's form*, the
API deliberately keeps accepting the field so "a scripted or API client can still send it", and the
residual risk accepted is that "an adapter can misdeclare its own UI".

`fromBeginning: true` on `retry` and `fullSync: true` on `run` request the same thing — a `null` start
cursor — so whatever we choose should be the same for both:

- **(a) `retry` enforces, `run` stays permissive.** Delivers the prototype as drawn. Two sibling
  endpoints then disagree about what an adapter's declaration means, for no reason a caller can
  discover. Not recommended.
- **(b) Neither enforces — the declaration stays a UI concern.** Consistent with the merged decision,
  no contract change anywhere, and Phase 2 collapses into Phase 3 (hide the action in the UI, which
  Phase 3 does anyway). Cheapest, and reversible into (c) later.
- **(c) Both enforce.** Coherent, but it reverses an accepted decision, breaks `run` for any existing
  API caller relying on the documented escape hatch, and needs a deprecation window per
  `BACKWARD_COMPATIBILITY.md` §7 rather than a single spec line.

I recommend **(b)**, and I withdraw the "server-side hole" framing I used in the prototype and in my
summary of it — the permissiveness is a documented decision, not an oversight. Screen 4 note 3 and
screen 13's third alert are wrong as drawn and need correcting whichever way this lands.

**Q2 — One spec or two?**

Phase 1 (surface the resume point) is read-only, changes no contract, and ships and delivers value on
its own. Phases 3–4 (the new actions) are a separate deployable capability that depends on none of
Phase 1's code. Split into two specs, or keep one?

I recommend **one spec**: they are a single operator-facing capability — *understand and control how a
failed run is retried* — and the helper-line copy on screen 7 only reads correctly once the reader
knows the overflow exists. Splitting would leave the actions spec re-deriving the vocabulary.

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

One API change in total, and only under Q1(a)/(c). Everything else is already on the wire:

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

---

*Remaining sections — Architecture, API Contracts, UI/UX, Edge Cases, Risks & Impact Review, Phasing,
Implementation Plan, Testing, Changelog — are written once Q1 and Q2 are answered. Q1 determines
whether Phase 2 exists at all.*
