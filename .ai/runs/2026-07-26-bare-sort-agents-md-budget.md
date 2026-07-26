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

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix the violation

- [ ] 1.1 Add the explicit comparator to the chain-key sort

### Phase 2: Validation

- [ ] 2.1 Guard test, script suite, and the configured validation gate all green
