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

Three files change, one of them new. No entity, column, migration, snapshot, endpoint, request field,
response field, status code or error code changes anywhere. The work is a shared pure helper that
turns a run row into a sentence about what a retry would do, two pages that render it, one confirm
dialog built from the existing `useConfirmDialog` primitive, and one query parameter that seeds the
start form from a past run.

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

## 📝 Architecture

### 1. `lib/resume-point.ts` — new, pure, isomorphic

The one piece of new logic. It turns a run row into a discriminated descriptor of what a retry of that
run would do, and both pages render from it. Pure and dependency-free so it is unit-testable without a
DOM or a container, and shared so the list row and the detail page cannot drift into telling an
operator two different stories about the same run.

```ts
export type ResumePoint =
  | { kind: 'none' }                                            // not a retryable state
  | { kind: 'fromBeginning' }                                   // retryable, but no batch committed
  | { kind: 'resumes'; batchesCompleted: number; totalBatches: number | null; cursor: string }

export function resolveResumePoint(run: {
  status: SyncRunStatus
  cursor: string | null
  batchesCompleted: number
}, totalBatches?: number | null): ResumePoint
```

Rules it encodes, in one place rather than twice:

- `failed` and `cancelled` are the only retryable states; everything else is `{ kind: 'none' }`.
- A retryable run whose `cursor` is `null` is `{ kind: 'fromBeginning' }` — Retry and "Retry from the
  beginning" would issue byte-identical requests, which is what makes **D3** (hide the overflow item)
  correct rather than merely tidy.
- `totalBatches` is an optional second argument, not a field on the run. The list page never passes it;
  the detail page passes the progress job's derived batch total. This is what lets one function serve a
  row that can only say "batch 41" and a page that can say "batch 41 of ~118".

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

None. No entity, column, migration, or `.snapshot-open-mercato.json` change. The run row already
carries every field this feature reads: `status`, `cursor`, `initialCursor`, `batchesCompleted`,
`parameters`.

Deliberately **not** added: a `retried_from_run_id` column. See § Non-goals.

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

It also does not return a progress job, so a list row has no batch total. The row therefore reads
"Retry (resumes from batch 41)" with no denominator, while the detail page reads "batch 41 of ~118".
Joining progress jobs into the list query to recover the denominator is rejected: it would add a query
per page render to put an approximate number in a menu sub-label the operator can get exactly by
opening the run.

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

One line, rendered beneath the header action row on the detail page and as a second line inside the
menu item on the list. It is the fix for the confusion this spec exists to end, and it renders in three
forms depending on what `resolveResumePoint` returns:

| `ResumePoint` | Detail page | List menu sub-label |
|---|---|---|
| `resumes` with a total | "Resumes from batch 41 of ~118 — `updated_at:2026-09-12T04:15:07Z`" | "Resumes from batch 41" |
| `resumes` without a total | "Resumes from batch 41 — `updated_at:2026-09-12T04:15:07Z`" | "Resumes from batch 41" |
| `fromBeginning` | "No batch was committed — Retry starts from the beginning" | "Starts from the beginning" |
| `none` | not rendered | not rendered |

The no-total form is not an edge case to tolerate — it is the **common** form for a streaming import,
where the progress job's `totalCount` is null because nothing counted the source first. Both strings
ship; neither is a fallback.

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

Hidden in three cases, each for its own reason:

1. The run is not `failed` or `cancelled` — there is nothing to retry.
2. `resolveResumePoint` returns `fromBeginning` (**D3**) — the request would be byte-identical to the
   primary action, so offering both would present one operation as two.
3. `applicableStartControls(integration.startControls, entityType).fullSync === false` — the adapter
   declares a full replay meaningless for this entity type. The list page already resolves this map for
   the start form; the detail page fetches `GET /api/data_sync/options` to resolve it the same way,
   which is the same call it already makes to resolve run-parameter labels.

Case 3 is **UI gating only**. Per **D0** the endpoint still accepts `fromBeginning: true` from a direct
API caller, by design. The row menu carries no explanatory footnote about it (**D5**); the detail page
states the restriction in a line beneath the actions, where there is room for a sentence.

The confirm dialog names the cost concretely rather than asking "Are you sure?" — the record count, the
batch a resumable retry would have started at, and the batch this one starts at — as prose in
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

### Permissions

Every action is gated on `data_sync.run`, which both pages already require for their existing
mutations. A holder of `data_sync.view` alone sees every state, every counter, and the full
resume-point line, and no action buttons at all — the line is a statement about the run, not an
affordance.

### i18n

Every new string routes through `useT()` with a `data_sync.*` key and ships in all five locale files
(`en`, `de`, `es`, `ko`, `pl`). No hardcoded user-facing string, and no locale-only English fallback.
The batch numbers and the cursor interpolate as parameters so translators can reorder them.

## 📝 Edge Cases & Failure Scenarios

| # | Situation | What the operator sees |
|---|---|---|
| 1 | Retryable run, no batch committed (`cursor` is `null`) | "No batch was committed — Retry starts from the beginning". The overflow item is hidden (**D3**), so the page never presents one request as two choices |
| 2 | Progress job's `totalCount` is null (the common streaming-import case) | The no-denominator string. Not an error, not a fallback — a first-class form |
| 3 | The run has no progress job at all | Same as #2. `resolveResumePoint` is called with `totalBatches` omitted |
| 4 | Adapter declares `fullSync` inapplicable for the entity type | The overflow item is absent; the detail page states why in one line. The endpoint still accepts the request from a direct caller (**D0**) |
| 5 | Stored parameters no longer valid — `422` with `code: parametersStale` | The existing error message, plus a "Start a new run with these settings…" action that lands on the prefilled start form. The 422 already exists and is already machine-readable; what is new is the way out |
| 6 | Another run for the same integration / entity type / direction is in flight — `409` | The existing error naming the conflict. The 409 body is a bare sentence today and this spec does not widen it, so the message cannot link the blocking run |
| 7 | `GET /api/data_sync/options` fails while resolving `startControls` on the detail page | The overflow item renders. Failing open matches `applicableStartControls`, whose documented default for an unknown entity type is "every control applies"; failing closed would hide a valid action because an unrelated request failed |
| 8 | `?from=<runId>` names a run that does not exist, is not readable, or belongs to another tenant | The tenant-scoped fetch returns nothing, the banner does not render, and the form shows its normal defaults — the same thing a direct visit to `/backend/data-sync` shows. Not an error state |
| 9 | The prefill drops a stored parameter the adapter no longer declares | A warning naming the dropped key, above the form |
| 10 | `cancelled` run — no `lastError` exists | The error card does not render, and the layout must not leave a gap where it would be. A banner names who cancelled the run and when, so it is distinguishable from a run that died silently |
| 11 | Run reaches a terminal state while the operator is looking at it | The page already refreshes from `progress.job.*` and `om:bridge:reconnected`; the action area and the resume-point line re-derive from the refreshed run like every other part of the page |
| 12 | The operator retries twice in quick succession | The second request hits the existing overlap `409`. No new guard, and no optimistic disabling that could strand the button if the first request fails |
| 13 | `paused` status | No actions and no resume-point line. Nothing in the engine produces this status; see § Non-goals |

## 📝 Non-goals

- Cursor semantics, engine behaviour, and the run lifecycle — untouched.
- Linking a retry to the run it retried. No `retried_from_run_id` column exists, so no screen can show
  a logical sync's true totals. Recorded as a known gap, not solved here.
- Deciding the fate of the vestigial `paused` status. Flagged for a separate issue.
- The schedule-level full-sync switch and `buildDefaultScheduleState`.
