---
name: om-auto-review-pr
description: Open Mercato repo-local extension of the shared `om-auto-review-pr` skill (installed from open-mercato/skills into .agents/skills/). Makes the review GitHub-checks-first (local validation only as a narrow fallback) and keeps this repo's stricter verdict rule (Medium findings request changes).
---

# Auto Review PR — Open Mercato extension

This file extends the shared `om-auto-review-pr` skill from [open-mercato/skills](https://github.com/open-mercato/skills) (installed at `.agents/skills/om-auto-review-pr/SKILL.md`). Follow the shared skill's full workflow — claim protocol, worktree isolation, review, verdict, labels, autofix loop, lock release — with the repo-specific rules below layered on top. The `om-code-review` step also picks up this repo's own extension at `.ai/skills/om-code-review/SKILL.md`.

## GitHub-checks-first validation (saves local resources)

CI already runs the full validation gate on every PR. Prefer GitHub PR check results over re-running `validation.commands` locally:

- Read the current PR checks (tracker operation **get-pr-checks**) and required checks (**get-required-checks**) first.
- For failing checks, inspect the check logs from GitHub rather than reproducing locally — e.g. `gh run view <run-id> --log-failed` when the check links to a workflow run.
- Run local test, typecheck, lint, build, template-sync, Playwright, package-install, or migration commands **only as a fallback** when GitHub check data is unavailable or unusable for the current PR head (permissions/API errors, no reported checks for the head SHA, or a failing check whose logs cannot be opened).
- Keep the fallback as narrow as the missing CI signal allows: relevant unit tests / typecheck for the changed packages first; expand to workspace scope only when findings touch shared contracts or multiple packages; run broad `yarn lint` / `yarn test` / `yarn typecheck` / `yarn build:*` only when GitHub provides no usable check data for those gates.
- If required checks are merely **pending**, do not run local substitutes — continue the code review, report the pending checks, and let branch protection plus the merge queue hold the actual merge.
- Record the validation source in the review report (`Validation source: GitHub checks` / `local fallback (<commands>)`).

When the shared skill (or the shared `om-code-review`) asks for local validation, first replace that action with GitHub check inspection under the rules above. Keep the same analysis depth: read code, specs, tests, contracts, and relevant docs.

## Verdict rule (stricter than the shared default)

This repo requests changes on Medium findings too:

| Condition | Decision |
|-----------|----------|
| Any Critical/blocker, High/major, or Medium/minor finding | `changes_requested` |
| Only Low/nit findings | `approved` |
| No findings | `approved` |

## Repo conventions the shared workflow already parameterizes

- Base branch: PRs target `develop` (config `baseBranch`); the PR's own `baseRefName` stays authoritative for diffs.
- Labels, QA gate, and claim protocol: as defined in `.ai/agentic.config.json` and root `AGENTS.md` (QA-approval merge gate: `needs-qa` without `qa-approved` never merges; auto-skills never touch the `qa` pipeline label).
