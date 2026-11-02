# Standalone integration CI

The pre-merge standalone job installs packages built from the PR into a disposable scaffold. The snapshot job installs the exact published snapshot into the same kind of scaffold. Both production-build and start that app before running repository integration specs against it.

## Shared runtime configuration

`scripts/lib/standalone-integration-env.mjs` owns the app and test-process settings. `scripts/ci/standalone-integration.mjs` consumes it for both package sources; `scripts/test-create-app-integration.ts` uses it for the local parity flow.

Change the builder and its tests when an integration feature needs another setting. Do not add a separate environment block to a workflow. The app's `.env` must exist before the production build because `NEXT_PUBLIC_*` settings are compiled into browser bundles.

The app and queue-drain children share absolute queue, cache, and capture paths. Runtime imports in an in-process spec must resolve through `importFromAppRuntime()` so the command bus and generated loaders use the same installed package instance.

Intentional differences:

| Setting | App | Playwright / drain children | Reason |
| --- | --- | --- | --- |
| `OM_DOCUMENTS_COLLAB_INTEGRATION` | `1` | Unset | Permits the production app's loopback endpoint; setting it on Playwright also opts a different realtime test in. |
| `OM_TEST_APP_ROOT` | Unset | Disposable app directory | Directs discovery, runtime imports, and queue draining to the installed app. |
| `AUTO_SPAWN_WORKERS`, `AUTO_SPAWN_SCHEDULER` | `false` | `false` | Queue-dependent specs explicitly drain work, including delayed jobs during polling. |
| Email / onboarding | Delivery disabled; onboarding prerequisites unset | Same | Connected onboarding tests are excluded. The monorepo lane covers the configured state. |
| Browser telemetry opt-in | Unset | Unset | Browser RUM tests skip with an explicit reason; the monorepo lane enables them. |

`requiredEnvVars` discovery metadata currently checks presence, not boolean truth. Do not use a nonempty `false` string to express an absent prerequisite. Cover enabled behavior in a configured lane; do not remove an assertion merely to make a lane green.

## Test selection and evidence

The fixed smoke suite must remain selected and executable. The PR lane adds affected module specs, with the full suite as a conservative fallback for shared or infrastructure changes. The snapshot lane runs the full eligible suite. The runner records selection in `.ai/qa/test-results/standalone-selection.json`; inspect that artifact alongside the Playwright report and app log.

Disabled owning modules are excluded by the CLI discovery rules added in #8452. Dependency and environment prerequisites still apply. Missing app configuration, an empty selection, or missing smoke coverage must fail rather than produce a successful no-op.

## Failure ownership

The author of the triggering merge owns the initial investigation; a maintainer coordinates it when several changes overlap. Record the failing run, commit, stage, and next action on the triggering PR. Separate package publication, dependency installation, app initialization, production build, readiness, discovery, and test failures. A setup failure means tests were not executed, not that they passed.

Compare the last successful run and the first failing run before assigning a cause. Inspect exact failed tests rather than treating every red workflow as the same regression. Fix the cause or propose reverting the triggering change promptly. Do not silently skip failures or continue calling the lane healthy while its required verification is incomplete.

## Rollout

First exercise the new PR job on representative framework, module, and test changes. Validate its negative paths: mixed package sources, missing prerequisites, invalid module configuration, and zero selected tests must fail clearly. Only after those runs pass should a maintainer add the `Standalone PR Integration Tests` job to branch protection. These PRs do not change repository rulesets, automatically revert commits, or alter snapshot publishing.
