# Step 5 — Release the lock, clean up, report back

## 5a. Release the in-progress lock (always, even on failure)

Release before the skill exits — use a `trap`/finally so a crash or early stop still clears the lock.

```bash
# Remove the in-progress label via the same probe-guarded GraphQL label flow used in step 3b
gh pr comment {prNumber} --body "🤖 \`auto-review-pr\` completed: ${VERDICT}. Lock released."
```

Rules:

- For `changes-requested` outcomes, the assignee should already be handed back to the original author
  (step 3c) before the lock is released.
- For approved outcomes, keep the current assignee unless a later handoff changed it.
- Remove the `in-progress` label (skip-and-log if it was never defined — environment §2).
- Post a completion comment with the verdict (`APPROVED` or `CHANGES REQUESTED`) and a short summary.
- If autofix ran, mention how many fix iterations completed.

## 5b. Clean up the worktree

Run cleanup in the same finally/trap so a crash does not leak worktrees, and only if you created one
this run:

```bash
cd "$REPO_ROOT"
if [ "$CREATED_WORKTREE" = "1" ]; then git worktree remove --force "$WORKTREE_DIR"; fi
git worktree prune
```

## 5c. Report back

Print a concise summary:

```text
PR #{prNumber}: {title}
Mode: {review | re-review}
Decision: {APPROVED | CHANGES REQUESTED}
Label: {merge-queue | changes-requested}  (+ needs-qa retained when applicable)
Findings: {X critical, Y high, Z medium, W low}
Worktree: {path}
Review submitted successfully.
```

Also surface:

- **Skipped labels** — any pipeline/meta labels that were undefined in this repo (from step 3b), with
  the paste-in `gh label create` commands from environment §2.
- **Local vs GitHub checks** — note when GitHub check data was unavailable and the script-probed local
  gate was authoritative (step 1e / step 2d).

If all findings were auto-fixed, note that fixes were applied and the PR is ready for merge. If a
critical blocker remains that needs human judgment, describe the blocker and ask for guidance.
