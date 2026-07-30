# Standalone development-memory root-cause attribution

Date: 2026-07-30

Status: confirmed for the attributed `next-turbopack` component; final three-run
acceptance remains open.

## Conclusion

**The default module-resource telemetry snapshots written below
`.mercato/module-resource-usage/` cause repeated Turbopack invalidation and retained
`next-server` memory during standalone development because the active Next.js
project watches that app-root path, the snapshots are atomically replaced at a
five-second throttle, and moving only those snapshots below the already ignored
Next.js `distDir` removed the five-second Fast Refresh cadence while reducing the
attributed peak by 30.40%.**

This is the confirmed hypothesis for Task 3. It does not claim that module
telemetry creates the original application graph. The generated backend and client
registries make that graph large; the telemetry writes repeatedly invalidate the
already-reachable graph and prevent the dominant process from settling.

## Baseline attribution

The corrected baseline median peak is **10,094.50 MB**. The three raw reports are:

- `/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/baseline-1.json`
- `/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/baseline-2.json`
- `/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/baseline-3.json`

| Run | Peak total | Mean total | Peak `next-turbopack` | Peak `next-server` | Peak timestamp |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 9,692.97 MB | 8,309.03 MB | 7,908.54 MB | 7,330.03 MB | `2026-07-30T20:56:36.943Z` |
| 2 | 10,094.50 MB | 9,431.21 MB | 7,689.89 MB | 7,051.50 MB | `2026-07-30T21:01:52.701Z` |
| 3 | 10,519.56 MB | 9,854.28 MB | 8,101.76 MB | 7,468.78 MB | `2026-07-30T21:06:05.132Z` |

Every peak is dominated by `next-turbopack`, and `next-server (v16.2.11)` is the
largest command. The next repeatable commands are the managed scheduler and shared
queue worker at roughly 0.47–0.54 GB each, followed by a Next.js build or
`jest-worker` child.

Run 1 peaks as the authenticated backend route first becomes available. Runs 2 and
3 peak 41.5 seconds and 26.5 seconds after their retained browser-console sessions
begin, during the sustained post-render invalidation phase rather than process
startup. Each baseline console contains exactly **36** Fast Refresh rebuilds in its
first 180 seconds, including the initial route work and one intended source edit.
The remaining rebuilds continue at an approximately five-second cadence long after
the intended edit.

## Reachable generated graph

The authenticated `/backend/memory-probe` route reaches generated registries
through both server and client bootstrap paths:

- `src/app/(backend)/backend/[...slug]/page.tsx` and the backend layout import
  `backend-routes.generated.ts` and call `bootstrap()`.
- `src/bootstrap.ts` imports the generated server registries.
- `src/components/ClientBootstrap.tsx` imports the generated client side-effect
  registries and dynamically loads injection, dashboard, notification, and enabled
  module registries.
- The shipped sources for those fixture files are
  `packages/create-app/template/src/app/(backend)/backend/[...slug]/page.tsx`,
  `packages/create-app/template/src/app/(backend)/backend/layout.tsx`,
  `packages/create-app/template/src/bootstrap.ts`, and
  `packages/create-app/template/src/components/ClientBootstrap.tsx`; the monorepo
  app has the mirrored consumers below `apps/mercato/src/`.

The fixture artifacts at attribution time were:

| Registry | Size | Lines | Static imports |
| --- | ---: | ---: | ---: |
| `backend-routes.generated.ts` | 113,487 bytes | 302 | 80 |
| `modules.app.generated.ts` | 855,779 bytes | 10,739 | 586 |
| `modules.bootstrap.generated.ts` | 155,026 bytes | 3,965 | 361 |
| `injection-widgets.generated.ts` | 16,491 bytes | 355 | 1 |
| `injection-tables.generated.ts` | 10,797 bytes | 362 | 22 |
| `dashboard-widgets.generated.ts` | 5,426 bytes | 131 | 1 |

`packages/cli/src/lib/generators/module-registry.ts` emits these files through
content-stable `writeGeneratedFile(...)` calls. The in-process structural watcher
in `packages/cli/src/mercato.ts` regenerates only after a structural checksum
change and skips structural invalidation when no output bytes changed. During the
repeated browser rebuilds, the generated registry mtimes stayed at their initial
generation time. Generated output was therefore reachable and expensive, but it
was not the recurring writer.

The existing `codex/dev-memory-research` branch was inspected as reference only.
Its `a86de25c2` change combines content-stable generation, route-manifest sharding,
bootstrap partitioning, and other graph changes. The lazy-worker and shared
scheduler research branches address separate long-running processes. None was
imported because the baseline points to one recurring filesystem invalidation seam,
and stacking those interventions would destroy causal attribution.

## Writer trace

`packages/shared/src/lib/modules/resource-usage.ts`:

- defaults snapshots to `.mercato/module-resource-usage/process-<pid>.json`;
- keeps snapshots enabled outside tests;
- throttles writes with `SNAPSHOT_THROTTLE_MS = 5_000`;
- writes a unique temporary file and atomically renames it over the process
  snapshot.

In the first experiment run, the `next-server` snapshot mtime advanced at
`21:17:50`, `21:18:00`, `21:18:05`, and `21:18:10` UTC while generated registry
mtimes did not change. The browser rebuild cadence aligned with those later
five-second writes.

## Rejected hypothesis

The compact dev runtime also samples process-tree memory every five seconds and
normally rewrites `.mercato/dev-splash-child-state.json`. That was the first
falsifiable hypothesis because its cadence matched the browser symptom.

The reversible test ran the fixture with `OM_DEV_SPLASH_PORT=off`, which suppresses
only the splash-state file and leaves the application, telemetry, module graph,
workers, scheduler, and Turbopack unchanged. Five-second Fast Refresh rebuilds
continued. The run was stopped, and the environment-only experiment required no
fixture or production revert. This hypothesis was rejected.

## Confirming experiment

The second experiment changed one variable:

```text
OM_MODULE_RESOURCE_USAGE_DIR=.mercato/next/module-resource-usage-experiment
```

The normal compact runtime and splash remained enabled. The destination is inside
the existing Next.js `distDir`, which Turbopack already excludes from application
source watching. The same initialized standalone fixture ran for 180 seconds at a
one-second sample interval. An authenticated browser visited
`/backend/memory-probe`, observed marker B, received marker A after one source edit
without navigation or server restart, and retained the console log.

Report:
`/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/experiment-telemetry-under-dist.json`

| Metric | Baseline comparator | Experiment | Delta |
| --- | ---: | ---: | ---: |
| Median/experiment peak total RSS | 10,094.50 MB | 7,397.08 MB | -2,697.42 MB (-26.72%) |
| Median/experiment mean total RSS | 9,431.21 MB | 6,819.47 MB | -2,611.74 MB (-27.69%) |
| Median/experiment peak `next-turbopack` | 7,908.54 MB | 5,503.97 MB | -2,404.57 MB (-30.40%) |
| Median/experiment peak `next-server` | 7,330.03 MB | 5,204.11 MB | -2,125.92 MB (-29.00%) |
| Fast Refresh rebuilds in 180 seconds | 36 per run | 3 | -33 (-91.67%) |

The three experiment rebuilds were the initial route rebuild, the intended source
edit, and one non-periodic residual rebuild. There was no repeated five-second
sequence. Meanwhile, the telemetry snapshots continued updating below
`.mercato/next/module-resource-usage-experiment`, and the splash-state file
continued updating in its original location. That boundary confirms the module
telemetry location, not telemetry collection or the splash writer, as the recurring
Turbopack trigger.

After measurement, the probe marker was restored to B, the dev process was stopped,
and no production source was changed.

## Task 3 production and test manifest

Production files:

- `scripts/dev.mjs`
- `packages/create-app/template/scripts/dev.mjs`

Regression-test files:

- create `scripts/__tests__/dev-module-resource-usage-dir.test.mjs`
- modify `packages/create-app/src/lib/template-dev-log-files.test.ts`

Documentation file:

- `apps/docs/docs/framework/operations/system-status.mdx`

The implementation must set a local-dev default for
`OM_MODULE_RESOURCE_USAGE_DIR` below the applicable app's
`.mercato/next/module-resource-usage` directory, before the app runtime, Next
server, scheduler, and worker are spawned. A non-empty user-provided
`OM_MODULE_RESOURCE_USAGE_DIR` must win unchanged.

The focused red assertion is:

```text
expected both managed dev wrappers to default OM_MODULE_RESOURCE_USAGE_DIR to
the app-local .mercato/next/module-resource-usage path while preserving an
explicit OM_MODULE_RESOURCE_USAGE_DIR override
```

Before implementation, the assertion fails because neither wrapper assigns the
variable. Task 3 must demonstrate that failure, implement the two mirrored script
changes, then make the focused test and existing create-app dev-wrapper tests pass.

## Compatibility and template obligations

- `yarn dev`, `yarn dev:classic`, and `yarn dev:verbose` keep their names and
  workflow. No CLI flag, generated export, import path, route, entity, event, ACL,
  DI key, or public type changes.
- `OM_MODULE_RESOURCE_USAGE_DIR` remains an explicit override. Only the managed
  local-dev default changes; production and callers outside the managed dev
  wrappers retain the shared library default.
- Snapshot payloads, atomic write semantics, cross-process aggregation, and system
  status reporting remain unchanged.
- `scripts/dev.mjs` and `packages/create-app/template/scripts/dev.mjs` are a
  required behavioral mirror. Neither `apps/mercato/src/app/**` nor an env-example
  file is touched, so no additional app-shell/env template pair is triggered.
- The public operations documentation must distinguish the shared default from the
  managed-dev default.

## Rollback

Remove the default environment injection from both dev wrappers and remove the
focused tests/documentation note. No data migration or cleanup is required.
Snapshots immediately return to `.mercato/module-resource-usage` on the next dev
start. Files already written below `.mercato/next` are disposable dev artifacts
and are cleared by the existing dev-cache reset flow.

## Intervention-specific acceptance

Task 3/4 must prove all of the following:

1. The focused test completes a red-green cycle and confirms standalone,
   monorepo-app, and explicit-override path resolution.
2. A standalone `yarn dev` run writes fresh snapshots below
   `.mercato/next/module-resource-usage`, and the system-status aggregation still
   reads sibling process snapshots.
3. A monorepo `yarn dev` smoke and a Verdaccio-backed standalone smoke both retain
   login, authenticated backend rendering, the original server PID, and one
   in-place source Fast Refresh.
4. No 180-second browser log contains a periodic sequence of three or more Fast
   Refresh rebuilds spaced four to six seconds apart after the intended edit.
5. Across three candidate runs, the median peak `next-turbopack` total is at least
   30% below 7,908.54 MB and the primary median total process-tree peak is at least
   30% below 10,094.50 MB (at most 7,066.15 MB).
6. The full repository and create-app validation gate in the specification passes.

The one-run experiment satisfies the attributed-component threshold but not the
primary total-process-tree threshold: 7,397.08 MB is 330.93 MB above the final
7,066.15 MB ceiling. Task 3 must not weaken the primary acceptance criterion or
claim completion from this experiment alone.
