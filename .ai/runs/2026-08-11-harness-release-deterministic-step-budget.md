# Harness release: decouple the deterministic step's process budget from `--case-timeout`

Issue: [#5184](https://github.com/open-mercato/open-mercato/issues/5184)
Base branch: `develop`
Branch: `cez/f78d288d`

## Goal

The release gate's deterministic step invokes no model — it is `evaluate-agent-harness.mjs --all`
in deterministic mode, pure catalog validation. It nevertheless derives its process budget from
`--case-timeout`, a flag whose own help calls it a *per-model invocation* timeout floor:

```js
options.caseTimeout * Math.max(1, plan.catalog.caseCount) + 60_000
```

Give that step a budget that does not ride the model ceiling, justify the chosen number against a
measured deterministic run rather than picking it freehand, pin it with a test, and state in
`RELEASE.md` which lanes `--case-timeout` actually governs afterwards.

## Measurement — the deterministic run's observed duration

Staged a temp app root the same way `agent-harness-evaluator.test.ts:stageApp()` does (harness +
guides + evaluator scripts copied out of `packages/create-app/agentic/shared`), then timed
`node scripts/evaluate-agent-harness.mjs --root <root> --all` on macOS (Darwin 25.5.0, Apple
silicon). Every run reported `Deterministic: 213/213 selected cases passed`.

| Selection | Cases | Observed wall time |
|---|---|---|
| `--case OMH-001` | 1 | 175 ms, 181 ms, 190 ms |
| `--family testing` | 8 | 175 ms, 187 ms, 194 ms |
| `--family business` | 63 | 184 ms, 190 ms, 203 ms |
| `--all` | 213 | 211 ms, 211 ms, 220 ms, 258 ms, 515 ms (cold) |

Two facts follow, and they decide the shape of the fix:

1. The complete-catalog run costs **well under a second** — the slowest observed run, a cold one,
   was 515 ms.
2. The cost is **almost entirely fixed** (process start plus catalog/guide load). Going from 1 case
   to 213 adds roughly 35 ms, i.e. a marginal cost near **0.2 ms per case**.

### Re-measurement after the 2026-08-21 base merge

Merging the latest `develop` grew the shipped catalog from 213 cases to 234, which made the numbers
above stale and tripped the repo's own `every published case count states the shipped catalog or the
portability sample` guard in `agent-surface-coverage.test.ts`. The measurement was therefore repeated
against the current catalog, on Linux x86_64 this time, five runs per selection. Every run reported
`Deterministic: 234/234 selected cases passed`.

| Selection | Cases | Observed wall time |
|---|---|---|
| `--case OMH-001` | 1 | 842 ms, 871 ms, 871 ms, 890 ms, 889 ms |
| `--family testing` | 8 | 875 ms, 933 ms, 962 ms, 823 ms, 949 ms |
| `--family business` | 63 | 791 ms, 951 ms, 967 ms, 929 ms, 950 ms |
| `--all` | 234 | 917 ms, 998 ms, 768 ms, 812 ms, 934 ms |

This host is uniformly slower than the macOS one — process start dominates on both, and here it
costs roughly 850 ms rather than 180 ms. Both readings survive, and the second is now the stronger
of the two: the complete-catalog run still finishes in **well under a second** (slowest 998 ms), and
the single-case run and the complete-catalog run are no longer distinguishable at all — their ranges
overlap, so the per-case marginal cost is below this host's run-to-run noise. Fact 2 therefore holds
more firmly than it did at 0.2 ms per case: catalog size does not move the duration, and a flat
budget remains the honest shape. The one figure that changes is the safety factor, from about 233×
the slowest observed run to about **120×** — still a ceiling no healthy run can approach.

The shipped documentation (`RELEASE.md`, the constant's comment, and the test's comment) states this
second measurement, because it is the one taken against the catalog the gate actually ships.

## Decision

A **flat 120 000 ms** allowance, `DETERMINISTIC_STEP_TIMEOUT_MS`, returned together with the argv
from an exported `deterministicInvocation()` so the call site and the test read one source.

- Flat rather than catalog-scaled, because fact 2 says catalog size barely moves the duration —
  scaling on `caseCount` would be fitting noise. At 0.2 ms per case the catalog would need to reach
  six figures before it consumed a meaningful part of the ceiling.
- 120 000 ms rather than a freehand number, because it is roughly **120×** the slowest observed run
  (about 233× against the earlier macOS measurement) and it is the value this script already gives
  its other model-free step: fixture preparation runs under a flat `120_000`. The gate now budgets
  model-free work one way and model work another.

## Tasks / Progress

- [x] Reproduce and measure the deterministic run (table above)
- [x] Add `DETERMINISTIC_STEP_TIMEOUT_MS` + `deterministicInvocation()` and use them at the call site
- [x] Update `--case-timeout` help to name the lanes it actually governs
- [x] Pin the budget and argv with a test in `packages/create-app/src/lib/agent-harness-release.test.ts`
- [x] Record the change and the governed lanes in `agentic/shared/ai/harness/RELEASE.md`
- [x] Run the validation gate — local runner, no compose `app` container; all eight commands green
- [x] Open the PR
- [x] Merge the latest `develop` in, re-measure against the grown 234-case catalog, and restate the
      published figures (2026-08-21, `om-auto-fix-pr`)
- [x] Merge `develop` again after #5180 landed, resolve the two conflicts it created in this file,
      and close the review's two Medium findings — the call site is now pinned by the `#5184` test
      and the `RELEASE.md` sentence about the raise names #5180 and both values (2026-08-22,
      `om-auto-fix-pr`)

## Notes

- #5180 was open against the same file when this work started — it touched the routing invocation
  and the `--case-timeout` default, not the deterministic call site, so the two stayed independent
  and could merge in either order. It landed first (`153faed87`, raising the default from 120000 ms
  to 600000 ms), and merging `develop` on 2026-08-22 resolved the two textual conflicts that created:
  both invocation helpers now sit side by side, and the `--case-timeout` help line reads develop's
  `DEFAULT_CASE_TIMEOUT_MS` while keeping this branch's sentence about the model-free steps. The
  raise also turned this PR's `RELEASE.md` sentence about it from anticipation into history, which
  is how the review finding on that sentence was closed.
- The nit the review left open — fixture preparation's ceiling is still a hand-written `120_000`
  while the docs claim the two model-free steps share one value — is tracked as #5473 rather than
  fixed here, because it changes a second step's call site and #5184 scoped this work to the
  deterministic one.
