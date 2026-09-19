# Notify — 2026-09-19-market-display-profile-wave1b

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-19T14:17:01Z — run started
- Brief: implement the remaining Phase 2 steps of `.ai/specs/2026-09-18-market-display-profile.md` (P2.2, P2.3, P2.4,
  P2.6 through P2.14); P2.1 and P2.5 landed on `develop` through PR #5; Phase 3 stays deferred.
- External skill URLs: none
- Routing: `om-auto-implement-spec` forwarded `--loop`, so `om-auto-create-pr` handed off to `om-auto-create-pr-loop`
  at the slot check without a step count.
- Decision: every Step is `inline`. The fourteen Steps share one descriptor and one set of helpers, so splitting them
  across executor subagents would make each re-derive the same context.
- Decision: the spec document itself is not committed on this branch. It merges through its own spec PR #1; it was
  checked out into the worktree only so the engine can read it.

## 2026-09-19T14:54:24Z — checkpoint 1
- Steps covered: 2.2a, 2.2b, 2.3, 2.4, 2.6a (commits 0e94e1179..71102151b).
- Targeted validation green: typecheck (shared, ui, core), the display/addressFormat/customers/calendar/sales test
  suites, `yarn generate` with no drift, `yarn build:packages`, `yarn i18n:check-sync`.
- UI verification skipped, with reason: the slot is attached to the shared instance database (no migration in this
  run, so `omw up` was correct), whose admin credentials this run does not hold, and writing the US market profile
  row needed to demonstrate the change would alter every other slot's rendering. Deferred to the final gate under
  `omw up --fresh`.
- Decision: the run fixed a pre-existing rules-of-hooks defect found in Step 2.4 (`MonthGrid.buildWeeks` called
  `useDisplayProfile()` from inside a `useMemo`) rather than routing around it.
- Decision: one no-profile rendering change was accepted and documented in Step 2.3 - the company card's
  "today, HH:MM" stamp moved to the short time style (`3:45 PM` in place of `03:45 PM` under an English UI).

## 2026-09-19T15:25:06Z — checkpoint 2
- Steps covered: 2.6b, 2.7, 2.8, 2.9, 2.10, 2.11 (commits 9fd947875..c80d7ad7d).
- Repo-wide typecheck (38 packages) and the full core, shared and ui suites are green; `yarn generate` shows no
  drift and all five locales are in sync.
- Problem found and fixed: `salesComponentsRender > renders tax rates settings rows` asserted `/VAT/`, which was
  matching the section description rather than any table row (the suite's DataTable stub never renders this
  component's row shape). Step 2.9's rewording exposed it. The assertion now counts the row, like its siblings.
- Decision: Steps 2.8 and 2.10 shipped smaller than the spec implies, for reasons recorded in their commits - the
  catalog tax fields already existed from PR #5, and the WMS warehouse dialog has no address layout to apply.
- UI verification still deferred to the final gate on `omw up --fresh`, for the reason recorded at checkpoint 1.

## 2026-09-19T16:32:05Z — final gate
- All fourteen Steps done. `origin/develop` (63bebfea9) merged in.
- Full `validation.commands` gate green in order, plus the design-system pass (one finding, fixed as `2.8-ds-fix`).
- Blocker worked around, not hidden: `yarn test` fails the `@open-mercato/cli` suite on this host because `TMPDIR`
  points inside the repository; re-run green with `TMPDIR` outside and `turbo --env-mode=loose`. The branch contains
  no commit touching `packages/cli`.
- Integration suite skipped, reason recorded: no seeded live environment could be brought up on this slot.
- UI verification attempted on a fresh slot database and abandoned: `omw up --fresh` left `apps/mercato/.env`
  pointing at the framework default database (fixed by hand, `yarn initialize` then succeeded), but the dev server
  never finishes compiling `/login` (`ERR_IMPORT_ATTRIBUTE_MISSING` on `language-subtag-registry` under Node 24).
  Neither failure is attributable to this branch. No screenshots exist; the PR carries `needs-qa`.
- Decision: the PR is left a **draft** on purpose - the task states the release step of this workflow merges and
  publishes it, which overrides the engine's default ready flip.

## 2026-09-19T16:48:16Z — review pass and run end
- `om-auto-review-pr 7 --autofix` run. Verdict: approve, posted as a comment because GitHub refuses an approving
  review from the PR author - a human approval is still outstanding, so the PR stays in `review`, not `merge-queue`.
- One major defect found in this run's own diff and fixed as Step `2.13-review-fix`: the market-aware CSV export ran
  formatted numbers through the spreadsheet-formula guard, whose pattern matches a leading minus, so every negative
  amount exported as `'-1,234.50`. The existing test missed it by asserting a substring the escaped cell contained.
- Two further no-market rendering changes were found during review and disclosed in the PR body rather than reverted
  (the sales documents date column and the tax breakdown stamp moving to the `formatDisplayDate*` primitive).
- Full gate re-run green after the fix: 46 test tasks, typecheck across 38 packages.
- Run ended. PR #7 left as a draft on purpose; lock released; labels `review feature needs-qa priority-medium
  risk-medium`.
