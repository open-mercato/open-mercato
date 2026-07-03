# Step 5 — Auto-review pass, summary comment, PR update, labels, cleanup, report

## 5a. Run `om-auto-review-pr` and apply fixes

Before posting the final summary comment, pushing the final changes, or flipping the PR body to
`complete`, subject the resumed PR to an automated second pass with
`.ai/skills/om-auto-review-pr/SKILL.md` against `{prNumber}` in autofix mode. The claim check for
`om-auto-review-pr` recognizes that the current user already owns the `in-progress` lock (from
`step-1`) and proceeds as re-entry without re-claiming.

1. Follow the entire `om-auto-review-pr` workflow verbatim — do not cherry-pick steps.
2. Apply fixes directly in the same worktree used for this resume. Never rewrite earlier commits; always add new commits under a new Step id (e.g. `X.Y-review-fix`) appended to the Tasks table. Each review-fix Step is lean: one commit, flip the Tasks row in the same commit, no per-Step checks/handoff files.
3. After each batch of fixes:
   - Run a quick scratch sanity check (typecheck + affected tests).
   - When the batch closes — or every 5 review-fix Steps, whichever comes first — run a checkpoint pass per `step-3-resume-loop-and-checkpoint.md` §3b (commit as `docs(runs): checkpoint N — review fixes`).
   - Re-run the full final gate (`step-4-final-gate.md`) whenever a fix touches code outside a single module/test file.
   - Commit each Step with a clear conventional-commit subject (e.g. `fix(ui): address review feedback on confirmation dialog focus trap`). Push immediately.
4. Loop until `om-auto-review-pr` returns a clean verdict or the remaining findings are non-actionable (out-of-scope, false positive) and explicitly documented in the summary comment.

If `om-auto-review-pr` cannot run (required checks not yet green, missing context), stop here, leave
`Status: in-progress` in the PR body, update `HANDOFF.md` + `NOTIFY.md` with the blocker, and tell
the user how to re-enter.

## 5b. Post the comprehensive summary comment

Every resume MUST end with a single `gh pr comment {prNumber} --body-file …` that captures what
this resume changed on top of the previous state (use `--body-file` so multi-line formatting is
preserved). Keep all headings stable across runs:

```markdown
## 🤖 `om-auto-continue-pr-loop` — resume summary

**Tracking plan:** {plan path}
**Run folder:** {run folder path}
**Branch:** {branch}
**Resume point:** {phase.step} → {last step reached in this resume}
**Final status:** {complete | still in-progress — re-run /auto-continue-pr-loop {prNumber}}

### Summary of changes in this resume
- {step-level bullets; files/modules touched during this resume only}

### External references honored
- {URLs from the plan's External References + anything newly consulted, with adopt/reject notes}  <!-- omit if none -->

### Verification phases completed (this resume)
- **Checkpoint verification (every ~5 Steps in this resume):** `{run-folder}/checkpoint-<N>-checks.md` with optional `checkpoint-<N>-artifacts/`.
- **Per-checkpoint validation:** {which packages ran typecheck / unit tests / i18n / generate / build}
- **Focused integration tests per checkpoint (UI-touched windows):** {which `.ai/qa/tests/...` folders were exercised}
- **Full validation gate (at spec completion):** {which scripts ran ✓; which were skipped as undefined in this app}
- **Full integration suite:** {yarn test:integration ✓ / ✗ — summary + link to HTML report}
- **Standalone integration:** {yarn test:create-app:integration ✓ / ✗ / skipped with reason}
- **ds-guardian pass:** {auto-fixes applied (SHA range) | clean | residual findings in final-gate-checks.md}
- **Self code-review:** {findings: none | list with fix SHA}
- **BC self-review:** {findings: none | list}
- **`om-auto-review-pr` autofix pass:** {verdict + follow-up SHA range, or clean on first pass}

### How to verify
- **Manual smoke test:** {concrete local steps + any test tenants/fixtures needed}
- **Areas to spot-check:** {files/functions that benefit most from a human eye}
- **Commands to re-run:** {the exact yarn/gh/curl commands you used}
- **Rollback plan:** {git revert of {commit range} | feature flag | DB migration reversal}

### What can go wrong (risk analysis)
- **Most likely regression / second-order effects / tenant-isolation / BC impact / residual risk accepted**
```

Rules: include every heading even when `None`/`N/A`; never post before 5a finishes (must reflect the
final post-autofix state); if the resume still did not reach `complete`, say
`Final status: still in-progress` and name the `/om-auto-continue-pr-loop {prNumber}` hand-off — do
not claim completion you did not reach; never paste secrets/tokens/`.env`.

## 5c. Update the PR body, normalize labels

Update the PR body:

- If every row in the Tasks table now has `Status: done`, flip the PR body's `Status: in-progress` to `Status: complete`.
- Extend the `What Changed` / `Tests` sections with the new work from this resume.

Labels (opt-in probing per `../references/environment.md` §2 — skip-and-log any label the repo does
not define):

- If the PR is still in a non-terminal pipeline state (`review`, `changes-requested`, `qa`, `qa-failed`, `merge-queue`, `blocked`, `do-not-merge`), keep it. Do NOT move a PR already in `merge-queue` back to `review` just because a resume happened.
- If the PR has no pipeline label (shouldn't happen, but may after an override), apply `review`.
- Add `needs-qa` if the resume introduces customer-facing behavior. Add `skip-qa` only for clearly low-risk changes. Never both.
- After any label change, post a short PR comment explaining why.

## 5d. Cleanup and lock release

Final tracking-file updates before releasing the lock:

- Rewrite `HANDOFF.md` one last time with either "complete" or "still in-progress — next Step: X.Y".
- Append a closing `NOTIFY.md` entry with the final status, PR URL, and any carry-forward notes.
- Commit and push as `docs(runs): finalize handoff for ${SLUG}` **before** releasing the lock so the final tracking-file update lands under the same lock.

Run cleanup in a finally/trap so crashes do not leak worktrees or locks:

```bash
cd "$REPO_ROOT"
if [ "$CREATED_WORKTREE" = "1" ]; then git worktree remove --force "$WORKTREE_DIR"; fi
git worktree prune

# Release the in-progress lock on the PR — always, even on failure.
gh pr edit {prNumber} --remove-label "in-progress" || true
gh pr comment {prNumber} --body "🤖 \`auto-continue-pr-loop\` completed. Status: ${STATUS}. Lock released."
```

## 5e. Report back

Summarize to the user:

```text
auto-continue-pr-loop #{prNumber}
Run folder: {run folder path}
Plan: {plan path}
Resume point: {phase.step}
Branch: {branch}
Status: {complete | still in-progress — re-run /auto-continue-pr-loop {prNumber}}
Tests: {summary}
Handoff: {run folder}/HANDOFF.md
Notifications: {run folder}/NOTIFY.md
```

If the resume still did not reach `complete`, leave `Status: in-progress` in the PR body, ensure
`HANDOFF.md` names the first unchecked Step, append a NOTIFY entry naming the blocker, and tell the
user to resume with `/auto-continue-pr-loop {prNumber}`.
