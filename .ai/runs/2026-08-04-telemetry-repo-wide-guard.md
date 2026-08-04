# Execution plan — register the telemetry default-unloaded guard

Fixes #4946.

## Goal

Make `scripts/__tests__/repo-wide-guards.test.mjs` pass again on `develop` and on every PR by
classifying `packages/telemetry/src/__tests__/default-unloaded.test.ts` in `REPO_WIDE_GUARDS`.

## Context

`packages/telemetry` landed with #4475 (`e76f4b8cb`, 2026-08-04 09:56Z). Its
`default-unloaded.test.ts` asserts host wiring across eight files that live outside the telemetry
package:

```
apps/mercato/src/instrumentation.ts
apps/mercato/src/app/api/[...slug]/route.ts
packages/create-app/template/src/instrumentation.ts
packages/create-app/template/src/app/api/[...slug]/route.ts
packages/cli/src/bin.ts
packages/queue/src/tracing.ts
packages/queue/src/strategies/async.ts
packages/queue/src/worker/runner.ts
```

`scripts/repo-wide-guards.mjs` is the single enumeration of such cross-package audits, and its own
test fails any test that reaches outside its package without being classified. The classification
entry was not added alongside the new package, so the guard test now fails on a pristine `develop`
checkout — and, because `ci.yml` runs the repo-wide guards unconditionally, on every PR that merges
the current base.

## Scope

One entry in `REPO_WIDE_GUARDS` in `scripts/repo-wide-guards.mjs`, declaring the telemetry workspace
and its guard test.

`REPO_WIDE_GUARDS` rather than `CROSS_PACKAGE_EXCEPTIONS` is the correct side of the fork: the test
must run on every PR precisely because a change to `packages/queue` or `apps/mercato` would otherwise
have this assertion filtered away by turbo — which is the failure mode the enumeration exists to
prevent (#4527, #4534).

## Non-goals

- No change to the telemetry package, its test, or any runtime host it scans.
- No change to the guard runner's mechanics, the CI workflow, or the enumeration's shape.
- No sweep for other unclassified tests beyond the one the guard currently reports.

## Risks

Low. The change is data in an enumeration; the guard test is the executable contract for it and moves
from red to green. The one behavioural consequence is intended: `packages/telemetry`'s guard test now
runs on every PR (~one extra jest run inside an already-batched step, seconds).

## Implementation Plan

### Phase 1: Classify the guard

- Step 1.1 — Add the `@open-mercato/telemetry` workspace group to `REPO_WIDE_GUARDS` with
  `src/__tests__/default-unloaded.test.ts` and a `scans` description naming the hosts it reads.
- Step 1.2 — Verify with the repository's own contract test
  (`node --test scripts/__tests__/repo-wide-guards.test.mjs`) plus the guard runner
  (`yarn test:repo-wide-guards`), then run the configured validation gate.

## Regression coverage

No new test is written, deliberately: `scripts/__tests__/repo-wide-guards.test.mjs` **is** the
regression test for this change. It fails on the current `develop` for exactly this file and passes
once the entry exists, and it will fail again the next time a cross-package test is added without a
classification. Adding a second test asserting the same enumeration would duplicate it.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Classify the guard

- [x] 1.1 Add the telemetry workspace group to REPO_WIDE_GUARDS — 678541426
- [x] 1.2 Verify with the guard contract test, the guard runner and the validation gate — 678541426

## Validation gate (runner: local — no compose `app` container up)

| Command | Result |
|---|---|
| `yarn build:packages` | ✅ 22/22 |
| `yarn generate` | ✅ clean tree, no unrelated migrations |
| `yarn build:packages` (rebuild) | ✅ 22/22 |
| `yarn i18n:check-sync` | ✅ all in sync |
| `yarn i18n:check-usage` | ✅ advisory only |
| `yarn typecheck` | ✅ 22/22 |
| `yarn test` | ⚠️ one pre-existing base failure, see below |
| `yarn build:app` | ✅ 1/1 |
| `node --test scripts/__tests__/repo-wide-guards.test.mjs` | ✅ 14/14 (was 13/14 before this change) |
| `yarn test:repo-wide-guards` | ✅ all guards pass, 24 test files, telemetry now among them |

`yarn test` fails only on `create-mercato-app`'s
`every local ESM import in template scripts resolves inside the template`: the template's
`scripts/dev-runtime.mjs:15` imports `./dev-memory-monitor.mjs`, which exists nowhere in the
repository. Reproduced on a pristine `upstream/develop` checkout with none of this branch's content —
it is base breakage from #4867, filed as **#4948**, and untouched by this diff. Run in isolation the
rest of that suite is green (450 tests, 444 pass, that one fail). A second create-app failure seen
during the first sweep (`build emits customers facts … (T5)`, `node build.mjs` exiting non-zero)
did **not** reproduce once nothing else was running — it was local memory pressure from a concurrent
`yarn build:app`, and `node build.mjs` completes cleanly on its own.
