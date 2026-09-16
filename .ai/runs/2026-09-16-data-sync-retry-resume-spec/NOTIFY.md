# Notify — 2026-09-16-data-sync-retry-resume-spec

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-16T12:18:20Z — run started
- Brief: complete `.ai/specs/2026-09-16-data-sync-retry-resume-actions.md` from skeleton to a finished,
  implementation-ready spec, and reconcile the `data-sync-retry-resume` prototype with the decisions
  taken during its review. Design-only — no implementation code.
- External skill URLs: none.

## 2026-09-16T12:18:20Z — decision: classified as a Spec-implementation run
- Heuristic 1 matched: the run is driven by a spec under `.ai/specs/`. Heuristic 2 also matched: the
  brief describes the work in phases and deliverables. The full run-folder contract therefore applies
  even though the diff is docs-only.

## 2026-09-16T12:18:20Z — decision: staying on the existing branch instead of cutting `feat/…`
- The skill's default is a `feat/` branch cut from `origin/develop`. The user's brief explicitly
  requires building on `jtomaszewski/data-sync-retry-vs-resume`, because the prototype commit
  `eaf4f3158e` and the spec skeleton `e42c7b411a` exist only on that branch and a fresh cut from
  `develop` would drop both. PR base remains `develop`. Recorded in `PLAN.md` § Deviations.

## 2026-09-16T12:18:20Z — decision: reusing the current linked worktree
- `git rev-parse --git-dir` and `--git-common-dir` differ, so the session is already inside a linked
  worktree. Per `references/worktree-setup.md` it is reused rather than nested, and no cleanup is owed
  at run end.

## 2026-09-16T12:18:20Z — decision: every Step is `inline`, none dispatched
- All nine Steps edit one of two documents and depend on decisions held in the planning conversation
  (the Q1 rationale, the five reversals, the prototype's exact current wording). A fresh executor would
  have to re-derive all of it before writing a line, which is the documented `inline` criterion.

## 2026-09-16T12:26:00Z — decision: Commit column filled in one sweep at the final gate
- A Step cannot record its own post-amend SHA: writing the SHA into `PLAN.md` and amending changes the
  SHA again, so Step 1.1's first attempt recorded a dead object. Every Step now writes `pending` and the
  real short SHAs are filled in a single bookkeeping pass during the final gate. `Status` remains the
  authoritative resume signal throughout, which is what `om-auto-continue-pr-loop` parses.

## 2026-09-16T12:26:00Z — decision: the confirm dialog body collapses to plain text
- `useConfirmDialog`/`ConfirmDialog` expose `text` as a string and no `children`/`body` node slot, so
  the prototype's richer dialog body (warning callout plus a two-cell batch comparison) is not
  expressible through the canonical primitive. The spec collapses the copy into `text` rather than
  growing a shared UI contract for one caller. Adding `body?: React.ReactNode` stays available
  additively and is recorded in the spec as the rejected alternative.

## 2026-09-16T12:34:00Z — checkpoint 1 — Steps 1.1..1.5
- Phase 1 (the specification body) is complete and verified. Five checks passed: nothing outside `.ai/`
  was touched, all ten required spec sections are present, all seven cited repo paths resolve, all
  three cited source line numbers are exact, and the `AGENTS.md` line the spec promises to correct
  exists as described. Four checks were skipped with reasons — typecheck/test/build and the i18n
  checkers have no changed inputs in a docs-only window, and the integration suite and browser
  verification have no UI to exercise until Step 2.2 redraws the prototype.

## 2026-09-16T12:34:00Z — finding: D0 is obligatory, not discretionary
- `BACKWARD_COMPATIBILITY.md` § Data Sync Start Control Applicability (2026-09-02) already states in
  writing that the adapter's start-control declaration "governs what the dashboard **offers**, never
  what the run API **accepts**", and that the separation "MUST hold for any future change here, or an
  API client posting `fullSync: true` would silently stop getting a full run". The server-side gate the
  first draft of this work proposed — and that the prototype still calls a hole — would have broken a
  recorded contract commitment, not merely diverged from a sibling endpoint. Recorded in the spec's
  Final Compliance Report; the prototype is corrected in Phase 2.

## 2026-09-16T12:44:00Z — final gate passed (docs-only minimum gate)
- All nine Steps are `done`. Eight structural checks passed and browser verification confirmed every
  redraw assertion mechanically: screen 9 reads `Resume`, screen 8 has no overflow button, screen 12's
  full-sync switch is off, screen 13 carries two alerts, and "Run again" survives only on the two
  `completed` screens. No console errors beyond the favicon 404, no overflow, no dangling links or
  icons, no empty popovers.
- The full `validation.commands` list, the integration suite and the design-system pass were skipped
  under the documented docs-only path in `references/final-gate.md`. The skip is justified mechanically
  rather than assumed: no changed path lies outside `.ai/`, so none of those commands has a changed
  input. Every skip and its reason is recorded in `final-gate-checks.md`.

## 2026-09-16T12:44:00Z — scope note: seven prototype decisions reversed, not five
- Two more surfaced while reconciling the two documents. The list gains no "resumed from" column (D6),
  and nothing renders in the resume-point slot for a non-retryable state (D7). D7 was an outright
  contradiction: the prototype's screen 10 drew a greyed placeholder that the spec's own UI/UX table
  says must not render. Both are recorded in the spec's § Proposed Solution and the prototype README.

## 2026-09-16T12:52:00Z — specification review: 3 blockers, 8 majors, all fixed
- The review ran through two fresh-context agents given only the spec path and the repo — deliberately
  not the authoring rationale, since an author cannot adversarially re-read their own document. Every
  blocker was re-verified by hand against the code before being acted on.
- Four promises the spec made turned out not to be cashable and were withdrawn rather than weakened:
  the `fromBeginning` resume-point copy was **false** (the endpoint falls back to `resolveStartCursor`,
  so a run that committed no batch can still resume at a shared cursor) and **D3 hid the one action
  that would have fixed it**; `sync_runs` stores neither `full_sync` nor `batch_size`, so **D4 could
  not be built as stated**; the "of ~118" denominator is not derivable from a source-record estimate;
  and neither page gates on `data_sync.run` today, so § Permissions described a behaviour that does not
  exist.
- Also fixed: `RowActionItem.label` is a `string` with no sub-label slot — the identical constraint the
  spec had already diagnosed for `ConfirmDialog` one section earlier and missed here; `lib/resume-point.ts`
  is an ADDITIVE §2/§4 surface by the `lib/start-controls.ts` precedent and was claimed as "nothing to
  declare"; the cancelled banner cannot name who; the `?from=` seed races two existing reset effects;
  and rendering an adapter cursor is a new exposure surface with no adapter contract behind it.
- Four prototype screens were redrawn a second time to match, and re-verified in a browser: no stale
  denominators in any rendered copy, no false from-the-beginning claim, screen 8's overflow restored,
  no two-line menu items left, no empty popovers, no dangling links.

## 2026-09-16T12:52:00Z — decision needing the user's eye: D4 was restated, not just reworded
- **D4 was one of the five decisions the user made explicitly.** It cannot ship as worded: the field it
  copies does not exist on the run row. The prefill now seeds only integration, entity type, direction
  and stored parameters — which is what the prototype's own `REQUIREMENTS.md` US-B2 said before this
  spec added two fields on top of it. Flagged in the run report for confirmation.
