# Step 6 — Auto-review pass, summary comment, cleanup, report

## 6a. Run `om-auto-review-pr` and apply fixes

Before posting the final summary, pushing the last commits, or reporting back, subject the PR to
an automated second pass with `.ai/skills/om-auto-review-pr/SKILL.md` against `{prNumber}` in
autofix mode.

**Release the `in-progress` lock before invoking `om-auto-review-pr`** so the reviewer skill can
claim it cleanly with its own three-signal protocol:

```bash
gh pr edit {prNumber} --remove-label "in-progress"
gh pr comment {prNumber} --body "🤖 \`auto-create-pr-loop\` releasing lock so \`auto-review-pr\` can claim it."
```

`om-auto-review-pr` re-applies `in-progress` per its own workflow and releases it when done. When
it returns (clean verdict or non-actionable findings only), **reclaim the lock** before posting
the summary comment:

```bash
gh pr edit {prNumber} --add-label "in-progress"
gh pr comment {prNumber} --body "🤖 \`auto-create-pr-loop\` reclaiming lock to post the final run summary."
```

Invoke it against `{prNumber}` in autofix mode:

1. Follow the entire `om-auto-review-pr` workflow verbatim — do not cherry-pick steps.
2. When it flags actionable issues, apply fixes directly in the same worktree. Never rewrite earlier commits; always add new commits under a new Step id (e.g. `X.Y-review-fix`) appended to the Tasks table. Each review-fix Step is still lean: one commit, flip the Tasks row in the same commit, no per-Step checks/handoff files.
3. After each batch of fixes:
   - Run a quick scratch sanity check (typecheck + affected tests).
   - When the batch closes — or every 5 review-fix Steps, whichever comes first — run a checkpoint pass per `step-3-implement-and-checkpoint.md` §3b (commit as `docs(runs): checkpoint N — review fixes`).
   - When the review-fix batch is fully applied, re-run the full final gate (`step-4-final-gate.md`) whenever a fix touches code outside a single module/test file.
   - Commit each Step with a clear conventional-commit subject (e.g. `fix(ui): address review feedback on confirmation dialog focus trap`). Push immediately.
4. Loop until `om-auto-review-pr` returns a clean verdict or the remaining findings are non-actionable and documented in the summary.

If `om-auto-review-pr` cannot run (required checks not yet green, missing context), escalate:
leave `Status: in-progress` in the PR body, stop here, and report the blocker so the user can
resume via `om-auto-continue-pr-loop`.

## 6b. Post the comprehensive summary comment

End every run with a single `gh pr comment {prNumber} --body-file …` the reviewer can read
top-to-bottom. Post it with `--body-file` so multi-line formatting is preserved. Keep all
headings stable across runs:

```markdown
## 🤖 `om-auto-create-pr-loop` — run summary

**Tracking plan:** .ai/runs/${DATE}-${SLUG}/PLAN.md
**Run folder:** .ai/runs/${DATE}-${SLUG}/
**Branch:** ${BRANCH}
**Final status:** {complete | in-progress — use /auto-continue-pr {prNumber}}

### Summary of changes
- {phase-level bullets; files/modules touched at a glance}

### External references honored
- {URL — adopted / rejected}  <!-- omit if no --skill-url -->

### Verification phases completed
- **Checkpoint verification (every ~5 Steps):** `.ai/runs/${DATE}-${SLUG}/checkpoint-<N>-checks.md` with optional `checkpoint-<N>-artifacts/` (Playwright transcripts + screenshots when UI was touched).
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

Rules: include every heading even when `None`/`N/A`; never post before 6a finishes (must reflect
the final post-autofix state); if still `in-progress`, say so and name the
`/om-auto-continue-pr-loop {prNumber}` hand-off — do not claim completion you did not reach; never
paste secrets/tokens/`.env`.

## 6c. Cleanup and lock release

Run cleanup in a finally/trap so crashes do not leak worktrees or locks:

```bash
cd "$REPO_ROOT"
if [ "$CREATED_WORKTREE" = "1" ]; then git worktree remove --force "$WORKTREE_DIR"; fi
git worktree prune

# Release the in-progress lock on the PR — always, even on failure.
if [ -n "${PR_NUMBER:-}" ]; then
  gh pr edit "$PR_NUMBER" --remove-label "in-progress" || true
  gh pr comment "$PR_NUMBER" --body "🤖 \`auto-create-pr-loop\` completed. Status: ${STATUS}. Lock released."
fi
```

If the PR was opened, write a final entry into `HANDOFF.md` (state: complete or in-progress) and
`NOTIFY.md` (closing timestamp + PR URL), commit, and push **before** releasing the `in-progress`
label so the final tracking-file update lands under the same lock.

## 6d. Report back

Summarize to the user:

```text
auto-create-pr-loop: {brief}
Run folder: .ai/runs/${DATE}-${SLUG}/
Plan: .ai/runs/${DATE}-${SLUG}/PLAN.md
Branch: {branch}
PR: {url}
Status: {complete | partial — use auto-continue-pr <prNumber>}
Tests: {summary}
Handoff: .ai/runs/${DATE}-${SLUG}/HANDOFF.md
Notifications: .ai/runs/${DATE}-${SLUG}/NOTIFY.md
```

If the run ends before the full gate passes (timeout, external blocker), leave `Status:
in-progress` in the PR body, ensure `HANDOFF.md` points to the first unchecked Step, append a
NOTIFY entry naming the blocker, and tell the user to resume with `auto-continue-pr {prNumber}`.
