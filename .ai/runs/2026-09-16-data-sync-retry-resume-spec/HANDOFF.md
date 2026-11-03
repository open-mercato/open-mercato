# Handoff — 2026-09-16-data-sync-retry-resume-spec

**Last updated:** 2026-09-16T12:55:00Z
**Branch:** jtomaszewski/data-sync-retry-vs-resume (pushed to the `fsh` fork remote)
**PR:** https://github.com/open-mercato/open-mercato/pull/6154
**Current phase/step:** all eleven Steps `done` (nine planned + two review fixes) — final gate passed, review applied
**Last commit:** 74e10a4a2e — docs(prototypes): redraw for the withdrawn D3 and the restated D4

## What just happened
- All three Phases landed: the specification is written end to end, the prototype was redrawn to agree
  with it on every point, and `2026-09-02-data-sync-adapter-start-controls.md` now records that the two
  endpoints are bound together.
- The final gate passed under the documented docs-only minimum.
- A fresh-context specification review then found 3 blockers and 8 majors. All were verified against the
  code and fixed. The substantive ones: the `fromBeginning` resume-point copy was **false** and D3 hid
  the action that would have fixed it; `sync_runs` stores neither `full_sync` nor `batch_size`, so D4
  could not be built as worded; the batch denominator is not derivable; and neither page gates on
  `data_sync.run` today. The prototype was redrawn a second time to match and re-verified in a browser.

## Next concrete action
- Nothing in this run. **One item needs the user's eye**: D4 was one of five decisions they made
  explicitly, and it was restated rather than merely reworded, because the field it copies does not
  exist on the run row. Implementation is a separate PR — hand the spec to `om-auto-implement-spec`,
  which can take its Phases 1–3 directly from § Implementation Plan.

## Blockers / open questions
- None. Two known gaps are recorded in the spec's § Non-goals rather than left open: there is no
  `retried_from_run_id` column, and `paused` is a status nothing writes. Both deserve their own issues.

## Environment caveats
- Dev runtime runnable: not needed — docs-only run, no app boot required.
- Browser / UI checks: done. The static prototype rendered clean in both themes; the localhost server
  was terminated immediately afterwards.
- Database/migration state: untouched. No entity, column, migration, or snapshot change in scope.

## Worktree
- Path: /Users/jacek/conductor/workspaces/open-mercato/richmond-v5
- Created this run: no — the session was already inside a linked worktree, so it was reused per
  `references/worktree-setup.md`. Nothing to clean up.

## Remote note
- `origin` (`open-mercato/open-mercato`) is read-only for this account (`TRIAGE`). The branch lives on
  `fsh` (`fullstackhouse/open-mercato`) and the PR is cross-repository into `develop`, matching how
  every sibling PR from this account is opened.
