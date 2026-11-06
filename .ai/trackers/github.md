# Tracker provider: GitHub

This file is the GitHub implementation of the tracker operations contract (see `TEMPLATE.md` for the contract itself). Skills perform issue/PR state management through **named tracker operations** — `**get-issue**`, `**comment-pr**`, and so on — and this file defines what each operation means for GitHub, using the `gh` CLI.

At runtime: `om-setup-agent-pipeline` copies this file into the repository at `.ai/trackers/github.md`, and the config's `tracker` field selects it. When a skill says "tracker operation **get-pr**", execute the command documented under that operation heading in the repo's copy. The repo's copy is authoritative: teams extend or override any operation by editing it, and every skill picks the change up on its next run. An operation not covered by an edit keeps its behavior from this file's text as copied.

## Prerequisites

- `gh` CLI installed and authenticated. Verify with the **auth-check** operation before a batch run; fail fast when unauthenticated.
- All operations accept an optional `{repo}` (`owner/name`); when omitted, `gh` infers it from the current checkout's git remote. Pass `--repo {owner}/{repo}` explicitly whenever a skill operates on a repository other than the current one.

## Conventions

- Issue and PR identifiers are numbers; in text they are written `#123`.
- A PR is linked to the issue it resolves with `Fixes #{issueId}` (or `Closes #{issueId}`) in the PR body; GitHub then closes the issue on merge. To reference without auto-closing, use a plain issue link.
- PRs open as **drafts** when a skill says so; a human (or **mark-pr-ready**) promotes them.
- Claim/lock signals on an issue or PR are: assignee set to the automation user, the `in-progress` label, and a `🤖`-prefixed claim comment. All three are set on claim; the label is guarded (below). The `ci-monitoring` label is **not** a claim/lock signal: it marks a PR whose work is finished and already reported while an agent watches CI, so a PR carrying `ci-monitoring` without any of the three signals above MUST be treated as unclaimed and is free to claim.
- Long, multi-line comment bodies are posted with `--body-file` (or a heredoc via process substitution) so formatting is preserved.
- CI status truth comes from **get-pr-checks**; the set of *required* checks comes from **get-required-checks** (branch protection). When branch protection is not readable (404), treat every reported check as required.

## Label guards

Every label mutation goes through an existence guard so a missing label degrades to a logged skip instead of a failure, and `labels.enabled: false` in the config skips label operations entirely.

```bash
label_exists() {
  gh label list --limit 200 --json name --jq '.[].name' | grep -Fxq "$1"
}

# PR labels
apply_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  if label_exists "$1"; then
    gh pr edit "$2" --add-label "$1"
  else
    echo "Skipping label '$1' (not defined in this repo). Create it with: gh label create '$1'"
  fi
}

# Issue labels
apply_issue_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  if label_exists "$1"; then
    gh issue edit "$2" --add-label "$1"
  else
    echo "Skipping label '$1' (not defined in this repo). Create it with: gh label create '$1'"
  fi
}

remove_issue_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  if label_exists "$1"; then
    gh issue edit "$2" --remove-label "$1"
  fi
}

# Pipeline labels are mutually exclusive: setting one removes the others first.
set_pipeline_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  for label in $PIPELINE_LABELS; do
    [ "$label" = "$2" ] && continue
    gh pr edit "$1" --remove-label "$label" 2>/dev/null || true
  done
  apply_label "$2" "$1"
}
```

When operating on a different repository than the current checkout, add `--repo "$REPO"` to each command inside the guards and check label existence against that repo (`gh label list --repo "$REPO"`).

## Operations

### Identity and repository

#### auth-check
Verify the CLI is authenticated. → exit status.
```bash
gh auth status
```

#### current-user
→ the automation user's login.
```bash
CURRENT_USER=$(gh api user --jq '.login')
```

#### repo-info
→ `owner/name` handle and default branch of the current repository.
```bash
gh repo view --json nameWithOwner,defaultBranchRef
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
```

#### default-branch
→ the repository's default branch name (used when the config's `baseBranch` is `"auto"`).
```bash
BASE_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || true)
[ -z "$BASE_BRANCH" ] && BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$BASE_BRANCH" ] && BASE_BRANCH="main"
```

### Public session-share artifacts

#### publish-session-share
`{owner}/{repo}`, `{branch}`, `{shareName}`, and a local `{bundleDir}` → atomically publish the four reviewed session-share artifacts on a new public branch and return repository, branch, commit, branch URL, and raw artifact URLs as JSON.

This operation is intentionally strict: the repository must already be public; the branch must be a new slash-free `session-share-…` ref; and the bundle directory must contain regular, non-symlinked `session.json`, `generated-files.zip`, `manifest.json`, and `privacy-report.json` files within the documented size cap. Git blobs, a tree, and a commit are created first; the public ref is created last, so a preparation failure does not expose a partial branch.

```bash
TARGET_REPO="{owner}/{repo}"
SHARE_BRANCH="{branch}"
SHARE_NAME="{shareName}"
BUNDLE_DIR="{bundleDir}"
printf '%s' "$TARGET_REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || exit 1
printf '%s' "$SHARE_NAME" | grep -Eq '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' || exit 1
[ "$SHARE_BRANCH" = "session-share-$SHARE_NAME" ] || exit 1
[ "$(gh repo view "$TARGET_REPO" --json visibility --jq .visibility)" = "PUBLIC" ] || exit 1
gh api "repos/${TARGET_REPO}/git/ref/heads/${SHARE_BRANCH}" >/dev/null 2>&1 && exit 1

SESSION_SHARE_TMP=$(mktemp -d)
trap 'rm -rf "$SESSION_SHARE_TMP"' EXIT HUP INT TERM
printf '[]\n' > "$SESSION_SHARE_TMP/tree.json"
TOTAL_BYTES=0
for ARTIFACT in session.json generated-files.zip manifest.json privacy-report.json; do
  ARTIFACT_PATH="$BUNDLE_DIR/$ARTIFACT"
  [ -f "$ARTIFACT_PATH" ] && [ ! -L "$ARTIFACT_PATH" ] || exit 1
  ARTIFACT_BYTES=$(wc -c < "$ARTIFACT_PATH" | tr -d ' ')
  TOTAL_BYTES=$((TOTAL_BYTES + ARTIFACT_BYTES))
  [ "$ARTIFACT_BYTES" -le 26214400 ] && [ "$TOTAL_BYTES" -le 31457280 ] || exit 1
done

for ARTIFACT in session.json generated-files.zip manifest.json privacy-report.json; do
  ARTIFACT_PATH="$BUNDLE_DIR/$ARTIFACT"
  base64 < "$ARTIFACT_PATH" | tr -d '\n' > "$SESSION_SHARE_TMP/content.b64"
  BLOB_SHA=$(jq -n --rawfile content "$SESSION_SHARE_TMP/content.b64" '{content:$content,encoding:"base64"}' \
    | gh api -X POST "repos/${TARGET_REPO}/git/blobs" --input - --jq .sha) || exit 1
  jq --arg path "$ARTIFACT" --arg sha "$BLOB_SHA" \
    '. + [{path:$path,mode:"100644",type:"blob",sha:$sha}]' \
    "$SESSION_SHARE_TMP/tree.json" > "$SESSION_SHARE_TMP/tree.next.json" || exit 1
  mv "$SESSION_SHARE_TMP/tree.next.json" "$SESSION_SHARE_TMP/tree.json"
done

DEFAULT_BRANCH=$(gh repo view "$TARGET_REPO" --json defaultBranchRef --jq .defaultBranchRef.name) || exit 1
BASE_COMMIT=$(gh api "repos/${TARGET_REPO}/git/ref/heads/${DEFAULT_BRANCH}" --jq .object.sha) || exit 1
BASE_TREE=$(gh api "repos/${TARGET_REPO}/git/commits/${BASE_COMMIT}" --jq .tree.sha) || exit 1
TREE_SHA=$(jq -n --arg base "$BASE_TREE" --slurpfile entries "$SESSION_SHARE_TMP/tree.json" \
  '{base_tree:$base,tree:$entries[0]}' \
  | gh api -X POST "repos/${TARGET_REPO}/git/trees" --input - --jq .sha) || exit 1
COMMIT_SHA=$(jq -n --arg message "session share ${SHARE_NAME}" --arg tree "$TREE_SHA" --arg parent "$BASE_COMMIT" \
  '{message:$message,tree:$tree,parents:[$parent]}' \
  | gh api -X POST "repos/${TARGET_REPO}/git/commits" --input - --jq .sha) || exit 1
jq -n --arg ref "refs/heads/${SHARE_BRANCH}" --arg sha "$COMMIT_SHA" '{ref:$ref,sha:$sha}' \
  | gh api -X POST "repos/${TARGET_REPO}/git/refs" --input - >/dev/null || exit 1

jq -n \
  --arg repository "$TARGET_REPO" \
  --arg branch "$SHARE_BRANCH" \
  --arg commit "$COMMIT_SHA" \
  --arg branchUrl "https://github.com/${TARGET_REPO}/tree/${SHARE_BRANCH}" \
  --arg sessionUrl "https://raw.githubusercontent.com/${TARGET_REPO}/${SHARE_BRANCH}/session.json" \
  --arg archiveUrl "https://raw.githubusercontent.com/${TARGET_REPO}/${SHARE_BRANCH}/generated-files.zip" \
  --arg manifestUrl "https://raw.githubusercontent.com/${TARGET_REPO}/${SHARE_BRANCH}/manifest.json" \
  --arg privacyUrl "https://raw.githubusercontent.com/${TARGET_REPO}/${SHARE_BRANCH}/privacy-report.json" \
  '{repository:$repository,branch:$branch,commit:$commit,branchUrl:$branchUrl,artifacts:{session:$sessionUrl,archive:$archiveUrl,manifest:$manifestUrl,privacy:$privacyUrl}}'
```

#### delete-session-share
`{owner}/{repo}`, `{branch}`, and `{shareName}` → remove only the exact derived session-share ref after a failed issue creation or an explicit retention cleanup request. Deleting a public ref cannot guarantee erasure from clones, forks, caches, logs, or archives.

```bash
TARGET_REPO="{owner}/{repo}"
SHARE_BRANCH="{branch}"
SHARE_NAME="{shareName}"
printf '%s' "$TARGET_REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || exit 1
printf '%s' "$SHARE_NAME" | grep -Eq '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' || exit 1
[ "$SHARE_BRANCH" = "session-share-$SHARE_NAME" ] || exit 1
gh api -X DELETE "repos/${TARGET_REPO}/git/refs/heads/${SHARE_BRANCH}"
```

### Issues

#### get-issue
`{issueId}`, field list → issue data. Request only the fields the calling skill names.
```bash
gh issue view {issueId} --repo {owner}/{repo} --json number,title,body,state,author,url,labels,assignees,comments
```

#### search-issues
Query (text, `in:title,body`, state) → matching issues.
```bash
ISSUE_STATE="{state}"
case "$ISSUE_STATE" in open|closed|all) ;; *) exit 1 ;; esac
gh issue list --repo {owner}/{repo} --state "$ISSUE_STATE" --search "<query> in:title,body" --json number,title,url
```

#### create-issue
Title, body, assignee, labels → created issue URL.
```bash
gh issue create --repo {owner}/{repo} --title "<title>" --assignee <login> --label <labels> --body "<body>"
```

#### close-issue
`{issueId}`, reason, closing comment.
```bash
gh issue close {issueId} --repo {owner}/{repo} --reason completed --comment "<comment>"
```

#### comment-issue
`{issueId}`, body (use a heredoc/body-file for multi-line bodies).
```bash
gh issue comment {issueId} --repo {owner}/{repo} --body "<body>"
```

#### update-issue
`{issueId}`, new title and/or body (use a body-file for multi-line bodies). Edits the issue's own fields; does not touch labels or assignees (those have their own operations).
```bash
gh issue edit {issueId} --repo {owner}/{repo} --title "<title>" --body-file <file>
```

#### assign-issue / unassign-issue
```bash
gh issue edit {issueId} --repo {owner}/{repo} --add-assignee "<login>"
gh issue edit {issueId} --repo {owner}/{repo} --remove-assignee "<login>"
```

#### label-issue / unlabel-issue
Always through the guards: `apply_issue_label "<label>" {issueId}` / `remove_issue_label "<label>" {issueId}`.

#### get-issue-comment
Comment id → body, author, URL.
```bash
gh api repos/{owner}/{repo}/issues/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
```

#### list-issue-comments
`{issueId or prNumber}` → conversation comments (PR conversation comments are issue comments on GitHub).
```bash
gh api repos/{owner}/{repo}/issues/{number}/comments --jq '.[] | {id,user:.user.login,body}'
```

#### update-comment
`{commentId}`, new body → rewrite an existing conversation comment in place (works for issue and PR conversation comments alike). This is how marker-idempotent comments (label rationale, verification, claim take-overs) are updated on re-runs: find your `🤖 …` marker via **list-issue-comments**, then update that comment instead of posting a new one. Use a body file so multi-line bodies survive.
```bash
gh api -X PATCH repos/{owner}/{repo}/issues/comments/{commentId} -F body=@<path>
```

```bash
tracker_repo() {
  if [ -n "${REPO:-}" ]; then printf '%s\n' "$REPO";
  else gh repo view --json nameWithOwner --jq .nameWithOwner; fi
}
```

#### get-lock

`{kind}` (`issue` or `pr`), `{item}` → `null` for an absent exact lock, or
`{ref,sha,repo,kind,item,runId,actor,createdAt}`. The authoritative GitHub lock is
`refs/om-locks/{kind}-{item}`. Its SHA points to an otherwise empty metadata
commit using the configured base's existing tree, with no branch/history edits.
The commit message binds the unique run id and actor; a base SHA alone cannot
identify two runs sharing a bot login. `createdAt` comes from the server commit
metadata, not a comment timestamp. Unknown/malformed refs and failed reads block.
Load these helpers before **acquire-lock** or **release-lock**:

```bash
gh_lock_target() {
  case "$1" in issue|pr) ;; *) return 1 ;; esac
  case "$2" in ''|*[!0-9]*) return 1 ;; esac
  LOCK_REPO=$(tracker_repo) || return 1
  LOCK_REF="refs/om-locks/$1-$2"
}
gh_get_lock() {
  gh_lock_target "$1" "$2" || return 1
  lock_refs=$(gh api "repos/$LOCK_REPO/git/matching-refs/om-locks/$1-$2") || return 1
  lock_entry=$(printf '%s' "$lock_refs" | jq -c --arg ref "$LOCK_REF" '
    if type != "array" then error("Invalid ref list") else
    [.[] | select(.ref == $ref)] | if length == 0 then null
    elif length == 1 and .[0].object.type == "commit" then .[0]
    else error("Ambiguous lock ref") end end') || return 1
  if [ "$lock_entry" = "null" ]; then printf 'null\n'; return 0; fi
  lock_sha=$(printf '%s' "$lock_entry" | jq -er '.object.sha | select(test("^[0-9a-f]{40}$"))') || return 1
  lock_commit=$(gh api "repos/$LOCK_REPO/git/commits/$lock_sha") || return 1
  printf '%s' "$lock_commit" | jq -ce --arg repo "$LOCK_REPO" --arg kind "$1" --arg item "$2" --arg ref "$LOCK_REF" --arg sha "$lock_sha" '
    .committer.date as $created |
    .message | select(startswith("om-claim-v1\n")) | ltrimstr("om-claim-v1\n") | fromjson |
    select(.repo == $repo and .kind == $kind and .item == $item and
      (.runId | type == "string" and length > 0) and
      (.actor | type == "string" and length > 0) and ($created | type == "string")) |
    . + {ref:$ref,sha:$sha,createdAt:$created}'
}
gh_get_lock "{kind}" "{number}"
```

#### acquire-lock

`{kind}`, `{item}`, unique run id, authenticated actor, resolved base SHA →
`{status: acquired|owned|conflict, lock: <get-lock result>}`. On GitHub this is
mandatory, including for unassignable bots and PRs in split-provider setups.
Requires contents-write and authenticated Git transport for eventual release.
Never switch to comments on 403/422/transport errors: an existing ref is a
conflict only after an exact successful read proves its owner. Reconcile an
uncertain POST through **get-lock** before retrying. No labels/assignment/comment
candidate or work is produced by a losing fresh run.

```bash
gh_acquire_lock() {
  # kind, item, run id, authenticated actor, configured base SHA
  gh_lock_target "$1" "$2" || return 1
  case "$3" in ''|*[!A-Za-z0-9._-]*) return 1 ;; esac
  [ -n "$4" ] || return 1
  printf '%s' "$5" | grep -Eq '^[0-9a-f]{40}$' || return 1
  lock_before=$(gh_get_lock "$1" "$2") || return 1
  if [ "$lock_before" != "null" ]; then
    printf '%s' "$lock_before" | jq --arg run "$3" --arg actor "$4" '
      {status:(if .runId == $run and .actor == $actor then "owned" else "conflict" end),lock:.}'
    return 0
  fi
  lock_tree=$(gh api "repos/$LOCK_REPO/git/commits/$5" --jq '.tree.sha') || return 1
  lock_message=$(jq -cn --arg repo "$LOCK_REPO" --arg kind "$1" --arg item "$2" --arg run "$3" --arg actor "$4" '
    "om-claim-v1\n" + ({repo:$repo,kind:$kind,item:$item,runId:$run,actor:$actor}|tojson)') || return 1
  lock_created=$(jq -n --argjson message "$lock_message" --arg tree "$lock_tree" --arg parent "$5" '
    {message:$message,tree:$tree,parents:[$parent]}' |
    gh api -X POST "repos/$LOCK_REPO/git/commits" --input -) || return 1
  lock_proposed=$(printf '%s' "$lock_created" | jq -er '.sha | select(test("^[0-9a-f]{40}$"))') || return 1
  # Create-only POST is the ownership decision; never PATCH/update an existing ref.
  if gh api -X POST "repos/$LOCK_REPO/git/refs" -f "ref=$LOCK_REF" -f "sha=$lock_proposed" >/dev/null 2>&1; then
    lock_posted=true
  else
    lock_posted=false
  fi
  lock_after=$(gh_get_lock "$1" "$2") || return 1
  [ "$lock_after" != "null" ] || return 1
  printf '%s' "$lock_after" | jq --arg run "$3" --arg actor "$4" --arg sha "$lock_proposed" --arg posted "$lock_posted" '
    {status:(if .sha == $sha and .runId == $run and .actor == $actor then "acquired"
      elif .runId == $run and .actor == $actor then "owned"
      elif $posted == "false" then "conflict" else error("Lock replaced after creation") end),lock:.}'
}
gh_acquire_lock "{kind}" "{number}" "$CLAIM_RUN_ID" "$CURRENT_USER" "$BASE_SHA"
```

Persist the returned lock SHA plus run id before comment/label writes; reconcile
the same run on resume. A metadata commit created by a losing contender may be
unreferenced and garbage-collected; it contains no secrets or new project content.

#### release-lock

`{kind}`, `{item}`, exact expected lock SHA, expected owner run id/actor → delete
only that exact ref. Normal callers pass their own verified identity; recovery
passes the observed previous owner only after the shared stale/force/UI recovery
authorization checks. Keep the lock while cleaning up owned labels and marking
the comment released; delete the ref last. A loser never calls this operation.

```bash
gh_release_lock() {
  # kind, item, expected SHA, expected owner's run id and actor
  gh_lock_target "$1" "$2" || return 1
  printf '%s' "$3" | grep -Eq '^[0-9a-f]{40}$' || return 1
  lock_current=$(gh_get_lock "$1" "$2") || return 1
  [ "$lock_current" != "null" ] || { printf 'absent\n'; return 0; }
  printf '%s' "$lock_current" | jq -e --arg sha "$3" --arg run "$4" --arg actor "$5" '
    .sha == $sha and .runId == $run and .actor == $actor' >/dev/null || return 1
  lock_url=$(gh repo view "$LOCK_REPO" --json url --jq .url) || return 1
  # Git's explicit expected-SHA lease is atomic compare-and-delete. REST DELETE
  # has no expected-SHA condition and can remove a successor during recovery.
  git push --porcelain --force-with-lease="$LOCK_REF:$3" "$lock_url.git" ":$LOCK_REF" || return 1
  lock_remaining=$(gh_get_lock "$1" "$2") || return 1
  if [ "$lock_remaining" = "null" ]; then printf 'released\n'
  elif printf '%s' "$lock_remaining" | jq -e --arg sha "$3" '.sha != $sha' >/dev/null; then
    printf 'released; successor retained\n'
  else return 1; fi
}
gh_release_lock "{kind}" "{number}" "$CLAIM_LOCK_SHA" "$CLAIM_RUN_ID" "$CURRENT_USER"
```

This narrowly scoped lease-deletion is authorized lock housekeeping, never a
force-push of project branches. Resolve the target repository's GitHub URL as
above rather than assuming `origin` is the target. Do not change credentials,
remove hooks or retry with an unconditional REST DELETE when Git transport fails.
Absent is idempotent; a changed SHA/owner blocks and preserves the successor.

#### get-claim-reset

`{kind}`, `{item}` → latest tracker-audited human `claim-reset` label application
as `{id,createdAt,actor}`, or `null` if none. Read every event page, including past
applications after label removal. Verify the event actor is a human permitted to
manage item labels; bot applications and comment/body text never authorize reset.
A failed/unsupported audit read is not `null`: stop recovery and report the gap.
This cutoff permanently retires claim comments created strictly before it;
same-second/unknown timestamps are uncertain and remain blocking. It does not
relax QA, merge, scheduler reservations or command/process isolation.

```bash
gh_get_claim_reset() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  reset_pages=$(gh api --paginate --slurp "repos/$(tracker_repo)/issues/$1/events?per_page=100") || return 1
  printf '%s' "$reset_pages" | jq -e 'type == "array" and all(.[]; type == "array")' >/dev/null || return 1
  reset_event=$(printf '%s' "$reset_pages" | jq '
    [ .[][] | select(.event == "labeled" and .label.name == "claim-reset" and .actor.type == "User") ]
    | sort_by(.created_at, .id) | .[-1] // null') || return 1
  if [ "$reset_event" = "null" ]; then printf 'null\n'; return 0; fi
  reset_actor=$(printf '%s' "$reset_event" | jq -r '.actor.login') || return 1
  case "$reset_actor" in ''|*[!A-Za-z0-9-]*) return 1 ;; esac
  reset_permission=$(gh api "repos/$(tracker_repo)/collaborators/$reset_actor/permission") || return 1
  printf '%s' "$reset_permission" | jq -e '
    (.permission == "admin" or .permission == "write" or .permission == "maintain" or .permission == "triage")
    or (.user.permissions | .admin == true or .maintain == true or .push == true or .triage == true)' >/dev/null || return 1
  printf '%s' "$reset_event" | jq '{id: (.id | tostring), createdAt: .created_at, actor: .actor.login}'
}
gh_get_claim_reset "{number}"
```

The platform event plus repository-permission read proves human label authority.
A label still present is an operator-visible recovery breadcrumb, not a permanent
bypass. Removing it does not revive retired claims; remove and reapply to request
a later reset. Never apply this label automatically.

#### claim-winner

`{kind}`, `{item}`, `LIVE_CLAIM_IDS` (JSON array of comment handles from a complete
fresh **list-issue-comments** read, selected by the skill's live/stale policy) →
`{id,user,body}` for the lowest server creation-order candidate, or `null` when
none is visible. Missing/unreadable/incomplete data is an error, never an empty
success. Require the caller's own id in the fresh candidate set before proceeding.
Ignore explicitly `released`/`withdrawn` comments even if passed as live. Do not
filter by actor: two contenders may share one bot account. Numeric ids compare
numerically; opaque ids use creation time then stable id. The caller repeats the
read/election and performs the post-label ownership check; this is not atomic.

```bash
gh_claim_winner() {
  # $1 = item number; $2 = LIVE_CLAIM_IDS as JSON string handles.
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s' "$2" | jq -e 'type == "array" and all(.[]; type == "string")' >/dev/null || return 1
  claim_pages=$(gh api --paginate --slurp "repos/$(tracker_repo)/issues/$1/comments?per_page=100") || return 1
  printf '%s' "$claim_pages" | jq -e 'type == "array" and all(.[]; type == "array")' >/dev/null || return 1
  printf '%s' "$claim_pages" | jq --argjson live "$2" '
    [ .[][] | select((.id | tostring) as $id | $live | index($id))
      | select((.body | test("(?m)^Claim-State: (released|withdrawn)\\r?$")) | not)
      | {id: (.id | tostring), user: .user.login, body} ]
    | sort_by(.id | [length, .]) | .[0] // null'
}
gh_claim_winner "{number}" "$LIVE_CLAIM_IDS"
```

All comment pages are read before ranking. Preserve REST numeric ids as string
handles at the operation boundary (do not substitute GraphQL node ids).

#### withdraw-claim

`{kind}`, `{item}`, `{commentId}`, full terminal body file, expected authenticated
actor and `Claim-Run` → rewrite only that run's original candidate through **update-comment**,
then read it back through **list-issue-comments**. Retain its legacy first line,
marker and run id; change `Claim-State: active` to `withdrawn` (loser) or `released`
(owner after cleanup), with the reason/winner. Before writing, verify exact item,
comment id, authenticated author and run id; a mismatch stops cleanup. Do not
edit a foreign candidate or delete its label. Return the same id and verified
terminal state; failed update/read-back is a blocker. Never fall back to a new
comment leaving the old active candidate in place.

### Pull requests

#### get-pr
`{prNumber}`, field list → PR data. Request only the fields the calling skill names; the full field set skills use:
```bash
gh pr view {prNumber} --json number,title,url,body,state,author,isDraft,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,maintainerCanModify,mergeable,mergeStateStatus,reviewDecision,labels,latestReviews,reviews,commits,files,assignees,comments,mergedAt,mergeCommit,closingIssuesReferences
```

#### list-prs
State/search filters, field list, limit → PRs.
```bash
gh pr list --state open --json number,title,url,author,labels,reviewDecision,mergeable,mergeStateStatus,headRefName,baseRefName,updatedAt,isDraft,assignees --limit 100
gh pr list --state merged --search "merged:>=${SINCE_DATE}" --json number,title,url,body,author,mergedAt,mergeCommit,baseRefName,headRefName,closingIssuesReferences,labels --limit {limit}
gh pr list --state closed --search "closed:>=${SINCE_DATE} is:unmerged" --json number,title,url,body,author,closedAt,baseRefName,headRefName,closingIssuesReferences,labels --limit {limit}
```

#### search-prs
Free-text query (for example an issue reference) and state → matching PRs.
```bash
gh search prs --repo {owner}/{repo} "#{issueId}" --state open --json number,title,url,state
```

#### create-pr
Base branch, draft flag, title, body → PR.
```bash
gh pr create --repo {owner}/{repo} --base "$BASE_BRANCH" --draft --title "<title>" --body "<body>"
PR_URL=$(gh pr view --json url --jq .url)
PR_NUMBER=$(gh pr view --json number --jq .number)
```

#### update-pr
`{prNumber}`, new title and/or new body → the PR's own title/body rewritten in place (not a comment), e.g. reframing a doc-originated spec PR that grew a feature implementation. Pass whichever of `--title` / `--body-file` changed; omit the other. Use a body file so multi-line bodies survive.
```bash
gh pr edit {prNumber} --title "<title>"
gh pr edit {prNumber} --body-file <path-or-process-substitution>
```
If `gh pr edit` silently no-ops in this repo (some GitHub setups do), fall back to the REST API:
```bash
gh api -X PATCH repos/{owner}/{repo}/pulls/{prNumber} -f title="<title>" -f body="$(cat <path>)"
```

#### comment-pr
`{prNumber}`, body. For long structured comments:
```bash
gh pr comment {prNumber} --body-file <path-or-process-substitution>
```

#### attach-image-evidence
`{prNumber}`, a markdown comment body (without the images), a `{slug}` (e.g. `pr-{prNumber}`), and a list of local PNG paths → post one comment with the images embedded **inline**, and return the comment URL.

GitHub does not accept image bytes through the comment API, so make the images referenceable first. For a **public** repo, upload them to a dedicated **slash-free** evidence branch (never the change's own branch) via the Contents API and reference `raw.githubusercontent.com` URLs — those render inline in comments:

```bash
OWNER_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
EVIDENCE_BRANCH="qa-evidence-{slug}"                 # slash-free: some raw URLs 404 on slashed refs
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)

# create the evidence branch if missing (branched from the default branch head)
gh api "repos/${OWNER_REPO}/git/refs/heads/${EVIDENCE_BRANCH}" >/dev/null 2>&1 || {
  SHA=$(gh api "repos/${OWNER_REPO}/git/refs/heads/${DEFAULT_BRANCH}" --jq .object.sha)
  gh api -X POST "repos/${OWNER_REPO}/git/refs" -f ref="refs/heads/${EVIDENCE_BRANCH}" -f sha="$SHA" >/dev/null
}

# upload each image. An image-sized base64 string blows the shell arg limit, so it
# must never touch a command line — write it to a temp file and let `jq --rawfile`
# read it into the JSON body, which `gh api --input -` sends over stdin. Pass the
# existing blob sha to overwrite on re-runs.
BODY_IMAGES=""
for img in <image-paths>; do
  path="{slug}/$(basename "$img")"
  base64 < "$img" | tr -d '\n' > /tmp/ev-content.b64            # portable across GNU/BSD; no newlines
  existing=$(gh api "repos/${OWNER_REPO}/contents/${path}?ref=${EVIDENCE_BRANCH}" --jq .sha 2>/dev/null || true)
  jq -n --rawfile c /tmp/ev-content.b64 --arg m "qa evidence {slug}" --arg b "$EVIDENCE_BRANCH" --arg s "$existing" \
     'if $s == "" then {message:$m,branch:$b,content:$c} else {message:$m,branch:$b,content:$c,sha:$s} end' \
     | gh api -X PUT "repos/${OWNER_REPO}/contents/${path}" --input - >/dev/null
  url="https://raw.githubusercontent.com/${OWNER_REPO}/${EVIDENCE_BRANCH}/${path}"
  BODY_IMAGES="${BODY_IMAGES}\n![$(basename "$img")](${url})"
done

# assemble the comment (caller's body + the image markdown) and post it
{ cat <body-file>; printf "%b" "$BODY_IMAGES"; } | gh pr comment {prNumber} --body-file -
gh pr view {prNumber} --json url --jq .url
```

Fallbacks: for a **private** repo the raw URLs need auth and will not render — post the comment with the image links plus the local artifact paths and note that inline rendering is unavailable (a private-visibility limit), rather than failing. When even the evidence branch cannot be pushed (no write access), degrade to listing the artifact paths in the comment. Never store evidence on the change's own branch, and never force-push.

#### assign-pr / unassign-pr
```bash
gh pr edit {prNumber} --add-assignee "<login>"
gh pr edit {prNumber} --remove-assignee "<login>"
```

#### label-pr / unlabel-pr
Always through the guards: `apply_label "<label>" {prNumber}` / `set_pipeline_label {prNumber} "<label>"` for the mutually exclusive pipeline group; direct removal:
```bash
gh pr edit {prNumber} --remove-label "<label>"
```

#### get-pr-diff
`{prNumber}` → full diff, or the changed-file list with `--name-only`.
```bash
gh pr diff {prNumber}
gh pr diff {prNumber} --name-only
```

#### get-pr-files
`{prNumber}` → changed files with per-file status (added/modified/removed), paginated.
```bash
gh api "repos/{owner}/{repo}/pulls/{prNumber}/files" --paginate --jq '.[] | {path: .filename, status: .status}'
```

#### checkout-pr
`{prNumber}` → the PR's head available locally (needed for cross-repository fork PRs where the head branch cannot be fetched from `origin`).
```bash
gh pr checkout {prNumber} --recurse-submodules=no
```

#### review-pr
`{prNumber}`, verdict (approve / request changes), body.
```bash
gh pr review {prNumber} --approve --body "<body>"
gh pr review {prNumber} --request-changes --body "<body>"
```
GitHub rejects self-approval (reviewing your own PR); surface that instead of working around it.

#### merge-pr
`{prNumber}`; squash is the default merge strategy. `--auto` merges when checks pass; `--delete-branch` only when asked.
```bash
gh pr merge {prNumber} --squash
```

#### mark-pr-ready
Promote a draft PR.
```bash
gh pr ready {prNumber}
```

#### get-pr-checks
`{prNumber}` → CI check runs with name, state, and link.
```bash
gh pr checks {prNumber} --json name,state,link
```

#### get-required-checks
Base branch → the set of required status checks. A 404 means branch protection is not readable — treat all reported checks as required.
```bash
gh api repos/{owner}/{repo}/branches/{baseRefName}/protection/required_status_checks --jq '.contexts[]' 2>/dev/null
```

#### get-pr-comment / get-review-comment
Conversation comment id (`issuecomment-<id>` links) vs inline review comment id (`discussion_r<id>` links) → body, author, URL.
```bash
gh api repos/{owner}/{repo}/issues/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
gh api repos/{owner}/{repo}/pulls/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
```

### CI runs

CI status for a *PR* comes from **get-pr-checks** / **get-required-checks** above. The operations here address CI runs directly — needed when working from a bare branch, or when a failure diagnosis needs the actual logs.

#### list-runs
Branch (or head SHA) → recent workflow runs with id, workflow name, status, and conclusion.
```bash
gh run list --branch {branch} --limit 20 --json databaseId,workflowName,name,status,conclusion,headSha,url,createdAt
```

#### get-run
Run id → status, conclusion, and per-job breakdown.
```bash
gh run view {runId} --json status,conclusion,workflowName,headSha,url,jobs
```

#### get-run-failed-logs
Run id → the log output of failed steps only. This is the primary diagnosis input for CI failures.
```bash
gh run view {runId} --log-failed
```

#### rerun-failed
Run id → re-execute only the failed jobs of that run. Use to disambiguate flaky failures before changing any code.
```bash
gh run rerun {runId} --failed
```

#### watch-run
Run id → block until the run completes, exiting non-zero on failure. Prefer this over sleep-polling; fall back to periodic **get-run** when watching is unavailable.
```bash
gh run watch {runId} --exit-status
```

### Labels

#### list-labels
→ all label names defined in the repo.
```bash
gh label list --limit 200 --json name --jq '.[].name'
```

#### create-label
Name, color, description. Never delete, rename, or recolor existing labels.
```bash
gh label create <name> --color <hex> --description "<description>"
```

#### ensure-label-taxonomy
Create every label from the config's taxonomy that does not exist yet (used by `om-setup-agent-pipeline`; skip ones that already exist per **list-labels**):
```bash
gh label create review            --color 0366d6 --description "Ready for code review"
gh label create changes-requested --color b60205 --description "Reviewer requested changes"
gh label create qa                --color fbca04 --description "Manual QA in progress"
gh label create qa-failed         --color b60205 --description "Manual QA failed"
gh label create merge-queue       --color 0e8a16 --description "Approved, ready to merge"
gh label create blocked           --color b60205 --description "Blocked by a dependency"
gh label create do-not-merge      --color b60205 --description "Hard merge block"
gh label create bug               --color d73a4a --description "Bug fix"
gh label create feature           --color a2eeef --description "New capability"
gh label create refactor          --color cfd3d7 --description "No behavior change"
gh label create security          --color b60205 --description "Security-relevant change"
gh label create dependencies      --color 0366d6 --description "Dependency update"
gh label create documentation     --color 0075ca --description "Docs only"
gh label create needs-qa          --color fbca04 --description "Requires manual QA before merge"
gh label create skip-qa           --color 0e8a16 --description "Low risk, QA not required"
gh label create qa-approved       --color 0e8a16 --description "Manual QA passed"
gh label create qa-self-verified  --color c5def5 --description "Self-QA exception used"
gh label create in-progress       --color c5def5 --description "An automated skill is working on this"
gh label create ci-monitoring     --color 00b8d9 --description "Work complete and reported; agent is watching CI results"
gh label create do-not-close      --color c5def5 --description "Humans only: never auto-close this issue"
gh label create priority-low      --color e4e669 --description "Cosmetic or follow-up work"
gh label create priority-medium   --color fbca04 --description "Ordinary bug or feature"
gh label create priority-high     --color d93f0b --description "Release-blocking"
gh label create priority-extreme  --color b60205 --description "Outage or security incident"
gh label create risk-low          --color 0e8a16 --description "Isolated, low blast radius"
gh label create risk-medium       --color fbca04 --description "Ordinary change with tests"
gh label create risk-high         --color b60205 --description "Wide blast radius, review deeply"
```
