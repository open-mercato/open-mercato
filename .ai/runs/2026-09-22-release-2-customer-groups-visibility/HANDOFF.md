# Handoff — 2026-09-22-release-2-customer-groups-visibility

**Last updated:** 2026-09-22T18:45:00Z
**Branch:** feat/release-2-customer-groups-visibility
**PR:** https://github.com/open-mercato/open-mercato/pull/6338 (ready for review, `blocked` on #6268)
**Current phase/step:** RUN COMPLETE — all 29 Steps `done`, `Status: complete` on the PR body.
**Last commit:** 6695f9490 — docs(runs): record final gate results — 24/24 integration passing

## What just happened
- All 29 planned Steps landed across Phase 1 (customer_groups groups/memberships), Phase 2 (commercial terms), and Phase 3 (catalog-visibility library).
- Full `validation.commands` gate ran green; two real `create-mercato-app` template-sync findings were found and fixed (commit `df56fa6e2`).
- A live QA pass (disposable Postgres `om_qa_cgrp_85352`, production-mode `mercato server start`) found and fixed a pervasive wrong-API-URL-path bug across the entire admin UI (11 product files + 27 test/fixture occurrences), taking the 24-test Playwright suite from 13/24 to 23/24.
- The last failing test, TC-CGRP-016, was root-caused via temporary (fully reverted, zero git diff) debug instrumentation in `CrudForm.tsx`: the create page's async existing-groups fetch races a `.fill()` issued right after navigation, occasionally dropping the keystroke before React's `onChange` attaches. Fixed with a one-line test-only readiness wait (commit `0384b2532`) — not a product change. Full 24/24 suite now passes, verified with a clean final run.
- PR #6338 finalized: body updated (`Status: complete`, final validation summary), labels set to the mandatory deviation set (`blocked` instead of `review`, plus `feature`, `needs-qa`, `priority-medium`, `risk-high`), consolidated label-rationale comment posted, a self-review pass posted (found no blockers — `om-auto-review-pr` isn't registered as an invocable skill in this worktree's session and GitHub blocks self-approval, so this substituted a manual review-equivalent comment), outcome/handoff summary comment posted, and the PR flipped from draft to ready for review via `gh pr ready`.

## Next concrete action
- None from this run — the run is complete. The PR stays `blocked` until #6268 merges to `develop`; once it does, this branch needs a follow-up merge from `develop` (expected no-op re-stack) before the `blocked` label is lifted (see PR body `## Blocked on`).
- A human reviewer should still submit the formal GitHub approve/request-changes review — the automation account cannot self-approve its own PR.

## Blockers / open questions
- Stacked on unmerged PR #6268 — MUST NOT merge before it. Tracked via the `blocked` pipeline label for the PR's whole lifetime until then.
- The spec's §7.1 group-priority price-resolution tie-break is deliberately not implemented (would require editing #6268-owned `pricing.ts`); flagged in the PR body's "⚠️ Decision needed" section for explicit sign-off once #6268 merges.
- Sales tax-rate group picker ships inert (documented follow-up, not blocking this PR).

## Environment caveats
- Live QA server used this run (`om_qa_cgrp_85352` / port 3100) was left running at the end of this session for any immediate follow-up; it is disposable and can be torn down freely.

## Worktree
- Path: /Users/bernard/workspace/open-mercato/.ai/cezar/worktrees/18501eb5-8b15-41ac-929d-0633b3aa3903
- Created this run: no (pre-existing cezar worktree, reused)
- node_modules: installed; `yarn build:packages` and `yarn build:app` current as of the final gate run.
