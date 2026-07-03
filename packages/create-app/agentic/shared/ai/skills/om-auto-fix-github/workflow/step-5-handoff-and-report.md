# Step 5 — Author handoff, release the lock, report

## 5a. Hand the issue back to its author

Once the fix PR exists, hand the issue back to the original author for verification — unless the
author is the current fixer, a bot account, or otherwise unavailable.

```bash
ISSUE_AUTHOR=$(gh issue view {issueId} --repo {owner}/{repo} --json author --jq '.author.login')

if [ -n "$ISSUE_AUTHOR" ] && [ "$ISSUE_AUTHOR" != "$CURRENT_USER" ] && [ -n "${PR_URL:-}" ]; then
  gh issue edit {issueId} --repo {owner}/{repo} --remove-assignee "$CURRENT_USER"
  gh issue edit {issueId} --repo {owner}/{repo} --add-assignee "$ISSUE_AUTHOR"
  gh issue comment {issueId} --repo {owner}/{repo} --body "Thanks @${ISSUE_AUTHOR} — a fix PR is ready for this issue: ${PR_URL}. Reassigning the issue to you for recheck/verification of the proposed fix."
fi
```

Rules:

- Do this only after a concrete fix PR exists (or when explicitly handing the issue back after
  confirming the fix landed elsewhere).
- If the author cannot be assigned (bot/deleted account/permission issue), keep the current assignee
  and still leave the verification handoff comment.
- Keep this handoff comment separate from the lock-release comment so the timeline clearly shows
  both the human handoff and the automation completion.

## 5b. Release the in-progress lock (finally-block)

Always run this as a finally-block — even if the PR open failed or the run was aborted earlier:

```bash
gh issue edit {issueId} --repo {owner}/{repo} --remove-label "in-progress"   # no-op if the repo lacks it
gh issue comment {issueId} --repo {owner}/{repo} --body "🤖 \`auto-fix-github\` completed: opened ${PR_URL:-(no PR — fix aborted)}. Lock released."
```

Remove the `in-progress` label so other auto-skills can act on the issue (e.g. a follow-up
reviewer). Post a completion comment that links the PR (or notes the abort) so the timeline stays
auditable. If no PR exists or the author cannot be reassigned, keep the current assignee and explain
the fallback in the handoff/completion comments.

## 5c. Clean up the worktree

Clean up the temporary worktree, but only if you created it in this run:

```bash
cd "$REPO_ROOT"
if [ "$CREATED_WORKTREE" = "1" ]; then
  git worktree remove --force "$WORKTREE_DIR"
fi
```

## 5d. Report back

```text
Issue #{issueId}: {title}
Status: {fixed | already solved | already in progress | blocked}
Branch: {branch}
PR: {url}
Tests: {summary}
```

If you stopped because a fix already exists (step 1c), report the existing PR or commit instead of
creating a new one. In the final summary, list any labels that were skipped because the repo lacks
them, with the paste-in `gh label create` commands (environment §2).
