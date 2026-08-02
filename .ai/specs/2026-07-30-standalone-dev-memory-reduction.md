# Standalone Dev-Mode Memory Reduction

## TLDR

Reduce the median peak process-tree RSS of a freshly scaffolded standalone Open
Mercato app by at least 30% without weakening the real developer workflow.

The accepted result must be demonstrated across three equivalent baseline and
candidate runs. Every run starts `yarn dev`, authenticates as the default super
administrator, visits an authenticated backend page, changes a standalone module
source file, observes hot reload without a server restart, and retains a profiler
report.

**Current outcome (2026-08-02): fixture measurement accepted; production change
not yet authorized.** The telemetry relocation implemented on this branch removes
recurring five-second rebuilds and lowers sustained RSS. A later fixture-only
composition of that fix with Next `16.3.0-preview.9`, suppressed automatic targeted
warmup, and the existing embedded-scheduler mechanism passes both 30% peak gates
across three valid single-browser-pass runs. C5 was omitted. Promoting the preview
pins and runtime/template defaults remains an explicit approval boundary.

This capability is intentionally separate from the monorepo profiling harness in
`.ai/specs/2026-05-27-dev-mode-memory-quick-wins.md`. It reuses that harness through
its public `--pid` seam but owns standalone fixture creation, workflow automation,
root-cause attribution, implementation, and acceptance evidence.

## Overview

Standalone applications are the first-run and day-to-day development environment
for users of `create-mercato-app`. Their memory profile differs materially from the
monorepo: they consume published package output, have no workspace package watch
farm, and compile an application graph generated from installed module packages.

The target audience is an Open Mercato developer using a workstation where
Turbopack compilation competes with the database, browser, editor, and other local
services. The outcome is a lower peak during the complete workflow rather than an
idle-only or artificially capped process.

### Market reference

The official Next.js 16.2 documentation treats Turbopack as the default development
bundler and Webpack as the supported fallback. It documents
`serverExternalPackages` as the stable mechanism for excluding eligible
server-only dependencies from Server Component bundling. It also states that
Turbopack already analyzes package imports, so `experimental.optimizePackageImports`
is not a general Turbopack memory lever. The design therefore keeps Turbopack,
measures the actual module graph, and tests externalization or graph deferral only
when the peak attribution supports it.

## Problem Statement

The existing dev-memory work measures the monorepo runtime and has removed large
workspace watcher overhead. A standalone app does not run that same process model,
so monorepo savings do not prove the generated app is efficient.

The missing evidence is a reproducible standalone before/after comparison that
includes the expensive user-visible phases:

- cold dev-server startup;
- login and tenant-aware authenticated routing;
- first backend compilation and render;
- file watching, regeneration, recompilation, and hot reload after a module edit.

A heap ceiling, idle-only snapshot, synthetic route, failed warmup, or missing hot
reload can produce a lower number without improving the developer experience.

## Proposed Solution

Create one Verdaccio-backed standalone fixture from current repository packages and
use it for both baseline and candidate measurements. Sample the complete `yarn dev`
process tree externally with the existing profiler. Drive one deterministic browser
scenario and repeat it three times from full dev restarts.

After the baseline, identify the repeatable dominant process and peak lifecycle
phase. Inspect only code and generated artifacts reachable from that phase. State
one falsifiable hypothesis, test it with a reversible experiment, and implement
the confirmed root-cause fix test-first. Do not stack speculative optimizations.

The primary calculation is:

```text
reduction = (baseline median peak RSS - candidate median peak RSS)
            / baseline median peak RSS
```

Acceptance requires `reduction >= 0.30`.

### MVP boundary

The MVP is all four phases in this specification: one reproducible baseline, one
confirmed root-cause intervention, one minimal test-first implementation, and one
accepted three-run candidate result. Baseline and attribution alone are not the
requested deliverable, and a production change without the three-run acceptance
result is not complete. Tasks 1–4 completed the workflow but the initial telemetry
candidate failed the final peak gate. The later fixture-only composition passes the
measurement gate; the MVP remains open until its approval-gated production scope
is implemented and validated rather than treating fixture edits as shipped behavior.

Deferred work includes a permanent CI memory-regression gate, a reusable browser
scenario package, other operating systems, broader route matrices, and every
optimization family not selected by the baseline evidence. Those candidates do
not enter the MVP merely because they appear in the risk register or an existing
research branch.

### Design decisions

| Decision | Rationale |
|----------|-----------|
| Median of three peak-RSS runs | Limits ordinary page-cache and timing noise while retaining the workstation-impacting peak. |
| External profiler attached by PID | Keeps measurement-only code out of the generated template and samples the full process tree. |
| Same fixture for baseline and candidate | Holds module set, database, route, edit, and application data constant. |
| Functional gates on every run | Prevents false savings caused by failed compilation, warmup, login, rendering, watching, or hot reload. |
| One hypothesis at a time | Makes the causal contribution observable and avoids an unreviewable bundle of guesses. |

### Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| V8 `--max-old-space-size` cap | Can replace memory pressure with compilation OOMs and does not remove root-cause work. |
| Webpack dev fallback | Officially supported, but not selected without evidence; Next.js recommends Turbopack for local performance. |
| `experimental.optimizePackageImports` list | Official Next.js guidance says Turbopack already analyzes imports; not a default intervention. |
| Preview/canary Next.js release | Fixture diagnostics are allowed; production promotion requires explicit dependency approval and the full validation gate. |
| Idle-only RSS | Misses the backend compile and hot-reload peaks the user experiences. |
| Import an existing research branch wholesale | Would combine multiple unproven changes and obscure attribution. |

## User Stories / Use Cases

- As a standalone-app developer, I want `yarn dev` to use materially less memory so
  my workstation does not swap or terminate the dev server.
- As a standalone-app developer, I want the optimization to preserve login,
  backend navigation, module watching, regeneration, and hot reload.
- As a maintainer, I want raw profiler reports and deterministic steps so the
  result can be reproduced and future regressions can be diagnosed.

## Architecture

```text
repository packages ──publish──> local Verdaccio
       │                              │
       │                              └──scaffold/install──> standalone fixture
       │                                                       │
profiler --pid <yarn-dev-pid> ──samples full process tree──────┤
                                                               │
browser scenario ──login/page/edit/HMR assertions──────────────┘
```

### Measurement contract

Each baseline and candidate run uses:

- the same machine and standalone directory;
- the same installed dependency versions;
- the same initialized database and background-service settings;
- the same backend route and module source edit;
- a 1-second sampling interval and a 180-second sampling duration;
- a full restart of the `yarn dev` process tree.

Reports are written under the standalone fixture's `.mercato/dev-rss/` directory.
They are runtime artifacts and are not committed. The run record commits the raw
summary values, exact commands, browser evidence, and comparison math.

### Runtime workflow

1. Start `yarn dev` and record its root PID.
2. Attach `scripts/profile-dev-rss.mjs --pid <pid>`.
3. Wait for the standalone dev runtime to report ready.
4. Open the app in a real browser and authenticate with the default super
   administrator fixture.
5. Visit the selected authenticated backend route.
6. Change a visible marker in a source file below the app's `src/modules/`.
7. Assert that the browser displays the changed marker without restarting the
   server and that the original server PID remains alive.
8. Stop the process tree cleanly and retain the report.

The fixed probe is the app-local `memory_probe` module at
`src/modules/memory_probe/`. Its authenticated page route is
`/backend/memory-probe`, and each run changes the page marker from
`Baseline marker A` to `Baseline marker B`.

### Root-cause gate

No production file changes before the baseline evidence identifies:

- the repeatable dominant process class;
- the peak sample and nearest lifecycle phase;
- the top processes at peak;
- the generated or source graph reachable during that phase;
- one falsifiable cause and one minimal experiment.

The exact production and test file manifest is written to the run folder before
implementation.

Production implementation must not begin until the spec is amended with:

- the confirmed hypothesis and measured experiment delta;
- the exact production and regression-test files;
- affected contract surfaces and template-sync obligations;
- the focused failing assertion;
- rollback mechanics;
- intervention-specific acceptance criteria;
- an updated compliance report covering every newly relevant `AGENTS.md`.

### Phase 2 telemetry sub-cause amendment — confirmed 2026-07-30

The confirmed hypothesis is:

> The default module-resource telemetry snapshots written below
> `.mercato/module-resource-usage/` cause repeated Turbopack invalidation and
> retained `next-server` memory during standalone development because the active
> Next.js project watches that app-root path, the snapshots are atomically replaced
> at a five-second throttle, and moving only those snapshots below the already
> ignored Next.js `distDir` removed the five-second Fast Refresh cadence while
> reducing the attributed peak by 30.40%.

All three baseline peaks were `next-turbopack` dominated. Their peak class totals
were 7,908.54 MB, 7,689.89 MB, and 8,101.76 MB, with `next-server (v16.2.11)` using
7,330.03 MB, 7,051.50 MB, and 7,468.78 MB. Each retained browser console recorded
exactly 36 Fast Refresh rebuilds in its first 180 seconds, including the initial
route work and the one intended edit; the remainder continued at an approximately
five-second cadence.

The generated graph is reachable at the peak:
`backend-routes.generated.ts` is 113,487 bytes with 80 static imports,
`modules.app.generated.ts` is 855,779 bytes with 586, and
`modules.bootstrap.generated.ts` is 155,026 bytes with 361. Their mtimes remained
content-stable after the initial generator pass. The recurring writer was
`packages/shared/src/lib/modules/resource-usage.ts`, whose default snapshot path is
inside the app root and whose atomic snapshot replacement is throttled to 5,000 ms.

The first reversible hypothesis disabled the compact splash state with
`OM_DEV_SPLASH_PORT=off`; periodic rebuilds continued, so it was rejected. The
confirmed experiment instead kept the normal splash and set only:

```text
OM_MODULE_RESOURCE_USAGE_DIR=.mercato/next/module-resource-usage-experiment
```

The equivalent 180-second standalone workflow produced:

| Metric | Baseline comparator | Experiment | Delta |
| --- | ---: | ---: | ---: |
| Peak total RSS | 10,094.50 MB | 7,397.08 MB | -26.72% |
| Mean total RSS | 9,431.21 MB | 6,819.47 MB | -27.69% |
| Peak `next-turbopack` | 7,908.54 MB | 5,503.97 MB | -30.40% |
| Peak `next-server` | 7,330.03 MB | 5,204.11 MB | -29.00% |
| Fast Refresh rebuilds in 180 seconds | 36 per run | 3 | -91.67% |

The three experiment rebuilds were initial route work, the intended edit, and one
non-periodic residual rebuild. Telemetry snapshots continued updating below
`.mercato/next`, the splash-state file continued updating in its original
location, the marker updated in place, and the server PID survived. The full
evidence is in
`.ai/runs/2026-07-30-standalone-dev-memory/root-cause.md`.

#### Exact Task 3 manifest

Production:

- `scripts/dev.mjs`
- `packages/create-app/template/scripts/dev.mjs`

Regression tests:

- create `scripts/__tests__/dev-module-resource-usage-dir.test.mjs`
- modify `packages/create-app/src/lib/template-dev-log-files.test.ts`

Documentation:

- `apps/docs/docs/framework/operations/system-status.mdx`

The implementation sets the managed local-dev default
`OM_MODULE_RESOURCE_USAGE_DIR` to the applicable app-local
`.mercato/next/module-resource-usage` directory before runtime children spawn. A
non-empty explicit value always wins.

The focused pre-fix failure is:

```text
expected both managed dev wrappers to default OM_MODULE_RESOURCE_USAGE_DIR to
the app-local .mercato/next/module-resource-usage path while preserving an
explicit OM_MODULE_RESOURCE_USAGE_DIR override
```

#### Affected contracts, template parity, and rollback

The stable `yarn dev` command and the existing `OM_MODULE_RESOURCE_USAGE_DIR`
configuration surface are affected behaviorally but not renamed or narrowed.
Snapshot payloads, atomic writes, system-status aggregation, generated exports,
routes, imports, types, entities, events, ACL features, and DI keys are unchanged.
Production and non-managed runtimes retain the shared library default.

`scripts/dev.mjs` and `packages/create-app/template/scripts/dev.mjs` must be
changed together. No `apps/mercato/src/app/**` or env-example file is touched, so
no additional app-shell/env template pair is required.

Rollback removes the default injection from both wrappers and the focused
tests/documentation note. There is no migration. On the next dev start snapshots
return to `.mercato/module-resource-usage`; files below `.mercato/next` are
disposable and already covered by dev-cache reset.

#### Intervention-specific acceptance

- The focused test completes a red-green cycle for standalone, monorepo-app, and
  explicit-override resolution.
- Managed dev writes fresh snapshots below
  `.mercato/next/module-resource-usage`, and system status still aggregates sibling
  process snapshots.
- Monorepo and Verdaccio-backed standalone smokes retain login, authenticated
  backend rendering, the original server PID, and in-place source Fast Refresh.
- No candidate browser log contains three or more post-edit Fast Refresh rebuilds
  spaced four to six seconds apart.
- The three-run candidate median peak `next-turbopack` total is at least 30% below
  7,908.54 MB.
- The unchanged primary gate also passes: median total process-tree peak is at
  least 30% below 10,094.50 MB, or at most 7,066.15 MB.

The one-run experiment is not final acceptance: 7,397.08 MB is 330.93 MB above the
primary total-process-tree ceiling.

### Task 4 correction and follow-up attribution — 2026-07-31

The telemetry relocation passed its functional and path assertions but failed the
unchanged peak gates in three rebuilt, republished, fixture-equivalent runs:

| Run | Raw report | Peak total | Mean total | Maximum `next-turbopack` | Peak `next-server` |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | `.mercato/dev-rss/candidate-1.json` | 10,611.17 MB | 6,656.76 MB | 9,272.87 MB | 8,833.23 MB |
| 2 | `.mercato/dev-rss/candidate-2.json` | 10,396.86 MB | 5,657.47 MB | 9,031.45 MB | 8,411.98 MB |
| 3 | `.mercato/dev-rss/candidate-3.json` | 9,758.31 MB | 6,329.72 MB | 8,929.55 MB | 7,926.23 MB |
| **Median** | — | **10,396.86 MB** | **6,329.72 MB** | **9,031.45 MB** | **8,411.98 MB** |

The artifact prefix is
`/private/tmp/open-mercato-standalone-memory-baseline/`. The total peak regressed
2.995% from the 10,094.50 MB baseline and exceeded the 7,066.15 MB ceiling by
3,330.71 MB. The maximum `next-turbopack` median regressed 14.199% from
7,908.54 MB and exceeded the 5,535.978 MB ceiling by 3,495.472 MB. Median mean
improved 32.885%, median Fast Refresh count fell from 36 to 5, the recurring
five-second cadence disappeared, and all browser/PID/telemetry-path checks passed.
This proves telemetry relocation is a sustained-memory and rebuild fix, not the
accepted peak intervention.

The best mode, warmup suppression, was then rerun under the acceptance runtime.
Every dev, profiler, and headed-browser command prepended the Node 24.13.1
executable directory to `PATH`; every first profiler sample proved the Node 24 root
and Next-launcher executable before browser traffic. An empty-cache preparatory
seed completed hydrated login HTTP 200, protected rendering, A-to-B HMR, and a
15-second settle. Its 57-file cache and SHA-256 manifest are retained under
`.mercato/dev-rss/cache-snapshots/turbopack-node24-suppressed-seed-2026-07-31/`.
Each measured run was an exact seed clone with normal topology and the full
180-second, one-second-interval headed workflow:

| Run | Raw report | Peak total | Maximum `next-turbopack` | HMR |
| --- | --- | ---: | ---: | ---: |
| 1 | `.mercato/dev-rss/experiment-node24-suppressed-repeat1.json` | 7,357.36 MB | 6,221.24 MB | 4.815 s |
| 2 | `.mercato/dev-rss/experiment-node24-suppressed-repeat2.json` | 7,920.43 MB | 7,288.54 MB | 6.316 s |
| 3 | `.mercato/dev-rss/experiment-node24-suppressed-repeat3.json` | 8,501.47 MB | 6,914.57 MB | 3.811 s |
| **Median** | — | **7,920.43 MB** | **6,914.57 MB** | **4.815 s** |

The acceptance median misses the 7,066.15 MB total ceiling by 854.28 MB and the
5,535.978 MB class ceiling by 1,378.592 MB. Warmup is a confirmed amplifier, but
suppression is not sufficient.

For directional attribution only, a Node 25.3.0 balanced warm-seed sequence ran
`suppressed → login-only → full → full →
login-only → suppressed`, with every arm cloned from the same retained A2
Turbopack seed and every run retaining login, protected probe, normal background
topology, A-to-B HMR, and 180 seconds of one-second samples:

All six follow-up profiler artifacts record Node 25.3.0. The required baseline and
production-candidate runtime contract used Node 24.13.1. The warmup sequence is internally balanced
and valid for relative S/L/F attribution, but it is not acceptance-equivalent to
the Node 24 baseline; its absolute ceiling comparisons are directional only.

| Targeted warmup mode | Median peak total | Median mean total | Median maximum `next-turbopack` | Median maximum `next-server` |
| --- | ---: | ---: | ---: | ---: |
| Suppressed | **9,104.50 MB** | 7,608.97 MB | **7,470.41 MB** | **6,898.57 MB** |
| Login only | 9,265.74 MB | 6,983.29 MB | 8,259.28 MB | 7,819.54 MB |
| Full | 11,033.66 MB | 7,530.15 MB | 9,755.57 MB | 9,224.11 MB |

The six reports below the retained fixture are
`.mercato/dev-rss/experiment-warm-seed-s1-suppressed.json`,
`.mercato/dev-rss/experiment-warm-seed-s2-suppressed.json`,
`.mercato/dev-rss/experiment-warm-seed-l1-login-only.json`,
`.mercato/dev-rss/experiment-warm-seed-l2-login-only.json`,
`.mercato/dev-rss/experiment-warm-seed-f1-full.json`, and
`.mercato/dev-rss/experiment-warm-seed-f2-full.json`. Full warmup adds
1,929.16 MB total and 2,285.16 MB class RSS over suppression; login-only adds
161.24 MB total, 788.87 MB class, and 920.97 MB server RSS, while full warmup adds
2,325.55 MB server RSS. The absolute Node 25
ceiling deltas are not acceptance evidence; the conclusion comes from the Node 24
repeats above.

The post-Task-4 artifact inventory was verified from root and Next-launcher
commands. Node 24.13.1 covers correlation, the first suppression shift,
request-manifest/UI/bootstrap/component/transpile/webpack/source-map/
externalization/old-space/CPU controls, C5, both scheduler runs, memory-limit run
1, and the corrective acceptance sequence. Node 25.3.0 covers memory-limit run 2,
both cache-off runs, clean-cache ABBA, S/L/F, minification, and the graph-pruning
aborts. Node 25 items are directional only.

| Intervention | Runtime | Raw evidence | Decision |
| --- | --- | --- | --- |
| C5 lightweight supervisor | Node 24, valid | `.mercato/dev-rss/experiment-lightweight-supervisor.json` | Local supervisor savings were real but too small; full peak 11,911.67 MB total / 10,436.75 MB class. |
| Embedded scheduler/shared worker | Node 24, valid | `.mercato/dev-rss/experiment-embedded-scheduler-run1.json`<br>`.mercato/dev-rss/experiment-embedded-scheduler-run2.json` | Saved 95–163 MB max and 298–332 MB mean in those processes; full-tree peaks regressed. |
| Native 4 GiB Turbopack limit | Mixed: run 1 Node 24; run 2 Node 25 directional | `.mercato/dev-rss/experiment-turbopack-memory-limit-4g-run1.json`<br>`.mercato/dev-rss/experiment-turbopack-memory-limit-4g-run2.json` | 11,323.87/13,413.26 MB peaks; no enforcement or useful reduction. |
| Filesystem cache off | Node 25, directional | `.mercato/dev-rss/experiment-turbopack-filesystem-cache-off-run1.json`<br>`.mercato/dev-rss/experiment-turbopack-filesystem-cache-off-run2.json` | Regression; disabling did not prevent store changes. |
| Empty-cache ABBA | Node 25, directional | `.mercato/dev-rss/experiment-clean-cache-abba-a1-on.json`<br>`.mercato/dev-rss/experiment-clean-cache-abba-a2-on.json`<br>`.mercato/dev-rss/experiment-clean-cache-abba-b1-off.json`<br>`.mercato/dev-rss/experiment-clean-cache-abba-b2-off.json` | ON median 13,528.16/12,711.00 MB total/class; OFF 14,245.77/13,567.42. Cache OFF worsened peaks 5.30%/6.74%. |
| Server/Turbopack minification | Node 25, invalid | `.mercato/dev-rss/experiment-dev-minification-seed.json` | Auth 500: MikroORM duplicate property-decorator metadata. |
| Tree shaking + unused imports/exports | Node 25, invalid | `.mercato/dev-rss/cache-snapshots/turbopack-graph-pruning-failed-seed-2026-07-31/` | Rust tree-shaker out-of-bounds panics. |
| Unused imports only | Node 25, invalid | `.mercato/dev-rss/cache-snapshots/turbopack-unused-imports-failed-seed-2026-07-31/` | Invalid configuration: requires unused-export removal, whose coherent combination already panics. |

The original accumulated 790-file cache and the 70-file A2 matched seed are
retained with SHA-256 manifests. Clean-cache ABBA proves the accumulated store is a
variance source rather than the missing fix: cold starts are worse, and cache-off
increases the peak.

#### Current decision and approval boundary

No valid source/config candidate on Next 16.2.x passes both ceilings. As of
2026-07-31, the [npm release tags](https://www.npmjs.com/package/next?activeTab=versions)
mark 16.2.12 as `latest`, but its stable published changes contain no documented
backport of the 16.3 Turbopack memory work. The
[upstream release stream](https://github.com/vercel/next.js/releases) distributes
16.3 as preview/canary and records relevant native-memory changes there.

An approval-safe, fixture-only diagnostic installed Next, `@next/env`, and the
Darwin ARM64 SWC at `16.3.0-preview.9`; React/React DOM remained `19.2.7`. Package
and lockfile changes never entered the worktree, and no runtime source changed.
Node 24.13.1 was pinned for every command; profiler samples independently proved
the dev root and Next launcher, while browser artifacts independently proved the
browser runner. Exact preview package versions and package-file hashes are retained
at `.mercato/dev-rss/evidence/preview9-package-and-restoration-manifest.txt`.

After a valid empty-cache seed (normal topology, login HTTP 200, protected render,
A-to-B HMR, 15-second settle), three exact seed clones produced:

| Run | Raw report | Peak total | Maximum `next-turbopack` | HMR |
| --- | --- | ---: | ---: | ---: |
| 1 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-repeat1.json` | 7,105.71 MB | 5,813.98 MB | 2.291 s |
| 2 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-repeat2.json` | 6,018.39 MB | 4,893.18 MB | 2.291 s |
| 3 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-repeat3.json` | 7,047.67 MB | 5,764.74 MB | 1.792 s |
| **Median** | — | **7,047.67 MB** | **5,764.74 MB** | **2.291 s** |

The artifact prefix is `/tmp/open-mercato-standalone-memory-baseline/`; matching
browser JSON files use the same labels under `.mercato/dev-rss/browser/`, and the
50-file seed manifest is under
`.mercato/dev-rss/cache-snapshots/turbopack-preview9-node24-suppressed-seed-2026-07-31/`.
No unexpected browser, native, or runtime errors occurred.

The primary median is 3,046.83 MB (30.183%) below the 10,094.50 MB comparator and
passes the 7,066.15 MB ceiling by only 18.48 MB. The secondary class median fails
its 5,535.978 MB ceiling by 228.762 MB. The preview is therefore diagnostic only:
the primary margin is too narrow for production confidence, the secondary target
still fails, and the retained restoration manifest verifies Next/SWC 16.2.11,
React 19.2.7, the original package/lock/runtime hashes, all 8,291 Next/@next file
hashes, and all 790 original cache hashes after restoration.

That preview-only result did not authorize production promotion. The completed
fixture-only composition and its remaining approval boundary are recorded below;
no earlier C5/scheduler saving is assumed additive.

#### Composed fixture acceptance — 2026-08-02

The approved fixture-only follow-up composed the branch telemetry fix, Next/
`@next/env`/Darwin ARM64 SWC `16.3.0-preview.9`, React/React DOM `19.2.7`,
suppressed automatic targeted warmup, and
`OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER=true`. **C5 was omitted** because its
exact temporary patch was not preserved; no additive C5 saving is claimed.

Accepted reports are relative to
`/private/tmp/open-mercato-standalone-memory-baseline/`:

| Run | Profiler report | Samples / configured window | Peak total | Mean total | Maximum `next-turbopack` | Embedded worker max / mean |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-embedded-scheduler-repeat1.json` | 173 / 180 s | 6,194.01 MB | 5,042.54 MB | 5,475.26 MB | 527.09 / 370.98 MB |
| 3 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-embedded-scheduler-repeat3.json` | 168 / 180 s | 5,841.84 MB | 4,890.01 MB | 5,101.92 MB | 377.50 / 311.27 MB |
| 4 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-embedded-scheduler-repeat4.json` | 173 / 180 s | 5,867.10 MB | 5,110.18 MB | 5,260.37 MB | 446.52 / 442.58 MB |
| **Median** | — | — | **5,867.10 MB** | **5,042.54 MB** | **5,260.37 MB** | **446.52 / 370.98 MB** |

Run 2 (`experiment-preview9-node24-suppressed-embedded-scheduler-repeat2.json`)
is directional only and excluded because its HMR stdin correction caused multiple
browser passes. Runs 1, 3, and 4 each have one matching browser JSON under
`.mercato/dev-rss/browser/`, Node `v24.13.1`, login HTTP 200, protected A-to-B
rendering, and HMR. Run 3's 168 successful samples are not a truncated profile:
its configured duration is `180000` ms and report timestamps span 183.037 seconds.

The accepted median total peak is 4,227.40 MB (**41.878%**) below the fixed
10,094.50 MB comparator and 1,199.05 MB below its ceiling. The class median is
2,648.17 MB (**33.485%**) below 7,908.54 MB and 275.608 MB below its ceiling.
Topology proofs show one `queue worker --all --with-scheduler` and no scheduler
child. Repeated raw logs prove schedule execution, enqueue, schedule completion,
queue consumption/job completion, and clean scheduler/worker shutdown.

Against the preview-only separate scheduler-plus-worker topology, command-level
median maximum fell from 1,019.72 to 446.52 MB (573.20 MB / **56.21%** saved),
and median mean fell from 684.75 to 370.98 MB (313.76 MB / **45.82%** saved).

No production source or manifest changed for this composition. Production work
requires approval for the following exact scope:

- preview pins and lockfile changes in `package.json`, `apps/mercato/package.json`,
  `packages/create-app/template/package.json.template`, and `yarn.lock`;
- standalone targeted warmup suppressed by default with an explicit opt-in
  override and the required root/template runtime mirror;
- the embedded-scheduler default already present in `scripts/dev.mjs` mirrored to
  `packages/create-app/template/scripts/dev.mjs`;
- the telemetry relocation already implemented on this branch retained unchanged.

After measurement, the fixture was restored exactly: marker B, normal warmup,
Next/@next `16.2.11`, React/React DOM `19.2.7`, no experiment processes, and passing
fixture, Yarn-state, 8,291-file Next/@next, and 790-file cache SHA-256 manifests.

## Data Models

N/A. The capability adds no persistent application entity or database schema. The
standalone database is a fixed test fixture and is held constant across runs.

## API Contracts

N/A. The capability adds or changes no HTTP route. Existing authentication and
backend routes are exercised as functional gates.

## Internationalization

N/A unless the confirmed intervention changes user-facing UI. A visible app-local
marker used only by the temporary standalone fixture is measurement data, not
shipped product copy.

## UI/UX

No product UI change is proposed. The browser is used to verify existing behavior.
If the confirmed intervention touches a provider/bootstrap boundary, the final spec
update must add the Frontend Architecture Contract required by `om-spec-writing`
before implementation.

## Migration & Backward Compatibility

The measurement phase touches no contract surface. The implementation must read and
preserve `BACKWARD_COMPATIBILITY.md`. It must not rename or remove auto-discovery
files, generated exports, import paths, CLI commands, route URLs, types, events,
widget spots, DI keys, ACL features, or notification IDs.

Any template or app-shell change is mirrored between the monorepo app and
`packages/create-app/template` in the same change. Published standalone package
dependencies stay aligned with `packages/create-app/template/src/modules.ts`.

## Implementation Plan

### Phase 1: Reproducible baseline

1. Build packages in the required build/generate/build order.
2. Publish to local Verdaccio and scaffold a fresh standalone app.
3. Add a minimal app-local module with a visible editable marker.
4. Run the complete browser and profiler workflow three times.
5. Record raw summaries, median peak RSS, and peak attribution.

**Exit criterion:** three valid reports exist, every functional assertion passed,
and the baseline record names the median and repeatable peak owner.

### Phase 2: Root-cause confirmation

1. Compare peak samples and lifecycle markers.
2. Inspect reachable generated registries, imports, and process roles.
3. State and test one minimal hypothesis.
4. Record the exact production/test file manifest only after confirmation.

**Exit criterion:** one reversible experiment measurably reduces the attributed
component, and this spec contains the root-cause amendment required by the gate.

### Phase 3: Test-first implementation

1. Add the focused test named by the root-cause amendment and verify the expected
   failure.
2. Implement the smallest fix.
3. Run focused and adjacent package tests.
4. Rebuild and republish packages.

**Exit criterion:** the focused test completes a red-green cycle, adjacent tests
pass, template parity is proven, and published packages contain the candidate.

### Phase 4: Acceptance and repository validation

1. Repeat the exact workflow three times against the candidate.
2. Confirm at least 30% median peak-RSS reduction and all functional gates.
3. Run `yarn build:packages`, `yarn generate`, `yarn build:packages`,
   `yarn test:create-app`, `yarn test:create-app:integration`, `yarn typecheck`,
   and the focused test/lint commands named by the root-cause amendment.
4. Run one fresh final standalone workflow after repository validation.

**Exit criterion:** the candidate median is at least 30% below baseline, all three
candidate workflows and the final fresh workflow pass, and every listed command
exits successfully. If the confirmed change also affects the monorepo dev runtime,
one equivalent `yarn dev` page/HMR smoke is required.

**Observed status:** functional and repository gates passed for the telemetry
candidate, but both peak gates failed. Phase 4 remains incomplete and returns to
root-cause work; the next dependency experiment is approval-gated as documented
above.

## Risks & Impact Review

### False reduction from incomplete work

- **Scenario**: The candidate reports lower RSS because login, page compilation,
  regeneration, or hot reload did not execute.
- **Severity**: High
- **Affected area**: Standalone developer experience and measurement validity
- **Mitigation**: Treat each workflow step as a required assertion on every run;
  verify the server PID survives the hot reload.
- **Residual risk**: Browser timing varies slightly; three equivalent runs and
  retained summaries make that variance visible.

### Non-comparable baseline and candidate

- **Scenario**: Package versions, database state, module set, route, or runtime
  settings differ between the two sets.
- **Severity**: High
- **Affected area**: Performance conclusion
- **Mitigation**: Reuse one initialized fixture and record dependency versions,
  environment, route, edit, interval, and duration.
- **Residual risk**: OS page-cache state is not forcibly purged; medians limit but
  do not eliminate ordinary host noise.

### Externalizing a browser-reachable dependency

- **Scenario**: A package selected from server traces is also needed in a client
  bundle, causing compile or runtime failure.
- **Severity**: High
- **Affected area**: Next.js build, SSR, and browser rendering
- **Mitigation**: Externalize only after import-graph evidence proves server-only
  reachability; cover both production build and the real browser workflow.
- **Residual risk**: Rare routes outside the exercised page require adjacent tests
  and the existing integration suite.

### Bootstrap deferral changes ordering

- **Scenario**: Lazy registry/bootstrap work reduces the initial graph but a
  consumer reads registrations synchronously before they are ready.
- **Severity**: High
- **Affected area**: Widgets, component overrides, notifications, and dashboards
- **Mitigation**: Preserve synchronous side-effect registrations, add ordering and
  hydration tests, and exercise a route that consumes the affected registry.
- **Residual risk**: Third-party modules may have undocumented timing assumptions;
  public export and registration semantics must remain unchanged.

### Template drift

- **Scenario**: The monorepo app improves while newly scaffolded apps retain the
  old behavior.
- **Severity**: High
- **Affected area**: `create-mercato-app`
- **Mitigation**: Mirror every app-shell/runtime change and run Verdaccio-backed
  create-app validation.
- **Residual risk**: Intentionally divergent template files require explicit
  review rather than mechanical copying.

### Dev telemetry relocation loses cross-process visibility

- **Scenario**: The managed runtime writes one process below the Next.js build tree
  while another process keeps the old default, so the system-status report omits a
  sibling snapshot.
- **Severity**: Medium
- **Affected area**: Local module-resource diagnostics
- **Mitigation**: Inject one inherited absolute directory before spawning Next,
  scheduler, and worker processes; verify sibling aggregation in the focused test
  and standalone smoke.
- **Residual risk**: A manually launched process that does not inherit the managed
  dev environment retains the shared default by design.

### Dependency-version shortcut

- **Scenario**: A preview dependency happens to reduce memory but is unstable or
  unavailable to standalone users.
- **Severity**: Medium
- **Affected area**: Dependency compatibility and release stability
- **Mitigation**: Preview releases may inform attribution but cannot be the shipped
  final result; use the repository's stable version policy.
- **Residual risk**: A later stable release may change the optimal intervention;
  retained measurements support re-evaluation.

## Final Compliance Report — 2026-07-30

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/create-app/template/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/shared/AGENTS.md`
- `.ai/docs/agent-instructions.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| `AGENTS.md` | Check existing OSS and enterprise specs before implementation | Compliant | Related memory specs were reviewed; this standalone capability is intentionally split. |
| `AGENTS.md` | Enter a plan for non-trivial work | Compliant | Detailed run plan exists under `.ai/runs/2026-07-30-standalone-dev-memory/`. |
| `packages/create-app/AGENTS.md` | Test through Verdaccio | Compliant | Required for the baseline and candidate fixture. |
| `packages/create-app/AGENTS.md` | Build before publishing and use build/generate/build order | Compliant | Phase 1 and Phase 4 require the exact order. |
| `packages/create-app/AGENTS.md` | Mirror app-shell/runtime changes into the template | Compliant | Mandatory implementation constraint and explicit risk mitigation. |
| `packages/create-app/template/AGENTS.md` | Preserve generated files and standalone dev workflow | Compliant | The intervention moves diagnostic runtime snapshots only; generated registry paths and hot reload remain unchanged. |
| `packages/cli/AGENTS.md` | Preserve generator output and standalone contracts | Compliant | Generator output was inspected but is not modified by the selected intervention. |
| `packages/shared/AGENTS.md` | Keep shared infrastructure contracts narrow and domain-independent | Compliant | The selected intervention preserves `resource-usage.ts`, its public environment override, snapshot format, and cross-process aggregation; managed dev wrappers supply a different default without changing shared package code or imports. |
| `BACKWARD_COMPATIBILITY.md` | Preserve stable and frozen contract surfaces | Compliant | No contract removal or rename is permitted. |
| `packages/create-app/AGENTS.md` | Validate monorepo and Verdaccio-backed standalone environments | Compliant for telemetry candidate | Both smokes, package rebuild/publish, and standalone workflow passed; peak acceptance failed independently. |
| Data, API, commands, cache, security, and design-system rules | Apply when those surfaces change | N/A | No entity, API, mutation, cache, or product UI change is selected. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Primary metric matches acceptance math | Pass | Median peak total process-tree RSS and 30% are used throughout. |
| User stories map to runtime workflow | Pass | Dev start, login, page navigation, module edit, and hot reload are explicit assertions. |
| Baseline and candidate are comparable | Pass | Fixture, dependencies, database, route, edit, settings, interval, and duration are fixed. |
| Risks cover likely intervention families | Pass | Externalization, bootstrap ordering, dependency shortcut, and template drift are explicit. |
| Data/API/UI sections match scope | Pass | All are N/A except browser verification of existing UI. |
| Selected intervention has exact files, rollback, and red assertion | Pass | The Phase 2 amendment names two production files, two tests, one documentation file, and a no-migration rollback. |
| Experiment isolates one variable | Pass | Telemetry relocation, warmup modes, process consolidation, native limits, cache modes, and compiler flags were tested in separate controlled arms. Invalid arms stopped at their first functional/compiler failure. |

### Non-Compliant Items

The fixture-only composed candidate passes both unchanged three-run peak gates,
but its preview dependency pins and runtime/template defaults are not authorized
production changes. The branch implementation remains a dev-runtime environment
change rather than a frontend/bootstrap change, so no Frontend Architecture
Contract is required.

### Verdict

**Needs production approval:** the composed fixture evidence meets the memory and
functional acceptance contract with material headroom. Implementation is still
blocked on explicit approval of the preview pins/lockfile, targeted-warmup default,
and create-app embedded-scheduler mirror. Until then, only the existing telemetry
relocation is production code on this branch.

## Changelog

### 2026-07-30

- Initial standalone dev-memory reduction specification with a three-run 30%
  peak-RSS target and mandatory login, backend page, and module hot-reload gates.
- Confirmed app-root module-resource telemetry snapshots as the recurring
  Turbopack invalidation trigger; recorded the isolated `distDir` relocation
  experiment, exact Task 3 files/tests, rollback, and acceptance criteria.

### 2026-07-31

- Corrected the production-candidate result: telemetry relocation improves mean
  RSS and rebuild cadence but regresses both mandatory peak medians.
- Added balanced targeted-warmup S/L/F evidence, current-stack intervention
  falsifications, cache ABBA controls, retained artifact paths, restoration state,
  and the approval-gated Next 16.3 decision boundary.

### 2026-08-02

- Added the three-run fixture-only composed acceptance set (runs 1/3/4), excluded
  the multi-browser run 2, recorded embedded scheduler lifecycle/topology savings,
  documented C5 omission and exact restoration, and defined the production
  manifest/runtime/template approval boundary.

### Review — 2026-07-30

- **Reviewer**: Agent plus fresh-context scope review
- **Security**: Passed; no data or authorization contract changes proposed
- **Performance**: Passed; deterministic primary metric and comparison controls
- **Cache**: N/A; no cache behavior proposed
- **Commands**: N/A; no business mutation proposed
- **Risks**: Passed; false savings and likely intervention hazards covered
- **Verdict**: Approved for baseline and attribution; production amendment required
