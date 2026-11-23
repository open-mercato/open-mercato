# Batch Branches — Daily Batches of Small PRs

Small PRs are squash-merged into a daily **batch branch** that only runs a fast CI gate
(`.github/workflows/batch-pr-ci.yml`, about 3–5 min). Once a day each batch branch is merged
into `main` with a **merge commit**, so every PR stays its own commit on `main`. The full
`ci.yml` suite runs once per batch, on that batch → `main` PR. The goal is about 80 merged PRs
a day without paying for 80 full CI runs and 80 QA passes.

## Branch naming and lanes

```
batch/<lane>-<YYYYMMDD>        e.g. batch/oss-20261124
```

- `<YYYYMMDD>` is the day the batch **fills** (day N), not the day it lands on `main`.
- A **lane** is an independent stream of batches with its own branch, its own batch → `main`
  PR and its own QA slot. Lane names are short kebab-case names picked by the maintainers.
  Start with one lane; add another (for example split by module area) only when one batch's
  QA pass or fix-up work becomes the bottleneck. Keep lanes on disjoint modules so two batch
  → `main` PRs do not conflict with each other.
- Create the day's batch branch from the current `main` tip at the start of day N:

  ```bash
  git fetch origin main
  git push origin origin/main:refs/heads/batch/<lane>-<YYYYMMDD>
  ```

## The two-day cycle and the daily cut-off

Every lane runs on a fixed daily **cut-off time** (agreed by the maintainers; there is no PR
count cap).

| Day | What happens to `batch/<lane>-<N>` |
|-----|------------------------------------|
| **N** — fill | Eligible PRs are retargeted to the batch and squash-merged once `Batch PR CI` and the `Enterprise Contribution Guard` are green and the PR is reviewed. Nothing merges into it after the cut-off. |
| **N+1** — land | Open the batch → `main` PR. It runs the full `ci.yml` suite. Fix breakage with separate `fix(batch): …` commits on the batch branch. Run one QA pass for the whole batch. Merge to `main` with a merge commit. |

Day N+1's batch fills while day N's batch is landing, so it starts from a `main` that does
not have day N yet. After day N lands, merge `main` into every open batch branch (a merge
commit, never a rebase: rebasing rewrites the squash commits other people already reviewed)
so each batch → `main` PR keeps showing only its own day.

## What goes into a batch

**Current rule (routing by author).** PRs opened by these authors are batch candidates:
`haxiorz`, `AHKSammich`, `pkarw`, `adeptofvoltron`, `andrzejewsky`, `wojciechszyjka`.
Routing is manual: a maintainer retargets the PR (see below). There is no automation that
picks PRs.

**Planned rule (dedicated label).** Routing will move to a dedicated label that any author
can request and a maintainer applies. Until that label exists and this doc names it, the
author list above is the rule.

**Always out of a batch** — these keep the normal per-PR flow against `main`/`develop`, even
from a listed author:

- PRs labelled `needs-human-qa`, `security`, `enterprise`, `backport` or `risk-high`.
- PRs touching anything under `packages/enterprise/`.
- PRs touching the shared core paths matched by `FULL_SUITE_PATTERN` in
  `.github/workflows/ci.yml` (shared packages such as `shared`, `ui`, `events`, `queue`,
  `cache`, `search`, `onboarding`, `webhooks`, the `core`/`enterprise` `src/lib/` trees, the
  integration harness, and the `apps/mercato` app shell). The workflow file is the source of
  truth; print the current pattern with
  `grep -m1 FULL_SUITE_PATTERN= .github/workflows/ci.yml`. These changes affect every module,
  and the fast gate only runs tests inside the changed package, so they need the full suite on
  their own PR.

## Retargeting a PR to a batch branch

```bash
gh pr edit <N> --base batch/<lane>-<YYYYMMDD>
```

The PR must be based on `main`. If its diff against the batch suddenly shows unrelated
commits (it was branched from `develop` or another topic branch), rebase it onto `main` first
and force-push the PR branch, or send it back to the author:

```bash
git rebase --onto origin/main <old-base> <pr-branch>
```

Retargeting fires a new `pull_request` event, so `Batch PR CI` and the enterprise guard run
against the batch. Merge with **Squash and merge**. Do not re-run the full `ci.yml` on the PR:
it does not trigger for `batch/**` bases by design.

## The fast gate (`Batch PR CI`)

One job on `blacksmith-4vcpu-ubuntu-2404`, cancelled and restarted on every push to the PR:

1. Restore the shared Yarn, `node_modules` and Turbo caches (same keys as `ci.yml`).
2. `yarn build:packages && yarn generate && yarn build:packages` (Turbo cache hits for
   unchanged packages; no app build).
3. `turbo run typecheck --filter='[HEAD^1]...'` — changed packages and their dependents.
4. ESLint on the changed files under `apps/mercato` (the same scope as `yarn lint`), plus the
   `logger:check-console:ci` guard.
5. `jest --findRelatedTests <changed files>` in each changed workspace that has a
   `jest.config.cjs`.

It does **not** run: the app build, Documents bundle budgets, integration tests, docker
builds, coverage, the dependency audit, DS lint, mutation tests, the unfiltered repo-wide
guards, create-app template parity or cross-package test fallout. All of that runs on the
batch → `main` PR.

## QA per batch

There is no QA on individual PRs inside a batch: the `needs-qa` ⇒ `qa-approved` gate moves
to the batch → `main` PR. On day N+1:

1. Deploy the batch branch to a free QA slot:

   ```bash
   gh workflow run qa-deploy.yml -f slot=qa1 -f branch=batch/<lane>-<YYYYMMDD> -f pr_number=<batch-PR>
   ```

2. Build one checklist from the test steps of every included PR, grouped by module, and post
   it on the batch → `main` PR. List the included PRs with:

   ```bash
   gh pr list --base batch/<lane>-<YYYYMMDD> --state merged --limit 200 \
     --json number,title,url,files --jq '.[] | "\(.number)\t\(.title)"'
   ```

3. QA works through the checklist on the slot. Failures are fixed with `fix(batch): …`
   commits or handled by the drop rule below. When the checklist passes, the batch PR gets
   `qa-approved`.

## Dropping a PR from a batch

If an included PR breaks the full run or QA and cannot be fixed quickly on the batch branch,
revert its squash commit out of the batch and send it back to its author:

```bash
git switch batch/<lane>-<YYYYMMDD> && git pull
git revert --no-edit <squash-commit-sha>
git push origin batch/<lane>-<YYYYMMDD>
```

Then comment on the original PR with the failing check or QA finding and ask the author to
open a new PR against a later batch (the original PR is already merged, so it cannot be
reopened). Remove its issues from the batch PR's `Closes` list.

## The batch → `main` PR

- Head `batch/<lane>-<YYYYMMDD>`, base `main`. It runs the full `ci.yml` suite unscoped: a
  `batch/*` head forces the 15 integration shards, full typecheck and full unit tests, the same
  as a push to `main`.
- **Merge with "Create a merge commit"**, never squash or rebase, so every included PR stays a
  separate commit on `main`.
- **Open it from an account on the enterprise guard's allowlist** (`ALLOWED_LOGINS` in
  `scripts/ci/enterprise-contribution-guard.ts`). The guard runs on this PR too.
- **List `Closes #N` for every issue linked from an included PR.** GitHub only auto-closes
  issues on merges into the default branch, so the squash merges into the batch closed
  nothing. Collect them with:

  ```bash
  gh pr list --base batch/<lane>-<YYYYMMDD> --state merged --limit 200 \
    --json closingIssuesReferences --jq '[.[].closingIssuesReferences[].number] | unique | .[] | "Closes #\(.)"'
  ```

- Also list the included PRs (number and title) in the description so the QA checklist and the
  merge commit message point back to them.
- After it merges, merge `main` into the next open batch branch. Batch branches can be deleted
  once merged.
