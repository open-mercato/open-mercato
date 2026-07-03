# Step 4 — Open the PR and normalize labels

## 4a. Open the PR

Open against `$BASE_BRANCH` (see `../references/environment.md` §1) in the current repository.
Title = conventional-commit prefix scoped to the primary area (e.g. `feat(ui): add confirmation
dialog wrapper`, `refactor(catalog): extract pricing resolver`, `docs(skills): …`).

PR body — **MUST** include the `Tracking plan:` line so `om-auto-continue-pr` can resume:

```markdown
Tracking plan: .ai/runs/${DATE}-${SLUG}.md
Status: in-progress

## Goal
- {one-line task summary from brief}

## External References
- {url — what was adopted, what was rejected}  <!-- only if --skill-url was used -->

## What Changed
- {bullet list of phase-level changes}

## Tests
- {unit tests added or updated}
- {other checks}

## Backward Compatibility
- {No contract surface changes | Describe BC handling}

## Progress
See [Progress section in the plan](.ai/runs/${DATE}-${SLUG}.md#progress).
```

Flip `Status:` to `complete` once all Progress steps are checked.

## 4b. Normalize labels (opt-in — probe first)

Apply labels per the PR workflow in root `AGENTS.md`, using the `apply_label` probe from
`../references/environment.md` §2 (skip-and-log any label this repo lacks):

- `review` — new PRs start here unless the run stopped early with an explicit blocker.
- `skip-qa` — only for clearly low-risk non-customer-facing changes (docs/deps/CI/test-only, trivial typos).
- `needs-qa` — when the run touches UI, sales/order flows, or other customer-facing behavior. Never combine with `skip-qa`.
- Additive category labels when they clearly apply: `bug`, `feature`, `refactor`, `security`, `dependencies`, `documentation`.
- After each applied label, post a short PR comment explaining why. In the final summary, list any labels that were skipped because the repo lacks them (with the `gh label create` commands).

Then proceed to `step-5-review-summary-cleanup.md`.
