# Plan — 2026-09-16-data-sync-retry-resume-spec

**Run mode:** Spec-implementation run (design-only — the deliverable is a specification, not code)
**Branch:** `jtomaszewski/data-sync-retry-vs-resume`
**Base branch:** `develop`
**Source spec:** `.ai/specs/2026-09-16-data-sync-retry-resume-actions.md` (skeleton committed in `e42c7b411a`)
**Prototype:** `.ai/prototypes/data-sync-retry-resume/` (committed in `eaf4f3158e`)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Resolve the Open Questions block into recorded decisions | inline | done | bf9e185719 |
| 1 | 1.2 | Write Architecture, Data Model, and API Contracts | inline | todo | — |
| 1 | 1.3 | Write UI/UX and Edge Cases & Failure Scenarios | inline | todo | — |
| 1 | 1.4 | Write Risks & Impact Review and Final Compliance Report | inline | todo | — |
| 1 | 1.5 | Write Phasing, Implementation Plan, Testing, and Changelog | inline | todo | — |
| 2 | 2.1 | Remove the withdrawn server-side-hole claims from the prototype | inline | todo | — |
| 2 | 2.2 | Redraw the prototype screens the five decisions reverse | inline | todo | — |
| 2 | 2.3 | Reconcile the prototype README and REQUIREMENTS with the decisions | inline | todo | — |
| 3 | 3.1 | Cross-reference the start-controls spec that Q1 relies on | inline | todo | — |

## Goal

Turn the committed spec skeleton into a complete, implementation-ready specification for the three
distinct operator actions on a Data Sync run — resume (labelled Retry/Resume), retry from the
beginning, and run again — and bring the prototype into agreement with the decisions taken during its
review, so that neither document contradicts the other.

## Scope

- `.ai/specs/2026-09-16-data-sync-retry-resume-actions.md` — all sections below the skeleton.
- `.ai/prototypes/data-sync-retry-resume/index.html` — the two notes that assert a defect that is not
  one, plus the four screens the decisions reverse.
- `.ai/prototypes/data-sync-retry-resume/README.md` and `REQUIREMENTS.md` — the open-question lists.
- `.ai/specs/2026-09-02-data-sync-adapter-start-controls.md` — one cross-reference line only.

## Non-goals

- **No implementation.** Nothing under `packages/core/src/modules/data_sync/**` is touched. The spec
  ships on its own PR; implementation follows via `om-auto-implement-spec`.
- No resolution of the vestigial `paused` status — recorded as a follow-up.
- No `retried_from_run_id` column or retry-chain reporting — recorded as a known gap.
- No change to cursor semantics, the sync engine, or the run lifecycle.
- No change to `POST /api/data_sync/run` or `POST /api/data_sync/runs/[id]/retry` behaviour.

## Decisions carried into this run

Taken by the user during the prototype and skeleton review; this run records them, it does not reopen
them.

| # | Decision | Consequence |
|---|---|---|
| Q1 | Neither `run` nor `retry` enforces `supportsStartControl('fullSync', …)` server-side | Zero API contract changes; the originally planned "Phase 2 — server-side gate + new 422" is deleted |
| Q2 | One spec, not split into display/actions | Phasing stays internal to this spec |
| D1 | A `cancelled` run's primary action reads **Resume**, not Retry | One conditional string on the detail page and in the row menu |
| D2 | "Run again" is offered on `completed` runs only | Prototype screen 3 is redrawn |
| D3 | "Retry from the beginning" is hidden when no batch was committed | Prototype screen 8 note 2 is resolved, not left open |
| D4 | The prefilled start form copies the source run's `fullSync` faithfully | Prototype screen 12 note 2 is resolved |
| D5 | The row-action menu carries no delta-only footnote; the detail page states it | Prototype screen 4 is redrawn |

## Risks

| Risk | Mitigation |
|---|---|
| The spec contradicts the merged start-controls spec | Step 3.1 cross-references it explicitly; Q1 was chosen *because* it is the consistent answer |
| The prototype keeps asserting a defect that does not exist, misleading a later reader | Steps 2.1–2.3 are in this PR, not deferred |
| A reviewer reads the prototype as the decision rather than the spec | The prototype README gains a "superseded by the spec" note in Step 2.3 |
| Scope creep into implementation | Explicit Non-goal; the final gate is docs-scoped and the review pass will flag any source-tree diff |

## Deviations from the skill's defaults

- **Branch name.** The skill mandates a `feat/`/`fix/` branch cut from `origin/develop`. This run stays
  on the existing `jtomaszewski/data-sync-retry-vs-resume`, on the user's explicit instruction: the
  prototype commit `eaf4f3158e` and the skeleton `e42c7b411a` exist only there, and cutting a new
  branch from `develop` would drop both.
- **Worktree.** The session is already inside a linked worktree
  (`/Users/jacek/conductor/workspaces/open-mercato/richmond-v5`), so per `references/worktree-setup.md`
  it is reused and no worktree is created or cleaned up.
- **Executor placement.** Every Step is `inline`. All nine Steps edit one of two documents and depend
  on decisions held in the planning conversation rather than on anything recoverable from the repo; a
  fresh executor would re-derive the prototype's exact wording and the Q1 rationale before it could
  write a line. That is the documented `inline` criterion (needs the main session's accumulated
  context, and executor overhead exceeds the work).

## External references

None. No `--skill-url` was passed.

## Implementation Plan

### Phase 1 — Complete the specification

**Step 1.1 — Resolve the Open Questions block into recorded decisions**
Replace the `## 📝 Open Questions` block with a `## 📝 Decisions taken` section recording Q1 = (b) and
Q2 = one spec, each with its rationale and the name of the merged decision it stays consistent with.
Flip `Status:` in the header from `skeleton — blocked on Open Questions` to `draft`. Remove the closing
placeholder paragraph. The spec must read as coherent with no dangling reference to an unanswered
question.

**Step 1.2 — Write Architecture, Data Model, and API Contracts**
Architecture: which files change and what each one reads. Data Model: none — no entity, column,
migration or snapshot change. API Contracts: state plainly that **no contract changes**, enumerate the
fields each surface already returns (`cursor`, `initialCursor`, `batchesCompleted` on both the list and
detail payloads; `totalCount` on the detail progress job only), and explain why the list row therefore
shows a batch number with no denominator and why `?from=<runId>` removes the need to widen the list
payload with `parameters`.

**Step 1.3 — Write UI/UX and Edge Cases & Failure Scenarios**
UI/UX: the per-state action table, the resume-point line and its degraded forms, the confirm dialog,
the prefilled start form, and the `data_sync.view`-without-`data_sync.run` variant. Edge Cases: no
committed cursor; null `totalCount`; stale stored parameters (`422 parametersStale`); an overlapping
in-progress run (`409`); an adapter that declares `fullSync` inapplicable; a `cancelled` run with no
`lastError`; a run whose adapter no longer declares a stored parameter.

**Step 1.4 — Write Risks & Impact Review and Final Compliance Report**
Risks table in the module's house format (risk, severity, affected area, mitigation, residual). Final
Compliance Report covering provider-agnosticism, backward compatibility (nothing to declare — record
why), i18n (every new string routed through `useT()`, keys added to all locale files), optimistic
locking (not applicable — these are run-lifecycle actions, not record edits), and docs.

**Step 1.5 — Write Phasing, Implementation Plan, Testing, and Changelog**
Three phases, each independently shippable: (1) resume-point display; (2) retry from the beginning
with its confirm dialog and its two hiding rules; (3) "Run again" prefill via `?from=<runId>`. Break
each into testable Steps for `om-auto-implement-spec`. Testing table per surface, including the
integration coverage `.ai/qa/AGENTS.md` requires for every affected API and key UI path. Changelog
entry dated 2026-09-16.

### Phase 2 — Reconcile the prototype

**Step 2.1 — Remove the withdrawn server-side-hole claims**
Screen 4 note 3 and screen 13's third alert both assert a server-side hole and a
`fullSyncUnsupported` 422 that Q1 = (b) means will never exist. Replace both with the accurate
statement: the declaration is a UI-applicability concern by design, decided in the start-controls spec,
and the API deliberately keeps accepting the field. Screen 1's matrix row and screen 13's note 3 need
the same correction.

**Step 2.2 — Redraw the screens the decisions reverse**
D2: remove "Run again with these settings…" from the failed-run menus (screens 3 and 4) and from the
failed-run detail overflow (screen 7). D3: remove "Retry from the beginning" from screen 8's overflow
and resolve its note 2. D5: remove the delta-only footnote from screen 4's menu and state it on the
detail page instead. D1: screen 9's primary action becomes **Resume**, and its note 1 becomes a
recorded decision rather than an open question. D4: screen 12's full-sync switch renders off, copied
from the source run, and its note 2 becomes a recorded decision. Screen 1's matrix is updated to match
all five.

**Step 2.3 — Reconcile the prototype README and REQUIREMENTS**
Rewrite the README's "What is a proposal, not a decision" section into "Decisions taken" plus whatever
genuinely remains open, add a line naming the spec as the authority over the prototype, and update
§4 of `REQUIREMENTS.md` so its list of unsettled questions matches reality.

### Phase 3 — Cross-reference

**Step 3.1 — Cross-reference the start-controls spec**
Add a changelog line and a forward reference to `.ai/specs/2026-09-02-data-sync-adapter-start-controls.md`
recording that its "`POST /api/data_sync/run` — unchanged" decision is what the retry endpoint's
matching permissiveness is based on, so a future reader changing one knows to change both.

## Verification

Docs-only run. The final gate runs the `validation.commands` list; the integration suite is skipped
with the documented docs-only reason. The prototype is re-rendered in a browser after Step 2.2 to
confirm the redraw did not break layout, with the checkpoint recording the result.
