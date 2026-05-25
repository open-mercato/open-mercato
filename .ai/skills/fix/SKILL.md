---
name: fix
description: Implements the minimal code change identified by the root-cause step, adds regression tests, and runs the validation gate. Claims the GitHub issue at start (assignee + in-progress label + claim comment) so concurrent automation backs off. Does not commit, push, or open a PR — that is the open-pr step's job.
---

# Fix

You are step 3 of an autofix workflow. The previous step (`root-cause`) wrote a brief telling you what to change and where. The repo is checked out on an isolated branch in the current working directory.

Your job: implement the proposed change, prove it works, and stop. The next step (`open-pr`) handles commit/push/PR.

## Arguments

- `{issueId}` (required) — the GitHub issue number
- `{repo}` (optional) — `owner/name`; infer from git remote if omitted

## Tools

You have write access:

- `Read`, `Edit`, `Write`, `Grep`, `Glob`
- `Bash`: full (tests, typecheck, generators, `gh` for the claim)

Do not run `git commit`, `git push`, or `gh pr create` — those are the next step's responsibility.

## Procedure

### 1. Claim the issue

This is the only step before PR-open that mutates GitHub state. Run the claim once, up front, so any parallel automation sees the lock immediately.

```bash
CURRENT_USER=$(gh api user --jq '.login')
gh issue edit {issueId} --repo {owner}/{repo} --add-assignee "$CURRENT_USER" || true
gh issue edit {issueId} --repo {owner}/{repo} --add-label "in-progress" || true
gh issue comment {issueId} --repo {owner}/{repo} --body \
  "🤖 \`autofix\` started by @${CURRENT_USER} at $(date -u +%Y-%m-%dT%H:%M:%SZ). Other auto-skills will skip this issue until the lock is released."
```

The lock release happens in `open-pr` (success path) or via an external janitor (failure path). Do not release here.

### 2. Read the analyzer's brief

The analyzer's full output is included in your user prompt, in a block marked:

```
— PREVIOUS STEP (root-cause) said —
<analyzer brief here>
```

Identify from that block:

- the file(s) to change
- the approach
- the regression test to add

**Do not invent your own root cause.** If the brief is missing, empty, contradicts the repo (e.g. names files that don't exist), or ended with `Status: blocked`, end your own output with `Status: blocked` and a one-line reason. The chain will stop cleanly — better than shipping a wrong fix.

If the analyzer ended with `LOW_CONFIDENCE`, be extra careful — re-read the affected code yourself before editing.

### 3. Make the minimal change

Edit only the files the analyzer named (plus the test file). Do not refactor unrelated code. Do not broaden scope.

Hard rules from the project's AGENTS.md (apply to every fix):

- In production code, prefer `findOneWithDecryption` / `findWithDecryption` over raw `em.findOne(` / `em.find(` — grep changed files before claiming done.
- Preserve frozen/stable contracts unless the issue explicitly requires a contract change (see BACKWARD_COMPATIBILITY.md).
- Respect tenant isolation rules.

### 4. Add regression tests (mandatory, autonomous)

Every fix MUST include test coverage. This is non-negotiable — never skip tests, never ask whether to add them.

- Add or update a unit test that fails without your fix and passes with it
- Add integration tests when the change touches risky flows (permissions, tenant isolation, multi-module behavior, workflows)
- Tests must be self-contained and target the smallest meaningful scope

### 5. Validation loop

Iterate until clean. Per iteration:

1. Run targeted unit tests for every changed package/module
2. Run targeted typecheck
3. If i18n files or user-facing strings changed: `yarn i18n:check-sync` and `yarn i18n:check-usage`
4. If entities/routes/templates changed: `yarn generate` and the relevant follow-ups (`yarn db:generate`, `yarn template:sync`)
5. Re-read the diff and remove any accidental scope creep

Before declaring done, run the CI/CD verification gate (from the `code-review` skill):

```
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
```

If the full gate is genuinely too expensive in the time available, run the targeted subset for changed packages and call out in your final summary which gate steps were skipped. The `open-pr` step will surface this in the PR body.

### 6. Self-review

Run the change through the `code-review` skill checks and BACKWARD_COMPATIBILITY.md:

- no frozen/stable contract surface broken without the deprecation protocol
- no API response fields removed
- no broken event IDs, widget spot IDs, ACL IDs, import paths, or DI names
- no tenant-isolation or encryption rule violations (re-grep for raw `em.findOne(`/`em.find(`)
- fix remains minimal — no unrelated churn

If self-review finds new issues, fix them and re-run the validation loop.

## Output contract

End with a final plain-text message in this shape — the next step parses it:

```
Status: ready
Files changed:
- <path/to/file-a.ts>
- <path/to/file-b.ts>
- <path/to/file-a.test.ts>

Summary: <one paragraph — what changed and why it fixes the issue>

Tests: <which tests/checks were added and that the full validation gate passed (or which steps were skipped and why)>

BC: <"no contract changes" OR a short statement of the contract change and the deprecation protocol followed>
```

If you cannot complete the fix safely (blocker discovered, change unexpectedly broad, tests can't be made to pass), end with `Status: blocked` instead and explain what's wrong. The lock will remain set so a human can pick it up.

## Rules

- Tests are mandatory and added autonomously — never push or hand off without them.
- No commit, no push, no PR — leave that to `open-pr`.
- Stay inside the worktree the engine prepared; do not create nested worktrees.
- Keep scope minimal; refactors belong in their own PR.
- Hard rule from AGENTS.md: grep changed non-test files for raw `em.findOne(`/`em.find(` and replace with the decryption variants before declaring done.
