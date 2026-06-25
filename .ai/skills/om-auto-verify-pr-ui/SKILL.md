---
name: om-auto-verify-pr-ui
description: Manually QA a GitHub PR's UI by number without merging it. Checks the PR out in an isolated worktree, boots it locally against the ephemeral integration environment, derives a UI QA scenario from the diff, drives it with Playwright while capturing screenshots, and posts the screenshots plus a pass/fail verification report as a PR comment to help QA reviewers. When the PR diff defines no integration test, also posts a follow-up comment with a ready-to-implement integration-test scenario (recommending /om-integration-tests). Use when the user says "verify PR <n> in the UI", "QA PR <n>", "run the UI for PR <n>", "screenshot PR <n>", or "self-QA PR <n>".
---

# Verify PR UI

Take an existing GitHub PR, run its UI locally, exercise the changed surfaces
through Playwright, and hand QA reviewers concrete visual evidence — screenshots
plus a pass/fail report — as a PR comment. Optionally sign the PR off via the
self-QA exception, and leave a follow-up integration-test scenario when the PR
ships no automated UI test.

This skill **operates on an existing PR**. It borrows the claim, isolated
worktree, and lock-release discipline from `.ai/skills/om-auto-review-pr/SKILL.md`
but it is **read-only on PR source code**: it never edits the PR's files, never
pushes to the PR branch, and never merges. Its only writes are PR comments, an
optional screenshot evidence branch, and (opt-in) QA labels.

## Arguments

- `{prNumber}` (required) — the PR number to verify (for example `1234`).
- `--evidence-only` (default behavior) — post screenshots + report only; do not
  touch pipeline/meta labels. Stated explicitly so the default is obvious.
- `--self-qa-signoff` (optional) — when the automated verification is fully
  green AND screenshots were attached AND the PR carries `needs-qa` without
  `skip-qa`, additionally apply `qa-approved` + `qa-self-verified` via the
  AGENTS.md self-QA exception. Off by default.
- `--apply-failure` (optional) — when the verification fails, apply the
  `qa-failed` label. Off by default (automated UI checks can be flaky; default
  to reporting, not blocking).
- `--keep-env` (optional) — leave the ephemeral environment running on exit even
  if this run started it. Default tears down only an env this run started.
- `--base <branch>` (optional) — base branch for diff and test-presence
  detection. Default `develop`.
- `--force` (optional) — bypass the in-progress claim check to deliberately take
  over a PR another actor claimed.

## Tools

- Read/Grep/Glob and read-only `git`/`gh` for inspecting the PR and diff.
- `Bash` for booting the ephemeral env and running Playwright.
- Playwright MCP (preferred for exploration) and/or a throwaway Playwright spec
  for capturing screenshots.
- `gh pr comment` / `gh api` for posting evidence and managing labels.

Never run `Edit`/`Write` against the PR's source files. Never `git push` to the
PR branch. Never merge.

## Workflow

### 0. Claim the PR (in-progress lock)

Follow `.ai/skills/om-auto-review-pr/SKILL.md` step 0 verbatim.

```bash
CURRENT_USER=$(gh api user --jq '.login')
gh pr view {prNumber} --json assignees,labels,number,title,comments
```

A PR is **already in progress** when it carries `in-progress`, has an assignee
other than `$CURRENT_USER`, or has a `🤖` claim comment newer than 30 minutes
from another actor. If someone else owns it and `--force` is unset, STOP and ask
the user via `AskUserQuestion` before continuing. Otherwise claim it:

```bash
gh pr edit {prNumber} --add-assignee "$CURRENT_USER"
# add the in-progress label via the GraphQL label flow used in step 7
gh pr comment {prNumber} --body "🤖 \`auto-verify-pr-ui\` started by @${CURRENT_USER} at $(date -u +%Y-%m-%dT%H:%M:%SZ). UI QA verification in progress; other auto-skills will skip this PR until the lock is released."
```

The lock MUST be released in step 9 even on failure — wrap teardown in a
`trap`/finally.

### 1. Fetch PR metadata and scope the UI surface

```bash
gh pr view {prNumber} --json number,title,url,author,baseRefName,headRefName,headRefOid,isCrossRepository,labels,files,body
gh pr diff {prNumber} --name-only
```

From the file list classify the change:

- **Has UI surface** when the diff touches `packages/ui/`, `apps/mercato/src/**`
  (pages/components), any `*.tsx`, portal routes, or a module's `frontend/`
  /`backend/` UI. These are verifiable through Playwright.
- **Backend-only / no UI** when the diff touches only API routes, services,
  migrations, events, or tests. UI verification is then limited — say so in the
  comment and verify the closest observable UI surface (an admin list/detail
  page that renders the affected data), or downgrade to an API smoke check and
  state that no direct UI change exists.

Read the PR body and the changed files closely enough to know **what the feature
is supposed to do** and **where in the UI a human would see it** (`/backend/...`
routes, portal routes, specific forms/tables/widgets).

### 2. Detect whether the PR already defines tests

Decide now whether the step-8 follow-up is needed.

```bash
gh pr diff {prNumber} --name-only > /tmp/verify-pr-{prNumber}-files.txt
```

- **Integration test present** when any changed path matches
  `**/__integration__/**/*.spec.ts` (module-local Playwright integration specs;
  this is the authoritative location per `.ai/qa/AGENTS.md`).
- **Unit test present** when any changed path matches `**/*.test.ts` or
  `**/__tests__/**`.

Record `HAS_INTEGRATION_TEST=true|false`. Per the brief, the follow-up
integration-test scenario in step 8 is posted **only when
`HAS_INTEGRATION_TEST` is false**. Unit-test presence does not suppress the
follow-up — the follow-up is specifically about a missing *integration* (UI)
test.

### 3. Isolated worktree for the PR head

Follow `.ai/skills/om-auto-review-pr/SKILL.md` step 4. Reuse the current linked
worktree when already inside one; otherwise create a temporary worktree from the
PR head SHA. Never touch the primary worktree; never nest worktrees.

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
GIT_DIR=$(git rev-parse --git-dir)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
CREATED_WORKTREE=0
if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]; then
  WORKTREE_DIR="$PWD"
  git fetch origin "pull/{prNumber}/head"
  git checkout -B "verify/pr-{prNumber}" FETCH_HEAD
else
  WORKTREE_DIR="$REPO_ROOT/.ai/tmp/auto-verify-pr-ui/pr-{prNumber}-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$(dirname "$WORKTREE_DIR")"
  git fetch origin "pull/{prNumber}/head"
  git worktree add --detach "$WORKTREE_DIR" "$(git rev-parse FETCH_HEAD)"
  CREATED_WORKTREE=1
  cd "$WORKTREE_DIR"
  git switch -c "verify/pr-{prNumber}"
fi
yarn install --mode=skip-build   # fall back to plain `yarn install` if unsupported
```

### 4. Boot the app against the ephemeral environment

The ephemeral integration environment gives a real app with a fresh Postgres
and the default tenant/users — exactly what the self-QA exception needs.

1. Reuse a running env when one exists:

```bash
cat .ai/qa/ephemeral-env.json 2>/dev/null   # look for "status":"running" and "base_url"
```

2. Otherwise start one (this builds packages, generates, spins up Postgres,
   initializes the DB, and starts the dev server):

```bash
yarn test:integration:ephemeral:start
```

   Record whether this run started the env (`STARTED_ENV=1`) so step 9 only
   tears down what it created. Re-read `.ai/qa/ephemeral-env.json` for the
   resolved `base_url` (export it as `BASE_URL` for Playwright).

Environment notes (see `.ai/qa/AGENTS.md` and `.ai/specs` for detail):

- Default credentials created by `mercato init`: `superadmin@acme.com`,
  `admin@acme.com`, `employee@acme.com` — all password `secret`. Pick the role
  whose ACL actually covers the changed surface (e.g. admin for most backend
  pages); note the chosen role in the report.
- Ephemeral boot requires Docker. If Docker or the ephemeral start is
  unavailable, do not fabricate results: stop the UI run, post a comment
  explaining the environment blocker, keep `Status` honest, and release the
  lock (step 9).
- If the host needs a Playwright platform override, set
  `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` (e.g. `ubuntu24.04-x64`) before invoking
  Playwright, matching the integration-test harness.

### 5. Derive the UI QA scenario from the diff

Translate the change into a concrete, PR-scoped manual route using the house QA
format from `.ai/skills/om-auto-qa-scenarios/SKILL.md`:

- Assign a priority tag: **P0** auth/sessions/tenant scope/money/event
  reliability; **P1** CRM/catalog/UI/custom fields; **P2** docs/tooling/DX.
  Prefer the PR's existing `priority-*` label when present.
- For each affected surface write three blocks: **Where to click**
  (`/backend/...` / portal routes), **What to verify** (concrete action →
  expected outcome), **What can go wrong** (regression symptom, tenant/permission
  edge case, empty/error state).
- For Next.js/UI surfaces include perceived-performance checks: cold-load the
  changed route, confirm a useful shell/loading state appears before heavy client
  interaction, check interaction responsiveness, and smoke the mobile viewport.

Keep it scoped to **this PR's changes** — do not write a full-app regression
script. Never invent routes, fields, or behavior the diff does not contain.

### 6. Drive the scenario with Playwright and capture screenshots

Exercise the scenario against `BASE_URL`, capturing a screenshot at each
verification point. Two complementary approaches:

- **Explore first with Playwright MCP** to discover real selectors and confirm
  the happy path renders, mirroring `.ai/skills/om-integration-tests/SKILL.md`.
- **Capture deterministic screenshots** by running a throwaway spec through the
  repo's Playwright config with screenshots forced on:

```bash
PW_CAPTURE_SCREENSHOTS=1 BASE_URL="$BASE_URL" \
  npx playwright test --config .ai/qa/tests/playwright.config.ts <throwaway-spec> --retries=0
```

  Write the throwaway spec under `.ai/tmp/auto-verify-pr-ui/` (NOT under a module's
  `__integration__/` — that would alter discovered tests). Use the shared login
  helper / `DEFAULT_CREDENTIALS` from `@open-mercato/core/helpers/integration` so
  auth matches the integration harness. Save PNGs to a known folder, e.g.
  `.ai/tmp/auto-verify-pr-ui/pr-{prNumber}/step-NN-<slug>.png`, and use
  `page.screenshot({ path, fullPage: true })` at each checkpoint.

Record, per scenario step: the action, the expected outcome, the observed
outcome, PASS/FAIL, and the screenshot filename. Overall verdict is **PASS** only
when every required step passed; otherwise **FAIL** (capture the failing-state
screenshot too — it is the most useful evidence).

### 7. Post the screenshots + verification report as a PR comment

Screenshots cannot be uploaded inline through `gh` directly, so make them
referenceable, then embed them.

**Primary (public repo with push access):** push the PNGs to a dedicated
evidence branch and reference raw URLs (they render inline on github.com).

```bash
OWNER_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
EVIDENCE_BRANCH="qa-evidence/pr-{prNumber}"
# from a clean throwaway checkout or orphan branch — do NOT pollute the PR branch:
git fetch origin "$EVIDENCE_BRANCH" 2>/dev/null || true
# create/update the branch with only the PNGs under pr-{prNumber}/, commit, push to origin
# reference: https://raw.githubusercontent.com/${OWNER_REPO}/${EVIDENCE_BRANCH}/pr-{prNumber}/step-NN.png
```

**Fallback (private repo, fork PR, or no push access):** raw URLs will not render
without auth. Instead list the local artifact paths and the Playwright HTML
report (`.ai/qa/test-results/html/`) in the comment, and tell the reviewer they
can also drag-drop the PNGs into a manual comment to get inline rendering. Never
block on this — a report without inline images is still useful.

Post one comment via `gh pr comment {prNumber} --body-file ...` so multi-line
formatting and image markdown survive:

```markdown
## 🖼️ `auto-verify-pr-ui` — UI QA evidence

**Overall verdict:** {✅ PASS | ❌ FAIL | ⚠️ PARTIAL — environment-limited}
**Environment:** ephemeral integration env at `{base_url}` · role `{admin@acme.com}`
**Branch verified:** {headRefName} @ {headRefOid (short)}

### Scenario ({P0|P1|P2} — {area})
**Where to click:** `/backend/...`

| # | Step | Expected | Observed | Result |
|---|------|----------|----------|--------|
| 1 | {action} | {expected} | {observed} | ✅ |
| 2 | {action} | {expected} | {observed} | ❌ |

### Screenshots
![Step 1 — {slug}]({raw url or path})
![Step 2 — {slug}]({raw url or path})

### Notes for QA
- {anything the reviewer should double-check manually — edge cases not covered}
- {tenant/permission boundary observations}
```

Rules for the comment:

- Report only what was actually observed. If a step could not be exercised, mark
  it `⚠️ not exercised` with the reason — never fabricate a PASS.
- Never paste secrets, tokens, `.env` content, or real credentials beyond the
  shared demo logins.
- Redact any sensitive values that leaked into a screenshot before posting; if a
  screenshot cannot be redacted, omit it and say so.

### 8. Post the follow-up integration-test scenario (only if no test exists)

**Only when `HAS_INTEGRATION_TEST` from step 2 is false.** If the PR already
ships a `**/__integration__/**/*.spec.ts`, skip this step entirely and say so in
the step-9 summary.

When no integration test exists, post a second comment with a ready-to-implement
scenario so a follow-up run can add it via `/om-integration-tests`:

```markdown
## 🧪 Follow-up: add an integration test for this PR

This PR ships no integration test (`**/__integration__/**/*.spec.ts`). The UI
QA above was done manually; lock it in with an automated test.

**Suggested location:** `packages/core/src/modules/{module}/__integration__/TC-{CATEGORY}-{XXX}.spec.ts`
(next free `TC-{CATEGORY}-*` number — check existing files first).

**Scenario (derived from the manual run above):**
1. Setup: {fixtures to create via API — prefer `@open-mercato/core/helpers/integration` fixtures}
2. Act: {the UI/API steps exercised above}
3. Assert: {the expected outcomes verified above}
4. Teardown: delete every fixture created (use the `deleteEntityIfExists`-style helpers).

**To implement:** run `/om-integration-tests` against this PR/feature, or assign
the follow-up to the PR author. Keep the test self-contained, deterministic, and
independent of seeded data (per `.ai/qa/AGENTS.md`).
```

Optionally, when the operator workflow expects a tracked follow-up, also open a
tracking issue or hand off via `om-followup-issue-from-pr`. Default to the PR
comment only — do not open issues unless asked.

### 9. Labels, teardown, and lock release

**Labels (conservative by default):**

- Default / `--evidence-only`: do **not** change pipeline or meta labels. The
  evidence comment is the deliverable; a QA reviewer decides the verdict.
- `--self-qa-signoff` AND verdict is PASS AND screenshots attached AND the PR
  carries `needs-qa` without `skip-qa`: apply `qa-approved` + `qa-self-verified`
  via the AGENTS.md self-QA exception. Post a label comment linking the evidence
  comment as the attached proof. Do this only when those conditions all hold —
  never sign off a partial/environment-limited run.
- `--apply-failure` AND verdict is FAIL: apply `qa-failed` and comment why. Never
  combine with `qa-approved`.
- Preserve all other labels. Use the GraphQL label flow (see
  `om-auto-review-pr` step 8) for atomicity, not `gh pr edit --add-label`.

**Teardown / cleanup (run in a `trap`/finally):**

```bash
cd "$REPO_ROOT"
# tear down the ephemeral env only if THIS run started it and --keep-env was not set
# (the ephemeral tooling exposes a stop command; otherwise leave it for reuse)
if [ "$CREATED_WORKTREE" = "1" ]; then git worktree remove --force "$WORKTREE_DIR"; fi
git worktree prune
# release the lock
# remove the in-progress label via the GraphQL flow
gh pr comment {prNumber} --body "🤖 \`auto-verify-pr-ui\` completed: {PASS|FAIL|PARTIAL}. Evidence posted above. Lock released."
```

Always release the `in-progress` lock and remove this run's assignee claim if it
was added solely for the lock, even when the run failed.

### 10. Report back

Print a concise summary to the user:

```text
auto-verify-pr-ui: PR #{prNumber} — {title}
Verdict: {PASS | FAIL | PARTIAL (env-limited)}
Env: ephemeral @ {base_url} (started by this run: {yes|no})
Evidence comment: {url}
Follow-up test scenario: {posted | skipped — PR already has an integration test}
Labels: {unchanged | qa-approved+qa-self-verified | qa-failed}
```

## Rules

- Operate only on the PR named by `{prNumber}`; always claim it first (step 0)
  and always release the lock in step 9, even on failure (trap/finally).
- Read-only on PR source code: never `Edit`/`Write` the PR's files, never push to
  the PR branch, never merge.
- Always use an isolated worktree; reuse the current linked worktree when inside
  one; never nest; clean up any worktree this run created.
- Boot the UI through the ephemeral integration environment; reuse a running env,
  start one only when needed, and tear down only an env this run started (unless
  `--keep-env`).
- Report only observed results. Never fabricate a PASS; mark un-exercised steps
  honestly; if the environment cannot boot, post the blocker and stop — do not
  invent screenshots or outcomes.
- Post the screenshot evidence as a PR comment (primary: `qa-evidence/pr-{n}`
  branch + raw URLs; fallback: artifact paths + HTML report). Never pollute the
  PR branch with evidence artifacts.
- Post the follow-up integration-test scenario **only when the PR diff defines no
  `**/__integration__/**/*.spec.ts`**; skip it when an integration test already
  exists.
- Default behavior changes no labels. `qa-approved`/`qa-self-verified` is applied
  only via `--self-qa-signoff` on a fully-green run with attached screenshots and
  `needs-qa` (no `skip-qa`); `qa-failed` only via `--apply-failure`. Use the
  GraphQL label flow and comment every label change.
- Never paste secrets, tokens, `.env` content, or non-demo credentials into
  comments; redact sensitive values from screenshots or omit them.
