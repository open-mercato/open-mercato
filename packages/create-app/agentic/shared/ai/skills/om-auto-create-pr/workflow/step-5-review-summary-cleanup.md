# Step 5 — Auto-review pass, summary comment, cleanup, report

## 5a. Run `om-auto-review-pr` and apply fixes

Before posting the summary or reporting back, subject the PR to an automated second pass with
`.ai/skills/om-auto-review-pr/SKILL.md` against `{prNumber}` in autofix mode. `om-auto-create-pr`
does not hold an `in-progress` lock at this point, so `om-auto-review-pr` claims it fresh (and
releases it per its own workflow) — that is expected.

1. Follow the entire `om-auto-review-pr` workflow verbatim.
2. Apply fixes in the same worktree; never rewrite earlier commits — always add new commits.
3. After each batch: re-run targeted validation (script-probed, `../references/environment.md` §3);
   re-run the full gate (step 3) when a fix touches code outside a single module/test file; update
   the plan's Progress (or add a `- [x] Post-review fix: … — {sha}` note); commit + push.
4. Loop until `om-auto-review-pr` returns a clean verdict or only non-actionable findings remain
   (documented in the summary).

If `om-auto-review-pr` cannot run, escalate: leave `Status: in-progress`, stop, and report the
blocker so the user can resume via `om-auto-continue-pr`.

## 5b. Post the comprehensive summary comment

End every run with a single `gh pr comment {prNumber} --body-file …` the reviewer can read
top-to-bottom. Keep all headings stable across runs:

```markdown
## 🤖 `om-auto-create-pr` — run summary

**Tracking plan:** .ai/runs/${DATE}-${SLUG}.md
**Branch:** ${BRANCH}
**Final status:** {complete | in-progress — use /auto-continue-pr {prNumber}}

### Summary of changes
- {phase-level bullets; files/modules touched at a glance}

### External references honored
- {URL — adopted / rejected}  <!-- omit if no --skill-url -->

### Verification phases completed
- **Targeted validation (per phase):** {packages × unit/typecheck/i18n/generate/build}
- **Full validation gate:** {which scripts ran ✓; which were skipped as undefined in this app}
- **Self code-review:** {findings: none | list with fix SHA}
- **BC self-review:** {findings: none | list}
- **`om-auto-review-pr` autofix pass:** {verdict + follow-up SHA range, or clean on first pass}

### How to verify
- **Manual smoke test:** {concrete local steps + fixtures}
- **Areas to spot-check:** {files/functions}
- **Commands to re-run:** {exact yarn/gh commands}
- **Rollback plan:** {git revert range | flag | migration reversal}

### What can go wrong (risk analysis)
- **Most likely regression / second-order effects / tenant-isolation / BC impact / residual risk accepted**
```

Rules: include every heading even when `None`/`N/A`; never post before 5a finishes; if still
`in-progress`, say so and name the `/om-auto-continue-pr {prNumber}` hand-off; never paste
secrets/tokens/`.env`.

## 5c. Cleanup and report

Run cleanup in a finally/trap so crashes do not leak worktrees:

```bash
cd "$REPO_ROOT"
if [ "$CREATED_WORKTREE" = "1" ]; then git worktree remove --force "$WORKTREE_DIR"; fi
git worktree prune
```

Then report to the user: brief, plan path, branch, PR url, status
(`complete` | `partial — use auto-continue-pr <prNumber>`), and a test summary. If the run ended
before the gate passed, leave `Status: in-progress` in the PR body and name the resume command.
