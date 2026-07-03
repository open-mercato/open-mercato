# Step 3 — Submit the verdict, transition pipeline labels, hand off to the author

## 3a. Submit the review

If approved, submit an approval review. If there are Critical, High, or Medium findings, submit a
changes-requested review. The review body MUST contain the full structured report from the
code-review skill. For re-reviews, note explicitly in the title/summary that it is a re-review.

## 3b. Pipeline-label transitions (opt-in, probe first)

Pipeline labels are **mutually exclusive**: `review`, `changes-requested`, `qa`, `qa-failed`,
`merge-queue`, `blocked`, `do-not-merge`. Keep `in-progress` separate — it is a lock, not a state.

This skill sets many labels, and a freshly scaffolded repo may not define them. **Probe before every
label operation** and skip-and-log when missing (environment §2) — never fail the run over an absent
label:

```bash
label_exists() { gh label list --limit 200 --json name --jq '.[].name' | grep -Fxq "$1"; }
```

Define and reuse a `setPipelineLabel(prNumber, newLabel)` helper that, **only for labels that exist**:

- adds `newLabel`;
- removes every other pipeline label from the list above;
- preserves category labels (`bug`, `feature`, `refactor`, `security`, `dependencies`, `enterprise`,
  `documentation`) and meta labels (`needs-qa`, `skip-qa`, `qa-approved`, `qa-self-verified`,
  `in-progress`);
- uses the GraphQL API for atomicity;
- logs `[labels] Skipping '<name>' (not defined in this repo)` for any missing label.

After every pipeline-label change, post a one-sentence PR comment explaining the choice.

Label rules:

- If the PR has no pipeline label when review starts, set `review` first so the state machine is explicit.
- Changes requested → set `changes-requested`.
- Approved and the PR carries `needs-qa` without `skip-qa` → **keep `needs-qa` and set `merge-queue`**;
  the QA-approval gate holds the actual merge until a QA reviewer adds `qa-approved`. **Auto-skills
  never set the `qa` pipeline label** — `qa` is driven manually by a QA reviewer.
- Approved with no QA requirement → set `merge-queue`.
- Never leave `review`, `changes-requested`, `qa`, `qa-failed`, and `merge-queue` on the PR together.

Suggested one-line comments:

- `review`: ``Label set to `review` because this PR is ready for code review.``
- `changes-requested`: ``Label set to `changes-requested` because review found actionable issues.``
- `merge-queue`: ``Label set to `merge-queue` because the required review gates passed.``
- `blocked`: ``Label set to `blocked` because progress depends on an external blocker.``
- `do-not-merge`: ``Label set to `do-not-merge` because this PR should not merge yet.``

At the end of the run, list any skipped (undefined) labels in the summary and offer the paste-in
`gh label create` commands from environment §2.

## 3c. Author handoff on `changes-requested`

When the verdict is `changes-requested`, reassign the PR back to the original author after the review
and pipeline label are posted — unless the author is the current reviewer, a bot, or otherwise
unavailable.

```bash
PR_AUTHOR=$(gh pr view {prNumber} --json author --jq '.author.login')
if [ -n "$PR_AUTHOR" ] && [ "$PR_AUTHOR" != "$CURRENT_USER" ]; then
  gh pr edit {prNumber} --remove-assignee "$CURRENT_USER"
  gh pr edit {prNumber} --add-assignee "$PR_AUTHOR"
  gh pr comment {prNumber} --body "Thanks @${PR_AUTHOR} — review found actionable items, so I'm handing this PR back to you for the next pass. When the updates are pushed, re-request review and the automation can pick it up from the latest head."
fi
```

Rules:

- Do this for every `changes-requested` outcome, including the step 1 early exits (conflicts, failing
  required checks) and the step 2b duplicate/already-merged exit.
- If the author cannot be assigned (bot/deleted/permission), keep the current assignee and leave the
  handoff comment without the reassignment claim.
- The handoff comment is separate from the one-line pipeline-label comment; keep both.

When the verdict is `changes-requested` and this run is allowed to autofix, continue to
`step-4-autofix-loop.md`. Otherwise go to `step-5-summary-cleanup-report.md`.
