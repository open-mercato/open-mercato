# Standalone development-memory root-cause attribution

Date: 2026-07-30

Status: **the current-dependency stable runtime composition misses the 30% memory
gate; no runtime control is selected for production. Its CPU reduction is parked
as verified follow-up evidence while one source-graph hypothesis is prepared.**

## Conclusion

**Authoritative stable-toolchain decision (2026-08-02): the current Next 16.2.11
composition does not provide a memory candidate.** Against the replacement
baseline median of **8,607.89 MB**, the isolated warmup arm peaked at **9,412.52
MB**, the composed telemetry/warmup/embedded-scheduler arm peaked at **9,046.49
MB**, and the one allowed lightweight-supervisor diagnostic peaked at **8,322.41
MB**. All miss the fixed **6,025.52 MB** ceiling. The composed and lightweight
arms reduced CPU core-seconds by **32.79%** and **30.97%**, respectively, but CPU
is not a substitute for the memory gate. No warmup, scheduler, supervisor,
dependency, manifest, or lockfile change is selected for the next implementation
task.

The next falsifiable direction is source-graph scoping. The retained fixture emits
`modules.app.generated.ts` at 855,779 bytes with 586 static imports and
`modules.bootstrap.generated.ts` at 155,026 bytes with 361 static imports. A
separate approved experiment must show that route-scoping those registries removes
enough first-route compiler work while preserving authentication, the protected
page, and in-place HMR. The stable-composition evidence and proposed boundary are
recorded below; the older historical attribution remains useful but is superseded
for production selection by this decision.

**The default module-resource telemetry snapshots written below
`.mercato/module-resource-usage/` were one real cause: they triggered repeated
five-second Turbopack invalidation and kept sustained `next-server` memory high.
Moving them below the ignored Next.js `distDir` removed that cadence and improved
median mean process-tree RSS by 32.89%. It did not reduce the mandatory peak.**

The corrected three-run production candidate regressed median total peak by 2.995%
and median maximum `next-turbopack` by 14.199%. Subsequent balanced controls locate
the remaining peak in first-route compilation owned by `next-server`; automatic
targeted warmup amplifies it, but even suppressing warmup misses both ceilings.
Telemetry relocation is therefore a valid branch implementation and hygiene fix,
not the final root cause or an accepted 30% peak candidate.

A later fixture-only composition combined that telemetry fix with Next
`16.3.0-preview.9`, suppressed automatic targeted warmup, and the existing
embedded-scheduler mechanism. Its globally audited replacement runs reduced
median total peak by **44.753182%** and median maximum `next-turbopack` by
**38.023580%**, passing both fixed ceilings with material headroom. This is accepted
historical measurement evidence, not an authorized production change: dependency
updates are prohibited, C5 was omitted, and the stable-toolchain rerun below
rejects the runtime/template controls as a memory candidate.

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

## Corrected Task 4 production-candidate result

The implemented telemetry relocation was rebuilt, republished to the isolated
Verdaccio registry, installed into the same retained fixture, and exercised in
three complete 180-second headed-browser runs. Login, the protected probe, marker
A-to-B Fast Refresh, original server PID continuity, background services, and the
new telemetry path all passed.

Raw reports:

- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/candidate-1.json`
- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/candidate-2.json`
- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/candidate-3.json`

| Run | Peak total | Mean total | Maximum `next-turbopack` | Peak `next-server` |
| --- | ---: | ---: | ---: | ---: |
| 1 | 10,611.17 MB | 6,656.76 MB | 9,272.87 MB | 8,833.23 MB |
| 2 | 10,396.86 MB | 5,657.47 MB | 9,031.45 MB | 8,411.98 MB |
| 3 | 9,758.31 MB | 6,329.72 MB | 8,929.55 MB | 7,926.23 MB |
| **Median** | **10,396.86 MB** | **6,329.72 MB** | **9,031.45 MB** | **8,411.98 MB** |

Against the corrected 10,094.50 MB total-peak and 7,908.54 MB class comparators,
the candidate regressed total peak by 302.36 MB (2.995%) and class peak by
1,122.91 MB (14.199%). It exceeded the 7,066.15 MB total ceiling by 3,330.71 MB
and the 5,535.978 MB class ceiling by 3,495.472 MB. Median mean improved 32.885%,
and median browser Fast Refresh count fell from 36 to 5 with no recurring
five-second sequence. The exact functional evidence and comparison math remain in
`.ai/runs/2026-07-30-standalone-dev-memory/verification.md` and the fixture's
`.mercato/dev-rss/browser/candidate-*` artifacts.

This corrected result supersedes the earlier one-run claim that the 30.40%
attributed reduction represented an accepted candidate.

## Post-Task 4 peak attribution

Lifecycle timestamps showed the automatic targeted warmup compiling `GET /login`,
`POST /api/auth/login`, and authenticated `GET /backend` before the controlled
browser. The first `/login` compile was the dominant phase.

### Acceptance-grade Node 24 warmup-suppression control

Because later exploratory shells drifted to Node 25.3.0, warmup suppression was
rerun under the required Node 24.13.1 contract. The executable directory was
prepended to `PATH` for the dev server, profiler, and headed browser. Before browser
traffic, every repeat's first profiler sample proved both the root command
`/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin/node ./scripts/dev.mjs` and the
Next launcher command `/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin/node
.../node_modules/next/dist/bin/next dev --turbopack`; browser evidence records the
same executable and `v24.13.1`.

An empty-cache preparatory seed completed hydrated login (HTTP 200), protected
probe rendering, genuine A-to-B HMR, and a 15-second settle. Its cache and 57-file
SHA-256 manifest are retained at
`/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/cache-snapshots/turbopack-node24-suppressed-seed-2026-07-31/`.
Each measured repeat was an exact clone of that untouched seed, retained normal
worker/scheduler topology, and ran the complete headed workflow for 180 seconds at
one-second intervals.

| Run | Raw report | Peak total | Maximum `next-turbopack` | HMR |
| --- | --- | ---: | ---: | ---: |
| 1 | `.mercato/dev-rss/experiment-node24-suppressed-repeat1.json` | 7,357.36 MB | 6,221.24 MB | 4.815 s |
| 2 | `.mercato/dev-rss/experiment-node24-suppressed-repeat2.json` | 7,920.43 MB | 7,288.54 MB | 6.316 s |
| 3 | `.mercato/dev-rss/experiment-node24-suppressed-repeat3.json` | 8,501.47 MB | 6,914.57 MB | 3.811 s |
| **Median** | — | **7,920.43 MB** | **6,914.57 MB** | **4.815 s** |

The Node 24 median misses the 7,066.15 MB total ceiling by 854.28 MB and the
5,535.978 MB class ceiling by 1,378.592 MB. This is the formal suppression result:
automatic warmup is an amplifier, but removing it is not sufficient. Matching
browser evidence is in `experiment-node24-suppressed-repeat1-browser.json`,
`experiment-node24-suppressed-repeat2-retry-browser.json`, and
`experiment-node24-suppressed-repeat3-browser.json`. The first repeat-2 navigation
was transiently aborted after login HTTP 200 and is retained separately as invalid
evidence.

### Node 25 directional warmup attribution

A balanced warm-seed sequence used the same retained A2 Turbopack seed and palindromic order
`suppressed → login-only → full → full → login-only → suppressed`; every arm ran
the full 180-second workflow with normal topology and genuine A-to-B HMR.

Artifact inspection found that these six follow-up process trees used Node 25.3.0,
whereas the required baseline/candidate runtime contract used Node 24.13.1. The six arms
are internally balanced and support relative warmup attribution, but their absolute
values are not acceptance-equivalent to the Node 24 baseline. Ceiling deltas below
are directional guardrails, not a replacement acceptance run.

Raw reports:

- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/experiment-warm-seed-s1-suppressed.json`
- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/experiment-warm-seed-s2-suppressed.json`
- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/experiment-warm-seed-l1-login-only.json`
- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/experiment-warm-seed-l2-login-only.json`
- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/experiment-warm-seed-f1-full.json`
- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/experiment-warm-seed-f2-full.json`

| Warmup mode | Median peak total | Median mean total | Median maximum `next-turbopack` | Median maximum `next-server` |
| --- | ---: | ---: | ---: | ---: |
| Suppressed | **9,104.50 MB** | 7,608.97 MB | **7,470.41 MB** | **6,898.57 MB** |
| Login only | 9,265.74 MB | 6,983.29 MB | 8,259.28 MB | 7,819.54 MB |
| Full | 11,033.66 MB | 7,530.15 MB | 9,755.57 MB | 9,224.11 MB |

Login-only added 161.24 MB total, 788.87 MB class, and 920.97 MB server RSS over
suppression. Full warmup added 1,929.16 MB total, 2,285.16 MB class, and
2,325.55 MB server RSS. Suppression is the decisive directional warmup winner. Its
absolute ceiling deltas are not formal evidence; the acceptance conclusion comes
from the Node 24 repeats above.

The exact A2 seed is retained at
`/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/cache-snapshots/turbopack-clean-a2-seed-2026-07-31/`
with its manifest and metadata.

## Falsified current-stack interventions

All valid rows retained the real server, normal worker/scheduler topology,
authentication, protected rendering, and in-place HMR. Invalid rows were stopped
at the first functional or compiler failure and are not treated as memory wins.
Artifact process trees divide into two runtime groups. The following complete
inventory was checked from each report's root and Next-launcher commands:

- **Node 24.13.1, protocol-valid:** `correlation-normal-warmup`,
  `experiment-warmup-suppressed-shift`, request-scoped backend manifest, UI direct
  imports, ClientBootstrap profile, lazy ComponentOverrides, minimal transpile,
  webpack, both source-map runs, both server-externalization runs, old-space 3072,
  both CPU-limit runs, C5 lightweight supervisor, both embedded-scheduler runs,
  and Turbopack memory-limit run 1, plus the corrective seed and three repeats.
- **Node 25.3.0, directional only:** Turbopack memory-limit run 2, both filesystem-
  cache-off runs, clean-cache ABBA A1/B1/B2/A2, warm-seed S1/L1/F1/F2/L2/S2, and
  the minification seed. The graph-pruning and unused-import aborts have no JSON
  report, but retained dev logs and panic artifacts also record Node 25.

| Intervention | Runtime | Evidence | Outcome |
| --- | --- | --- | --- |
| C5 lightweight `server dev` supervisor | Node 24, valid | `.mercato/dev-rss/experiment-lightweight-supervisor.json` | Supervisor saved 58.70 MB max and 91.83 MB mean locally, but the valid tree peaked at 11,911.67 MB total / 10,436.75 MB class. Too small; total peak regressed. |
| Scheduler embedded in shared worker | Node 24, valid | `.mercato/dev-rss/experiment-embedded-scheduler-run1.json`<br>`.mercato/dev-rss/experiment-embedded-scheduler-run2.json` | Direct combined-process savings of 95–163 MB max and 298–332 MB mean; full-tree peaks were 12,296.74 and 11,610.16 MB. Falsified. |
| Native 4 GiB Turbopack memory limit | Mixed: run 1 Node 24; run 2 Node 25 directional | `.mercato/dev-rss/experiment-turbopack-memory-limit-4g-run1.json`<br>`.mercato/dev-rss/experiment-turbopack-memory-limit-4g-run2.json` | 11,323.87 and 13,413.26 MB peaks; neither showed limit enforcement, eviction, OOM, or useful reduction. |
| Filesystem cache disabled | Node 25, directional | `.mercato/dev-rss/experiment-turbopack-filesystem-cache-off-run1.json`<br>`.mercato/dev-rss/experiment-turbopack-filesystem-cache-off-run2.json` | 12,467.45 and 13,161.36 MB peaks. The store still changed; disabling did not reduce peak. |
| Empty-cache ABBA, cache ON/OFF | Node 25, directional | `.mercato/dev-rss/experiment-clean-cache-abba-a1-on.json`<br>`.mercato/dev-rss/experiment-clean-cache-abba-a2-on.json`<br>`.mercato/dev-rss/experiment-clean-cache-abba-b1-off.json`<br>`.mercato/dev-rss/experiment-clean-cache-abba-b2-off.json` | ON median 13,528.16 MB total / 12,711.00 MB class; OFF median 14,245.77 / 13,567.42. OFF worsened peaks by 5.30% / 6.74%. |
| Server + Turbopack minification | Node 25, invalid | `.mercato/dev-rss/experiment-dev-minification-seed.json` | Auth returned 500 with MikroORM `Multiple property decorators used on 'b.role'`; partial cold peak 10,619.83 MB. No matched repeats. |
| Tree shaking + unused imports/exports | Node 25, invalid | `.mercato/dev-rss/cache-snapshots/turbopack-graph-pruning-failed-seed-2026-07-31/` | Repeated Rust `tree_shake/graph.rs:743` out-of-bounds panics during instrumentation compilation. |
| Unused-import removal alone | Node 25, invalid | `.mercato/dev-rss/cache-snapshots/turbopack-unused-imports-failed-seed-2026-07-31/` | Next 16.2.11 requires unused-export removal to be enabled with it; two retained panic logs. |

Clean-cache ABBA proves the accumulated 10+ GiB filesystem cache is a variance
source, not the missing fix: cold runs are worse, and disabling the cache increases
median peak. Minification and graph-pruning flags cannot be shipped on the current
stack because they break correctness or crash Turbopack.

## Historical Next 16.2 findings and preview boundary

No tested source/config intervention on Next 16.2.x satisfies both peak ceilings.
The [current npm release tags](https://www.npmjs.com/package/next?activeTab=versions)
identify Next 16.2.12 as `latest`, and the published stable change set contains no
documented backport of the 16.3 Turbopack memory work. The 16.3 line is still
distributed as preview/canary (for example `16.3.0-preview.9` and
`16.3.0-canary.97`), as verified on 2026-07-31 in the
[upstream release stream](https://github.com/vercel/next.js/releases).

### Fixture-only Next 16.3 preview diagnostic

An approval-safe diagnostic installed `next`, `@next/env`, and
`@next/swc-darwin-arm64` at `16.3.0-preview.9` only inside the disposable fixture.
React and React DOM remained `19.2.7`, within the preview's peer range. The
operator launched the dev, profiler, and browser commands with Node 24.13.1 pinned;
first samples independently proved the root and Next-launcher paths,
`next-server` reported the preview version, and browser artifacts independently
reported the same pinned Node executable. The retained package-state manifest at
`.mercato/dev-rss/evidence/preview9-package-and-restoration-manifest.txt` records
the exact preview package versions and package-file hashes.

An empty-cache suppressed-warmup seed passed normal-topology startup, hydrated
login HTTP 200, protected probe rendering, A-to-B HMR in 3.799 seconds, and a
15-second settle. Its 50-file cache manifest is retained at
`/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/cache-snapshots/turbopack-preview9-node24-suppressed-seed-2026-07-31/`.
Three exact clones then ran for 180 seconds at one-second intervals:

| Run | Peak total | Maximum `next-turbopack` | Artifacts ready | Login page / auth / probe | HMR |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 7,105.71 MB | 5,813.98 MB | 4.2 s | 1.092 / 1.808 / 2.697 s | 2.291 s |
| 2 | 6,018.39 MB | 4,893.18 MB | 4.6 s | 1.152 / 1.925 / 2.722 s | 2.291 s |
| 3 | 7,047.67 MB | 5,764.74 MB | 4.1 s | 1.052 / 1.665 / 2.537 s | 1.792 s |
| **Median** | **7,047.67 MB** | **5,764.74 MB** | **4.2 s** | — | **2.291 s** |

Raw profiler reports are
`/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/experiment-preview9-node24-suppressed-repeat{1,2,3}.json`; matching browser evidence is under
`.mercato/dev-rss/browser/experiment-preview9-node24-suppressed-repeat{1,2,3}-browser.json`.
All runs retained login, protected rendering, normal workers/scheduler, and genuine
HMR. There were no native/runtime failures; the only failed responses were the two
expected pre-login feature checks returning 401 in each browser run.

The primary median is 3,046.83 MB (30.183%) below the 10,094.50 MB comparator and
passes the 7,066.15 MB ceiling by only 18.48 MB. The secondary class median remains
228.762 MB above its 5,535.978 MB ceiling. This is a high-signal diagnostic, not a
production acceptance result: the primary margin is within observed run variance,
the secondary target still fails. No production manifest, lockfile, or runtime
source was changed. The retained restoration manifest verifies the fixture back at
Next/SWC 16.2.11 and React 19.2.7, with the original package/lock/runtime hashes,
all 8,291 Next/@next file hashes, and all 790 original cache hashes passing.

That preview-only result did not authorize production promotion. The completed
fixture-only composition is retained below as historical evidence, followed by
the authoritative stable-toolchain no-selection decision; no earlier C5/scheduler
saving is assumed additive.

### Historical fixture-only composed diagnostic

The final fixture-only composition retained the branch telemetry fix and added
Next/`@next/env`/Darwin ARM64 SWC `16.3.0-preview.9`, React/React DOM `19.2.7`,
temporary targeted-warmup suppression, and
`OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER=true`. **C5 was omitted** because its
exact temporary patch was not preserved; no C5 saving is treated as additive.

The first composition ledger was re-audited after a reviewer found worker PID
18017 surviving from run 3 until 2026-08-02. It is not acceptance evidence:

| Run | Disposition | Reason |
| --- | --- | --- |
| 1 | Superseded | Graceful log existed, but not the later required bounded global process/listener audit. |
| 2 | Invalid | More than one browser pass after an stdin-timing correction. |
| 3 | Invalid | Embedded worker PID 18017 survived beyond profiler completion. |
| 4 | Invalid | Environment was contaminated by the surviving run-3 worker. |
| 5 | Accepted | Clean pre-audit; one browser pass; full profile; clean post-audit. |
| 6 | Accepted | Clean pre-audit; one browser pass; full profile; clean post-audit. |
| 7 | Accepted | Clean pre-audit; one browser pass; full profile; clean post-audit. |

Runs 5–7 each cloned the verified 50-file preview seed and ran `180000` ms at a
`1000` ms interval. Before every start, a global audit proved zero matching
fixture/dev/profiler/browser/worker/scheduler processes and no listeners on ports
3000/4000. After `Ctrl-C`, logs showed scheduler polling stopped and the embedded
worker closed; a bounded audit then proved the same global zero state before the
next run. Retained audit and executable-path proofs are under
`.mercato/dev-rss/evidence/clean-composed-reruns/`.

| Run | Profiler report | Samples | Peak total | Mean total | Maximum `next-turbopack` | Worker max / mean | Login / auth / probe / HMR |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-embedded-scheduler-repeat5.json` | 173 | 5,333.13 MB | 3,641.38 MB | 4,394.88 MB | 450.84 / 345.69 MB | 0.375 / 1.393 / 2.954 / 10.337 s |
| 6 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-embedded-scheduler-repeat6.json` | 173 | 5,945.74 MB | 4,797.10 MB | 4,901.43 MB | 443.45 / 441.17 MB | 0.951 / 1.885 / 2.626 / 11.842 s |
| 7 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-embedded-scheduler-repeat7.json` | 173 | 5,576.89 MB | 5,028.49 MB | 4,944.89 MB | 383.75 / 380.25 MB | 1.100 / 1.855 / 2.369 / 12.858 s |
| **Median** | — | — | **5,576.89 MB** | **4,797.10 MB** | **4,901.43 MB** | **443.45 / 380.25 MB** | — |

The artifact prefix is `/private/tmp/open-mercato-standalone-memory-baseline/`;
matching single-pass browser JSON uses the same labels under
`.mercato/dev-rss/browser/`. The launch ledgers retain `lsof` text-executable
proof that each profiler used Node `24.13.1`; browser JSON and process listings
independently prove Node 24 for the browser and dev topology. Each run retained
one `queue worker --all --with-scheduler`, no scheduler child, login HTTP 200,
protected A-to-B rendering, repeated schedule execute/enqueue/complete/consume
lifecycles, and only the two expected pre-login feature-check 401s.

The accepted total median is 4,517.61 MB (**44.753182%**) below 10,094.50 MB and
passes the 7,066.15 MB ceiling by 1,489.26 MB. The class median is 3,007.11 MB
(**38.023580%**) below 7,908.54 MB and passes 5,535.978 MB by 634.548 MB. Against
the preview-only separate worker-plus-scheduler topology, median maximum falls
1,019.72→443.45 MB (576.27 MB / **56.51%**) and median mean falls
684.75→380.25 MB (304.50 MB / **44.47%**).

#### Production disposition

No production code changed for this preview composition. The later user constraint
prohibits dependency and lockfile changes, and the stable-toolchain rerun below
rejects the runtime controls as a memory candidate. Therefore none of the former
preview/runtime files or tests is selected for production.

## Stable-toolchain composition decision — 2026-08-02

The tested hypothesis was:

> Watched telemetry snapshots plus automatic authenticated route warmup and a
> separate scheduler process cause avoidable compile invalidation, startup work,
> and process overhead; relocating telemetry, skipping automatic warmup, and
> embedding scheduler polling should reduce total RSS and CPU while preserving the
> user-driven first compile and scheduler behavior.

Every accepted run used Node 24.13.1, installed Next/`@next` 16.2.11 and React
19.2.7, the same 5,629-file seed with canonical digest
`27ed25b9dacd68c8b8f249086e4bb2e7b6096638e573ff99cfb75ac627a422ae`,
the same marker-A hash
`8672e3cd23e43756f1a885b20724915c98110fff70a7c26da3cd756dcf516a6b`,
and the fixed authenticated page/edit/HMR workflow. The replacement baseline
medians are 8,607.89 MB peak RSS, 6,643.70 MB mean RSS, 130.24 CPU core-seconds,
72.43% mean CPU, and 876.91% peak sampled CPU. Its hard 30% ceiling is 6,025.52
MB.

| Accepted arm | Peak RSS | Mean RSS | CPU core-s | Mean CPU | Peak CPU | Peak RSS vs baseline | CPU core-s vs baseline |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Isolated warmup suppression; original telemetry and separate scheduler/shared worker | 9,412.52 MB | 7,045.96 MB | 124.52 | 69.17% | 900.47% | +804.63 MB (+9.35%) | -5.72 (-4.39%) |
| Telemetry relocation + warmup suppression + embedded scheduler | 9,046.49 MB | 7,452.67 MB | 87.54 | 48.91% | 927.90% | +438.60 MB (+5.10%) | -42.70 (-32.79%) |
| Lightweight supervisor diagnostic with the composed controls | 8,322.41 MB | 6,946.07 MB | 89.90 | 49.83% | 816.89% | -285.48 MB (-3.32%) | -40.34 (-30.97%) |

The isolated arm is retained in
`.mercato/dev-rss/stable-composition-telemetry-warmup.json`; its validity envelope
is under `.mercato/dev-rss/evidence/stable-composition/`. It ran 180,002 ms with
173 samples, issued zero automatic warmup requests, wrote the `warmup-skipped`
ready reason, retained one separate scheduler and one shared worker, passed the
browser/identity/audit gates, and made memory worse.

The composed arm is retained as
`.mercato/dev-rss/stable-composition-embedded-scheduler.json`. It ran 180,001 ms
with 172 samples, wrote two fresh telemetry files below
`.mercato/next/module-resource-usage`, retained exactly one
`queue worker --all --with-scheduler` and no scheduler child or separate shared
worker, and logged one scheduler polling start/stop plus six complete
execute/enqueue/consume/complete cycles. Marker A appeared at T+74,235, marker B
at T+111,674 after the T+100 edit, and the same Next PID/start survived through
the independent T+140,103 identity capture. It misses the memory ceiling by
3,020.97 MB even though CPU core-seconds improved by 32.79%.

Because the composed arm missed the gate, the plan allowed one lightweight-
supervisor run. The retained runtime envelope was initially rejected only because
the coordinator applied the warmup arm's telemetry-root predicate to the
`lightweight` label. The reconciliation script recomputed that predicate from the
retained launch time and fresh telemetry files, then reasserted every unchanged
gate. The corrected validity envelope is
`.mercato/dev-rss/evidence/stable-composition/stable-composition-lightweight-supervisor-validity.json`;
the original harness-error envelope remains beside it. The arm saves 724.08 MB
peak and 506.60 MB mean RSS versus the composed arm, but still misses the hard
ceiling by 2,296.89 MB. It also requires bypassing standard `yarn dev`, so it is a
diagnostic, not a shippable default under the approved no-manifest-change scope.

One warmup prelaunch and two composed attempts are excluded from all comparisons:
the warmup prelaunch was withdrawn before the dev spawn after the copied
coordinator resolved the seed from the wrong directory; one composed attempt had
no browser action inside the required window; and one observed marker A only after
the edit. Their evidence is preserved with `withdrawn` labels, and every post-
withdrawal audit passed.

### Exact production selection

- Selected runtime controls: **none**.
- Selected production files for the next implementation task: **none**.
- Selected regression-test files for the next implementation task: **none**.
- New or changed environment defaults: **none**.
- Rollback: **none required**, because every runtime/source experiment was
  fixture-only and restored.
- Existing branch state: the previously implemented Task 3 telemetry relocation
  remains unchanged as rebuild/sustained-memory hygiene; it is not a newly
  selected Task 5 control and is not claimed to satisfy the peak-memory goal.
- Parked follow-up: the embedded and lightweight arms' roughly 30–33% CPU-work
  reductions may be reconsidered only after a memory candidate exists; they must
  not be presented as satisfying the memory goal.

The next implementation task must not apply warmup, embedded-scheduler, or
lightweight-supervisor defaults from these results.

### Next source-graph hypothesis and bounded proposed boundary

The next single hypothesis is that first-route Turbopack memory is dominated by
the two broad generated module registries: `modules.app.generated.ts` is 855,779
bytes with 586 static imports, and `modules.bootstrap.generated.ts` is 155,026
bytes with 361, for 947 static imports total. Route-scoped additive loaders should
keep unrelated module entrypoints out of the initial server bootstrap and client
app graph while preserving the existing generated filenames, `modules` exports,
default exports, and `bootstrapModules` compatibility alias.

This is a proposal for a separate measured architecture decision, not a selected
Task 5 manifest. Read-only inspection bounds that proposal to:

| Role | Proposed file/test boundary | Required proof before production selection |
| --- | --- | --- |
| Generator | `packages/cli/src/lib/generators/module-registry.ts` | Emit additive route-scoped loader output without renaming or removing current registries/exports. |
| Server app/template consumers | `apps/mercato/src/bootstrap.ts`; `packages/create-app/template/src/bootstrap.ts` | Consume the scoped server loader with exact app/template parity. |
| Client app/template consumers | `apps/mercato/src/app/start/page.tsx`; `packages/create-app/template/src/app/start/page.tsx` | Consume the scoped client loader while preserving the `/start` behavior. |
| Generator tests | `packages/cli/src/lib/generators/__tests__/module-subset.test.ts`; `packages/cli/src/lib/generators/__tests__/structural-contracts.test.ts`; `packages/cli/src/lib/generators/__tests__/output-snapshots.test.ts` | Prove the route-scoped import boundary plus legacy filename/export compatibility. |
| Consumer/parity tests | `apps/mercato/src/__tests__/bootstrap.test.ts`; create `packages/create-app/src/lib/template-route-scoped-registries.test.ts` | Prove server selection and exact monorepo/template wiring parity. |

A fixture-only arm is accepted for promotion to the three-run candidate sequence
only if it passes the same seed, Node, browser, scheduler, telemetry, identity,
HMR, shutdown, and audit gates and reaches at most 6,025.52 MB peak RSS. A result
above that ceiling rejects this hypothesis for the current goal even if it is a
directional improvement. Any need to touch shared bootstrap internals, catch-all
route contracts, generated filenames/exports, or files outside the boundary above
requires a new architecture decision before editing them.

## Stable composition restoration audit

The fixture was restored to package hash
`b7f1aba393d1841e2c719efeb7478d7027fcd9d22f73d01f7fc3140e52dc7c84`,
lockfile hash
`94cd39654752c9cfb73dce51def0475cac02d0facc137c101744f91e24a851be`,
`scripts/dev.mjs` hash
`78b4b94d3dd2d5d855ae001ee3b2e5849e55392764c8f5f2566838f73180cac4`,
`scripts/dev-runtime.mjs` hash
`e15fa5b889afc1e3b2474da92113441a9d967c1632eac71226723b4622bfa354`,
and marker A. Installed Next/`@next` is 16.2.11 and React/React DOM is 19.2.7.
The final audit at `2026-08-02T17:53:19.403Z` found zero matching fixture,
profiler, browser-controller, worker/scheduler processes and zero listeners on
ports 3000/4000. The worktree dependency/manifest/lockfile diff is empty.

## Historical preview restoration audit

After the composed experiment, the fixture was restored with marker B, normal
targeted-warmup behavior, no dev/profiler/browser tree, and its exact baseline
package, lockfile, dependency, and compiler-cache state. The verified hashes are:

- `next.config.ts`: `dd017fb4c340741a1801021883832644fc624c2159d4a181b87b952fe4d9a30a`
- `scripts/dev-runtime.mjs`: `e15fa5b889afc1e3b2474da92113441a9d967c1632eac71226723b4622bfa354`
- installed CLI `dist/mercato.js`: `1ab1296c0662b75263b2dd1141cca44178781c8603ec3b8c4c1c2b7f60a155fd`
- probe marker B: `bb1b3f26a3d4caf75ac8c7f84a5b4059aa80b362307e841a0133c9b8aae0b2ac`

All 790 original Turbopack cache hashes passed their retained SHA-256 manifest.
The preserved fixture manifest, the separate Yarn-state hash, and all 8,291
Next/@next file hashes also passed. Installed versions are again Next,
`@next/env`, and Darwin ARM64 SWC `16.2.11`, with React/React DOM `19.2.7`.
The final global audit at `2026-08-02T13:49:06Z` found no matching fixture
processes and no listeners on ports 3000/4000; its retained ledger is
`.mercato/dev-rss/evidence/clean-composed-reruns/final-restoration-audit.txt`.
The original accumulated cache, Node 24 suppression seed, A2 Node 25 warm seed,
and invalid compiler caches remain separate; none was promoted into the restored
working cache.

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
