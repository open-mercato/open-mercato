# Execution plan — translate users list column headers (adopted from PR #5842)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-09-02 because PR #5842 carried no execution plan (it was opened by the `om-auto-fix-issue` chain, which does not write a `Tracking plan:` line).
**PR:** #5842 · **Branch:** `fix/issue-5652-untranslated-pl-strings` · **Base:** `develop`
**Author:** @adeptofvoltron (this run's own automation identity — the plan reconstructs and continues its own prior chain, not a third party's intent)

## 🎯 Goal
Ship the already-implemented fix for #5652 (hardcoded English column headers on `/backend/users`) through UI QA verification and PR finalization.

## Scope
- UI QA verification of the Polish-locale column headers on `/backend/users` (`om-auto-qa-pr`).
- PR finalization: summary comment, label normalization, lock release.

## Non-goals
- No further code changes to `packages/core/src/modules/auth/**` — the fix, tests, and full validation gate are already complete and reviewed (see Phase 1).
- Not fixing the other pages named in issue #5652's screenshots (`/backend/roles/create`, `/backend/users/create`, portal landing, portal notifications) — the author already investigated and could not reproduce hardcoded strings there; PR body explicitly flags this as a follow-up QA spot-check, not in scope for this PR.

## Evidence
| Conclusion | Drawn from | Confidence |
|---|---|---|
| The fix, tests, and validation gate are already done | PR body "What Changed"/"Tests" sections; single commit `16bf08ffc8` on the branch; `om-auto-review-pr`'s own review comment reporting the full gate green | high |
| The code review already reached a clean approve verdict | `om-auto-review-pr` review comment (2026-09-02T12:18:37Z): "✅ approve — no blocker or major findings" | high |
| The PR could not be self-approved on GitHub (bot account opened it) | `om-auto-review-pr` completion comment: "Could not submit a formal GitHub approval on this run's own PR" | high |
| UI QA verification was started but never finished | `om-auto-qa-pr` comment "starting UI verification" (12:19:48Z) with no further PR activity in the ~19 minutes since; worktree shows an uncommitted `.ai/qa/test-env-*` fingerprint from a partially-built test env, no screenshots or report | high |
| The remaining work is exactly: finish QA, then finalize | Direct consequence of the above — nothing else is outstanding per the PR body's own "Note for reviewers/QA" section | high |

## Assumptions
- The stray uncommitted `packages/ui/src/backend/icons/lucideRegistry.generated.tsx` diff and `.ai/qa/test-env-*` files found in the reused worktree are leftovers from the crashed `om-auto-qa-pr` run (an unrelated icon added by `yarn generate` picking up drift elsewhere on `develop`, plus a test-env fingerprint/port file) — not part of this PR's intended diff. Left uncommitted and untouched; they do not block QA or finalization.
- Since the worktree's `HEAD` (`16bf08ffc8`) still matches the PR head exactly and no code changed, the full `validation.commands` gate result already reported by `om-fix`/`om-auto-review-pr` against this same commit is reused rather than re-run from scratch (matches the precedent already set in the review comment). It will be re-run only if QA verification surfaces a real defect requiring a code change.

## Risks
- Low. No code change is anticipated; the only remaining risk is a genuine QA failure (headers not rendering correctly in Polish), which would require a follow-up code fix and a full gate re-run before this plan can complete.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Implement the i18n fix (`t()` wiring in `page.tsx` + locale keys in 5 locale files) and the regression test — 16bf08ffc8
- [x] 1.2 Full validation gate run and passed (`build:packages`, `generate`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `test`, `build:app`) — 16bf08ffc8
- [x] 1.3 Code review pass — clean approve verdict, QA instructions posted — 16bf08ffc8

### Phase 2: Finish UI QA verification

- [ ] 2.1 Run `om-auto-qa-pr` (or the equivalent manual browser verification) against the already-posted QA instructions: Polish-locale `/backend/users` headers, plus an English-locale regression check
- [ ] 2.2 Post QA evidence (screenshots + pass/fail) on the PR

### Phase 3: Finalize the PR

- [ ] 3.1 Post the comprehensive resume summary comment
- [ ] 3.2 Normalize labels per QA outcome; keep `review` pipeline label (self-approval still blocked) unless QA fails
- [ ] 3.3 Release the `in-progress` lock
