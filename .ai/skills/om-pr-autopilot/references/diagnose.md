# Diagnose — the ten state signals

Read-only. Collect every signal below before classifying; a signal you did not
read is `unknown`, never an assumption. All tracker calls go through the
operations named in `.ai/trackers/github.md` — the commands here are the GitHub
descriptor's own, quoted for convenience.

## 1. Identity and repository

```bash
gh auth status
gh repo view --json nameWithOwner --jq .nameWithOwner
```

Record the active account and the repository. The run must operate as the
identity this repository's automation runs are made from — never a hard-coded
handle. Derive it from **current-user** and confirm it is the account that owns
the PR's claim and (for `IS_MINE`) authored the head branch. An active account
that does not match is a **stop condition** — report it and do not mutate
anything.

## 2. PR core (get-pr)

```bash
gh pr view {prNumber} --json number,title,url,body,state,author,isDraft,\
baseRefName,headRefName,headRepositoryOwner,isCrossRepository,maintainerCanModify,\
mergeable,mergeStateStatus,reviewDecision,labels,latestReviews,assignees,\
commits,files,closingIssuesReferences
```

Derive: `IS_MINE` (author == current user), `IS_FORK` (`isCrossRepository`),
`IS_DRAFT`, `STATE` (stop unless `OPEN`).

## 3. Plan progress (the "how far is the implementation" signal)

Take the first `Tracking plan:` / `Tracking run folder:` line from the PR body:

```bash
gh pr view {prNumber} --json body --jq .body | grep -E '^Tracking (plan|run folder):' | head -n1
```

- **Plan file under `$RUNS_DIR`** (`.ai/runs/<date>-<slug>.md`) → read its
  `## Progress` section; count `- [ ]` (pending) vs `- [x]` (done) steps and note
  the first pending one. This is the `om-auto-continue-pr` contract.
- **Run folder** (contains `PLAN.md` + `HANDOFF.md`) → parse the top-of-file
  `## Tasks` table in `PLAN.md`; the first row whose `Status` is not `done` is
  the resume point. This is the `om-auto-continue-pr-loop` contract — note which
  variant applies, they are not interchangeable.
- **No tracking line** → fall back to diffing the PR against the base for a new
  file under `$RUNS_DIR`. Exactly one candidate → use it. Several → ask the user.
  None → record `plan: none` (the PR was not created by the auto-create chain;
  implementation completeness must then be judged from the diff and the linked
  issue, and no `om-auto-continue-pr` step can run).

## 4. Diff scope

```bash
gh pr diff {prNumber} --name-only
```

Classify: **spec-only** (touches only `$SPECS_DIR`, the config's `paths.specs` —
read it, never hard-code the path), **docs-only**,
**UI-touching** (any `packages/ui/**`, `**/frontend/**`, `**/backend/**` page or
component, portal surfaces), **migration/schema**, **contract surface** (types,
event ids, API routes, DI keys, ACL ids — see `BACKWARD_COMPATIBILITY.md`).
Spec-only and UI-touching change the chain; the rest drive the label set.

## 5. Review decision and unresolved threads

`reviewDecision` from step 2, plus the actual open conversations:

```bash
gh api graphql -f query='
  query($owner:String!,$repo:String!,$pr:Int!){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$pr){
        reviewThreads(first:100){nodes{isResolved isOutdated path
          comments(first:1){nodes{author{login} body url}}}}}}}' \
  -F owner={owner} -F repo={repo} -F pr={prNumber} \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[]
         | select(.isResolved==false and .isOutdated==false)] | length'
```

Record the count and the paths. `CHANGES_REQUESTED`, or unresolved non-outdated
threads, means the review loop still has work — even when CI is green.

## 6. CI

```bash
gh pr checks {prNumber} --json name,state,link
gh api repos/{owner}/{repo}/branches/{baseRefName}/protection/required_status_checks \
  --jq '.contexts[]' 2>/dev/null
```

A 404 on protection → treat every reported check as required. Record
`ci: green | red(<names>) | pending | none`.

## 7. Mergeability

`mergeable` + `mergeStateStatus` from step 2. `CONFLICTING` → the base merge must
run first. `BEHIND` → base advanced. `BLOCKED` → a gate (review or required
check) is unmet, not necessarily a conflict.

## 8. Labels

From step 2's `labels`. Record the current pipeline label (mutually exclusive:
`review`, `changes-requested`, `qa`, `qa-failed`, `merge-queue`, `blocked`,
`do-not-merge`), the category/meta/priority/risk labels present, and which ones
are **missing** versus what the diff warrants (see `AGENTS.md` → PR Workflow for
the inference rules). Missing priority/risk on a non-draft PR is a finding.

## 9. QA evidence

`needs-qa` / `skip-qa` / `qa-approved` / `qa-self-verified` / `screenshots` from
the label set, plus a scan of the PR comments for posted screenshots or a written
self-QA confirmation:

```bash
gh pr view {prNumber} --json comments --jq '.comments[] | {author:.author.login, body:.body}'
```

`needs-qa` without `qa-approved` is a **hard merge block**; so are `qa-failed`,
`blocked`, and `do-not-merge`.

## 10. Claim state

`in-progress` label, assignees other than the current user, and any 🤖 claim
comment newer than 30 minutes from another actor. Feeds the step-2 lock decision
in `SKILL.md`, not the classification.

---

## Output: the PR State Report

Fill this verbatim — it is what step 4 classifies and what step 7 publishes.

```markdown
### PR State Report — #{number} {title}

- Author / fork: {author} · {same-repo|fork} · {draft|ready}
- Plan: {plan path | run folder | none} — {done}/{total} steps done, next: {step}
- Diff scope: {spec-only|docs|UI|migration|contract|code} ({n} files)
- Review: {NONE|REVIEW_REQUIRED|CHANGES_REQUESTED|APPROVED} · {n} unresolved threads
- CI: {green|red: names|pending|none} ({n} required checks)
- Mergeability: {MERGEABLE|CONFLICTING|BEHIND|BLOCKED|UNKNOWN}
- Labels: pipeline={x} category={…} meta={…} priority={x} risk={x} · missing: {…}
- QA: {n/a|needs-qa, no evidence|needs-qa + qa-approved|skip-qa|qa-failed}
- Blockers: {hard blockers, or none}
```
