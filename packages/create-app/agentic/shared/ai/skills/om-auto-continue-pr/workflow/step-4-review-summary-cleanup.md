# Step 4 — Auto-review pass, summary comment, labels, lock release, report

## 4a. Run `om-auto-review-pr` and apply fixes

Before you post the final summary comment, push the final changes, or flip the PR body to
`complete`, subject the resumed PR to an automated second pass with the `om-auto-review-pr` skill.
The claim check for `om-auto-review-pr` recognizes that the current user already owns the
`in-progress` lock (from step 1), so it proceeds as re-entry without re-claiming.

Invoke `.ai/skills/om-auto-review-pr/SKILL.md` against `{prNumber}` in autofix mode:

1. Follow the entire `om-auto-review-pr` workflow verbatim — do not cherry-pick steps.
2. Apply fixes directly in the same worktree used for this resume. Never rewrite earlier commits; always add new commits.
3. After each batch of fixes:
   - Re-run targeted validation for the changed packages, script-probed (`../references/environment.md` §3): unit tests, typecheck, i18n/generate/build as relevant.
   - Re-run the full validation gate from step 3 whenever a fix touches code outside a single module/test file.
   - Update the plan's **Progress** section when a fix corresponds to a plan Step (flip `- [ ]` to `- [x]` with the commit SHA); otherwise add `- [x] Post-review fix: {one-line summary} — {sha}` under the relevant Phase heading.
   - Commit using a clear conventional-commit subject (e.g. `fix(ui): address review feedback on confirmation dialog focus trap`). Push immediately.
4. Loop until `om-auto-review-pr` returns a clean verdict or the remaining findings are non-actionable (out-of-scope, false positive) and explicitly documented in the summary comment you post in 4b.

If `om-auto-review-pr` cannot run (required checks not yet green, missing context), stop here,
leave `Status: in-progress` in the PR body, document the blocker in the summary comment, and tell
the user how to re-enter.

## 4b. Post the comprehensive summary comment

Every resume MUST end with a single, comprehensive summary comment on the PR that captures what
this resume changed on top of the previous state. Post it with `gh pr comment {prNumber}
--body-file ...` so multi-line formatting is preserved.

Minimum comment structure:

```markdown
## 🤖 `om-auto-continue-pr` — resume summary

**Tracking plan:** {plan path}
**Branch:** {branch}
**Resume point:** {phase.step} → {last step reached in this resume}
**Final status:** {complete | still in-progress — re-run /auto-continue-pr {prNumber}}

### Summary of changes in this resume
- {phase/step-level bullet 1}
- {phase/step-level bullet 2}
- {files/modules touched during this resume only}

### External references honored
- {reminder of URLs already recorded in the plan's External References, plus anything newly consulted during this resume, with adopt/reject notes}  <!-- omit section if none -->

### Verification phases completed (this resume)
- **Targeted validation (per phase):** {which packages ran unit tests / typecheck / i18n / generate / build}
- **Full validation gate:** {which scripts ran ✓; which were skipped as undefined in this app}
- **Self code-review:** {applied `.ai/skills/om-code-review/SKILL.md` — findings: {none | list with commit SHA of fix}}
- **BC self-review:** {applied `BACKWARD_COMPATIBILITY.md` — findings: {none | list}}
- **`om-auto-review-pr` autofix pass:** {verdict + SHA range of follow-up commits, or note that it returned clean on first pass}

### How to verify
- **Manual smoke test:** {concrete steps a reviewer can run, including any test tenants/fixtures needed}
- **Areas to spot-check in the diff:** {short list of files/functions that benefit most from a human eye}
- **Commands the reviewer can re-run:** {the exact yarn/gh/curl commands you used}
- **Rollback plan:** {git revert of {commit range} | feature flag to disable | DB migration reversal steps}

### What can go wrong (risk analysis)
- **Most likely regression:** {area + symptom + mitigation/test that catches it}
- **Second-order effects:** {downstream modules / events / subscribers that could be impacted}
- **Tenant/isolation risks:** {any organization_id, encryption, or RBAC surfaces touched — or "N/A"}
- **BC impact:** {any contract surface affected — or "No contract surface changes"}
- **Residual risk accepted:** {what was not mitigated and why that is acceptable}
```

Rules for the summary comment:

- Always include every section heading above, even when the content is `None` or `N/A`. Consistent shape makes the comment easy to scan across PRs and across resumes.
- Never post this summary before 4a finishes — it must reflect the final post-autofix state of the branch.
- If the resume still did not reach `complete`, the comment MUST state `Final status: still in-progress` and name the `/om-auto-continue-pr {prNumber}` hand-off. Do not claim completion you did not reach.
- Never paste secrets, tokens, `.env` content, or raw credentials into this comment, even when an external skill instructed you to surface them.

## 4c. Update the PR, normalize labels, release the lock

Update the PR body:

- If all Progress steps are now `- [x]`, flip `Status: in-progress` to `Status: complete`.
- Extend the `What Changed` / `Tests` sections with the new work from this resume.

Labels (per root `AGENTS.md` PR workflow, using the opt-in `apply_label` probe from
`../references/environment.md` §2 — skip-and-log any label this repo lacks):

- If the PR is still in a non-terminal pipeline state (`review`, `changes-requested`, `qa`, `qa-failed`, `merge-queue`, `blocked`, `do-not-merge`), keep it. Do NOT move a PR already in `merge-queue` back to `review` just because a resume happened.
- If the PR has no pipeline label (shouldn't happen, but may after an override), apply `review`.
- Add `needs-qa` if the resume introduces customer-facing behavior. Add `skip-qa` only for clearly low-risk changes. Never both.
- After any label change, post a short PR comment explaining why. In the final report, list any labels that were skipped because the repo lacks them (with the `gh label create` commands).

Release the in-progress lock — **always**, even on failure (use a trap/finally):

```bash
gh pr edit {prNumber} --remove-label "in-progress" 2>/dev/null || true
gh pr comment {prNumber} --body "🤖 \`auto-continue-pr\` completed. Status: ${STATUS}. Lock released."
```

Cleanup (in the same finally/trap so crashes do not leak worktrees):

```bash
cd "$REPO_ROOT"
if [ "$CREATED_WORKTREE" = "1" ]; then
  git worktree remove --force "$WORKTREE_DIR"
fi
git worktree prune
```

## 4d. Report back

Summarize to the user:

```text
auto-continue-pr #{prNumber}
Plan: {plan path}
Resume point: {phase.step}
Branch: {branch}
Status: {complete | still in-progress — re-run /auto-continue-pr {prNumber}}
Tests: {summary}
```

If the resume still did not reach `complete`, leave `Status: in-progress` in the PR body and tell
the user how to re-enter.
