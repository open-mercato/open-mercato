# Standalone integration CI

The existing snapshot job installs the exact published snapshot into a disposable scaffold, production-builds and starts the app, then runs repository integration specs against it. Its push trigger and frequency are unchanged. No standalone integration job runs automatically on pull requests.

## Shared runtime configuration

`scripts/lib/standalone-integration-env.mjs` owns the app and test-process settings. `scripts/ci/standalone-integration.mjs` consumes it for both package sources; `scripts/test-create-app-integration.ts` uses it for the local parity flow.

Change the builder and its tests when an integration feature needs another setting. Do not add a separate environment block to a workflow. The app's `.env` must exist before the production build because `NEXT_PUBLIC_*` settings are compiled into browser bundles.

The local parity command retains its Verdaccio package source, arbitrary Playwright arguments, and disabled/activated example build assertions. It starts its own disposable pgvector database on a random loopback port and runs `yarn start` directly. It does not use `mercato test:ephemeral`, whose monorepo-oriented defaults would override the standalone profile. The server and database are stopped even when setup or tests fail; the scaffold is preserved unless `--cleanup` was requested.

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

The snapshot lane runs the full eligible suite and verifies that the fixed smoke tests actually execute. The runner records selection in `.ai/qa/test-results/standalone-selection.json`; inspect that artifact alongside the Playwright report and app log.

The same runner can optionally verify locally packed packages on demand. With a disposable database already provisioned, run `STANDALONE_DATABASE_URL=<disposable-database-url> node scripts/ci/standalone-integration.mjs --source local --suite smoke`. Use `--suite affected --base-ref origin/main` to add changed-module and dependent specs, with a full-suite fallback for shared infrastructure changes. These commands are manual; no pull-request workflow invokes them.

Disabled owning modules are excluded by the CLI discovery rules added in #8452. Dependency and environment prerequisites still apply. Missing app configuration, an empty selection, or missing smoke coverage must fail rather than produce a successful no-op.

## Failure ownership

The author of the triggering merge owns the initial investigation; a maintainer coordinates it when several changes overlap. Record the failing run, commit, stage, and next action on the triggering PR. Separate package publication, dependency installation, app initialization, production build, readiness, discovery, and test failures. A setup failure means tests were not executed, not that they passed.

Compare the last successful run and the first failing run before assigning a cause. Inspect exact failed tests rather than treating every red workflow as the same regression. Fix the cause or propose reverting the triggering change promptly. Do not silently skip failures or continue calling the lane healthy while its required verification is incomplete.

## Rollout

Verify the refactored runner in the existing published snapshot lane. Negative tests cover mixed package sources, missing prerequisites, invalid module configuration, and zero selected tests. Repository rulesets, branch protection, snapshot publishing, and workflow triggers remain unchanged. Shared configuration reduces drift, but standalone regressions are still detected after merge unless someone runs the optional manual check before merging.
