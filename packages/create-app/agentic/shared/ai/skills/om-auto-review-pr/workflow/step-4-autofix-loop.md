# Step 4 — Autonomous autofix and fix-forward loop

After posting a `changes_requested` review, **immediately proceed to fix all actionable findings
without asking the user.** This skill is fully autonomous: it reviews, fixes, re-reviews, and
iterates until the PR is merge-ready or a truly critical blocker remains.

Only stop and ask the user for:

- ambiguous product/architecture decisions that could go multiple valid ways;
- missing credentials, environment access, or infrastructure failures;
- backward-compatibility breakage not covered by the deprecation protocol;
- scope expansion that fundamentally changes what the PR does.

For everything else — missing tests, code style, i18n, type errors, lint failures, missing metadata
exports, security hardening — fix autonomously. All work stays inside the isolated worktree.

## 4a. The loop

Do not stop after the first patch. Treat autofix as an iterative loop:

0. **Unit-test audit (first).** If the PR diff has no test files (`*.test.ts`, `*.spec.ts`,
   `__tests__/*`), add appropriate unit tests as the first autofix action. Every behavior change,
   bug fix, or new feature must have test coverage — non-negotiable in autofix mode.
1. Convert the current findings into a concrete fix list.
2. If the PR is conflicted, resolve conflicts against the latest base branch (`baseRefName`) first —
   always `git fetch origin "{baseRefName}"` before resolving, and only inside the isolated worktree
   or carry-forward branch, never the user's active worktree.
3. Implement the next batch of fixable findings.
4. Validate the updated code (prefer re-triggering the PR's GitHub checks; run the local gate
   script-probed via `has_script`/`run_if_present` from environment §3 for scopes CI does not cover):
   relevant unit tests and typecheck for every changed package/module; if i18n locale files changed,
   verify keys are alphabetically sorted; expand to the affected workspace scope when a fix touches
   shared contracts or multiple packages.
5. Re-run the code review on the updated diff in the same worktree.
6. If actionable findings remain, repeat from step 1.
7. Stop only when the re-review is `approved`, or a real blocker remains (ambiguous product/arch
   decision, environment/infra failure unrelated to the change, missing credentials/access).

If conflict resolution introduces new findings, keep looping instead of stopping. The goal is not
"submit one fix commit" — it is "finish the PR".

## 4b. Same-repo PRs

If the head branch is in the main repository and you have push access: implement fixes on the
checked-out PR branch, resolve base conflicts there if needed, run the loop above, then commit and
push to that branch only after the latest re-review is approvable.

- Never force-push unless the user explicitly asked.
- Prefer a normal follow-up commit.
- Use conventional-commit messages scoped to the affected area: `fix(<area>): …`, `feat(<area>): …`,
  `refactor(<area>): …`.
- Before pushing, ensure the latest cycle included unit tests, typecheck, and a fresh code review.

## 4c. Fork PRs

Do not wait on the original author and do not push to the contributor's branch by default. Instead:

1. Keep the worktree on the fetched PR head SHA so original commits/authorship are preserved.
2. Create a new branch in the main repository, e.g. `carry/pr-{prNumber}-ready`.
3. Implement fixes there.
4. Resolve any conflicts against `{baseRefName}` on that carry-forward branch.
5. Run the loop until re-reviewed as approvable or a real blocker remains.
6. Commit and push the new branch to `origin`.
7. Open a replacement PR against `{baseRefName}`.
8. Close the original PR only after the replacement PR exists successfully.

Validation for autofix mode: on every cycle run unit tests and typecheck for changed
packages/modules; before the final push run at least one last unit-test and one last typecheck pass
against the final branch state; rerun broader workspace validation if the original review required it.

Replacement PR requirements: conventional-commit title scoped to the primary affected area
(`auth`, `catalog`, `ui`, `shared`, …); include the original PR link; credit the original author;
state it carries the original work forward plus the requested fixes; note it was re-reviewed after
autofix and is intended merge-ready; reassign to the original author when possible with a handoff
comment inviting the next recheck from the carried-forward branch. Normalize labels on the
replacement PR with the same probe-guarded `setPipelineLabel` flow (step 3b).

Suggested replacement PR body:

```markdown
Supersedes #{prNumber}

Credit: original implementation by @{originalAuthor}. This follow-up PR carries that work forward with the requested fixes so it can merge without waiting on the original branch.

## Included work
- Original changes from #{prNumber}
- Follow-up fixes applied during re-review
```

Suggested replacement handoff comment:

```markdown
Thanks @{originalAuthor} — this replacement PR carries your original work forward with the requested fixes applied. Reassigning it to you so you can do the next recheck from the merge-ready branch.
```

Suggested original PR closing comment:

```markdown
Closing in favor of #{newPrNumber} ({newPrUrl}).

Credit to @{originalAuthor} for the original implementation. The replacement PR carries the same work forward with the requested fixes so it can merge without waiting on the fork branch.
```

When the loop ends (approved or a real blocker documented), proceed to
`step-5-summary-cleanup-report.md`.
