# Execution plan — make the weekly timesheet grid reject unparseable durations instead of silently storing a clamped 24-hour day (adopted from PR #4966)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-04 because PR #4966 carried no execution plan. It was opened by the `om-auto-fix-issue` chain (`om-verify-in-repo` → `om-root-cause` → `om-fix` → `om-open-pr` → `om-auto-review-pr` → `om-auto-qa-pr`), which writes no `.ai/runs` plan of its own; the chain then stopped mid-way through its UI-QA step, leaving the PR complete on code but unverified in a browser.
**PR:** #4966 · **Branch:** `fix/issue-4846-staff-timesheet-duration-parsing` · **Base:** `develop`
**Author:** @adeptofvoltron — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Every duration typed into the weekly timesheet grid is either understood exactly as typed (`1:30`, `1.5`, `1,5`, `90m`, `1h 30m`, bare decimal hours) or rejected with a visible inline error that blocks the save — never silently coerced into a clamped, plausible-looking 24-hour day (issue #4846).

## Scope

- `packages/core/src/modules/staff/lib/timesheetsDuration.ts` — the module-internal duration parser/formatter.
- `packages/core/src/modules/staff/backend/staff/timesheets/page.tsx` — the weekly/monthly grid: cell input handling, per-cell error state, Save gating, format hint, confirm-dialog summary, DS status tokens.
- `packages/core/src/modules/staff/i18n/{en,de,es,ko,pl}.json` — the new `staff.timesheets.my.duration.*` and `confirm_save.summary` keys.
- Unit coverage for the parser and for the page-level "an invalid cell cannot reach the API" guarantee.
- Browser verification of the grid, because the change is entirely user-facing.

## Non-goals

- **Reinterpreting a bare number as minutes.** Issue #4846's example list implies `90` should mean 90 minutes; bare numbers stay decimal **hours** so a habitual `8` does not silently become 8 minutes. The reported `30 → 24:00` symptom is fixed by surfacing it as a visible `out_of_range` error instead. This trade-off is stated in the PR body and is open to maintainer override.
- **Unifying every entry point in the staff module** behind the new parser. The issue's "one shared duration parser for every entry point" is satisfied for the grid only; the timer bar and the list-view entry form keep their current inputs. Extending the parser to them belongs in a follow-up issue, not in a bug fix for the grid.
- **Promoting the parser into `@open-mercato/shared`.** It stays module-internal so this fix does not mint a new public contract surface for a module slated for extraction.
- **Anything the browser pass discovers that is pre-existing on `develop`.** Those become follow-up issues, not scope on this PR.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The goal is to stop silent coercion of mistyped durations and surface a rejection instead | Issue #4846 title, its typed→stored table, and its "Suggested fix" paragraph | high |
| The fix itself is already implemented and landed | The PR diff (9 files) and `git log origin/develop..HEAD` — `5654f88` (fix + parser + i18n + 35 parser tests) and `975f59dc` (review follow-up) | high |
| Code review is already done and returned a clean verdict on the current head | The `om-auto-review-pr` review of record posted 18:54:03Z on `975f59dc`: no blockers, one major and one minor found, fixed and pushed in the same run | high |
| Formal approval cannot come from this chain | The same comment: GitHub refuses `Review Can not approve your own pull request` because this account authored the PR | high |
| The remaining work is browser verification | The `om-auto-review-pr` completion comment naming `om-auto-qa-pr` as the next chain step, and that skill's take-over comment at 18:55:49Z with no result posted after it | high |
| The QA run got as far as step 3 and then failed | `.ai/qa/qa-run-4966/test-results/.last-run.json` (`status: failed`), three captured screenshots (`step-01`..`step-03`), and the recorded assertion failure: after saving `1:30` the grid renders `""` instead of `1.5` on revisit | high |
| That failing assertion is about persisted-entry rendering, not about parsing | The same error context: the API assertion `duration_minutes === 90` passed before it, so the value reached the database correctly; the failing expectation is the post-reload grid render | high |
| Whether that failure is a regression or pre-existing is undetermined | The previous run authored `probe.qa.spec.ts` (a pre-existing 90-minute entry rendering as `1.5`, with no save involved) precisely to settle it, and died before running it | high |
| `needs-qa` is mandatory here and cannot be waived | `AGENTS.md` automated-verification exemption — the diff changes a `.tsx` page outside tests | high |
| Required CI is not green yet | `gh pr checks 4966` at 19:07Z: `audit-scope`, `lint`, `prepare` pending; `license/cla` passed | high |

## Assumptions

- **The chain is dead, not running.** No agent process is alive against this worktree and the newest 🤖 comment is a take-over with no result behind it, so this is a crashed run rather than a live one. If a background run does resurface, its pushes and mine would collide on the same branch — the most reversible reading was to verify first (process check) and then resume, rather than to leave a claimed PR stranded.
- **Adoption ran in `auto` mode rather than `ask`.** The default with a user in the loop is `ask`, which lands the plan and stops for confirmation. I continued instead because the goal here is *stated* rather than inferred — the PR body, issue #4846 and the chain's own comments name both the objective and the exact stopping point — and because stopping would have left a failed QA assertion undiagnosed on a `priority-high` PR. Contradict this by amending the plan or commenting on the PR.
- **The post-revisit render failure is treated as a genuine finding until proven otherwise**, not as harness flake. Classifying it (regression vs pre-existing on `develop`) is step 2.1 and gates whether this PR grows a fix or files a follow-up.
- **`om-auto-review-pr` does not need a second full pass** unless this resume lands new code. Its review of record already covers `975f59dc`, which is still the head. A code change during step 2.3 re-triggers it.

## Risks

- The QA finding may turn out to be a regression in this PR's render path, which would reopen the code change on a PR that already passed review — the plan carries an explicit step for that outcome rather than assuming the happy path.
- The ephemeral test environment must be re-booted from scratch (the crashed run left only a stale Postgres testcontainer), so the browser pass is the slowest and most failure-prone part of this resume.
- The PR is cross-repository; pushes go to the fork head. A fork that disallowed maintainer edits would block the plan commit — not the case here, since this account authored the branch.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Add the module-internal `timesheetsDuration` parser/formatter with 35 unit cases pinning issue #4846's table — 5654f88
- [x] 1.2 Rewire the grid to store typed text verbatim, parse on blur, flag invalid cells and block Save; add the format hint, confirm-dialog summary and DS status tokens; translate five locales — 5654f88
- [x] 1.3 Address the `om-auto-review-pr` findings: page-level regression coverage for the "an invalid cell cannot reach the API" guarantee, and stop counting an invalidated cell in the grid totals — 975f59dc
- [x] 1.4 Run the full eight-command validation gate and post the review of record — 975f59dc

### Phase 2: Browser verification (the step the chain stopped in)

- [x] 2.1 Boot the ephemeral test environment and classify the crashed run's failing assertion (persisted 90-minute entry rendering as `""`) as either a regression from this PR or pre-existing behavior on `develop` — **pre-existing**, no code change: two throwaway diagnostics settled it. A 90-minute entry written through the ordinary single-entry route renders as `1.5` on a cold load, so this PR's render path is correct; priming the grid's week-list URL, posting a bulk save, and re-reading the same URL returns the pre-save payload, so the bulk route leaves the cached list stale
- [x] 2.2 Act on the classification: if it is a regression, fix it with a regression test and re-run the validation gate; if it is pre-existing, file a follow-up issue and record the finding on the PR — filed as **#4970** (the bulk route never calls `invalidateCrudCache`, which `makeCrudRoute` does on its own writes); no change to this PR's scope
- [x] 2.3 Complete the duration-entry QA scenario end to end and capture screenshots for the P0 and P1 steps — 12/12 steps green, 12 screenshots captured; the revisit assertion now flushes the stale cache through a single-entry write and asserts both the bulk-saved and the fixture-written cell, and the totals step asserts the row total falls back to the persisted value
- [x] 2.4 Post the QA evidence comment with the attached screenshots on PR #4966

### Phase 3: Finalize

- [x] 3.1 Re-run `om-auto-review-pr --autofix` if Phase 2 landed any code change, otherwise record that the existing review of record still covers the head — no product code changed in this resume (the only commits are this plan file), so the review of record on `975f59dc` still covers every code line in the diff; recorded rather than re-run
- [x] 3.2 Post the resume-summary comment, normalize the labels with rationale, and report the CI state
