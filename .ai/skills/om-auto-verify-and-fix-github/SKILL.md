---
name: om-auto-verify-and-fix-github
description: Browser-first GitHub issue fix workflow. Claims a GitHub issue, checks for existing solutions, creates an isolated worktree, reproduces the bug through the Browser against the ephemeral integration environment, records a failing Playwright integration test, fixes the bug, makes the test green, runs validation/review gates, pushes a branch, and opens a PR linked to the issue.
---

# Auto Verify And Fix GitHub

Fix a GitHub issue end to end when the issue has a browser-visible user flow. This is the browser-first variant of `om-auto-fix-issue`: prove the bug in the running app before editing, preserve the reproduction as a Playwright integration test, then fix the product and open a PR.

Use `om-auto-fix-issue` instead when the issue is clearly static, CLI-only, API-only with no browser surface, or cannot reasonably be reproduced through the application UI.

## Arguments

- `{issueId}` (required) - the GitHub issue number, for example `1234`
- `{repo}` (optional) - `owner/name`; if omitted, infer from the current git remote
- `--force` (optional) - bypass the in-progress concurrency check; use only when intentionally taking over an existing claim

## Required Supporting Skills

Read these before deviating:

- `.agents/skills/om-auto-fix-issue/SKILL.md` - claim protocol, solved-work checks, worktree isolation, validation loop, PR labels, and issue handoff
- `.agents/skills/om-integration-tests/SKILL.md` - ephemeral environment, Browser/Playwright exploration, test placement, fixture rules, and failure artifact analysis
- `.agents/skills/om-code-review/SKILL.md` and `BACKWARD_COMPATIBILITY.md` - final self-review and compatibility gate

## Workflow

### 0. Claim the issue lock

Run the same in-progress check as `om-auto-fix-issue` before doing anything else:

```bash
CURRENT_USER=$(gh api user --jq '.login')
gh issue view {issueId} --repo {owner}/{repo} --json assignees,labels,number,title,comments
```

An issue is already in progress when any of these are true:

- it has the `in-progress` label,
- it has an assignee whose login is not `$CURRENT_USER`,
- another actor posted a recent claim comment that starts with `🤖`,
- an open PR appears to solve or reference the issue.

If another actor owns the lock and `--force` is absent, stop and ask the user whether to override. If `--force` is present, post a force-override comment naming the previous owner, then continue.

Claim only after the check passes:

```bash
gh issue edit {issueId} --repo {owner}/{repo} --add-assignee "$CURRENT_USER"
gh issue edit {issueId} --repo {owner}/{repo} --add-label "in-progress"
gh issue comment {issueId} --repo {owner}/{repo} --body "🤖 \`auto-verify-and-fix-github\` started by @${CURRENT_USER} at $(date -u +%Y-%m-%dT%H:%M:%SZ). Browser reproduction, integration coverage, and fix PR are in progress."
```

Always release the `in-progress` label in a finally/trap, even when the run aborts.

### 1. Resolve repository and fetch issue context

Infer `{owner}/{repo}` if omitted:

```bash
gh repo view --json nameWithOwner,defaultBranchRef
gh issue view {issueId} --repo {owner}/{repo} --json number,title,body,state,author,url,labels,assignees,comments
```

Capture:

- repository and issue URL,
- title, body, labels, state, author,
- recent comments and screenshots/log snippets,
- reported route, role, browser, fixture, or account details.

Base branch is always `develop`.

### 2. Check whether work already exists

Before creating a worktree or changing code:

```bash
gh issue view {issueId} --repo {owner}/{repo} --json state
gh search prs --repo {owner}/{repo} "#{issueId}" --state open --json number,title,url,state
gh search prs --repo {owner}/{repo} "#{issueId}" --state merged --json number,title,url,state
git fetch origin develop
git log origin/develop --grep="#{issueId}" --oneline
```

Stop early when the issue is already closed with a credible fix, an open PR already solves it, or `origin/develop` already contains the fix. Report the existing PR or commit instead of duplicating work.

### 3. Triage for a browser reproduction

Read the relevant context before starting the app:

- root `AGENTS.md` task-router rows,
- closest package/module `AGENTS.md`,
- related specs in `.ai/specs/` and `.ai/specs/enterprise/`,
- `.ai/lessons.md` if present.

Reduce the issue to:

- expected behavior,
- actual behavior,
- affected route or browser flow,
- required role and fixtures,
- likely owning package/module,
- smallest safe fix scope.

If there is no browser-visible path after triage, stop and report that this issue should use `om-auto-fix-issue` unless the user explicitly authorizes a non-browser fallback.

### 4. Create an isolated worktree

Never reproduce or fix in the primary worktree.

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
GIT_DIR=$(git rev-parse --git-dir)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
WORKTREE_PARENT="$REPO_ROOT/.ai/tmp/auto-verify-and-fix-github"
CREATED_WORKTREE=0

if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]; then
  WORKTREE_DIR="$PWD"
else
  WORKTREE_DIR="$WORKTREE_PARENT/issue-{issueId}-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$WORKTREE_PARENT"
  git fetch origin develop
  git worktree add --detach "$WORKTREE_DIR" "origin/develop"
  CREATED_WORKTREE=1
fi

cd "$WORKTREE_DIR"
git checkout -B "fix/issue-{issueId}-{slug}" "origin/develop"
yarn install --mode=skip-build
```

If `--mode=skip-build` is unavailable, run plain `yarn install`.

Rules:

- Reuse the current linked worktree when already inside one; do not create nested worktrees.
- All app startup, Browser exploration, code edits, tests, validation, and PR prep happen inside this worktree.
- Clean up a temporary worktree only if this run created it.

### 5. Start or reuse the ephemeral browser environment

Inside the issue worktree, read `.ai/qa/ephemeral-env.json` before starting anything.

- If it exists and says `status: running`, verify the recorded `baseUrl` or `base_url` responds and belongs to this worktree's current code.
- If it is missing, stale, points at the wrong checkout, or does not respond, start a fresh app:

```bash
yarn test:integration:ephemeral:start
```

Use the active URL from `.ai/qa/ephemeral-env.json`. Never assume `localhost:3000`. Default is usually `http://127.0.0.1:5001`, but the file is authoritative.

Keep the environment available for both reproduction and the red/green Playwright loop. If startup fails, diagnose the ephemeral logs before touching product code.

### 6. Reproduce through the Browser before editing

Use the Browser/in-app browser against the active ephemeral URL to perform the reported flow:

1. Login with the required role.
2. Navigate through the real UI, not guessed URLs unless the issue gives an exact route.
3. Create or locate fixtures safely; prefer API setup for repeatability.
4. Capture snapshots/screenshots or trace notes that show the actual failure.
5. Record exact selectors, labels, URL transitions, network errors, console errors, and expected vs actual state.

Do not edit production code until the bug is reproduced or there is a documented reason it cannot be reproduced in the ephemeral environment.

If reproduction fails because the issue is stale, already fixed, environment-specific, missing credentials, or underspecified, stop and report the evidence. Release the issue lock.

### 7. Write the failing Playwright integration test

Before fixing the bug, encode the browser reproduction as a module-local Playwright test.

Follow `om-integration-tests` rules:

- Put tests in `<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts`.
- Use the next TC number by checking existing scenarios and tests.
- Use locators discovered from Browser snapshots (`getByRole`, `getByLabel`, `getByText`).
- Do not hardcode record IDs, tenant IDs, organization IDs, or seeded/demo data.
- Create required fixtures at runtime and clean them up in `finally`/teardown.
- Keep each test file focused on one scenario.
- Add integration metadata when modules or environment variables gate the test.
- Do not add per-test timeout or retry overrides.

Run the new test before the fix and confirm it fails for the reported product behavior:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <path-to-new-test> --retries=0
```

Save the red-run evidence for the PR summary: failing assertion, screenshot/trace path, and a short reason. If the red run cannot be produced because the test runner or ephemeral environment is broken, stop unless the blocker is external and documented.

### 8. Implement the minimal fix

Fix only the owning code path.

Rules:

- Preserve behavior outside the reported flow.
- Do not refactor unrelated code.
- Do not broaden scope to adjacent UX improvements.
- Preserve public contracts unless the issue explicitly requires a compatibility-managed change.
- Follow the closest `AGENTS.md` for imports, data access, UI, i18n, and validation.
- Run `yarn generate` when module auto-discovery files change.

### 9. Make the browser test green

Run the new integration test until it passes:

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts <path-to-new-test> --retries=0
```

If it fails, inspect Playwright artifacts before changing code or test selectors:

- `test-results/**/error-context.md`,
- screenshots,
- trace/video attachments,
- HTML report when useful.

Classify each failure as product, test, or environment. Fix product bugs in product code and test brittleness in test code. Do not weaken assertions to make the test pass.

### 10. Run the fix-validation loop

After the targeted browser test is green, run the smallest relevant unit/type/i18n checks for changed packages, then the full gate before publishing unless a real blocker prevents it.

Per iteration:

1. Run unit tests for changed package/module.
2. Run typecheck for changed package/module or repo.
3. If user-facing strings or locale files changed, run:
   - `yarn i18n:check-sync`
   - `yarn i18n:check-usage`
4. If module structure, generated files, entities, or routes changed, run:
   - `yarn generate`
   - `yarn build:packages`
   - `yarn db:generate` only when entity schema changed, then review generated SQL and snapshots
5. Re-run the new Playwright integration test.
6. Re-read the diff and remove accidental scope creep.
7. Grep changed non-test files for raw `em.findOne(` / `em.find(` and replace with `findOneWithDecryption` / `findWithDecryption` where required.

Full pre-PR gate:

```bash
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
npx playwright test --config .ai/qa/tests/playwright.config.ts <path-to-new-test>
```

### 11. Self-review and backward compatibility review

Run the change through `.agents/skills/om-code-review/SKILL.md` and `BACKWARD_COMPATIBILITY.md`.

Explicitly verify:

- no frozen or stable contract surface was broken,
- no API response fields were removed,
- no event IDs, widget spot IDs, ACL IDs, import paths, or DI names were broken,
- tenant isolation and encryption rules are preserved,
- the new browser test is deterministic and cleans up its fixtures,
- the fix remains minimal.

Fix any findings and repeat the validation loop.

### 12. Commit and push

Only publish after the latest state includes:

- Browser reproduction evidence,
- a new integration test that failed before the fix,
- the fixed product code,
- the same integration test passing after the fix,
- required validation and self-review.

Suggested commit:

```bash
git add <changed-files>
git commit -m "fix(issue #{issueId}): {short summary}"
git push -u origin "$(git branch --show-current)"
```

Use `feat/issue-{issueId}-{slug}` only when the issue is clearly an enhancement rather than a defect.

### 13. Open the PR and normalize labels

Open the PR against `develop`.

PR title convention:

- `fix(<area>): <short summary> (#issueId)` for bugs,
- `feat(<area>): <short summary> (#issueId)` for enhancements,
- `security(<area>): <short summary> (#issueId)` for security fixes.

PR body:

```markdown
Fixes #{issueId}

## Problem
- {brief issue summary}

## Browser Reproduction
- Ephemeral URL: {baseUrl}
- Red run: {command + failing assertion/artifact path}
- Flow: {short UI path}

## Root Cause
- {root cause}

## What Changed
- {change 1}
- {change 2}

## Tests
- {new Playwright integration test path}
- {green command output summary}
- {unit/type/i18n/build checks}

## Backward Compatibility
- No contract surface changes
```

Apply labels immediately:

- add `review`,
- add `needs-qa` for customer-facing browser fixes unless the change is test-only or clearly low-risk,
- do not add `skip-qa` unless the PR is non-customer-facing,
- never add both `needs-qa` and `skip-qa`,
- give the PR exactly one priority label — inherit the issue's `priority-*` when present, otherwise infer one per the root `AGENTS.md` rule (this skill verifies real customer-facing browser bugs, so default at least `priority-medium`; raise to `priority-high` for auth/session/tenant/money/event-reliability or release-blocking flows),
- give the PR exactly one risk label — inherit the issue's `risk-*` when present, otherwise infer one per the root `AGENTS.md` rule (default `risk-medium`; raise to `risk-high` when the fix touches auth/session/tenant-scope/money, migrations, encryption, event reliability, shared contracts, or spans multiple modules; drop to `risk-low` only for a test-only/isolated change),
- do not add `qa-approved`; this skill's browser repro is not a substitute for manual QA sign-off, so a `needs-qa` PR stays blocked by the QA-approval gate until QA (or the self-QA exception) applies `qa-approved`.

Post a short PR comment for every pipeline/meta label changed.

### 14. Handoff and release the issue lock

After the PR exists, hand the issue back to the original issue author for verification unless the author is the current fixer, a bot account, or unavailable.

```bash
ISSUE_AUTHOR=$(gh issue view {issueId} --repo {owner}/{repo} --json author --jq '.author.login')

if [ -n "$ISSUE_AUTHOR" ] && [ "$ISSUE_AUTHOR" != "$CURRENT_USER" ] && [ -n "${PR_URL:-}" ]; then
  gh issue edit {issueId} --repo {owner}/{repo} --remove-assignee "$CURRENT_USER"
  gh issue edit {issueId} --repo {owner}/{repo} --add-assignee "$ISSUE_AUTHOR"
  gh issue comment {issueId} --repo {owner}/{repo} --body "Thanks @${ISSUE_AUTHOR} - a browser-verified fix PR is ready: ${PR_URL}. Reassigning this issue to you for verification."
fi
```

Always release the lock:

```bash
gh issue edit {issueId} --repo {owner}/{repo} --remove-label "in-progress"
gh issue comment {issueId} --repo {owner}/{repo} --body "🤖 \`auto-verify-and-fix-github\` completed: opened ${PR_URL:-(no PR - run aborted)}. Lock released."
```

Clean up only worktrees created by this run:

```bash
cd "$REPO_ROOT"
if [ "$CREATED_WORKTREE" = "1" ]; then
  git worktree remove --force "$WORKTREE_DIR"
fi
git worktree prune
```

### 15. Report back

Summarize:

```text
Issue #{issueId}: {title}
Status: {fixed | already solved | already in progress | not browser-reproducible | blocked}
Branch: {branch}
PR: {url}
Browser reproduction: {red evidence summary}
Integration test: {path + green command}
Other checks: {summary}
```

## Rules

- Always run the issue claim check before any other mutation.
- Always release the `in-progress` issue lock, even on failure.
- Always check for existing fixes before writing code.
- Always use an isolated worktree based on `origin/develop`.
- Always run the ephemeral environment and Browser exploration inside the issue worktree.
- Always check `.ai/qa/ephemeral-env.json` before starting a new ephemeral app.
- Always use the active URL from `.ai/qa/ephemeral-env.json`; never assume `localhost:3000`.
- Always reproduce the issue through the Browser before editing production code.
- Always write the Playwright integration test before the fix for browser-reproducible issues.
- Always run the new test red before the fix and green after the fix.
- Never rely on seeded/demo data in the integration test.
- Never hardcode record IDs, tenant IDs, or organization IDs in the integration test.
- Never weaken assertions just to make a test pass.
- Keep the fix minimal and scoped to the owning module/package.
- Run targeted checks while iterating and the full validation gate before PR publication unless a real blocker is documented.
- Run code-review and backward-compatibility self-review before publishing.
- Link the issue in the PR and include browser reproduction evidence.
- New PRs from this skill must start with the `review` pipeline label.
- Customer-facing browser fixes should usually carry `needs-qa`; use `skip-qa` only for clearly non-customer-facing changes.
- Always give the PR exactly one priority label (inherit the issue's, else infer per root `AGENTS.md`); never add `qa-approved` — a `needs-qa` PR stays blocked by the QA-approval gate until manual QA signs off.
- Always give the PR exactly one risk label (inherit the issue's, else infer per root `AGENTS.md`).
- When this skill changes PR labels, it must also post a short comment explaining why.
- Branches opened by this skill must use `fix/` for corrective work or `feat/` for enhancement work; never `codex/`.
