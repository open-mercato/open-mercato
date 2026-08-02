# Standalone Dev-Mode Memory and CPU Reduction

## TLDR

Reduce the median peak process-tree RSS of a freshly scaffolded standalone Open
Mercato app by at least 30% without weakening the real developer workflow. Measure
CPU use over the same workflow and reduce it toward 30% where the confirmed
memory intervention allows; CPU improvement is a co-goal, not a second hard gate.

The accepted result must be demonstrated across three equivalent baseline and
candidate runs. Every run starts `yarn dev`, authenticates as the default super
administrator, visits an authenticated backend page, changes a standalone module
source file, observes hot reload without a server restart, and retains one RSS and
CPU profiler report.

**Current outcome (2026-08-02): stable-toolchain design approved; implementation
not started.** The telemetry relocation implemented on this branch removes
recurring five-second rebuilds and lowers sustained RSS. A fixture-only Next
`16.3.0-preview.9` composition proves that the workflow can clear the memory gate,
but it is diagnostic evidence only. The shipped solution must keep every current
dependency and lockfile entry unchanged, use the installed Next `16.2.11`
toolchain, add CPU measurement to the existing profiler, and compose only existing
runtime controls. The stable warmup-suppression control reached a 21.537% median
peak-RSS reduction on its own, so the remaining work is a measured stable-stack
composition rather than dependency promotion.

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
the confirmed root-cause fix test-first. Compose stable runtime controls only after
their isolated effects are known; do not stack speculative optimizations.

The primary calculation is:

```text
reduction = (baseline median peak RSS - candidate median peak RSS)
            / baseline median peak RSS
```

Acceptance requires `reduction >= 0.30`.

The existing profiler is extended with process-tree CPU time obtained from the
same platform `ps` snapshots it already uses. Per-run CPU core-seconds are derived
from positive per-PID CPU-time deltas, including the observed CPU time of newly
seen child processes. The comparison is:

```text
cpu reduction = (baseline median CPU core-seconds
                 - candidate median CPU core-seconds)
                / baseline median CPU core-seconds
```

Peak sampled process-tree CPU percentage is retained as a secondary diagnostic.
The candidate should reduce CPU toward 30%; after the 30% memory gate passes, a
smaller CPU improvement is reported and remaining CPU work is parked rather than
holding back the memory change.

### MVP boundary

The MVP is all four phases in this specification: one reproducible RSS/CPU
baseline, one confirmed stable-toolchain intervention, one minimal test-first
implementation, and one accepted three-run candidate result. Baseline and
attribution alone are not the requested deliverable, and a production change
without the three-run acceptance result is not complete. Tasks 1–4 completed the
original memory workflow but the initial telemetry candidate failed the final peak
gate. Preview-only fixture results remain attribution evidence and cannot satisfy
the MVP. The stable candidate must pass on the unchanged installed dependency set.

Deferred work includes a permanent CI memory-regression gate, a reusable browser
scenario package, other operating systems, broader route matrices, and every
optimization family not selected by the baseline evidence. Those candidates do
not enter the MVP merely because they appear in the risk register or an existing
research branch.

### Design decisions

| Decision | Rationale |
|----------|-----------|
| Median of three peak-RSS runs | Limits ordinary page-cache and timing noise while retaining the workstation-impacting peak. |
| Median of three CPU core-second totals | Measures total processor work rather than a single noisy instantaneous percentage. |
| External profiler attached by PID | Keeps measurement-only code out of the generated template and samples the full process tree. |
| Same fixture for baseline and candidate | Holds module set, database, route, edit, and application data constant. |
| No dependency or lockfile changes | Keeps the result shippable on the current supported standalone toolchain. |
| Functional gates on every run | Prevents false savings caused by failed compilation, warmup, login, rendering, watching, or hot reload. |
| One hypothesis at a time | Makes the causal contribution observable and avoids an unreviewable bundle of guesses. |

### Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| V8 `--max-old-space-size` cap | Can replace memory pressure with compilation OOMs and does not remove root-cause work. |
| Webpack dev fallback | Officially supported, but not selected without evidence; Next.js recommends Turbopack for local performance. |
| `experimental.optimizePackageImports` list | Official Next.js guidance says Turbopack already analyzes imports; not a default intervention. |
| Preview/canary Next.js release | Retained as historical diagnostic evidence only; the user explicitly prohibited dependency updates. |
| Next/Turbopack CPU or heap limits | Existing CPU-count and old-space experiments increased RSS or did not enforce a useful bound. |
| Idle-only RSS | Misses the backend compile and hot-reload peaks the user experiences. |
| Import an existing research branch wholesale | Would combine multiple unproven changes and obscure attribution. |

## User Stories / Use Cases

- As a standalone-app developer, I want `yarn dev` to use materially less memory so
  my workstation does not swap or terminate the dev server.
- As a standalone-app developer, I want the same workflow to perform less total
  CPU work so development competes less with my browser and editor.
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
profiler --pid <yarn-dev-pid> ──samples RSS + CPU process tree─┤
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
- unchanged package manifests, installed versions, and lockfile;
- an exact clone of one retained stable Next `16.2.11` Turbopack seed, verified by
  the same file-count and SHA-256 manifest before every run;
- the probe source restored to `Baseline marker A` and verified by its retained
  SHA-256 hash before the measured process starts;
- a full restart of the `yarn dev` process tree.

The authoritative comparison cohort is newly measured after CPU instrumentation:
three runs of the pre-optimization merge-base runtime and three runs of the
candidate runtime, both built against the current locked dependencies and the same
retained seed. Its baseline median is the denominator for the hard RSS calculation
and the CPU comparison. The historical 10,094.50 MB RSS median remains a
cross-check only; it does not compete with the fresh cohort. Maximum
`next-turbopack`/`next-server` RSS remains attribution data, not a second release
gate.

The profiler's first successful sample defines `T+0`. The root process must have
started no more than two seconds earlier; the first observation of each PID
includes its accumulated CPU time so startup work is counted. The browser workflow
starts at `T+60s`, the visible module edit occurs at `T+100s`, hot reload must
complete by `T+140s`, and the unchanged browser settles until the profiler stops at
`T+180s`. A valid report spans `180000 ± 2000` ms and contains at least 170
successful one-second samples. A late readiness, login, page render, or HMR result
invalidates the run rather than shifting later actions.

Reports are written under the standalone fixture's `.mercato/dev-rss/` directory.
They are runtime artifacts and are not committed. The run record commits the raw
RSS/CPU summary values, exact commands, browser evidence, and comparison math.

### Runtime workflow

1. Start `yarn dev` and record its root PID.
2. Attach `scripts/profile-dev-rss.mjs --pid <pid>`.
3. Wait for the standalone dev runtime to report ready.
4. Open the app in a real browser and authenticate with the default super
   administrator fixture.
5. Visit the selected authenticated backend route.
6. Record the actual Next server PID and process start identity before the edit.
7. Change a visible marker in a source file below the app's `src/modules/`.
8. Assert that the browser displays the changed marker without navigation and
   that the same Next PID/start identity remains alive afterward; the wrapper PID
   alone is insufficient evidence.
9. Stop the process tree cleanly and retain the report.

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
- The historical telemetry study also tracked a 30% `next-turbopack` class
  reduction against 7,908.54 MB. Under the current design this class metric is
  attribution data, not a second release gate.
- The hard gate is the median total process-tree peak: the candidate is at least
  30% below the authoritative fresh CPU-capable baseline cohort defined by the
  measurement contract.

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

The historical study median misses the 7,066.15 MB total threshold by 854.28 MB;
its class attribution also misses 5,535.978 MB by 1,378.592 MB. Warmup is a
confirmed amplifier, but
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

#### Historical preview diagnostic — not a production option

No valid source/config candidate on Next 16.2.x passed the historical 30%
total-process-tree threshold. As of
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

The primary median is 3,046.83 MB (30.183%) below the historical 10,094.50 MB
comparator. The secondary class median misses its historical 5,535.978 MB
diagnostic threshold by 228.762 MB. The preview is diagnostic only because
dependency updates are prohibited; the retained restoration manifest verifies
Next/SWC 16.2.11,
React 19.2.7, the original package/lock/runtime hashes, all 8,291 Next/@next file
hashes, and all 790 original cache hashes after restoration.

That preview-only result did not authorize production promotion. The completed
fixture-only composition is retained below as attribution evidence only; the user
subsequently prohibited all dependency updates. No earlier C5/scheduler saving is
assumed additive, and none of these preview runs may enter stable acceptance math.

#### Composed fixture diagnostic — corrected 2026-08-02

The fixture combined the branch telemetry fix, Next/`@next/env`/Darwin ARM64 SWC
`16.3.0-preview.9`, React/React DOM `19.2.7`, suppressed automatic targeted
warmup, and `OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER=true`. **C5 was omitted**;
its prior saving is not assumed additive.

Runs 1–4 are not acceptance evidence. Run 2 had multiple browser passes; run 3's
worker PID 18017 survived beyond the profile; run 4 was contaminated by that
worker; and run 1 lacks the later required bounded global post-stop audit. Clean
replacement runs 5–7 each have: a verified exact seed clone; zero-process/zero-
listener pre-audit; one browser pass; a full `180000` ms profile; one embedded
worker and no scheduler child; repeated scheduler lifecycle; graceful shutdown;
and a bounded zero-process/zero-listener post-audit.

| Run | Profiler report | Samples | Peak total | Mean total | Maximum `next-turbopack` | Worker max / mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 5 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-embedded-scheduler-repeat5.json` | 173 | 5,333.13 MB | 3,641.38 MB | 4,394.88 MB | 450.84 / 345.69 MB |
| 6 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-embedded-scheduler-repeat6.json` | 173 | 5,945.74 MB | 4,797.10 MB | 4,901.43 MB | 443.45 / 441.17 MB |
| 7 | `.mercato/dev-rss/experiment-preview9-node24-suppressed-embedded-scheduler-repeat7.json` | 173 | 5,576.89 MB | 5,028.49 MB | 4,944.89 MB | 383.75 / 380.25 MB |
| **Median** | — | — | **5,576.89 MB** | **4,797.10 MB** | **4,901.43 MB** | **443.45 / 380.25 MB** |

All relative paths use prefix
`/private/tmp/open-mercato-standalone-memory-baseline/`. Matching browser JSON is
under `.mercato/dev-rss/browser/`; audit and profiler-executable proofs are under
`.mercato/dev-rss/evidence/clean-composed-reruns/`. The retained `lsof` records
prove every profiler used Node `24.13.1`; browser JSON and topology listings prove
the same for browser and dev processes.

The total median is 4,517.61 MB (**44.753182%**) below the historical 10,094.50 MB
comparator. The class median is 3,007.11 MB (**38.023580%**) below its historical
7,908.54 MB attribution comparator. Relative to preview-only separate
worker-plus-scheduler processes, embedded median maximum saves 576.27 MB
(**56.51%**) and median mean saves 304.50 MB (**44.47%**).

No production source changed for the preview composition, and no dependency pin
or lockfile change is permitted. The next stable-toolchain phase may touch only:

| Role | Planned file boundary | Requirement |
| --- | --- | --- |
| CPU sampler | `scripts/dev-memory-sampler.mjs` | Parse existing `ps` CPU-time data and aggregate the profiled descendant tree. |
| CPU profiler/report | `scripts/profile-dev-rss.mjs` | Retain CPU samples/core-seconds beside existing RSS data without changing the CLI contract. |
| CPU regression tests | `scripts/__tests__/dev-memory-sampler.test.mjs` and `scripts/__tests__/profile-dev-rss.test.mjs` | Prove parsing, PID churn, aggregation, and report rendering. |
| Monorepo warmup runtime | `apps/mercato/scripts/dev.mjs` | If reconfirmed in composition, suppress automatic targeted warmup by default and preserve explicit opt-in. |
| Template warmup runtime | `packages/create-app/template/scripts/dev-runtime.mjs` | Mirror the monorepo warmup behavior exactly. |
| Root standalone wrapper | `scripts/dev.mjs` | Retain and verify the existing embedded-scheduler default and explicit override. |
| Template standalone wrapper | `packages/create-app/template/scripts/dev.mjs` | Mirror the root embedded-scheduler behavior exactly. |
| Runtime regression tests | `scripts/__tests__/dev-cache-purge.test.mjs` and `packages/create-app/src/lib/template-dev-log-files.test.ts` | Prove warmup and scheduler default/override parity without introducing a dependency change. |

`package.json`, `apps/mercato/package.json`,
`packages/create-app/template/package.json.template`, and `yarn.lock` are explicit
no-change gates. The exact production/test subset is narrowed after the stable
composition proves which runtime levers are load-bearing. The telemetry relocation
already on this branch remains unchanged. Final fixture
restoration passed fixture, Yarn-state, 8,291-file Next/@next, and 790-file cache
manifests and restored marker B, normal warmup, Next/@next `16.2.11`, React
`19.2.7`, no matching processes, and no listeners on 3000/4000.

Rollback is per control and requires no migration. Removing CPU fields from the
profiler/sampler restores the previous RSS-only report shape while the existing
fields and CLI remain compatible. Setting the selected warmup opt-in environment
flag restores automatic targeted warmup; reverting the paired monorepo/template
default checks restores the old default. Setting
`OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER=false` preserves the separate scheduler
topology; reverting the paired root/template wrapper defaults restores it globally.
`OM_MODULE_RESOURCE_USAGE_DIR` continues to override the telemetry destination.
The stable composition amendment must replace these generic descriptions with the
exact selected controls before Phase 3 begins.

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

### Phase 1: CPU-capable profiler and comparable baseline

1. Add red-green coverage for platform `ps` CPU-time parsing, descendant
   aggregation, PID churn, core-second totals, and report rendering.
2. Extend the existing profiler and sampler without adding a dependency or
   changing their CLI contract.
3. Verify that all package manifests and `yarn.lock` remain byte-for-byte
   unchanged.
4. From the retained exact stable Next `16.2.11` seed, run the complete browser and
   profiler workflow three times against the pre-optimization merge-base runtime;
   restore and verify the seed before every run.
5. Record median peak RSS, median CPU core-seconds, peak sampled CPU, and lifecycle
   attribution.

**Exit criterion:** three clean reports contain comparable RSS and CPU data, every
functional assertion passed, and no package/lockfile changed.

### Phase 2: Stable-toolchain composition

1. Reconfirm automatic warmup suppression in isolation on the CPU-capable harness.
2. Compose telemetry relocation, warmup suppression, and the existing embedded-
   scheduler/shared-worker control from the same exact cache seed.
3. Test the existing lightweight-supervisor path only if the composition remains
   short of the memory ceiling; keep it only when its isolated delta is positive.
4. Do not use dependency updates, heap/CPU caps already falsified by evidence, or
   failed compiler graph-pruning flags.
5. Record the exact production/test file subset only after the composition proves
   which levers are load-bearing.

**Exit criterion:** one stable composition is functionally valid, shows a positive
RSS delta attributable to the selected controls, and is ready for the required
three-run acceptance. CPU is measured and reported but cannot block this exit.

### Phase 3: Test-first production implementation

1. Add the focused failing assertions named by the stable composition amendment.
2. Implement only the confirmed runtime defaults and required template mirrors.
3. Prove explicit opt-outs/opt-ins preserve the previous warmup and scheduler
   behavior.
4. Run focused and adjacent tests and verify all dependency manifests and lockfile
   remain unchanged.
5. Rebuild and republish current repository packages to the fixture.

**Exit criterion:** focused tests complete a red-green cycle, template parity is
proven, published packages contain the candidate, and dependency drift is zero.

### Phase 4: Acceptance and repository validation

1. Repeat the exact clean workflow three times against the candidate.
2. Confirm at least 30% median peak-RSS reduction and all functional gates.
3. Report median CPU core-second and peak sampled CPU deltas. Aim toward 30%; once
   the memory gate passes, record and park any remaining CPU improvement rather
   than expanding this change.
4. Run `yarn build:packages`, `yarn generate`, `yarn build:packages`,
   `yarn test:create-app`, `yarn test:create-app:integration`, `yarn typecheck`,
   and the focused test/lint commands named by the stable composition amendment.
5. Run one fresh final standalone workflow after repository validation.

**Exit criterion:** the candidate median peak RSS is at least 30% below the fresh
authoritative baseline; the achieved CPU delta is documented and any remaining
CPU work—including a regression—is explicitly parked; all three candidate
workflows and the final fresh workflow pass; no dependency file changes; and every
listed command exits successfully. If the confirmed change also affects the
monorepo dev runtime, one equivalent `yarn dev` page/HMR smoke is required.

**Observed status:** the original memory baseline and root-cause inventory are
complete. CPU instrumentation/baseline and stable-toolchain composition are not
yet implemented. Preview runs remain historical diagnostics and cannot satisfy
Phase 4.

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

### Misleading CPU accounting

- **Scenario**: Instantaneous `%CPU` samples or exited child processes undercount
  total compiler work and make the candidate appear cheaper than baseline.
- **Severity**: High
- **Affected area**: CPU conclusion and developer workstation impact
- **Mitigation**: Derive core-seconds from monotonic per-PID CPU-time deltas,
  include the observed time of newly seen descendants, test PID churn, and retain
  peak sampled tree CPU as a separate diagnostic.
- **Residual risk**: A process that starts and exits entirely between one-second
  samples can be missed; identical sampling and three-run medians keep the
  comparison symmetric.

### Dependency drift invalidates the stable-toolchain result

- **Scenario**: A package manifest, installed Next component, or lockfile changes
  while testing and silently reintroduces the preview-based saving.
- **Severity**: High
- **Affected area**: Reproducibility and release compatibility
- **Mitigation**: Hash the manifests and lockfile before every baseline/candidate
  set, retain installed Next/`@next` versions, and fail acceptance on any drift.
- **Residual risk**: Host-level tool versions can still change; Node 24 executable
  paths and versions are retained per run.

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
| `packages/create-app/template/AGENTS.md` | Preserve generated files and standalone dev workflow | Compliant by design | The stable candidate may change runtime defaults only; generated registry paths, login, and hot reload remain required gates. |
| `packages/cli/AGENTS.md` | Preserve generator output and standalone contracts | Compliant | Generator output was inspected but is not modified by the selected intervention. |
| `packages/shared/AGENTS.md` | Keep shared infrastructure contracts narrow and domain-independent | Compliant | CPU data is added to the repository profiling harness, not shared application contracts; `resource-usage.ts` and its public environment override remain unchanged. |
| `BACKWARD_COMPATIBILITY.md` | Preserve stable and frozen contract surfaces | Compliant | No contract removal or rename is permitted. |
| `packages/create-app/AGENTS.md` | Validate monorepo and Verdaccio-backed standalone environments | Pending stable candidate | Phase 4 requires both environments after the no-dependency implementation. |
| Data, API, commands, cache, security, and design-system rules | Apply when those surfaces change | N/A | No entity, API, mutation, cache, or product UI change is selected. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Primary metric matches acceptance math | Pass | Median peak total process-tree RSS and 30% remain the hard gate; CPU core-seconds are a separately reported co-goal. |
| User stories map to runtime workflow | Pass | Dev start, login, page navigation, module edit, and hot reload are explicit assertions. |
| Baseline and candidate are comparable | Pass | Fixture, dependencies, database, route, edit, settings, interval, and duration are fixed. |
| Risks cover likely intervention families | Pass | Externalization, bootstrap ordering, dependency shortcut, and template drift are explicit. |
| Data/API/UI sections match scope | Pass | All are N/A except browser verification of existing UI. |
| Selected intervention has exact files, rollback, and red assertion | Pending | CPU profiler files and the allowed runtime boundary are named; the exact production/test subset is narrowed only after stable composition confirms load-bearing levers. |
| Experiment isolates one variable | Pass | Telemetry relocation, warmup modes, process consolidation, native limits, cache modes, and compiler flags were tested in separate controlled arms. Invalid arms stopped at their first functional/compiler failure. |

### Non-Compliant Items

The fixture-only preview composition cleared the historical total/class memory
thresholds but is ineligible for production because dependency updates are
prohibited. The stable
Next `16.2.11` composition and CPU baseline remain pending. The branch remains a
dev-runtime/profiling change rather than a frontend/bootstrap change, so no
Frontend Architecture Contract is required.

### Verdict

**Design approved; written-spec review pending:** implementation keeps the current
dependency set and lockfile unchanged, establishes CPU accounting first, then
tests stable runtime controls. The existing telemetry relocation is the only
production code on this branch until the stable composition is confirmed and
implemented test-first.

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
  and the historical Next 16.3 diagnostic boundary.

### 2026-08-02

- Corrected the composed acceptance ledger after discovering a surviving run-3
  worker: withdrew runs 1–4, added globally audited clean runs 5–7, recomputed
  medians, retained Node 24 profiler proofs and exact restoration audits, and
  recorded the then-proposed production and regression-test files before the later
  no-dependency constraint superseded that path.
- Recorded the user-approved stable-toolchain design: prohibited dependency and
  lockfile changes, added CPU reduction as a measured co-goal, defined CPU
  core-second accounting, replaced preview promotion with a current-tool runtime
  composition, and made 30% memory reduction the hard delivery gate while parking
  further CPU work after recording the achieved delta, including an explicit
  parked follow-up when CPU regresses.

### Review — 2026-07-30

- **Reviewer**: Agent plus fresh-context scope review
- **Security**: Passed; no data or authorization contract changes proposed
- **Performance**: Passed; deterministic primary metric and comparison controls
- **Cache**: N/A; no cache behavior proposed
- **Commands**: N/A; no business mutation proposed
- **Risks**: Passed; false savings and likely intervention hazards covered
- **Verdict**: Approved for baseline and attribution; production amendment required
