# Execution plan — run the repo-wide audit guards unfiltered on every PR

## Goal

A handful of tests in this repo are **repo-wide audits** rather than package unit tests: they
deliberately read files in other packages, in `apps/`, or in `scripts/`. CI's PR test step scopes
the run by dependency graph (`yarn turbo run test --filter=[origin/<base>]...`), and turbo selects
*packages*, not paths — so a PR that touches only `scripts/` (or only `apps/`) selects no owning
package, those audits never run, and the violation lands on `develop`, where the post-merge
unfiltered `yarn test` turns the base red for everyone. Make that class of breakage fail its own
PR, the way `ci.yml` already does for the create-app parity guards (#3779).

## Root cause

`.github/workflows/ci.yml`, job `test`, step `Test`:

```yaml
if [ "${{ github.event_name }}" = "pull_request" ]; then
  yarn turbo run test --filter=[origin/${{ github.base_ref }}]...
else
  yarn test
fi
```

`packages/core/src/__tests__/explicit-sort-comparators.test.ts` (the #3620 guard) scans every
package `src` root **and everything under `scripts/`**, but it lives in `@open-mercato/core`, which
a `scripts/`-only change never selects. That is exactly how #4527's violation reached `develop`
(run `89770173435`, `scripts/check-agents-md-budget.mjs:93`), and #4527's own CI could not catch it
either. `ci.yml` already carries one always-unfiltered step for the same class (create-app parity,
#3779); #4472 was another instance of a turbo filter silently matching zero tasks.

## Scope

- Enumerate the repo-wide audits in one place, with the reason each reaches outside its package.
- Run them unconditionally on every PR through a single yarn entry point.
- Keep the enumeration honest with an automated check that itself runs unfiltered.

## Non-goals

- No change to the turbo filter for ordinary package tests — it is doing its job for those.
- No change to the guards themselves; they are correct.
- No move or rename of any guard test file.

## Enumeration (what counts as a repo-wide audit)

Discovered by scanning every `*.test.ts(x)` under `packages/*/src` and `apps/*/src` for a repo-root
anchor (a `__dirname` ascent past the workspace root, a `findRepoRoot()` helper, or `process.cwd()`)
combined with a reference to another tree (`packages/`, `apps/`, `scripts/`, `external/`, or
`git ls-files`). 21 candidates, classified as:

**Run unfiltered (16 test files):**

| Workspace | Guards |
|---|---|
| `@open-mercato/core` | explicit-sort-comparators, alert-duplicate-icon-coverage, auth-onboarding-feedback-ds-tokens, license-metadata-consistency, types-dependency-classification, optimistic-lock-ui-coverage-workspace, optimistic-lock-command-coverage, modules/crud-indexer-config |
| `@open-mercato/cli` | module-facts.bc-guard, example-public-route-safety, disabled-example-module, release-notes-retired |
| `@open-mercato/shared` | db/escapeLikePattern |
| `@open-mercato/ui` | primitives/zindex-overlay |
| `@open-mercato/app` | components/starter-chrome-ds, components/StartPageContent |

**Deliberately excluded (5):** the three create-app guards (already unfiltered via the existing
parity step) and three `packages/ui` tests that anchor on the repo root but only read
`packages/ui` sources, so the turbo filter selects them correctly.

Two corrections to the issue's guesses: `module-decoupling.test.ts` builds an in-memory registry
and is genuinely core-local, so it is not in the set; and the AGENTS.md budget check already runs
unfiltered at `ci.yml` (`yarn agents:check-budget`), so it stays where it is.

## Risks

- The manifest is hand-maintained and would rot as new guards land — mitigated by the drift check
  in `scripts/__tests__/repo-wide-guards.test.mjs`, which fails when a listed path disappears (the
  silent zero-match failure of #4472) or when a new cross-package test is left unclassified.
- The new CI step is unconditional, so a misbehaving guard blocks every PR. Measured cost is ~8–10 s
  for all 16 files (static file scans, five jest boots), which keeps it off the critical path.

## Implementation plan

### Phase 1: Enumerate and run

- 1.1 Add `scripts/repo-wide-guards.mjs`: the manifest (guards + documented exceptions), the
  cross-package detector, and a runner that invokes one jest per workspace.
- 1.2 Add the `test:repo-wide-guards` yarn script so the same set is runnable locally.
- 1.3 Add an always-unfiltered `Run repo-wide audit guards` step to `.github/workflows/ci.yml`,
  with a comment enumerating the guarded class and pointing at the manifest.

### Phase 2: Keep the enumeration honest

- 2.1 Add `scripts/__tests__/repo-wide-guards.test.mjs` (runs unfiltered via the existing
  `Test scripts` step): listed paths and exceptions must exist, no cross-package test may stay
  unclassified, no exception may go stale, and `ci.yml` must run the step with no `if:` guard.

### Phase 3: Validation

- 3.1 Reproduce #4527's pre-fix state and confirm the guards now fail the PR's own run.
- 3.2 Run the configured validation gate.

## Progress

PR: (pending — filled in once the PR is opened)

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Enumerate and run

- [x] 1.1 `scripts/repo-wide-guards.mjs` — manifest, detector, per-workspace runner
- [x] 1.2 `test:repo-wide-guards` yarn script
- [x] 1.3 Always-unfiltered CI step with the enumeration in its comment

### Phase 2: Keep the enumeration honest

- [x] 2.1 `scripts/__tests__/repo-wide-guards.test.mjs` — 8 cases, runs via `yarn test:scripts`

### Phase 3: Validation

- [x] 3.1 Reproduction of #4527: reverting the comparator in `scripts/check-agents-md-budget.mjs`
  makes `yarn test:repo-wide-guards` fail with the exact `scripts/check-agents-md-budget.mjs:93`
  violation from the red `develop` run; the file was restored afterwards.
- [x] 3.2 Configured gate green — see below.

Runner: local (no compose `app` container running).

- `yarn test:repo-wide-guards` — 16 guard files across 5 workspaces, all passing, ~8–10 s.
- `yarn test:scripts` — 357/357 passing, including the 8 new manifest cases.
- Negative checks: dropping a manifest entry fails "no test that audits other packages is left
  unclassified"; renaming the CI step fails "ci.yml runs the repo-wide guards unconditionally".
- Configured gate: `yarn build:packages`, `yarn generate`, `yarn build:packages`,
  `yarn i18n:check-sync`, `yarn typecheck`, `yarn test` (23/23 turbo tasks) and `yarn build:app`
  all pass. `yarn i18n:check-usage` reports 2 missing keys in
  `packages/ui/src/backend/fields/phone.tsx` — a file this PR does not touch; the finding is
  pre-existing on `develop` and the step is `continue-on-error: true` in CI.

## Note on CI visibility

Unlike #4527, this PR's own CI *does* exercise the change: the new step runs on this PR, so the
16 enumerated guards execute here, and the manifest test runs through the existing `Test scripts`
step. A green `Run repo-wide audit guards` check on this PR is itself the acceptance evidence.
