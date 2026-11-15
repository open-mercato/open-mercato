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

## Overview

Three source files change behaviour, one of them new — a shared pure helper that turns a run row into
a sentence about what a retry would do, plus the two pages that render it. Around that sit five locale
files, two documentation files, three new integration specs and the component tests, so the diff is
roughly a dozen files even though the behavioural surface is three.

No entity, column, migration, snapshot, endpoint, request field, response field, status code or error
code changes anywhere. That is a constraint the design was cut back to satisfy, not a happy accident —
§ Surface cost lists the three things an earlier draft promised that the data model cannot support.

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

### Scope — one spec, not two

This is a scope decision, deliberately left unnumbered so it cannot be confused with the design
decisions **D1**–**D7** below. Phase 1 (surface the resume point) is read-only, changes no contract, and
ships alone. Phases 2–3 (the new actions) depend on none of Phase 1's code. They are nonetheless one specification, because they are
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
| `failed` | **Retry** | Retry from the beginning | "Resumes from batch 41 — `<cursor>`" |
| `cancelled` | **Resume** | Start from the beginning | "Resumes from batch 3 — `<cursor>`" |
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
4. The prefilled start form seeds **only what the run actually stores** — integration, entity type,
   direction, and the stored `parameters`. It does not seed `fullSync` or batch size, because
   `sync_runs` persists neither: `fullSync` is consumed by `api/run.ts` to pick a start cursor and
   thrown away, and `batchSize` reaches the queue payload only. Both controls render at their form
   defaults, and the banner says which fields were seeded so the operator is not left guessing.
5. The row-action menu carries **no** "this feed is delta-only" footnote; the detail page states it.

Two smaller decisions (**D6** and **D7**), settled the same way:

6. **The list gains no "resumed from" column.** It would spend a column on a value that is null for
   every row that is not `failed` or `cancelled`. The run detail page carries it instead (**D8**).
7. **Nothing renders in the resume-point slot for a non-retryable state.** An earlier draft carried a
   greyed "Retry becomes available if this run fails or is cancelled" placeholder on running runs; the
   line is a statement about a retry that could actually happen, and there is none.

One decision (**D8**) was taken later, against a running instance rather than on paper:

8. **The resume point does not appear in the runs list at all** — not as a column (**D6**), and not
   folded into the row-menu label either. `RowActions` renders each `RowActionItem.label` as the sole
   child of a **fixed-width** (`w-44`, 176px) button whose base class includes `whitespace-nowrap`
   (`packages/ui/src/primitives/button.tsx:7`), so a label past roughly 22 characters does not wrap —
   it overflows the menu's border and background and paints over the page. Every label this feature
   added exceeded that budget in at least one locale; the German `noCommittedBatch` form runs to 64
   characters. The row menu therefore names the action alone (**Retry** / **Resume** / **Run again…**),
   and the run detail page is the single surface that states a resume position. See the Changelog entry
   for 2026-09-17.

Items 2–7 reverse what the prototype originally drew. The prototype was the argument, not the
conclusion — it has been redrawn to match these decisions in the same change that lands this spec, and
each redrawn screen's notes record what changed and why.

### Surface cost

No API change — but only because the design was cut back to what the data model actually holds:

| Need | Status |
|---|---|
| Detail resume point | ✅ `cursor`, `initialCursor`, `batchesCompleted` already on `GET /api/data_sync/runs/[id]` |
| List row resume point | ✅ the same three fields already on `GET /api/data_sync/runs` |
| A batch denominator ("of ~118") | ❌ **not derivable** — `totalCount` estimates source records, not batches, and batch size is not persisted. Dropped; § Architecture 1b |
| Prefilling `fullSync` / batch size | ❌ **not stored** — `sync_runs` has neither column. Dropped from the prefill |
| A truthful start position when the run committed no batch | ❌ **not on the run row** — it is the endpoint's `resolveStartCursor` fallback. Would need an additive `retryStartCursor` field; declined, see § Non-goals |
| "Run again" prefill of what *is* stored | ✅ `?from=<runId>`; the start form fetches the run itself, so the list payload does not grow `parameters` |

Three of those six are things an earlier draft promised and the data cannot support. Each is now a
stated limitation rather than a silent one.

## 📝 Architecture

### 1. `lib/resume-point.ts` — new, pure, isomorphic

The one piece of new logic. It turns a run row into a discriminated descriptor of what a retry of that
run would do, and both pages render from it. Pure and dependency-free so it is unit-testable without a
DOM or a container, and shared so the list row and the detail page cannot drift into telling an
operator two different stories about the same run.

```ts
export type ResumePoint =
  | { kind: 'none' }                                     // not a retryable state
  | { kind: 'noCommittedBatch' }                         // retryable, but this run committed nothing
  | { kind: 'resumes'; batchesCompleted: number; cursor: string }

export function resolveResumePoint(run: {
  status: SyncRunStatus
  cursor: string | null
  batchesCompleted: number
}): ResumePoint
```

Rules it encodes, in one place rather than twice:

- `failed` and `cancelled` are the only retryable states; everything else is `{ kind: 'none' }`.
- A retryable run whose `cursor` is `null` is `{ kind: 'noCommittedBatch' }`.

**What this function must never claim.** An earlier draft called that third case `fromBeginning` and
rendered "Retry starts from the beginning". That is false, and dangerously so. The endpoint resolves:

```ts
// api/runs/[id]/retry.ts:121
const cursor = parsedBody.data.fromBeginning
  ? null
  : previous.cursor ?? await resolveStartCursor({ ... })
```

`resolveStartCursor` reads the **shared** `sync_cursors` row (or, for an adapter that opted out, this
entity type's own last run) — state the run row does not carry. So a run that died on its first batch
can still resume at a shared cursor written by an earlier successful run, silently skipping everything
before it. That is the exact class of silent partial import `2026-08-12-data-sync-run-scoped-cursor`
exists to prevent, and a UI sentence promising "from the beginning" would send an operator straight
into it.

The run row alone therefore **cannot** predict the effective start position for this case, and this
spec does not pretend otherwise: the copy says only what the row knows, and the from-scratch action
stays available so an operator who needs a guaranteed replay has one. Surfacing the server-resolved
start position as an additive `retryStartCursor` response field would let the UI be precise here; it is
a contract change, it is not needed for the rest of the feature, and it is recorded in § Non-goals as
the follow-up that would close this gap.

### 1b. Why there is no "of ~118" denominator

An earlier draft rendered "batch 41 of ~118", taking the total from the progress job's `totalCount`.
`totalCount` is set from `batch.totalEstimate` (`lib/sync-engine.ts:768`) and estimates **source
records**, not batches. Converting records to batches needs the run's batch size, which `sync_runs`
does not store, and adapter batches need not be uniform in any case. The denominator is therefore not
derivable from anything that ships today, and every surface renders the batch number alone.

### 2. `backend/data-sync/runs/[id]/page.tsx` — the detail page

- `SyncRunDetail` grows `cursor: string | null` and `initialCursor: string | null`. The API has
  returned both since `2026-08-12-data-sync-run-scoped-cursor`; the type simply never declared them.
- A resume-point line renders beneath the header action row, from `resolveResumePoint`.
- The header action area becomes state-dependent per the table in § Proposed Solution, with an overflow
  menu that exists only when it has an item.
- "Retry from the beginning" routes through `useConfirmDialog` before it posts.
- The Progress card gains a two-cell block — **Started from** (`initialCursor`) and **Committed
  through** (`cursor`) — rendered for every state, including `completed`. These describe *this* run's
  own record and are deliberately not phrased as a claim about a future retry; the resume-point line
  above is the only sentence about the next run.

### 3. `backend/data-sync/page.tsx` — the list page

- `SyncRunRow` grows the same two fields, from the same already-shipped list payload.
- Each row's `RowActions` menu is derived from the same `resolveResumePoint` call, so a row's sub-label
  and the detail page's helper line are generated by one function.
- The page reads `?from=<runId>` on mount and, when present, fetches that run and seeds the start form.

### 4. The confirm dialog — canonical primitive, plain-text body

`useConfirmDialog()` from `@open-mercato/ui/backend/confirm-dialog` is the project's confirmation
mechanism and this spec uses it unchanged. Its `ConfirmDialogOptions` carries `title`, `text`,
`confirmText`, `cancelText` and `variant` — `text` is a **string**, and neither `ConfirmDialogOptions`
nor `ConfirmDialogProps` exposes a `children` or `body` node slot.

The prototype drew a richer body: a warning callout plus a two-cell comparison of the batch a resumable
retry would start at against the batch this one starts at. **That body is not expressible through the
canonical primitive**, so this spec collapses it into `text` — multi-sentence prose naming the record
count, the batch the resumable retry would have started at, and the batch this retry starts at. The
information survives; the layout does not.

Adding a `body?: React.ReactNode` slot to `ConfirmDialog` would be an additive change to a shared UI
primitive under `BACKWARD_COMPATIBILITY.md` §2, and it is deliberately **not** proposed here: one
feature's dialog copy is not enough reason to grow a shared contract, and the option stays open
additively if a second caller ever wants it.

`variant` stays `"default"`, not `"destructive"`. Nothing is deleted — a full replay matches and
updates existing records — and spending the destructive styling here devalues it on Cancel run, which
is the genuinely destructive action on the same page.

## 📝 Data Models

None. No entity, column, migration, or `.snapshot-open-mercato.json` change.

The run row carries exactly five fields this feature reads — `status`, `cursor`, `initialCursor`,
`batchesCompleted`, `parameters` — and the design is deliberately bounded by that list. Three columns
are **not** added, each of which would have made some part of the design nicer:

| Not added | What it would have enabled | Why not here |
|---|---|---|
| `full_sync`, `batch_size` | Prefilling both controls from the source run | Additive columns plus a migration, a snapshot update and two response fields — a materially different spec for a convenience |
| `cancelled_by` | "Cancelled by Anna Nowak" instead of "Cancelled at 21:41" | Same, for one banner |
| `retried_from_run_id` | Showing a retry chain as one logical sync with true totals | Same, and it needs its own design for how the chain is presented |

## 📝 API Contracts

**No contract changes.** Not one endpoint, request field, response field, status code, or error code.
This is a consequence of **D0** and it is the main reason the feature is small.

### `GET /api/data_sync/runs/[id]` — unchanged, already sufficient

Returns `cursor`, `initialCursor` and `batchesCompleted` today, plus a nested `progressJob` carrying
`totalCount`. The detail page's TypeScript type omits the two cursor fields; adding them to the type is
a client-side correction, not an API change.

### `GET /api/data_sync/runs` — unchanged, already sufficient

Returns `cursor`, `initialCursor` and `batchesCompleted` per row. It does **not** return `parameters`,
and it does not need to — see the next section.

It also does not return a progress job, so a list row has no batch total. Neither surface carries a
denominator: the row names the action alone (**D8**) and the detail page states the batch number
without "of ~118" (§ Architecture 1b). Joining progress jobs into the list query to recover a
denominator is rejected regardless: it would add a query per page render to put an approximate number
where the operator can get an exact one by opening the run.

### `POST /api/data_sync/runs/[id]/retry` — unchanged

`retrySyncSchema` already accepts `fromBeginning: boolean` with a `false` default, and the route
already resolves `null` for a from-scratch retry. The UI starts sending `true` for the first time; the
endpoint needs no change to receive it. Per **D0** it does not gain a `supportsStartControl` check.

### `POST /api/data_sync/run` — unchanged

Still the endpoint the prefilled start form posts to, with the body the form already builds.

### `?from=<runId>` on `/backend/data-sync` — a route parameter, not an API contract

"Run again" navigates to `/backend/data-sync?from=<runId>`. The start form reads the parameter, fetches
`GET /api/data_sync/runs/<runId>`, and seeds itself from the response.

Why a query parameter and not router state: it survives a reload, it is linkable and pasteable into a
ticket, and it keeps the prefill out of component state that a navigation would drop. Why the form
fetches rather than the caller passing the data: it keeps the list payload from growing a `parameters`
field for the sake of one button, and it means the detail page and the list row navigate identically.

An unknown, unreadable, or cross-tenant `runId` is not an error state — the tenant-scoped fetch simply
returns nothing and the form renders its normal empty defaults, exactly as a direct visit to
`/backend/data-sync` does. See § Edge Cases.

## 📝 UI/UX

Only what is unique to this feature. The page scaffolding, `DataTable`, `RowActions`, `FormHeader` and
flash-message behaviour are unchanged and not re-documented.

### The resume-point line

**It renders on the run detail page only** — one line beneath the header action row — in two forms
depending on what `resolveResumePoint` returns:

| `ResumePoint` | Detail page |
|---|---|
| `resumes` | "Resumes from batch 41 — `updated_at:2026-09-12T04:15:07Z`" |
| `noCommittedBatch` | "This run committed no batch. Retry starts from this feed's last saved position, which may be earlier than this run began." |
| `none` | not rendered |

**The runs list does not carry it, in any form** (**D8**). An earlier draft folded it into the row
item's own label — `RowActionItem.label` is a `string` with no `description` or `ReactNode` slot
(`packages/ui/src/backend/RowActions.tsx:8`), the same constraint § Architecture 4 hits with
`ConfirmDialog` — on the assumption that collapsing the copy was the cheap way out, as `US-A2`'s own
wording ("Retry (resume from batch N)") had assumed. It is not: that label is the sole child of a
**fixed-width** `w-44` menu whose items are `whitespace-nowrap`, so the collapsed string overflowed the
menu box instead of fitting in it. The row menu names the action alone, and `resolveResumePoint` has
exactly one caller — the detail page.

**The `noCommittedBatch` copy is deliberately non-committal**, for the reason § Architecture 1 gives:
the run row cannot predict where the endpoint's fallback will land. Saying less is the only honest
option without the additive `retryStartCursor` field this spec declines to add.

The list column shows no batch denominator and neither does the detail page — § Architecture 1b.

The cursor is rendered verbatim in a monospace face and is never paraphrased, truncated or
prettified. It is an adapter-defined opaque string — a watermark here, an id or a page token elsewhere
— and it is the only value an operator can paste into a support ticket.

### Actions per state

Per the table in § Proposed Solution. Three rules govern the shape rather than the contents:

- The primary action is a single click with **no confirm**. It is additive and safe, and demanding a
  dialog for the common path is what teaches operators to dismiss dialogs unread.
- The overflow menu renders only when it has at least one item. A `completed` run therefore shows one
  button and no `⋯` — an overflow holding zero or one item is worse than none.
- An action that does not apply is **absent, not disabled**. A disabled control invites a hunt for the
  permission that would enable it; these are properties of the run and the adapter, not of the operator.

`cancelled` runs read **Resume** rather than Retry (**D1**). Nothing went wrong — the operator stopped
it — and "Retry" misdescribes that. This is one conditional string in two places, and it is the only
point in this design where two different words are justified.

### "Retry from the beginning" — visibility and confirm

Hidden in two cases:

1. The run is not `failed` or `cancelled` — there is nothing to retry.
2. `applicableStartControls(integration.startControls, entityType).fullSync === false` — the adapter
   declares a full replay meaningless for this entity type. The list page already resolves this map for
   the start form; the detail page fetches `GET /api/data_sync/options` to resolve it the same way,
   which is the same call it already makes to resolve run-parameter labels.

Case 2 is **UI gating only**. Per **D0** the endpoint still accepts `fromBeginning: true` from a direct
API caller, by design. The row menu carries no explanatory footnote about it (**D5**); the detail page
states the restriction in a line beneath the actions, where there is room for a sentence.

The confirm dialog names the cost concretely rather than asking "Are you sure?" — the record count
(`progressJob.totalCount`, the source-record estimate, omitted from the copy when it is null rather
than guessed at), the batch a resumable retry would have started at, and the batch this one starts at — as prose in
`ConfirmDialogOptions.text`, per § Architecture 4. `variant` is `"default"`. `Cmd/Ctrl+Enter` submits
and `Escape` cancels; both come free with the primitive and both are required.

### "Run again" and the prefilled start form

Offered on `completed` runs only (**D2**). On a failed run it would differ from "Retry from the
beginning" only in offering an edit step, which is not worth a second near-identical menu item on the
state where the menu is already longest.

It navigates to `/backend/data-sync?from=<runId>`, and the start form:

- seeds integration, entity type, direction, batch size, and every stored parameter the adapter still
  declares;
- copies the source run's `fullSync` value **faithfully** (**D4**) rather than defaulting it on. A
  prefill that quietly changes a setting is how a prefill surprises someone, and an operator who wants
  a full replay can tick the switch that is right there;
- renders an information banner naming the run it was seeded from, linking back to it;
- renders a warning when normalizing the stored parameters dropped a key the adapter no longer
  declares, naming the dropped key. The retry endpoint already drops such keys silently — here there is
  a form in front of the operator, so silence would be a choice rather than a constraint;
- submits nothing on arrival. Prefill is not a trigger.

**Sequencing is part of the contract, not an implementation detail.** `backend/data-sync/page.tsx`
already runs an effect keyed on `[selectedIntegration]` that unconditionally overwrites direction and
coerces the entity type, and a second that resets `paramValues` once the adapter's declaration
resolves. Options load asynchronously, so a seed applied on mount lands *before* both and is silently
overwritten — a form that flashes prefilled and then is not, and a bidirectional adapter's `export` run
seeded as `import`. The implementation must therefore:

- seed exactly once, **after** the options response resolves for the target integration, behind a ref
  guard;
- suppress both reset effects while a seed is pending;
- strip `?from=` via `router.replace` once applied, so a re-render or a back-navigation cannot re-seed
  over the operator's edits;
- treat a malformed id identically to an unknown one. A non-UUID `?from=` answers `400 Invalid run id`,
  not `404` — both render the plain form.

### Accessibility

Three things this design needs that the surrounding pages do not already provide:

- The `⋯` overflow gets an accessible name (`aria-label`), since it has no text.
- The resume-point line is associated with the action it describes via `aria-describedby`, so a screen
  reader reaching the Retry button hears where it would resume before activating it. A visually
  adjacent line is not an association.
- A cursor is an adapter-defined string of unbounded length and § UI/UX forbids truncating it. It
  therefore wraps rather than overflowing, and the detail page's layout must survive a several-hundred
  character value without pushing the action row off-screen.

### Permissions — new work, not an existing behaviour

**Today neither page gates anything on `data_sync.run`.** `backend/data-sync/page.meta.ts:12` and
`backend/data-sync/runs/[id]/page.meta.ts:3` both declare `requireFeatures: ['data_sync.view']`, and
neither page reads granted features anywhere. A viewer currently sees Retry, Cancel and the whole start
form, and receives a 403 on click. The API routes are correctly gated (`api/runs/[id]/retry.ts:21`
requires `data_sync.run`); the pages are not.

This spec does not inherit that behaviour, it adds it. Both pages resolve `data_sync.run` from the
granted feature set and render no action affordance without it — a holder of `data_sync.view` alone
sees every state, every counter and the full resume-point line, because the line is a statement about
the run rather than an affordance. Phase 1 Step 1.6 implements it, and it is the one part of this spec
that changes behaviour for an existing role rather than adding a new control.

### i18n

Every new string routes through `useT()` with a `data_sync.*` key and ships in all five locale files
(`en`, `de`, `es`, `ko`, `pl`). No hardcoded user-facing string, and no locale-only English fallback.
The batch numbers and the cursor interpolate as parameters so translators can reorder them.

## 📝 Edge Cases & Failure Scenarios

| # | Situation | What the operator sees |
|---|---|---|
| 1 | Retryable run, no batch committed (`cursor` is `null`) | The non-committal `noCommittedBatch` copy, and **the from-scratch action stays visible**. The endpoint's `previous.cursor ?? resolveStartCursor(...)` fallback may resume at a shared cursor the run row cannot see, so this is precisely the case where an operator most needs a guaranteed replay — and an earlier draft hid it here |
| 2 | Progress job is absent or its `totalCount` is null | No effect. No surface renders a batch denominator — § Architecture 1b |
| 3 | An adapter opted out of the shared cursor (`persistsSharedCursor` false) | Same as #1. The fallback reads this entity type's own last run instead of the shared row; either way the run row cannot predict it |
| 4 | Adapter declares `fullSync` inapplicable for the entity type | The overflow item is absent; the detail page states why in one line. The endpoint still accepts the request from a direct caller (**D0**) |
| 5 | Stored parameters no longer valid — `422` with `code: parametersStale` | The existing error message, plus a "Start a new run with these settings…" action that lands on the prefilled start form. The 422 already exists and is already machine-readable; what is new is the way out |
| 6 | Another run for the same integration / entity type / direction is in flight — `409` | The existing error naming the conflict. The 409 body is a bare sentence today and this spec does not widen it, so the message cannot link the blocking run |
| 7 | `GET /api/data_sync/options` fails while resolving `startControls` on the detail page | The overflow item renders. Failing open matches `applicableStartControls`, whose documented default for an unknown entity type is "every control applies"; failing closed would hide a valid action because an unrelated request failed |
| 8 | `?from=<runId>` names a run that does not exist, is not readable, or belongs to another tenant | The tenant-scoped fetch returns nothing, the banner does not render, and the form shows its normal defaults — the same thing a direct visit to `/backend/data-sync` shows. Not an error state |
| 9 | The prefill drops a stored parameter the adapter no longer declares | A warning naming the dropped key, above the form |
| 10 | `cancelled` run — no `lastError` exists | The error card does not render, and the layout must not leave a gap where it would be. A banner names **when** the run was cancelled, from `updatedAt`, so it is distinguishable from a run that died silently. It does **not** name who: `cancel.ts:96` calls `markStatus(run.id, 'cancelled', scope)`, which writes only status, `lastError` and `updatedAt`, and `triggeredBy` is who *started* the run. Recording the canceller needs a column — see § Non-goals |
| 11 | Run reaches a terminal state while the operator is looking at it | The page already refreshes from `progress.job.*` and `om:bridge:reconnected`; the action area and the resume-point line re-derive from the refreshed run like every other part of the page |
| 12 | The operator retries twice in quick succession | The second request hits the existing overlap `409`. No new guard, and no optimistic disabling that could strand the button if the first request fails |
| 13 | `paused` status | No actions and no resume-point line. Nothing in the engine produces this status; see § Non-goals |

## 📝 Risks & Impact Review

| # | Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | The resume-point line states a batch or cursor that is not where the retry actually starts, and an operator trusts it | High | Detail page, list row menu | Both surfaces derive the line from one pure function, `resolveResumePoint`, fed by the same `cursor`/`batchesCompleted` the endpoint itself resolves from. Unit-tested per state and per null case | The endpoint resolves `previous.cursor ?? resolveStartCursor(...)`; when `previous.cursor` is null the fallback may find a shared cursor the UI did not predict. Covered by rendering `fromBeginning` only for the null case and never promising a specific batch for it |
| 2 | An operator triggers a full replay believing it resumes | High | `POST /api/data_sync/runs/[id]/retry` | The action lives in an overflow, never as a peer of the primary, and is the only path in the UI behind a confirm. The confirm names the record count and both start positions rather than asking "Are you sure?" | An operator can still confirm without reading. Reduced, not eliminated |
| 3 | A full replay is read as destructive and avoided when it is the right fix | Medium | Confirm dialog | `variant` stays `"default"`; the copy states that existing records are matched and updated rather than duplicated | None |
| 4 | Two sibling endpoints disagree about what an adapter's declaration means | High | `run` and `retry` | **D0** — neither enforces. This also satisfies the written commitment in `BACKWARD_COMPATIBILITY.md` § Data Sync Start Control Applicability | None. The separation is now recorded in two specs and the compatibility document |
| 5 | The prefill silently changes a setting the operator did not choose | Medium | Start form | **D4** — `fullSync` is copied faithfully; a banner names the source run; a warning names any dropped parameter | An operator may not notice the banner. The form submits nothing on arrival, so the cost of not noticing is bounded at reading the fields |
| 6 | `?from=<runId>` becomes a way to probe another tenant's run ids | Medium | Start form prefill | The prefill reads through the existing tenant-scoped `GET /api/data_sync/runs/[id]`, which already answers 404 outside the scope. An unreadable id renders the plain form, identical to a direct visit — no distinguishing error | None. The parameter grants no read the operator did not already have |
| 7 | Hiding the from-scratch action for one entity type hides it everywhere, through a bad adapter predicate | Medium | Detail page, list row menu | `applicableStartControls` already defaults to "applies" for an unknown entity type and for a throwing predicate; an options-fetch failure fails open (Edge case 7) | An adapter can hide its own action. This is the same trust `2026-09-02` already extended, unchanged |
| 8 | ~~The list row's denominator-free string reads as a defect~~ | — | — | Moot under **D8**: the list row carries no resume string at all | None |
| 9 | Scope creep into cursor or engine semantics | Medium | Engine, run lifecycle | Explicit § Non-goals; no file under `lib/sync-engine.ts`, `lib/sync-run-service.ts` or `lib/start-cursor.ts` is in scope | None |
| 10 | The prototype keeps asserting a defect that this spec withdrew, misleading a later reader | Medium | `.ai/prototypes/data-sync-retry-resume/` | Corrected in the same change that lands this spec, with the README naming the spec as the authority | None |
| 11 | **An adapter cursor carries a secret or personal data, and this spec puts it on screen** | High | Detail page (the list never renders a cursor — **D8**) | Cursors are rendered nowhere today, so this is a new exposure surface. `data_sync/AGENTS.md` already constrains run parameters — "never declare a parameter that carries a secret" — but says nothing about cursors. Phase 1 Step 1.7 adds the matching one-line adapter contract to that file, in the same change that first renders one | An adapter written before that line exists may already encode a page token or a customer-keyed watermark. The value is shown only to `data_sync.view` holders, but the UI copy invites pasting it into a support ticket, so the contract line is the mitigation that matters |

## 📝 Final Compliance Report

- **Backward compatibility — one additive surface, and one thing deliberately not changed.** Twelve of
  `BACKWARD_COMPATIBILITY.md`'s fourteen categories are untouched: no auto-discovery file, signature of
  an existing export, event id, widget spot id, API route, DB schema, DI name, ACL feature id,
  notification id, AI id, CLI command, or generated file.

  **§2 and §4 do change, additively.** `lib/resume-point.ts` exports a new module path and the new type
  `ResumePoint`, and § Cross-cutting commits to documenting it in `data_sync/AGENTS.md` — which under §4
  is what makes a path public API. The precedent is exact: `lib/start-controls.ts` is recorded as
  ADDITIVE in `BACKWARD_COMPATIBILITY.md` § Data Sync Start Control Applicability for the same shape, in
  the same folder, in the same module. **The implementation PR MUST add the matching ADDITIVE row**; an
  earlier draft of this section claimed there was nothing to declare, which was wrong by the repo's own
  precedent.

  The one thing that *could* have broken something — making `retry`
  reject `fromBeginning: true` for a restricted entity type — is ruled out not merely by preference but
  by a commitment already recorded in that document:

  > The declaration governs what the dashboard **offers**, never what the run API **accepts** — that
  > separation MUST hold for any future change here, or an API client posting `fullSync: true` would
  > silently stop getting a full run.
  > — `BACKWARD_COMPATIBILITY.md` § Data Sync Start Control Applicability (2026-09-02)

  **D0 is therefore obligatory, not discretionary.**
- **Provider-agnostic.** No provider name and no entity-type string is special-cased. Applicability is
  read only through `applicableStartControls`, from the adapter's own declaration.
- **Canonical mechanisms.** `useConfirmDialog` for the confirm, `RowActions` for the row menu,
  `FormHeader` for the detail header, `apiCall` for every read, `useGuardedMutation` for every write,
  `LoadingMessage`/`ErrorMessage` for states, `flash` for outcomes. One new module,
  `lib/resume-point.ts`, and it exists to stop two pages computing the same sentence differently.
- **No invented UI surface.** The prototype's richer confirm body is dropped rather than met by adding
  a `body?: React.ReactNode` slot to the shared `ConfirmDialog`; § Architecture 4 records the
  trade-off and leaves the slot available additively for a future second caller.
- **Optimistic locking — not applicable, deliberately.** Retry, cancel and start are run-lifecycle
  actions that create or transition a run, not concurrent edits of a user-editable record. They keep
  the existing `optimistic-lock-exempt` annotations already present at both call sites; no
  `updatedAt` header is introduced.
- **Tenant scoping.** Every read and write goes through the existing tenant-scoped routes. The
  `?from=<runId>` prefill grants no read the operator does not already have.
- **i18n.** Every new string routes through `useT()` under a `data_sync.*` key and ships in all five
  locale files. Batch numbers and cursors interpolate as parameters. No hardcoded user-facing string;
  `yarn i18n:check` (which runs `check-sync`, `check-usage`, `check-hardcoded` and `check-values`) must
  pass.
- **Design system.** Status colours come from `status-*` tokens, never hardcoded Tailwind shades; no
  arbitrary values; no `dark:` overrides on semantic tokens. The resume-point line uses
  `text-muted-foreground` and the cursor a monospace token.
- **Docs.** `packages/core/src/modules/data_sync/AGENTS.md` gains a short section correcting its
  current one-line claim that "Retry reads the last successful cursor, resumes from there" into the
  three named actions, and
  `apps/docs/docs/framework/modules/integrations-data-sync.mdx` gains the operator-facing description.

## 📝 Non-goals

- Cursor semantics, engine behaviour, and the run lifecycle — untouched.
- **An additive `retryStartCursor` response field.** It would let the detail page state precisely where
  a retry will resume even when the run committed no batch, closing the one place this design can only
  be non-committal (§ Architecture 1). It is a contract change, nothing else in the feature needs it,
  and the honest copy is adequate in the meantime. The obvious follow-up if operators ask for it.
- **`sync_runs.full_sync`, `sync_runs.batch_size`, `sync_runs.cancelled_by`.** Three additive columns
  that would each improve one sentence of this design. Each needs a migration, a snapshot update, a
  response field and a `BACKWARD_COMPATIBILITY.md` entry — a different spec, not a footnote in this one.
- Linking a retry to the run it retried. No `retried_from_run_id` column exists, so no screen can show
  a logical sync's true totals. Recorded as a known gap, not solved here.
- Deciding the fate of the vestigial `paused` status. Flagged for a separate issue.
- The schedule-level full-sync switch and `buildDefaultScheduleState`.

## 📋 Phasing

Three phases. Each is independently shippable, leaves the application working, and delivers something
an operator can use on its own.

| Phase | Delivers | Ships alone because |
|---|---|---|
| 1 | The resume point, everywhere Retry is offered | Read-only. Changes no contract and adds no action. On its own it already ends the confusion this spec exists for |
| 2 | "Retry from the beginning", with its confirm and its two hiding rules | Depends on Phase 1's `resolveResumePoint` for hiding rule **D3**, but on nothing else |
| 3 | "Run again" and the prefilled start form | Touches a different page region and a different endpoint from Phases 1–2 |

Phase 1 is the one to ship first even if the others are deferred indefinitely. Phase 3 is the one to
drop first if scope has to shrink — it is a convenience, while Phases 1–2 are about an operator
understanding what a button does.

## 📋 Implementation Plan

### Phase 1 — Surface the resume point

**Step 1.1 — Add `lib/resume-point.ts`**
The pure module and its `ResumePoint` type per § Architecture 1, with unit tests covering each
retryable and non-retryable status, a null cursor, and a zero `batchesCompleted` with a non-null
cursor. No UI in this step. The module takes no `totalBatches` argument — § Architecture 1b.

**Step 1.2 — Render the resume point on the run detail page**
Add `cursor` and `initialCursor` to `SyncRunDetail`, render the line beneath the header action row in
all three forms, and add the "Started from / Committed through" block to the Progress card for every
state. Add the locale keys to all five files. Component tests assert the three forms and the
`data_sync.view`-only variant.

**Step 1.3 — ~~Render the resume point in the list row menu~~ — reverted by D8**
As built, this added `cursor`, `initialCursor` and `batchesCompleted` to `SyncRunRow` and folded the
resume point into the Retry item's `label` string. **D8 reverted all of it** once the overflow showed
up on a running instance: the three fields are gone again, the label names the action alone, and the
component test now asserts that no row label states a position. Kept here because the reversal, not the
step, is the thing worth remembering.

**Step 1.4 — Relabel the `cancelled` primary action to Resume**
The conditional string on both surfaces (**D1**), plus its locale keys. Test asserts `failed` reads
Retry and `cancelled` reads Resume on both surfaces.

**Step 1.5 — Integration coverage `TC-DS-012`**
Assert that a failed run's detail page renders the committed cursor verbatim, and that a run with no
committed batch renders the non-committal `noCommittedBatch` string instead — explicitly **not** a
claim about starting from the beginning.

**Step 1.6 — Gate the action affordances on `data_sync.run`**
Both pages resolve the feature from the granted set and render no action area without it. This is new
behaviour, not an existing guarantee: today both `page.meta.ts` files require only `data_sync.view` and
neither page reads features at all, so a viewer sees buttons that 403 on click. Tests assert that a
`data_sync.view`-only principal sees the resume-point line and no buttons, on both surfaces.

**Step 1.7 — Document the cursor-visibility contract for adapter authors**
Add one line to `packages/core/src/modules/data_sync/AGENTS.md`, beside the existing run-parameter
constraint: a cursor is operator-visible and must never encode a credential or personal data. This
lands in the same phase that first renders a cursor, not after it. Risk 11.

### Phase 2 — Retry from the beginning

**Step 2.1 — Add the overflow action and its confirm on the detail page**
The `⋯` menu, the `useConfirmDialog` call with the prose body from § Architecture 4, and the
`fromBeginning: true` request through `useGuardedMutation`. The menu renders only when it has an item.
Locale keys in all five files. Tests assert the request body, that confirming is required before any
request is sent, and that cancelling sends nothing.

**Step 2.2 — Hide the action when the adapter declares full sync inapplicable**
Resolve `startControls` on the detail page through the `GET /api/data_sync/options` call it already
makes, gate the item on `applicableStartControls(...).fullSync`, and state the restriction in a line
beneath the actions. Test asserts the item is absent for a restricted entity type, present for an
unrestricted one, and **present when the options fetch fails** (Edge case 7 — fails open).

**Step 2.3 — Add the same action to the list row menu**
Same gating, no explanatory footnote (**D5**). Test asserts the menu contents for each of the three
failed-run shapes.

**Step 2.4 — Integration coverage `TC-DS-013`**
Assert that a from-the-beginning retry starts a run whose `initialCursor` is null while the resumable
retry of the same run starts one that inherits the failed run's cursor. Assert the same for a run that
committed no batch — the case where the two requests differ most and an earlier draft wrongly called
them identical.

### Phase 3 — Run again

**Step 3.1 — Add the "Run again" action on completed runs**
The primary button on the detail page and the row menu item, both navigating to
`/backend/data-sync?from=<runId>` (**D2**). No overflow menu on a completed run. Locale keys. Test
asserts the target URL and that no Retry action renders for a completed run.

**Step 3.2 — Seed the start form from `?from=<runId>`**
Read the parameter, fetch the run, and seed integration / entity type / direction / stored
`parameters` — and nothing else, because `sync_runs` persists neither `fullSync` nor batch size
(**D4**). Render the source banner naming which fields were seeded, and the dropped-parameter warning.
Implement the sequencing contract in § UI/UX: seed once after options resolve, behind a ref guard;
suppress the two existing reset effects while a seed is pending; strip the parameter with
`router.replace` once applied. Tests assert each seeded field, that `fullSync` and batch size are left
at their form defaults, the dropped-key warning, that an unknown **or malformed** id renders the plain
form with no banner and no error (Edge case 8), that a later options resolution does not overwrite the
seed, and that arrival submits nothing.

**Step 3.3 — Route the stale-parameter 422 to the prefilled form**
Add the "Start a new run with these settings…" action to the existing `parametersStale` error surface
(Edge case 5). Test asserts the action appears for that code and not for other failures.

**Step 3.4 — Integration coverage `TC-DS-014`**
Assert that "Run again" on a completed run lands on the start form with the run's stored parameters
populated, and that starting from there creates a run carrying them.

### Cross-cutting, at the end of each phase

Update `packages/core/src/modules/data_sync/AGENTS.md` and
`apps/docs/docs/framework/modules/integrations-data-sync.mdx` as each phase changes what is true. The
module's current one-line claim — "Retry reads the last successful cursor, resumes from there" — is
accurate but incomplete once Phase 2 lands, and wrong as a description of the whole action set.

## 📝 Testing

| Surface | Coverage |
|---|---|
| `lib/resume-point.ts` | Every status; null cursor; zero `batchesCompleted` with a non-null cursor. **No `totalBatches` case — the argument does not exist** |
| Run detail page | Both resume-point forms; that `noCommittedBatch` never renders a "from the beginning" claim; the Started-from / Committed-through block across states; the action set per status; `Resume` vs `Retry` wording; the overflow rendering only when non-empty |
| Permissions | A `data_sync.view`-only principal sees the resume-point line and no action buttons, on both surfaces |
| Confirm dialog | Confirming issues `fromBeginning: true`; cancelling issues nothing; no request precedes the confirm |
| Visibility gating | Hidden for a restricted entity type; **present when the options fetch fails**; **present for a null cursor**, which is where a guaranteed replay matters most |
| List row menu | Menu contents for each run state; that a failed run reading "Retry" is byte-identical whether or not it committed a batch (**D8** — no label states a position); `completed` offers only Run again… |
| Start form prefill | Each seeded field; that `fullSync` and batch size stay at form defaults; the source banner; the dropped-parameter warning; unknown **and malformed** ids render plain defaults; a late options resolution does not overwrite the seed; arrival submits nothing |
| Error surfaces | `parametersStale` renders the way out; the overlap `409` renders unchanged |
| Integration `TC-DS-012` | Resume point rendered from a real failed run, and the non-committal form from one with no committed batch |
| Integration `TC-DS-013` | From-the-beginning retry yields a null `initialCursor`; resumable retry inherits the cursor; the two differ for a run that committed no batch |
| Integration `TC-DS-014` | Run again lands prefilled and the resulting run carries the parameters |

Per `.ai/qa/AGENTS.md` the three integration specs ship in the same change as the behaviour they
cover, create their own fixtures, clean up in teardown, and depend on no seeded demo data.

## Changelog

- **2026-09-21** — **Code-review fixes (PR #6187).** Two corrections, neither changing a decision:
  1. **The `?from=` prefill now seeds its parameters on the dashboard's own path.** The parameter effect
     was keyed on the `runParameters` memo alone, whose identity does not change when the seeded run
     carries the integration, entity type and direction the form already holds — the single-integration
     case the row menu's **Run again…** hits directly. The seed token moved from a ref into state and
     into that effect's dependencies, so a new seed re-runs it on its own; the token is a counter rather
     than `Date.now()`, so two clicks inside one millisecond still mint distinct tokens. It is never
     cleared: clearing it would re-run the effect with no seed and reset the operator's own edits.
  2. **The detail page's overflow uses `ActionsDropdown`, not `RowActions`** — `packages/ui/AGENTS.md`
     § UI Interaction already routes `FormHeader mode="detail"` context actions there, and that sibling
     carries the #3580 sizing fix (`min-w-52 w-max max-w-xs` plus `whitespace-normal` items). So the
     residual below is now **list-page only**. Qualifying the last line of that entry: whatever
     `ActionsDropdown` measures at rest, it does not paint a long label outside its border — its items
     are `whitespace-normal h-auto` inside a `max-w-xs` menu, so they wrap. Its resting width was not
     re-measured here; that is cosmetic, not the overflow defect.
- **2026-09-17** — **D8**, taken against a running instance during manual test-drive rather than on
  paper. The resume point is removed from the runs list entirely. `RowActions` fixes its menu at `w-44`
  (176px) and renders every item through a `whitespace-nowrap` `Button`, so a label longer than roughly
  22 characters overflows the menu's border and background rather than wrapping — which is what
  "Retry (resumes from this feed's last saved position)" did, visibly, in Polish. Shortening the copy
  could not fix it: the `noCommittedBatch` case has to say *the feed's* saved position rather than
  *this run's*, and no phrasing carrying that distinction fits 22 characters in German or Polish. The
  two alternatives both changed a shared primitive — widening/wrapping the menu, or adding a
  `description` slot to `RowActionItem` — and were declined in favour of keeping the primitive
  untouched. Consequences: `data_sync.dashboard.actions.retryResumes` and `.retryLastSaved` are deleted
  from all five locales; `.runAgain` shortens to "Run again…" (it overflowed too, at 30–40 characters);
  `SyncRunRow` drops `cursor`, `initialCursor` and `batchesCompleted`, which existed only to feed the
  label; the list page calls `isRetryableRunStatus` instead of `resolveResumePoint`. The cost is real
  and accepted: **US-A1's "see where a retry will resume before pressing it" now requires opening the
  run**, one click further than the story asked for. `lib/resume-point.ts` is unchanged — the helper and
  its contract were never the problem.
- **2026-09-17** — **Known residual, deliberately not fixed here** (since 2026-09-21 the **runs list**
  row menu only; the detail page moved to `ActionsDropdown`). Two shipped row-menu labels still
  exceed what `RowActions` can render: `Retry from the beginning` (24 characters) and the Spanish
  `Reintentar desde el principio` (29), against a box that holds roughly 22. The menu is a fixed `w-44`
  (176px) whose items inherit `whitespace-nowrap` from the `Button` primitive, so an over-long label
  paints outside the menu's border rather than wrapping — the same defect issue #3580 fixed in the
  sibling `ActionsDropdown`, which `RowActions` was never given.

  A fix was built and measured against a running instance, then **reverted to keep this change out of a
  shared UI primitive**. Recording what it found, because it is not guessable from the CSS and the next
  attempt should not have to rediscover it: the naive fix (`w-max max-w-xs` + wrapping items) sizes the
  menu to **316px for three short labels** whose longest item has a max-content of **167px**, because
  `Button` is `inline-flex` and an inline-flex child inside a `max-content` block yields a bogus
  intrinsic width. Overriding the items to `flex` is what makes `w-max` behave; with it the menu
  measures 177px for a normal row menu, keeps the 176px floor for short ones, and grows to the 320px cap
  and wraps for a long label. Two intermediate attempts — swapping `w-max` for `w-fit`, then widening
  `min-w-44` to `min-w-48` — were symptom fixes that left `w-fit`/`max-w-xs` inert with `min-width`
  silently doing all the sizing. `ActionsDropdown` likely sits at ~320px for the same reason.
- **2026-09-16** — Initial spec. Written after a 13-screen clickable prototype
  (`.ai/prototypes/data-sync-retry-resume/`) was reviewed; six of that prototype's drawn choices were
  reversed during that review (**D2**–**D7**) and the prototype was corrected in the same change.
  **D1** — a `cancelled` run reading Resume — confirmed what the prototype's requirements already said
  rather than reversing it. The originally planned server-side full-sync gate on `retry` was dropped
  entirely once `BACKWARD_COMPATIBILITY.md` § Data Sync Start Control Applicability was found to forbid
  it (**D0**).
- **2026-09-16** — Revised after specification review (3 blockers, 8 majors). Four of the design's
  promises turned out not to be cashable against the data model and were withdrawn rather than
  weakened:
  - **The `fromBeginning` resume-point copy was false.** The endpoint falls back to
    `resolveStartCursor(...)` when the run committed no batch, so a run that died on its first batch can
    still resume at a shared cursor. The copy is now non-committal, and the withdrawn **D3** — which hid
    the from-scratch action in exactly that case — is gone, so the operator keeps the one control that
    guarantees a replay.
  - **`sync_runs` stores neither `full_sync` nor `batch_size`**, so the prefill seeds only integration,
    entity type, direction and `parameters` — which is what the prototype's own `US-B2` had said before
    this spec added two fields on top of it. **D4** is restated accordingly.
  - **The "of ~118" denominator is not derivable.** `totalCount` estimates source records, not batches.
    Every surface now renders the batch number alone, and `ResumePoint` lost its `totalBatches`
    argument.
  - **Neither page gates on `data_sync.run` today.** § Permissions claimed an existing behaviour that
    does not exist; it is now specified as new work with its own step.

  Also: the list row's sub-label collapses into the item's `label` string, because `RowActionItem.label`
  is a `string` — the same constraint the spec had already found in `ConfirmDialog` and missed one
  section earlier; `lib/resume-point.ts` is declared as an ADDITIVE §2/§4 surface following the
  `lib/start-controls.ts` precedent; the cancelled banner names *when* rather than *who*, since nothing
  records the canceller; the `?from=` seeding sequence is specified against the two existing reset
  effects that would otherwise clobber it; and a new Risk 11 covers rendering an adapter cursor
  verbatim, with an adapter-contract line scheduled in the same phase that first renders one.
