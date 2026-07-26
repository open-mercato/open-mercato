# State matrix — which chain a PR needs

Evaluate rows **top to bottom** against the PR State Report. A PR normally
matches several rows: run every matched row in this order, skipping any whose
exit condition already holds after the previous step. Re-read the cheap signals
(CI, review decision, mergeability) between steps — a step can change what is
left to do.

| # | State signal | Chain step | Exit condition |
|---|---|---|---|
| 0 | `state != OPEN` (merged/closed) | **stop** — report and exit | — |
| 0b | Active GitHub account is not `wojciechszyjka` | **stop** — wrong identity | — |
| 0c | Hard block present: `do-not-merge`, `blocked`, `qa-failed` | **stop** unless the user explicitly says to work through it; report the blocker | — |
| 1 | Plan exists with pending steps (`- [ ]` / non-`done` rows) | `om-auto-continue-pr {pr}` — or `om-auto-continue-pr-loop {pr}` when the tracking line points at a **run folder** | all plan steps done |
| 2 | `plan: none` and the diff does not implement the linked issue | **ask the user** — an unplanned, incomplete PR is a scope decision, not a dispatch one | user answers |
| 3 | Spec-only diff (`.ai/specs/**` only) | `om-auto-review-pr {pr}` (specification review). **Never** grow it into implementation — that ships via `om-auto-implement-spec` on its own PR | spec review submitted |
| 4 | `mergeStateStatus` is `CONFLICTING` or `BEHIND` | `om-auto-fix-pr {pr}` (it merges the base **first**, before review or CI work) | `MERGEABLE` |
| 5 | Review is `NONE` / `REVIEW_REQUIRED`, or `CHANGES_REQUESTED`, or unresolved threads > 0 | `om-auto-fix-pr {pr} --max-iterations <n>` on your own PR (review + autofix + CI + UI in one loop). On **someone else's** PR: `om-auto-review-pr {pr}` only — review and hand off, no autofix, unless the user explicitly asked for it | approvable, no unresolved blocking threads |
| 6 | CI red, everything else already fine | `om-auto-fix-pr {pr} --ci-only` | all required checks green |
| 7 | Diff is UI-touching and there is no QA evidence (`needs-qa` without `qa-approved`/`screenshots`) | `om-auto-qa-pr {pr}` — capture screenshots and a pass/fail report | evidence attached, or a documented reason UI QA cannot run |
| 8 | Review findings intentionally not fixed (nits, low severity, out of scope) | `om-followup-issue-from-pr` per finding, idempotently | each finding tracked |
| 9 | Approvable + green + QA satisfied (`qa-approved` present, or `skip-qa`, or non-user-facing) | **default: stop at merge-ready** and report. With `--allow-merge`: `om-approve-merge-pr {pr}` | reported / merged |
| 10 | Merge-ready but the QA gate is unmet (`needs-qa`, no `qa-approved`) | **stop** — request QA sign-off in the summary comment; never self-apply `qa-approved` without real self-QA evidence | reported |

## Notes that change the chain

- **Fork PR** (`isCrossRepository: true`): you cannot push to the contributor's
  branch. Do not force a base merge — `om-auto-fix-pr` hands that to
  `om-auto-review-pr`'s fork carry-forward flow, which opens a credited
  replacement PR (`Supersedes #…`, reassigned to the original author). From then
  on `{prNumber}` means the replacement.
- **Draft PR**: diagnose and fix normally; promotion to ready happens inside
  `om-auto-fix-pr`'s merge-prep step, not here. A spec-only design PR and any PR
  carrying `⚠ NEEDS HUMAN CONFIRMATION` stay draft.
- **Row 1 and row 5 both matched**: finish the implementation first. Reviewing an
  unfinished PR burns a review cycle on code that is about to change.
- **`om-auto-fix-pr` already contains** review + CI + UI QA + follow-ups. When
  row 5 runs it, rows 6–8 are usually satisfied by it — re-diagnose and skip them
  rather than running them twice.
- **Self-QA exception** (row 7/10): permitted only after actually running the
  branch locally and clicking the flow through, with evidence attached to the PR.
  Then both `qa-approved` and `qa-self-verified` go on. Never one without the
  evidence.
