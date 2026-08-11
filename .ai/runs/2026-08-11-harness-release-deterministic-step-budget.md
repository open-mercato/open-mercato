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

## Decision

A **flat 120 000 ms** allowance, `DETERMINISTIC_STEP_TIMEOUT_MS`, returned together with the argv
from an exported `deterministicInvocation()` so the call site and the test read one source.

- Flat rather than catalog-scaled, because fact 2 says catalog size barely moves the duration —
  scaling on `caseCount` would be fitting noise. At 0.2 ms per case the catalog would need to reach
  six figures before it consumed a meaningful part of the ceiling.
- 120 000 ms rather than a freehand number, because it is roughly **233×** the slowest observed run
  and it is the value this script already gives its other model-free step: fixture preparation runs
  under a flat `120_000`. The gate now budgets model-free work one way and model work another.

## Tasks / Progress

- [x] Reproduce and measure the deterministic run (table above)
- [x] Add `DETERMINISTIC_STEP_TIMEOUT_MS` + `deterministicInvocation()` and use them at the call site
- [x] Update `--case-timeout` help to name the lanes it actually governs
- [x] Pin the budget and argv with a test in `packages/create-app/src/lib/agent-harness-release.test.ts`
- [x] Record the change and the governed lanes in `agentic/shared/ai/harness/RELEASE.md`
- [x] Run the validation gate — local runner, no compose `app` container; all eight commands green
- [x] Open the PR

## Notes

- #5180 is open against the same file but touches the routing invocation and the `--case-timeout`
  default, not the deterministic call site. This PR is based on `develop` and stays independent of
  it; both can merge in either order.
