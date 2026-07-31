# StrykerJS Mutation Testing as a Diff-Scoped CI Quality Gate

## 📝 TLDR

Introduce StrykerJS mutation testing to Open Mercato as a **diff-scoped** CI check: only the
business-logic files a pull request actually changes are mutated, only in the packages that
changed, and only with mutators that produce actionable signal. The goal is to catch tests that
execute code without verifying it — the dominant failure mode of AI-generated test suites, which
this repository now produces at scale — without inviting brittle string-assertion tests and
without adding hours to CI. The design is grounded in a measured pilot (Phase 0, already run):
**44 s – 1 min 25 s** per PR-sized diff on `packages/shared`. The gate lands advisory-first and
only becomes a merge blocker in Phase 3, after the collected data justifies the threshold.

## 📝 Resolved assumptions (autonomous defaults)

This spec was drafted unattended. Each Open Question below was resolved toward the most
reversible, smallest-scope option; every one of them can be overridden before merge.

| # | Question | Resolved answer | Rationale |
|---|----------|-----------------|-----------|
| Q1 | Does the gate ultimately block merge, or stay advisory forever? | Not decided here. Advisory through Phases 1–2; making it a required check is Phase 3's own gate, requiring an explicit core-team decision recorded on that phase. | Turning a check into a merge blocker changes the PR pipeline, which `AGENTS.md` classifies as Ask First. Deferring it keeps this spec mergeable while Phases 1–2 already deliver visibility. The reviewer does not have to approve enforcement by approving this spec. |
| Q2 | Which packages are in scope initially? | `packages/shared` in Phase 1; `packages/core` only after the Phase 0b measurement; every other package opt-in through an explicit allowlist. | Pilot numbers exist only for `shared`. An allowlist is trivially reversible; a repo-wide default is not. |
| Q3 | How is the `coverageAnalysis` blocker resolved — by removing `@jest-environment` docblocks from existing tests, or by living with `"off"`? | Live with `"off"` in Phases 1–3; revisit in Phase 4 via a `mixinJestEnvironment` wrapper. Do not touch existing test files. | Editing dozens of unrelated test files to satisfy a new tool is a large, risky diff for a performance optimisation that the measured times do not yet require. |
| Q4 | Is `inPlace: true` acceptable for local developer runs, given it mutates working-tree sources? | CI is the supported environment. The local script refuses to run on a dirty working tree and prints the recovery command. | `inPlace` is forced by the monorepo jest config (see Architecture); the clean-tree guard makes the worst case a `git checkout`. |
| Q5 | Where do the Stryker devDependencies live — root or per package? | Root `devDependencies`, single version, hoisted; configuration per package. | One version to upgrade, no drift between packages, and no per-package `package.json` churn when the allowlist grows. |
| Q6 | Should `ObjectLiteral` join `StringLiteral` and `Regex` in `excludedMutations`? | No — keep it enabled through the advisory phases and decide from real data before Phase 3. | The pilot's `phone.ts` case is ambiguous: 24 `ObjectLiteral` survivors are a genuine gap (tests never assert `reason`), not obviously noise. Excluding it now would hide the exact class of defect the initiative targets. |
| Q7 | Is this one capability or several? | One: "score the tests of changed business logic in CI". Reporting (Phase 2) and enforcement (Phase 3) are stages of that capability, not separate deliverables. | Neither stage is useful without the runner from Phase 1. |
| Q8 | What happens on a PR whose diff contains no in-scope files? | The job is skipped entirely and reports success — no empty run, no synthetic score. | Matches how `ci.yml`'s `prepare` job already skips integration tests for out-of-scope diffs. |

## 📝 Problem Statement

Test coverage says a line was executed. It does not say the test would notice if that line were
wrong. That gap matters more here than in most repositories:

- A large and growing share of this codebase's tests are written by AI agents, following the
  `om-auto-*` pipeline. Agents optimise for the visible signal — tests pass, coverage rises — and
  an assertion-free test satisfies both.
- The existing quality gates cannot see the difference. `yarn test`, the coverage merge job in
  `ci.yml`, `yarn lint` and `yarn typecheck` all pass on a test that calls a function and asserts
  nothing about the result.

The Phase 0 pilot confirmed this is not hypothetical. Measured on `packages/shared`, before any
new tests were written:

- `parseBooleanToken` (`src/lib/boolean.ts`) — the helper `AGENTS.md` **mandates** for all boolean
  parsing — has an untested empty-string path and an untested non-string path. Both mutants
  survive: `if (!trimmed) return null` → `if (false)`, and `typeof value === 'string'` → `true`.
- `src/lib/crud/optimistic-lock.ts`, which guards concurrent edits across every CRUD entity in the
  platform, scores **74.5 %** — 51 surviving mutants in the code path that decides whether a
  concurrent write is rejected.
- `src/lib/phone.ts` scores **57.1 %**: the tests assert that validation fails, never *why* it
  fails, so every `reason` discriminator can be deleted without a test noticing.

The counter-risk is equally real and is the reason this spec is conservative. A naive mutation
gate teaches agents (and humans) to write tests that kill mutants rather than tests that describe
behaviour — asserting exact log strings, exact error copy, exact object shapes. Google's
mutation-testing-at-scale work (Petrović & Ivanković, ICSE-SEIP 2018) reports the same finding:
developers reject mutation results as noise unless the tool shows only mutants inside the change
under review and suppresses "arid" mutants that no reasonable test should have to kill. Both
mitigations are load-bearing in this design.

## 📝 Proposed Solution

Mutate **only what the PR changed**, **only in the business-logic layer**, **only with mutators
that describe behaviour**, and report before enforcing.

1. **Diff scoping.** StrykerJS has no `--since` flag (verified against the current docs: it offers
   `--incremental`, `--incrementalFile` and `--force`, all of which diff against Stryker's own
   previous report, not a git ref). The file list is therefore computed by us from
   `git diff --name-only origin/$BASE...HEAD`, filtered, grouped per package, and passed as
   `--mutate`.
2. **Layer filtering.** Only files that encode business rules are mutated —
   `packages/*/src/modules/*/{lib,commands,services}/**`, `data/validators.ts`, and
   `packages/shared/src/lib/**`. Routes, entities, DI wiring, migrations, i18n, ACL declarations,
   widgets and every `.tsx` file are out of scope: they are declarative, framework-shaped, or
   already covered by integration tests, and mutating them produces survivors nobody should fix.
3. **Mutator filtering.** `StringLiteral` and `Regex` are excluded. In this repository string
   literals are event IDs (`module.entity.action`), i18n keys and ACL feature IDs — mutating them
   would demand exactly the brittle string assertions the initiative exists to avoid. The pilot
   confirmed the exclusion is clean: 34 `StringLiteral` mutants ignored, no effect on the score.
4. **Advisory before blocking.** Phases 1–2 run the gate with `continue-on-error: true` and publish
   the result. The break threshold is switched on only in Phase 3, with a minimum-mutant floor, and
   only once the collected scores show what a fair threshold is.

Alternatives considered:

- **Repo-wide nightly mutation run.** Rejected as the primary mechanism: it produces a number
  nobody owns, arrives after the code is merged, and on this codebase's size would run for hours.
  It remains a plausible Phase 4 addition for tracking a trend.
- **Enforcing branch coverage instead.** Rejected — it is the metric that already fails to detect
  the problem described above.
- **`stryker --incremental` as the scoping mechanism.** Rejected for Phase 1: it requires carrying
  a per-package `stryker-incremental.json` across CI runs and still mutates the full file set on a
  cache miss. Revisit in Phase 4 once the advisory data shows where time actually goes.

## 📝 Architecture

Four new pieces, no changes to application code and no changes to `ci.yml`.

```
scripts/stryker/createConfig.mjs      shared config factory (one source of truth)
packages/<pkg>/stryker.conf.mjs       per-package config, calls the factory
scripts/stryker/scope.mjs             git diff → per-package mutate lists (GH Actions matrix JSON)
scripts/stryker/report.mjs            mutation.json → markdown survivor report
.github/workflows/mutation-tests.yml  the workflow
```

### Why per-package configuration is forced, not chosen

Every package carries its own `jest.config.cjs` with its own `rootDir`, its own `moduleNameMapper`,
and a transformer referenced as `<rootDir>/../../scripts/jest-mikroorm-transformer.cjs`. A single
root Stryker config cannot drive them. The factory keeps the shared settings in one file while each
package's `stryker.conf.mjs` supplies only its own path; a `.mjs` config is required because
Stryker's JSON format has no `extends`.

### Why `inPlace: true` is mandatory

Stryker's default sandbox copies the package into `packages/<pkg>/.stryker-tmp/sandbox-XXXX/`,
one directory level deeper than the real package. Every relative path in the jest config then
resolves outside the sandbox and the run dies with
`Cannot find module '../../jest.config.base.cjs'`. `inPlace: true` removes the sandbox and fixes
it. It also side-steps a second blocker: Stryker's tsconfig preprocessor calls
`ts.parseConfigFileTextToJson`, which does not exist in this repo's `typescript@7.0.2` (the Go
compiler; the JS API lives behind the `typescript-js` alias — see
`scripts/jest-typescript-resolver.cjs`), and `inPlace` short-circuits that preprocessor entirely.

The trade-off is that Stryker mutates real source files during the run and restores them from
`.stryker-tmp/backup-XXXX` afterwards. The pilot verified restoration is clean, including after a
crashed run. A `SIGKILL`ed process can still leave mutated sources behind, which is why CI —
ephemeral by construction — is the supported environment, and why the local wrapper refuses to
start on a dirty working tree.

### `scripts/stryker/scope.mjs`

Input: base ref (default `origin/develop`). Output: a GitHub Actions matrix on stdout.

```jsonc
{ "include": [ { "package": "shared", "mutate": "src/lib/boolean.ts,src/lib/phone.ts" } ] }
```

Rules:
- `git diff --name-only --diff-filter=d $BASE...HEAD` (deleted files excluded).
- Keep only paths matching the in-scope globs of an allowlisted package.
- Emit no entry for a package with no in-scope changes; emit an empty matrix when nothing matches,
  which the workflow treats as "skip".
- Cap the mutate list at `MUTATION_MAX_FILES` (default 25) per package, sorted by path for
  determinism, and print what was dropped so a truncated run never reads as full coverage.

### `.github/workflows/mutation-tests.yml`

A standalone workflow on `pull_request`, separate from `ci.yml` so a mutation failure can never be
confused with a test failure and so the file can be deleted without touching the main pipeline.
A `scope` job runs `scope.mjs` and emits the matrix; a `mutate` job fans out over it with
`fail-fast: false`, `timeout-minutes: 20`, and `continue-on-error` controlled by a single
`MUTATION_ENFORCE` repository variable — Phase 3 flips one value rather than rewriting the file.

### Reporting

Results go to `$GITHUB_STEP_SUMMARY` plus an uploaded HTML/JSON artifact — the pattern `ci.yml`
already uses for merged integration coverage. This is deliberate: `$GITHUB_STEP_SUMMARY` needs no
token and therefore works identically on fork PRs, which this repository receives. A PR comment
would require `pull-requests: write`, which `pull_request` runs from forks do not get; obtaining it
means `pull_request_target` or a `workflow_run` second stage, both of which run privileged code
against contributor input. Phase 2 ships the summary + artifact for everyone and, only if the team
wants inline comments, adds a comment step guarded by
`github.event.pull_request.head.repo.full_name == github.repository` — the same fork guard
`ci.yml`'s `docker-build` job already uses.

Each survivor is reported as `file:line:column`, mutator name, and the `-`/`+` diff of the
replacement, so a developer or an agent can go straight to the untested behaviour.

## 📝 Data Model

None. No entities, no migrations, no database access. Mutation runs read source and test files
only.

## 📝 API Contracts

No HTTP or module contracts change. Three new internal CLI contracts are introduced and are the
only surfaces other tooling should depend on:

| Surface | Contract |
|---------|----------|
| `node scripts/stryker/scope.mjs [--base <ref>] [--json]` | stdout: GH Actions matrix JSON; exit 0 with an empty matrix when nothing is in scope |
| `node scripts/stryker/report.mjs <mutation.json>` | stdout: markdown survivor table; exit 0 always |
| `yarn mutation:changed` | local wrapper: clean-tree guard → `scope.mjs` → Stryker per package |

No `BACKWARD_COMPATIBILITY.md` contract surface is touched: no auto-discovery file, type,
signature, import path, event ID, widget spot ID, API route, DB schema, DI key, ACL feature,
notification ID, CLI command (in the `mercato` sense) or generated file changes.

## 📝 UI/UX

No application UI. The developer-facing surface is the GitHub Actions job summary: a per-package
score line, then a table of survivors with `file:line`, mutator, and replacement. When the run is
advisory, the summary states plainly that the result does not block merge, so nobody mistakes a red
number for a broken build.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|----------|-----------|
| PR touches no in-scope files (UI-only, API-only, docs) | `scope.mjs` emits an empty matrix; the workflow skips. No score is invented. |
| PR touches more than `MUTATION_MAX_FILES` in one package | The list is truncated deterministically and the dropped paths are printed in the summary. A silent cap would misrepresent coverage. |
| File deleted in the diff | Excluded via `--diff-filter=d`; Stryker would otherwise fail on a missing path. |
| File renamed | Treated as a new path and mutated; the old path is gone and is not scored. |
| A widely-imported file is changed | `--findRelatedTests` pulls in a large test set — the pilot measured 530 tests per mutant for `boolean.ts` versus 127 for a leaf file. Bounded by `timeout-minutes: 20`; a timeout is reported as an infrastructure outcome, never as a low score. |
| Flaky test in the related set | Can mark a mutant killed or timed out incorrectly. Advisory phases surface it as noise to investigate; Phase 3 must not be enabled while a package has known flaky suites. |
| Stryker "error" mutants (2 of 32 in the pilot's `boolean.ts` run) | Excluded from the score by Stryker itself; reported in the summary so systematic errors are visible. |
| `inPlace` run killed mid-flight in CI | Runner is ephemeral — no impact. Locally, the wrapper's clean-tree precondition makes `git checkout -- .` a complete recovery, and the summary prints that command. |
| Stryker or the jest runner breaks on a dependency bump | The workflow is standalone and advisory; it cannot block `ci.yml`. Rollback is deleting one file. |
| Fork PR | Summary + artifact work without a token. The optional comment step is fork-guarded and silently skipped. |

## 📝 Risks & Impact Review

**Blast radius.** One new workflow file, four new scripts, root devDependencies. No application
code, no schema, no runtime behaviour. `ci.yml` is untouched, so the existing pipeline cannot
regress.

**Gaming the metric.** The genuine risk. A mutation score is a proxy, and both humans and agents
optimise proxies. Mitigations: the mutator exclusions remove the cheapest way to game it
(assert-the-string tests); the score is computed only on changed files, so there is no incentive to
pad untouched code; and the threshold is a floor for review, never a target to maximise. This spec
explicitly does **not** propose a repo-wide score badge or a per-package leaderboard.

**Small-diff volatility.** With four mutants, one survivor is 75 %. Phase 3's minimum-mutant floor
(default 20) exists solely for this and must ship in the same change as the threshold.

**CI cost.** Measured PR-sized runs are 44 s – 1 min 25 s on `packages/shared` at concurrency 4,
comparable to a GitHub-hosted runner. The job runs in parallel with `ci.yml`, so it adds no wall
time to the critical path unless it becomes required in Phase 3.

**Extrapolation risk.** `packages/core` has larger suites, 30 s test timeouts, and DI/ORM
bootstrapping. The `shared` numbers do not transfer, which is exactly why Phase 0b measures before
`core` is enabled.

**Rollback.** Delete `.github/workflows/mutation-tests.yml`, or set `MUTATION_ENFORCE=false`.
Nothing persists between runs; nothing else depends on it.

## 📋 Phasing

| Phase | Deliverable | Exit criterion |
|-------|-------------|----------------|
| **0** ✅ | Feasibility pilot on `packages/shared` | Done — `.ai/analysis/2026-07-31-stryker-mutation-testing-pilot.md` |
| **0b** | Same measurement on `packages/core` | A run on 3 representative `core` business-logic files completes under 10 min, or `core` stays out of scope |
| **1** | Config factory, scope script, advisory workflow, `shared` allowlisted | Green advisory runs on real PRs for 2–3 weeks; scores collected |
| **2** | Survivor reporting (job summary + artifact; optional fork-guarded PR comment) | A developer can act on a survivor without opening the artifact |
| **3** | Enforcement: `thresholds.break`, minimum-mutant floor, `MUTATION_ENFORCE=true` | Core-team sign-off on the threshold, chosen from Phase 1–2 data |
| **4** | Optional: `incremental` + cache, `mixinJestEnvironment` for `perTest` coverage, nightly trend run | Only if Phase 1–3 timings demand it |

## 📋 Implementation Plan

### Phase 0b — measure `packages/core` (1 step)

1. Add a throwaway `packages/core/stryker.conf.mjs` mirroring the pilot config; run it against
   three representative business-logic files (one `lib/`, one `commands/`, one `data/validators.ts`);
   append the timings to the Phase 0 analysis document. Deliverable is the measurement, not the
   config. **Test:** the run completes and produces a score; if it does not, Phase 1 ships with
   `shared` only.

### Phase 1 — advisory gate (5 steps)

1. Add `@stryker-mutator/core` and `@stryker-mutator/jest-runner` to root `devDependencies`; add
   `mutation:changed` to the root `package.json` scripts. **Test:** `yarn install --immutable`
   succeeds; `yarn stryker --version` resolves.
2. Add `scripts/stryker/createConfig.mjs` (factory: `inPlace`, `coverageAnalysis: "off"`, jest
   runner wiring, `excludedMutations: ["StringLiteral", "Regex"]`, thresholds, reporters) and
   `packages/shared/stryker.conf.mjs` calling it. **Test:** unit test asserting the factory output
   for a given package name; `yarn stryker run --mutate src/lib/boolean.ts` in `packages/shared`
   reproduces the pilot's 93.3 %.
3. Add `scripts/stryker/scope.mjs` with the allowlist, in-scope globs, deletion filter and file
   cap. **Test:** unit tests over a stubbed diff list — in-scope file included, `.tsx` excluded,
   `api/` excluded, deleted file excluded, cap truncates and reports, empty diff yields an empty
   matrix.
4. Add the local wrapper (`yarn mutation:changed`) with the clean-tree guard and the recovery
   message. **Test:** running it on a dirty tree exits non-zero without invoking Stryker.
5. Add `.github/workflows/mutation-tests.yml`: `scope` job → `mutate` matrix job, `fail-fast:
   false`, `timeout-minutes: 20`, `continue-on-error` from `MUTATION_ENFORCE` (default `false`).
   **Test:** the workflow runs on this PR itself and reports a score for the files it changes.

### Phase 2 — reporting (2 steps)

1. Add `scripts/stryker/report.mjs` converting `mutation.json` into a markdown survivor table
   (`file:line:column`, mutator, `-`/`+` replacement), and write it to `$GITHUB_STEP_SUMMARY`;
   upload the HTML + JSON reports as an artifact. **Test:** unit test over a fixture
   `mutation.json` asserting survivors are listed and killed mutants are not.
2. Optional, only if the team wants it: a fork-guarded PR comment step reusing the same markdown.
   **Test:** the step is skipped on a fork PR and posts exactly one idempotent comment otherwise.

### Phase 3 — enforcement (2 steps, gated on core-team approval)

1. Add the minimum-mutant floor to the runner: below `MUTATION_MIN_MUTANTS` (default 20) the score
   is reported but never fails. **Test:** unit test — 4 mutants with 1 survivor does not fail;
   30 mutants at 60 % does.
2. Set `thresholds.break` (70, revised from Phase 1–2 data) and `MUTATION_ENFORCE=true`; document
   the gate in `AGENTS.md` → Validation Commands and in the PR workflow docs. **Test:** a
   deliberately under-tested branch fails the check; the same branch with the missing assertions
   added passes.

### Phase 4 — optional optimisation (2 steps)

1. `mixinJestEnvironment` wrapper module so `@jest-environment` docblocks can point at a
   Stryker-aware environment, unlocking `coverageAnalysis: "perTest"`. **Test:** the dry run
   completes with `perTest` and per-mutant test counts drop measurably.
2. `incremental: true` with a per-package `actions/cache` entry keyed on the package's source tree.
   **Test:** a second run on an unchanged branch reuses the incremental file and finishes faster.

## 📝 References

- Phase 0 pilot measurements and blockers: `.ai/analysis/2026-07-31-stryker-mutation-testing-pilot.md`
- Pilot branch with the working configuration: `chore/stryker-pilot`
- Existing quality-tooling precedent: `.ai/specs/SPEC-050-2026-02-28-sonarqube-critical-fixes.md`,
  `.ai/specs/SPEC-052-2026-02-22-integration-test-coverage-quick-wins.md`
- CI scoping precedent (`prepare` job's changed-module detection): `.github/workflows/ci.yml`
- Petrović & Ivanković, *State of Mutation Testing at Google* (ICSE-SEIP 2018) — diff-scoped
  presentation and arid-mutant suppression as adoption prerequisites
