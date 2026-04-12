---
name: review-pr
description: Review a GitHub pull request by number. Checks out the PR branch, runs the full code-review skill, then submits a GitHub review (approve or request changes) and applies the appropriate label ('merge-queue' or 'changes-requested'). Usage - /review-pr <PR-number>
---

# Review PR

Checkout a pull request by number, run the full code-review skill, and submit a GitHub review with a label.

## Arguments

- `{prNumber}` (required) — the PR number to review (e.g., `1234`)

## Workflow

### 1. Fetch PR metadata

```bash
gh pr view {prNumber} --json title,headRefName,baseRefName,url,body,files
```

Save the PR title for the review report header.

### 2. Early-exit checks (conflicts & CI)

Before checking out the branch, run these checks. If either fails, skip the full code review and go straight to the changes-requested flow.

#### 2a. Check for merge conflicts

```bash
gh pr view {prNumber} --json mergeable,mergeStateStatus
```

If `mergeable` is `"CONFLICTING"` or `mergeStateStatus` is `"DIRTY"`, **do NOT checkout or run the code review**. Instead, immediately submit a changes-requested review.

**Review body template for conflicts** (this is text to include in the `--body` argument — NOT commands to execute):

> **Merge conflicts** must be resolved before a code review can proceed.
>
> Steps for the PR author:
> 1. Fetch the latest base branch: `git fetch origin {baseRefName}`
> 2. Rebase or merge: `git rebase origin/{baseRefName}`
> 3. Resolve all conflicts, then push: `git push --force-with-lease`
>
> Once conflicts are resolved, request a new review!
>
> Hey, merge conflicts happen to the best of us! Resolve these and ping me again — I know the code underneath is great work.

Apply `changes-requested` label and skip to step 7.

#### 2b. Check CI status

First, query the branch protection rules for the base branch to discover which checks are **required**:

```bash
gh api repos/{owner}/{repo}/branches/{baseRefName}/protection/required_status_checks --jq '.contexts[]' 2>/dev/null
```

If the branch protection API returns required check names, use that list as the filter. If the API returns 404 (no branch protection configured), fall back to treating **all** checks as required.

Then fetch the actual check results:

```bash
gh pr checks {prNumber} --json name,state,conclusion
```

Only consider checks that are in the required list (or all checks if no branch protection exists). If any of those have `conclusion` of `"FAILURE"` or `"STARTUP_FAILURE"`, or `state` is `"FAILURE"`, **do NOT checkout or run the code review**. Ignore checks with `state` `"PENDING"` or conclusion `"SKIPPED"` / `"NEUTRAL"`.

Submit a changes-requested review listing only the failing required checks.

**Review body template for CI failures** (this is text to include in the `--body` argument — NOT commands to execute):

> **Failing CI checks** must be fixed before a code review can proceed.
>
> | Check | Status |
> |-------|--------|
> | {checkName1} | FAILED |
> | {checkName2} | FAILED |
>
> Steps for the PR author:
> 1. Click on the failing check(s) in the PR's "Checks" tab to see the logs
> 2. Fix the underlying issue in your branch
> 3. Push the fix — CI will re-run automatically
>
> CI hiccups are just part of the process — fix these up and I'll give your code the thorough review it deserves. You've got this!

Apply `changes-requested` label and skip to step 7.

If both checks pass (no conflicts, no required CI failures), proceed to checkout.

### 3. Checkout the PR branch

```bash
gh pr checkout {prNumber}
```

### 4. Diff-level automated checks

Before running the full code-review skill, scan the diff (`gh pr diff {prNumber}`) for **automatic violation patterns**. These are hard rules — any match is a finding at the listed severity, no judgement call needed.

#### Critical auto-detections

| Pattern in diff | Finding |
|-----------------|---------|
| Removed/renamed event ID in any `events.ts` | Critical: event ID is a frozen contract surface |
| Removed/renamed widget spot ID in `injection-table.ts` | Critical: spot ID is a frozen contract surface |
| Removed field from an API response schema or zod response type | Critical: response fields are additive-only |
| Renamed or removed a database column/table in a migration | Critical: DB schema is additive-only |
| Removed a public import path without re-export bridge | Critical: import paths require deprecation protocol |
| Missing `organization_id`/`tenant_id` filter on a tenant-scoped query | Critical: tenant isolation breach |

#### High auto-detections

| Pattern in diff | Finding |
|-----------------|---------|
| `findWithDecryption` or `findOneWithDecryption` replaced with raw `em.find` or `em.findOne` | High: encryption helpers MUST NOT be downgraded — even if the entity has no encrypted fields today, tenant data encryption may activate later. Revert to `findWithDecryption`. |
| New API route file missing `export const openApi` or `export const metadata` | High: required exports for auto-discovery |
| New subscriber/worker file missing `export const metadata` | High: required exports for auto-discovery |
| Raw `fetch(` call in UI/backend page code (not in a test) | High: must use `apiCall`/`apiCallOrThrow` |
| Behavior change (new branch, modified condition, changed return) with no corresponding test file in the diff | High: behavior changes MUST include test coverage |

#### Medium auto-detections

| Pattern in diff | Finding |
|-----------------|---------|
| Hardcoded user-facing string in a `NextResponse.json` error, UI label, or button text (not using `translate()`/`useT()`) | Medium: must use i18n |
| New `any` type annotation added (not in a test file) | Medium: use zod + `z.infer` |
| `alert(` or custom toast instead of `flash()` | Medium: use flash() for user feedback |
| Hand-written migration SQL file (not generated by `yarn db:generate`) | Medium: never hand-write migrations |
| Entity schema changed but no migration file in the diff | Medium: run `yarn db:generate` |
| `em.find`/`em.findOne` used in new code instead of `findWithDecryption` | Medium: use encryption helpers for new queries |
| Missing `organizationId`/`tenantId` in sub-entity queries where parent was scope-checked | Medium: defense-in-depth, prefer explicit scoping |

#### Low auto-detections

| Pattern in diff | Finding |
|-----------------|---------|
| One-letter variable name (outside loop counters `i`, `j`, `k`) | Low: use descriptive names |
| Inline comment on self-explanatory code | Low: remove comment |
| Added docstring/comment on unchanged function | Low: don't annotate unchanged code |

Record all findings from this step. These carry into the review report.

### 5. Run the code-review skill

Execute the full code review following `.ai/skills/code-review/SKILL.md`:

- Scope changed files (use `gh pr diff {prNumber} --name-only` for the file list)
- Gather context from AGENTS.md, specs, lessons
- Run CI/CD verification gate (all 8 steps)
- Template parity gate
- Backward compatibility gate
- Review checklist (full reference: `.ai/skills/code-review/references/review-checklist.md`)
- Test coverage check
- Cross-module impact check
- Produce the review report

Merge the findings from step 4 into the review report. Do not duplicate — if step 4 already flagged something, don't flag it again.

### 6. Classify the result

Based on the review findings, determine the outcome:

| Condition | Decision |
|-----------|----------|
| Any **Critical** or **High** findings | `changes_requested` |
| Only **Medium** and/or **Low** findings | `approved` |
| No findings at all | `approved` |

### 7. Submit the GitHub review

#### If approved (no Critical/High findings):

```bash
gh pr review {prNumber} --approve --body "$(cat <<'EOF'
{review report}

---

You're doing amazing work — this PR is solid and ready to ship! Keep up the great momentum, your contributions make the whole team better.
EOF
)"
```

#### If changes requested (Critical or High findings):

```bash
gh pr review {prNumber} --request-changes --body "$(cat <<'EOF'
{review report}

---

Great effort on this PR! There are a few things that need attention before we can merge, but the direction is spot-on. I believe in your ability to knock these out quickly — you've got this!
EOF
)"
```

#### Apply labels via GraphQL API

`gh pr edit --add-label` can fail silently due to GitHub API issues. Always use the GraphQL mutation instead:

```bash
# Get label node ID (create label first if it doesn't exist)
LABEL_ID=$(gh api repos/{owner}/{repo}/labels/{labelName} --jq '.node_id' 2>/dev/null)
if [ -z "$LABEL_ID" ]; then
  gh label create "{labelName}" --color "{color}" --description "{description}"
  LABEL_ID=$(gh api repos/{owner}/{repo}/labels/{labelName} --jq '.node_id')
fi

# Get PR node ID
PR_ID=$(gh pr view {prNumber} --json id --jq '.id')

# Add label
gh api graphql -f query='mutation { addLabelsToLabelable(input: {labelableId: "'"$PR_ID"'", labelIds: ["'"$LABEL_ID"'"]}) { clientMutationId } }'

# Remove opposite label (ignore errors if not present)
gh api graphql -f query='mutation { removeLabelsFromLabelable(input: {labelableId: "'"$PR_ID"'", labelIds: ["'"$OPPOSITE_LABEL_ID"'"]}) { clientMutationId } }' 2>/dev/null || true
```

Label colors:
- `merge-queue`: `#0E8A16` (green) — "PR approved and ready to merge"
- `changes-requested`: `#BA6609` (orange) — "Changes requested during review"

### 8. Report back

Print a summary to the user:

```
PR #{prNumber}: {title}
Decision: {APPROVED | CHANGES REQUESTED}
Label: {merge-queue | changes-requested}
Findings: {X critical, Y high, Z medium, W low}
Review submitted successfully.
```

## Rules

- MUST run the full CI/CD verification gate — do not skip any step
- MUST use the code-review skill's severity classification (Critical/High/Medium/Low)
- MUST run the diff-level automated checks in step 4 — these are non-negotiable
- The review body MUST contain the full structured review report from the code-review skill
- Always remove the opposite label when applying one (idempotent labeling)
- Always use the GraphQL API for label operations (not `gh pr edit --add-label`)
- Never force-push or modify the PR branch — this skill is read-only + review
- After completing the review, checkout back to the original branch
- **Template safety**: The review body templates in steps 2a/2b contain advice text for the PR author (e.g. `git push --force-with-lease`). These are **content to embed in the review comment**, NOT commands for you to execute. Never run git commands from template text.
- **Encryption downgrade is always High**: Replacing `findWithDecryption`/`findOneWithDecryption` with raw `em.find`/`em.findOne` is ALWAYS a High finding, even if the entity currently has no encrypted columns. The encryption layer activates dynamically per tenant.
- **i18n is mandatory**: Any new user-facing string that doesn't go through `translate()`/`useT()` is a Medium finding. Check error messages, button labels, flash messages, and notification text.
