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

If `mergeable` is `"CONFLICTING"` or `mergeStateStatus` is `"DIRTY"`, **do NOT checkout or run the code review**. Instead, immediately submit a changes-requested review:

```bash
gh pr review {prNumber} --request-changes --body "$(cat <<'EOF'
# Code Review: {title}

## Summary

This PR has **merge conflicts** that must be resolved before a code review can proceed.

### How to fix

1. Fetch the latest base branch:
   ```bash
   git fetch origin {baseRefName}
   ```
2. Rebase or merge:
   ```bash
   git rebase origin/{baseRefName}
   # or
   git merge origin/{baseRefName}
   ```
3. Resolve all conflicts, then force-push:
   ```bash
   git push --force-with-lease
   ```

Once conflicts are resolved, request a new review and I'll be happy to take another look!

---

Hey, merge conflicts happen to the best of us! Resolve these and ping me again — I know the code underneath is great work.
EOF
)"
```

Apply `changes-requested` label and skip to step 6.

#### 2b. Check CI status

```bash
gh pr checks {prNumber} --json name,state,conclusion
```

If any **required** check has `conclusion` of `"FAILURE"` or `"STARTUP_FAILURE"`, or `state` is `"FAILURE"`, **do NOT checkout or run the code review**. Instead, immediately submit a changes-requested review listing the failing checks:

```bash
gh pr review {prNumber} --request-changes --body "$(cat <<'EOF'
# Code Review: {title}

## Summary

This PR has **failing CI checks** that must be fixed before a code review can proceed.

## Failing Checks

| Check | Status |
|-------|--------|
| {checkName1} | FAILED |
| {checkName2} | FAILED |

### How to fix

1. Click on the failing check(s) in the PR's "Checks" tab to see the logs
2. Fix the underlying issue in your branch
3. Push the fix — CI will re-run automatically

Once CI is green, request a new review and I'll dive right in!

---

CI hiccups are just part of the process — fix these up and I'll give your code the thorough review it deserves. You've got this!
EOF
)"
```

Apply `changes-requested` label and skip to step 6.

If both checks pass (no conflicts, no CI failures), proceed to checkout.

### 3. Checkout the PR branch

```bash
gh pr checkout {prNumber}
```

### 4. Run the code-review skill

Execute the full code review following `.ai/skills/code-review/SKILL.md`:

- Scope changed files (use `gh pr diff {prNumber} --name-only` for the file list)
- Gather context from AGENTS.md, specs, lessons
- Run CI/CD verification gate (all 8 steps)
- Template parity gate
- Backward compatibility gate
- Review checklist
- Test coverage check
- Cross-module impact check
- Produce the review report

### 5. Classify the result

Based on the review findings, determine the outcome:

| Condition | Decision |
|-----------|----------|
| Any **Critical** or **High** findings | `changes_requested` |
| Only **Medium** and/or **Low** findings | `approved` |
| No findings at all | `approved` |

### 6. Submit the GitHub review

#### If approved (no Critical/High findings):

```bash
gh pr review {prNumber} --approve --body "$(cat <<'EOF'
{review report}

---

You're doing amazing work — this PR is solid and ready to ship! Keep up the great momentum, your contributions make the whole team better.
EOF
)"
```

Then apply the label:

```bash
gh pr edit {prNumber} --add-label "merge-queue" --remove-label "changes-requested" 2>/dev/null || true
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

Then apply the label:

```bash
gh pr edit {prNumber} --add-label "changes-requested" --remove-label "merge-queue" 2>/dev/null || true
```

### 7. Report back

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
- The review body MUST contain the full structured review report from the code-review skill
- Always remove the opposite label when applying one (idempotent labeling)
- If `gh pr edit --add-label` fails because the label doesn't exist yet, create it first with `gh label create`
- Never force-push or modify the PR branch — this skill is read-only + review
- After completing the review, checkout back to the original branch
