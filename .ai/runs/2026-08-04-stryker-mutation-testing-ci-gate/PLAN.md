# Execution plan — StrykerJS mutation testing as a diff-scoped CI quality gate

**Run slug:** `2026-08-04-stryker-mutation-testing-ci-gate`
**Branch:** `feat/stryker-mutation-testing-ci-gate`
**Base branch:** `develop`
**Source spec:** `.ai/specs/2026-07-31-stryker-mutation-testing-ci-gate.md`
**Design PR (merged):** #4773
**Subject issue:** none — this run is spec-driven

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add Stryker devDependencies and the `mutation:changed` script | inline | done | 723419941 |
| 0 | 0b.1 | Measure `packages/core` and decide its allowlist status | inline | done | 641325d9a |
| 1 | 1.2 | Config factory and `packages/shared/stryker.conf.mjs` | dispatch | done | cdc409d00 |
| 1 | 1.3 | `scripts/stryker/scope.mjs` — allowlist, globs, deletion filter, file cap | dispatch | done | 2fed7cd92 |
| 1 | 1.4 | Local `yarn mutation:changed` wrapper with the clean-tree guard | dispatch:cheap | done | 63b68afb2 |
| 1 | 1.5 | `.github/workflows/mutation-tests.yml` advisory workflow | dispatch | done | 089fcad52 |
| 2 | 2.1 | `scripts/stryker/report.mjs` — survivor table, job summary, artifact | dispatch | done | 9f008a2da |
| 2 | 2.2 | Fork-guarded PR comment step | dispatch:cheap | done | a3b2a9bba |
| 3 | 3.1 | Minimum-mutant floor (`MUTATION_MIN_MUTANTS`) | dispatch | done | 288aa86f2 |
| 3 | 3.2 | Dormant enforcement — `thresholds.break`, `MUTATION_ENFORCE`, docs | inline | done | 1f4868f48 |
| 4 | 4.1 | `mixinJestEnvironment` wrapper for `perTest` coverage (conditional) | inline | done | 22614e6d3 |
| 4 | 4.2 | `incremental` plus Actions cache (conditional) | inline | done | a7864dd25 |
| 1 | 1.3-review-fix | Drop the dead `--json` flag from `scope.mjs` | inline | done | — |

### Why Step 1.1 precedes Phase 0b

The spec lists Phase 0b first, but the 0b measurement cannot run until StrykerJS is installed. Step
1.1 therefore lands first as the prerequisite commit, and Step 0b.1 runs the measurement against it.
Nothing else about the spec's ordering changes: the 0b result is consumed by Step 1.3, which is the
Step that writes the allowlist, and 0b.1 lands well before it.

## Goal

Ship StrykerJS mutation testing as a diff-scoped, advisory-first CI quality gate that scores only
the business-logic files a pull request actually changes, so tests that execute code without
verifying it are caught before merge — without adding hours to CI and without pushing contributors
or AI agents toward brittle string-assertion tests.

## Scope

- Root `devDependencies` for `@stryker-mutator/core` and `@stryker-mutator/jest-runner`, plus root
  `package.json` scripts.
- Four new scripts under `scripts/stryker/`: `createConfig.mjs`, `scope.mjs`, `report.mjs`, and the
  local `mutation-changed.mjs` wrapper.
- One per-package config: `packages/shared/stryker.conf.mjs` (plus `packages/core` only if the
  Phase 0b measurement justifies it).
- One new standalone workflow: `.github/workflows/mutation-tests.yml`.
- Unit tests for every Step whose spec entry carries a **Test:** criterion.
- Documentation updates: the spec's Phase 3 section, the Phase 0 analysis document, and a developer
  note on the `// Stryker disable next-line` escape hatch.

## Non-goals

- **Not** modifying `.github/workflows/ci.yml`. The mutation workflow is standalone by design so a
  mutation failure can never be confused with a test failure and so rollback is deleting one file.
- **Not** editing any existing test file. The `@jest-environment` docblock blocker is worked around,
  never fixed by touching unrelated suites (spec Q3).
- **Not** enabling enforcement. The machinery ships dormant; flipping it on is a core-team decision
  (operator decision 1, spec Q1, `AGENTS.md` "Ask First" on pipeline changes).
- **Not** touching PR pipeline or label automation, and not registering the check as required.
- **Not** adding a repo-wide mutation score badge or a per-package leaderboard — the spec explicitly
  rules both out as metric-gaming vectors.
- **Not** changing application code, the database schema, or any runtime behaviour.

## Operator decisions that override spec defaults

1. **Phase 3 enforcement ships OFF.** `thresholds.break`, the `MUTATION_MIN_MUTANTS` floor and the
   `MUTATION_ENFORCE` flag are all implemented and tested, but `MUTATION_ENFORCE` defaults to
   `false`, the workflow keeps `continue-on-error`, and the check is neither registered nor
   documented as a required merge-blocking check. Turning it on must remain a one-line env change.
2. **Phase 0b is a measurement, not a deliverable.** The throwaway `packages/core` config is not
   committed; only the timings appended to the analysis document are. If the run exceeds the spec's
   10-minute exit criterion or fails, the allowlist ships with `packages/shared` only and the reason
   is recorded.

## Implementation Plan

### Phase 1 — advisory gate

#### Step 1.1 — Add Stryker devDependencies and the `mutation:changed` script

- Add `@stryker-mutator/core` and `@stryker-mutator/jest-runner` to the **root** `devDependencies`
  (spec Q5: one hoisted version, configuration per package), matching the pilot's `^9.6.1`.
- Add the `mutation:changed` script to the root `package.json`, pointing at the wrapper that Step
  1.4 creates. The script line lands here so the dependency and script surface arrive in one commit;
  the wrapper file itself is Step 1.4's commit.
- **Test:** `yarn install --immutable` succeeds and `yarn stryker --version` resolves.

### Phase 0b — measure `packages/core`

#### Step 0b.1 — Measure `packages/core` and decide its allowlist status

- Create a throwaway `packages/core/stryker.conf.mjs` mirroring the pilot config; run it against
  three representative business-logic files: one from `lib/`, one from `commands/`, and one
  `data/validators.ts`.
- Append the timings, the per-file scores, and the pass/fail verdict against the spec's 10-minute
  exit criterion to `.ai/analysis/2026-07-31-stryker-mutation-testing-pilot.md`.
- Decide from the measured data whether `packages/core` joins the Step 1.3 allowlist. On a timeout,
  a failure, or a run over 10 minutes, the allowlist ships with `packages/shared` only and the
  reason is recorded in both the analysis document and the PR body.
- Delete the throwaway config — the deliverable is the measurement, not the config.
- **Test:** the run completes and produces a score; if it does not, Phase 1 ships `shared` only.

### Phase 1 — advisory gate (continued)

#### Step 1.2 — Config factory and `packages/shared/stryker.conf.mjs`

- Add `scripts/stryker/createConfig.mjs` as the single source of truth for shared settings:
  `inPlace: true` (mandatory — it removes the sandbox that breaks the per-package jest config's
  relative paths, and short-circuits the tsconfig preprocessor that TypeScript 7.0.2 breaks),
  `coverageAnalysis: "off"`, the jest runner wiring with `enableFindRelatedTests`,
  `excludedMutations: ["StringLiteral", "Regex"]`, thresholds, and reporters.
- Add `packages/shared/stryker.conf.mjs` calling the factory with only its own package name.
- Document the `// Stryker disable next-line <mutator>` escape hatch for equivalent mutants, with
  the requirement that each suppression carries a one-line justification.
- **Test:** a unit test asserting the factory output for a given package name, and
  `yarn stryker run --mutate src/lib/boolean.ts` in `packages/shared` reproducing the pilot's 93.3 %.

#### Step 1.3 — `scripts/stryker/scope.mjs` — allowlist, globs, deletion filter, file cap

- Compute the mutate list from `git diff --name-only --diff-filter=d $BASE...HEAD` (StrykerJS has no
  `--since` flag, so scoping is ours to compute) and emit a GitHub Actions matrix on stdout.
- Keep only paths matching the in-scope globs of an allowlisted package; emit no entry for a package
  with no in-scope changes; emit an empty matrix when nothing matches.
- Cap the list at `MUTATION_MAX_FILES` (default 25) per package, sorted by path for determinism, and
  print what was dropped so a truncated run never reads as full coverage.
- **Test:** unit tests over a stubbed diff list — in-scope file included, `.tsx` excluded, `api/`
  excluded, deleted file excluded, cap truncates and reports, empty diff yields an empty matrix.

#### Step 1.4 — Local `yarn mutation:changed` wrapper with the clean-tree guard

- Add the wrapper that runs the clean-tree guard, then `scope.mjs`, then Stryker per package.
- Because `inPlace: true` mutates real working-tree sources, the guard refuses to start on a dirty
  tree and prints the `git checkout -- .` recovery command (spec Q4).
- **Test:** running it on a dirty tree exits non-zero without invoking Stryker.

#### Step 1.5 — `.github/workflows/mutation-tests.yml` advisory workflow

- A standalone `pull_request` workflow, separate from `ci.yml`: a `scope` job running `scope.mjs`
  and emitting the matrix, then a `mutate` matrix job with `fail-fast: false`,
  `timeout-minutes: 20`, and `continue-on-error` driven by `MUTATION_ENFORCE` (default `false`).
- A PR whose diff contains no in-scope files skips entirely and reports success — no empty run and
  no synthetic score (spec Q8).
- **Test:** the workflow runs on this PR itself and reports a score for the files it changes.

### Phase 2 — reporting

#### Step 2.1 — `scripts/stryker/report.mjs` — survivor table, job summary, artifact

- Convert `mutation.json` into a markdown survivor table (`file:line:column`, mutator, and the
  `-`/`+` diff of the replacement) and write it to `$GITHUB_STEP_SUMMARY`; upload the HTML and JSON
  reports as an artifact.
- When the run is advisory, the summary states plainly that the result does not block merge.
- **Test:** a unit test over a fixture `mutation.json` asserting survivors are listed and killed
  mutants are not.

#### Step 2.2 — Fork-guarded PR comment step

- Add the PR comment step reusing the same markdown, guarded by
  `github.event.pull_request.head.repo.full_name == github.repository` — the same fork guard
  `ci.yml`'s `docker-build` job already uses, because `pull_request` runs from forks get no
  `pull-requests: write` token.
- **Test:** the step is skipped on a fork PR and posts exactly one idempotent comment otherwise.

### Phase 3 — enforcement machinery, shipped dormant

#### Step 3.1 — Minimum-mutant floor (`MUTATION_MIN_MUTANTS`)

- Below `MUTATION_MIN_MUTANTS` (default 20) the score is reported but never fails. This exists for
  small-diff volatility: with four mutants, one survivor is 75 %.
- **Test:** unit test — 4 mutants with 1 survivor does not fail; 30 mutants at 60 % does.

#### Step 3.2 — Dormant enforcement — `thresholds.break`, `MUTATION_ENFORCE`, docs

- Wire `thresholds.break` (70, to be revised from Phase 1–2 data) and the `MUTATION_ENFORCE` flag,
  **defaulting to `false`** so the workflow keeps `continue-on-error` and the gate stays advisory.
- Record in the spec's Phase 3 section that enforcement is implemented-but-dormant and awaiting an
  explicit core-team decision (spec Q1, `AGENTS.md` "Ask First" on pipeline changes). Describe the
  gate in the docs as dormant — do not add it to `AGENTS.md` → Validation Commands as if active, and
  do not register it as a required check.
- **Test:** the enforcement decision function fails a deliberately under-tested fixture when
  enforcement is on and passes the same fixture when it is off (the shipped default).

### Phase 4 — optional optimisation (conditional)

#### Step 4.1 — `mixinJestEnvironment` wrapper for `perTest` coverage (conditional)

- Attempt a wrapper module so `@jest-environment` docblocks can point at a Stryker-aware
  environment, unlocking `coverageAnalysis: "perTest"` without editing existing test files.
- The spec gates Phase 4 on need ("only if Phase 1–3 timings demand it"). If the measured timings do
  not justify it, or `perTest` still cannot be unlocked, that is reported honestly in the PR body and
  the spec rather than shipping speculative optimisation. Partial delivery is acceptable; silently
  skipping is not.
- **Test:** the dry run completes with `perTest` and per-mutant test counts drop measurably.

#### Step 4.2 — `incremental` plus Actions cache (conditional)

- Attempt `incremental: true` with a per-package `actions/cache` entry keyed on the package's source
  tree. Same conditionality and same honesty requirement as Step 4.1.
- **Test:** a second run on an unchanged branch reuses the incremental file and finishes faster.

## Risks

- **Extrapolation risk (highest).** `packages/core` has larger suites, 30 s test timeouts, and
  DI/ORM bootstrapping; the `shared` numbers do not transfer. Step 0b.1 measures before `core` is
  enabled, and the fallback is a `shared`-only allowlist.
- **`inPlace` mutates real sources.** Mitigated by the clean-tree guard locally and by CI being
  ephemeral. A `SIGKILL`ed local run can still leave mutated sources; the wrapper prints the
  recovery command.
- **Gaming the metric.** Mitigated by the mutator exclusions, by scoring only changed files, and by
  treating the threshold as a review floor rather than a target. No badge, no leaderboard.
- **Phase 4 may not be deliverable.** Explicitly conditional in the spec; the risk is answered by
  reporting honestly rather than by shipping unproven configuration.
- **Validation-gate noise.** This machine has two known pre-existing failures unrelated to this
  change (`packages/ui` `format.test.ts` under a Polish locale; two `watch-packages` `fs.watch`
  tests). They are recorded as pre-existing, never "fixed" by this run.

## External References

None. No `--skill-url` arguments were passed to this run.
