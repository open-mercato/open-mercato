# Step 1 — Claim the PR, fetch metadata, decide review vs re-review, early-exit gates

Load `../references/environment.md` first for base-branch/label/script/layout/claim rules. This
step runs entirely off GitHub metadata — no worktree yet — so a conflicted or CI-failing PR can
short-circuit straight to `changes-requested` (step 3) without paying for a checkout.

## 1a. In-progress concurrency check (claim the PR)

Auto-skills MUST NOT clobber each other. Before anything else, decide whether you may claim this PR.

```bash
CURRENT_USER=$(gh api user --jq '.login')
gh pr view {prNumber} --json assignees,labels,number,title,comments
```

A PR is **already in progress** when ANY is true:

- It carries the `in-progress` label.
- It has at least one assignee whose login is not `$CURRENT_USER`.
- A claim comment newer than 30 minutes exists from another actor (look for the `🤖` start marker).

| State | `--force`? | Action |
|-------|-----------|--------|
| Not in progress | — | Claim and proceed. |
| In progress, current user owns the lock | — | Re-entry; proceed without re-claiming. |
| In progress, someone else owns the lock | no | **STOP.** Ask via `AskUserQuestion`: "PR #{prNumber} is in progress (owner: {owner}, signal: {label/assignee/comment}). Override and continue?" Continue only on an explicit yes. |
| In progress, someone else owns the lock | yes | Post a force-override comment naming the previous owner, then claim and proceed. |

Stale-lock recovery: if the `in-progress` label is older than 60 minutes and the assignee did not
push or comment in that window, treat it as expired — still ask before overriding unless `--force`.

Claim only after the check passes:

```bash
gh pr edit {prNumber} --add-assignee "$CURRENT_USER"
# Apply the in-progress label via the same probe-guarded GraphQL flow used for pipeline labels
# (see ../references/environment.md §2 — skip-and-log if the label is not defined in this repo).
gh pr comment {prNumber} --body "🤖 \`auto-review-pr\` started by @${CURRENT_USER} at $(date -u +%Y-%m-%dT%H:%M:%SZ). Other auto-skills will skip this PR until the lock is released."
```

`in-progress` is a **lock**, not a pipeline state — never silently skip the claim (environment §5).
The release step (step 5) MUST run even on failure (trap/finally).

## 1b. Fetch PR metadata and reviewer context

Use GitHub as the source of truth. Gather enough to decide first-review vs re-review and fork vs
same-repo.

```bash
gh pr view {prNumber} --json number,title,url,author,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,maintainerCanModify,mergeable,mergeStateStatus,reviewDecision,labels,latestReviews,reviews,commits,files
gh api user --jq '.login'
```

Capture: PR title, URL, base branch (`baseRefName` — authoritative for THIS PR; it may or may not
be the app default from environment §1), head branch, head SHA, author login, `isCrossRepository`,
`maintainerCanModify`, existing labels, and existing reviews by the current reviewer.

## 1c. Decide review vs re-review

Treat the run as a **re-review** when the current reviewer already submitted a review. Use `reviews`
first, `latestReviews` as fallback.

- No prior review from the current reviewer → normal review.
- Prior review and the head SHA changed after it → re-review of updated code.
- Prior review and the head SHA did not change → continue only if the user explicitly asked to
  re-review; otherwise stop and report there are no new commits.

When re-reviewing: title the report `Re-review: {PR title}`; re-check all previous blocker areas
before approving; replace labels idempotently; submit a fresh review rather than assuming the
previous one still applies.

## 1d. Early-exit gate — conflicts

```bash
gh pr view {prNumber} --json mergeable,mergeStateStatus,baseRefName
```

If `mergeable` is `CONFLICTING` or `mergeStateStatus` is `DIRTY`, do not check out or review on the
**first** pass. Submit a changes-requested review with a conflict-focused body, apply
`changes-requested`, remove `merge-queue` (step 3), and stop. On a **second** pass where the user
approved autofix, conflicts become actionable work resolved inside the isolated worktree /
carry-forward branch (step 4).

## 1e. Early-exit gate — CI checks (prefer GitHub, fall back to local)

This skill **prefers the PR's GitHub checks** over re-running validation locally. Discover required
checks first:

```bash
gh api repos/{owner}/{repo}/branches/{baseRefName}/protection/required_status_checks --jq '.contexts[]' 2>/dev/null
```

If branch protection returns 404, treat all reported PR checks as required. Fetch results:

```bash
gh pr checks {prNumber} --json name,state,link
```

- Failing states: `FAILURE`, `ERROR`, `CANCELLED`, `TIMED_OUT`.
- Non-failing states: `PENDING`, `SUCCESS`, `SKIPPED`, `NEUTRAL`.

If any required check is failing, do not check out or review: submit a changes-requested review
listing only the failing required checks, apply `changes-requested`, remove `merge-queue`, and stop.

If `gh pr checks` reports **no checks at all** (repo has no CI configured), there is no GitHub check
data — do not early-exit here; instead rely on the script-probed local validation gate run as part
of the full code-review in step 2 (environment §3). Record that GitHub check data was unavailable so
the summary can note the local gate was authoritative.

When no early-exit fires, proceed to `step-2-worktree-and-review.md`.
