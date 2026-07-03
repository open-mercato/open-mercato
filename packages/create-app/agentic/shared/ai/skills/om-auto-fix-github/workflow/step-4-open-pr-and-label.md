# Step 4 — Push the branch, open the PR, normalize labels

Only publish after the latest fix state includes regression tests, passes the required validation,
and passes self-review and BC checks.

## 4a. Commit and push the fix branch

- Branch: `fix/issue-{issueId}-{slug}` (corrective work) or `feat/issue-{issueId}-{slug}` (clear
  enhancement/feature). Never `codex/...`.
- Commit style: `fix(issue #{issueId}): {short summary}`.

```bash
git push -u origin "$(git branch --show-current)"
```

## 4b. Open the PR (linked to the issue)

Open against `$BASE_BRANCH` (environment §1) in the current repository.

PR title — conventional-commit prefix scoped to the primary affected `<area>` (module or package,
e.g. `auth`, `catalog`, `ui`, `shared`):

- `fix(<area>): <short summary> (#{issueId})` — bug fixes (most issue fixes)
- `feat(<area>): <short summary> (#{issueId})` — new features
- `refactor(<area>): <short summary> (#{issueId})` — refactors
- `security(<area>): <short summary> (#{issueId})` — security fixes

Examples: `fix(auth): prevent privilege escalation via role name spoofing (#1427)`;
`feat(catalog): add bulk product import endpoint (#1500)`.

PR body — link the issue, describe root cause, what changed, the added regression tests, the checks
you ran, and BC status:

```markdown
Fixes #{issueId}

## Problem
- {brief issue summary}

## Root Cause
- {root cause}

## What Changed
- {change 1}
- {change 2}

## Tests
- {unit tests added or updated}
- {other checks}

## Backward Compatibility
- No contract surface changes
```

If the issue is in another repository or should not auto-close, replace `Fixes #{issueId}` with a
plain issue link. Capture the resulting URL as `PR_URL` for the handoff in step 5.

## 4c. Normalize labels (opt-in — probe first)

Apply labels with the `apply_label` probe (environment §2); skip-and-log any label this repo lacks:

- `review` — new PRs from this skill start here.
- `skip-qa` — only for clearly low-risk changes (docs-only, dependency-only, CI-only, test-only, or
  trivial typo/single-file maintenance fixes).
- `needs-qa` — only when the fix clearly introduces customer-facing behavior that must be manually
  exercised. Never combine `needs-qa` and `skip-qa`.
- After each applied label, post a short PR comment explaining why.

Suggested label comments:

- `review`: `Label set to \`review\` because the fix PR is ready for code review.`
- `skip-qa`: `Label set to \`skip-qa\` because this change is low-risk and does not need manual QA.`

If another auto-skill will immediately continue on the new PR, it must run the normal PR claim
protocol (assignee + `in-progress` + claim comment) before mutating it. Then proceed to
`step-5-handoff-and-report.md`.
