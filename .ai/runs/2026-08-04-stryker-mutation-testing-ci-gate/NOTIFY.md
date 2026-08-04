# Notify — 2026-08-04-stryker-mutation-testing-ci-gate

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-08-04T07:04:00Z — run started

- Brief: implement all phases (0b, 1, 2, 3, 4) of the StrykerJS diff-scoped mutation-testing CI gate
  spec in a single PR against `develop`.
- Source spec: `.ai/specs/2026-07-31-stryker-mutation-testing-ci-gate.md` (design PR #4773, merged).
- External skill URLs: none.
- Engine: `om-auto-create-pr-loop`, selected because `--loop` was forwarded by the operator through
  `om-auto-implement-spec` → `om-auto-create-pr`. The plan's 12 Steps are below the configured
  threshold of 20, so without the explicit flag this would have run plain.

## 2026-08-04T07:04:00Z — decision: Step 1.1 precedes Phase 0b

- The spec lists Phase 0b first, but the 0b measurement cannot run before StrykerJS is installed.
  Step 1.1 therefore lands first as the prerequisite commit. The 0b result is consumed by Step 1.3
  (the Step that writes the allowlist), and 0b.1 lands well before it, so no spec intent is lost.

## 2026-08-04T07:04:00Z — decision: two operator overrides recorded in the plan

- Phase 3 enforcement ships **dormant** (`MUTATION_ENFORCE` defaults to `false`, workflow keeps
  `continue-on-error`, check not registered as required). Rationale: spec Q1 leaves enforcement to an
  explicit core-team decision, and `AGENTS.md` classifies pipeline changes as Ask First.
- Phase 0b is a **measurement, not a deliverable**: the throwaway `packages/core` config is not
  committed; only the appended timings are.

## 2026-08-04T07:16:00Z — convention: Commit-column SHAs are filled one commit later

- A Step's commit cannot contain its own SHA, so each Step's commit flips only the `Status` cell to
  `done` (that is the cell `om-auto-continue-pr-loop` parses to find the resume point). The `Commit`
  cell is filled with the real short SHA in the next commit or at the checkpoint. No Step is ever
  left ambiguous: `Status` is authoritative, `Commit` is informational.

## 2026-08-04T09:20:00Z — Phase 0b result: packages/core stays out of the allowlist

- Measured three representative `core` files. Only the 75-LOC `auth/lib/rateLimitCheck.ts`
  completed (1 m 45 s, 41 mutants, 58.5 %). `auth/commands/roles.ts` exceeded ten minutes twice
  without producing a score. `customers/data/validators.ts` generated 403 mutants with Stryker's own
  ETA at ~6 h 42 m and was aborted.
- The spec's exit criterion ("3 representative core files complete under 10 min") is missed by about
  two orders of magnitude, so the Phase 1 allowlist ships as `['shared']` only, per the operator's
  Phase 0b instruction. Full numbers and reasoning appended to
  `.ai/analysis/2026-07-31-stryker-mutation-testing-pilot.md`.
- The throwaway `packages/core/stryker.conf.mjs` was deleted, not committed.

## 2026-08-04T09:20:00Z — blocker encountered and resolved: interrupted inPlace runs

- Two measurement runs were killed by the tooling's 10-minute cap while Stryker held real source
  files mutated. Each left ~4 966 modified files in `packages/core`, because Stryker's
  `disableTypeChecks` default prepends `// @ts-nocheck` before mutating and `inPlace: true` writes
  that to disk. `git checkout -- packages/core` recovered fully both times.
- Consequence for the design: the clean-tree guard in the local wrapper is a hard stop, not a
  warning, and `disableTypeChecks` cannot be turned off to shrink the blast radius because this
  repo's ts-jest transformer type-checks. Recorded in the analysis document.
- Process note for future runs in this environment: background tasks are killed at the 10-minute
  tool cap, and `ps` in this sandbox does not reliably show those processes — rely on task
  notifications, and never run two `inPlace` Stryker runs against the same package concurrently.

## 2026-08-04T07:33:00Z — checkpoint 1: Phase 1 and Phase 0b complete (6 Steps)

- `yarn test:scripts`: 463 passed / 0 failed, including 44 new tests across five files.
- Step 1.2's headline criterion verified: `packages/shared` `boolean.ts` scores **93.33 %** through
  the new factory, reproducing the Phase 0 pilot's 93.3 % (28 killed / 2 survived / 2 errors,
  1 m 27 s, 615.92 tests per mutant). Details in `checkpoint-1-checks.md`.
- Blocker found and fixed: a fresh worktree fails Stryker's dry run with
  `Cannot find module '@open-mercato/cache'` because package suites resolve siblings through
  `dist/`. The workflow now builds packages before mutating.
- Environment hazard recorded: a detached measurement survived repeated `pkill` (the sandbox
  dropped the signals) and re-instrumented `packages/core` mid-run. Killing it required
  `dangerouslyDisableSandbox`; `pgrep` sees such processes when `ps` does not.
