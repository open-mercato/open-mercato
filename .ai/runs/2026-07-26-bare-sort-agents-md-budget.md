# Execution plan — restore develop's green test job (bare sort in check-agents-md-budget)

## Goal

`develop` fails its `test` job: the explicit-sort-comparator audit
(`packages/core/src/__tests__/explicit-sort-comparators.test.ts`, the #3620 guard) reports one
violation in `scripts/check-agents-md-budget.mjs:93`. Because the guard runs in the shared `test`
job, every PR that merges the current base inherits the red check. Give that sort an explicit
comparator so the audit passes and the base is mergeable again.

## Root cause

`scripts/check-agents-md-budget.mjs` arrived in commit `09a84a85f`
("fix(agents): ratchet only the nested part of over-budget instruction chains"), already merged to
`develop`. Line 93 sorts the baseline chain keys with a bare `.sort()`:

```js
const chains = Object.keys(baseline.chains)
  .sort()
```

The guard scans every non-test source file under a package `src` root **and under `scripts/`**, so a
new script under `scripts/` is in scope. The violation was not visible on that PR because the guard
and the script landed through different branches and only meet on `develop`.

## Scope

- One call site: `scripts/check-agents-md-budget.mjs:93` gets an explicit comparator.
- The keys are canonical internal identifiers (directory paths from the baseline), so the guard's
  documented canonical-key form applies: `(a, b) => (a < b ? -1 : a > b ? 1 : 0)`.

## Non-goals

- No change to the budget logic, the baseline format, or the ratchet behavior of
  `check-agents-md-budget.mjs` — ordering of the chain keys is unchanged for the string keys it
  actually holds, so this is behavior-preserving.
- No change to the guard test itself. The guard is correct; the script is what violates it.
- No sweep of other sort call sites — the audit reports exactly one violation on this base.

## Risks

- Low. The comparator reproduces the default lexicographic order for the string keys in scope, so
  `analyze()` output ordering is unchanged; the existing `scripts/__tests__/check-agents-md-budget.test.mjs`
  suite covers the behavior.

## Implementation plan

### Phase 1: Fix the violation

- 1.1 Give the chain-key sort in `scripts/check-agents-md-budget.mjs` an explicit canonical-key
  comparator.

### Phase 2: Validation

- 2.1 Confirm the guard passes and the script's own suite is green, then run the configured
  validation gate.

## Progress

PR: #4527

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix the violation

- [x] 1.1 Add the explicit comparator to the chain-key sort — c9fe3d62a

### Phase 2: Validation

- [x] 2.1 Guard test, script suite, and the configured validation gate all green — c9fe3d62a

Runner: local. The #3620 guard (`packages/core/src/__tests__/explicit-sort-comparators.test.ts`) goes
from one violation to 4/4 passing, and the script's own suite
(`scripts/__tests__/check-agents-md-budget.test.mjs`, run by the `Test scripts` CI step) is 8/8.
Configured gate: `yarn build:packages`, `yarn generate`, `yarn build:packages`,
`yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck` and `yarn build:app` all pass.

`yarn test` reports 1032/1033 suites passing with **zero failed assertions** across two full runs;
each run lost one different suite to `A jest worker process was terminated ... signal=SIGSEGV`
(`image.route` / `optimistic-lock` / `labels/scoping` in the first run, `ai-tools/settings-pack` in
the second). Every one of them passes standalone under `--runInBand` (13/13 and 6/6), so this is
local worker instability under parallel load, not a regression from this change. CI is the
authoritative gate.

## Note on CI visibility of this fix

This PR touches only `scripts/`, and `.github/workflows/ci.yml` scopes the PR test run to
`yarn turbo run test --filter=[origin/<base>]...` — which selects packages by dependency graph and
will not pull in `@open-mercato/core`, where the guard lives. So the guard will not run on this PR's
own CI, exactly as it did not run on the PR that introduced the violation; the unfiltered `yarn test`
on the post-merge push is what turned `develop` red. The evidence that the guard is satisfied is the
local run above plus the `Test scripts` step. This asymmetry is the same one `ci.yml` already
documents for the create-app parity guards (#3779).
