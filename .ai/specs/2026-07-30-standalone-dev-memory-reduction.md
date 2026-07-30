# Standalone Dev-Mode Memory Reduction

## TLDR

Reduce the median peak process-tree RSS of a freshly scaffolded standalone Open
Mercato app by at least 30% without weakening the real developer workflow.

The accepted result must be demonstrated across three equivalent baseline and
candidate runs. Every run starts `yarn dev`, authenticates as the default super
administrator, visits an authenticated backend page, changes a standalone module
source file, observes hot reload without a server restart, and retains a profiler
report.

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
result is not complete.

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
| Preview/canary Next.js release | Useful as diagnostic evidence, but not acceptable as the shipped final dependency. |
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

Production implementation is blocked until the spec is amended with:

- the confirmed hypothesis and measured experiment delta;
- the exact production and regression-test files;
- affected contract surfaces and template-sync obligations;
- the focused failing assertion;
- rollback mechanics;
- intervention-specific acceptance criteria;
- an updated compliance report covering every newly relevant `AGENTS.md`.

### Phase 2 root-cause amendment — confirmed 2026-07-30

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
| `BACKWARD_COMPATIBILITY.md` | Preserve stable and frozen contract surfaces | Compliant | No contract removal or rename is permitted. |
| `packages/create-app/AGENTS.md` | Validate monorepo and Verdaccio-backed standalone environments | Pending Task 3/4 | Both smokes and the full create-app gate are now explicit acceptance criteria. |
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
| Experiment isolates one variable | Pass | Only `OM_MODULE_RESOURCE_USAGE_DIR` moved below the existing Next.js `distDir`; telemetry and splash remained enabled. |

### Non-Compliant Items

The Phase 2 production gate is satisfied. Final compliance remains pending the
Task 3 red-green cycle and the Task 4 three-run primary acceptance gate. The
selected intervention is a dev-runtime environment change, not a frontend or
bootstrap change, so no Frontend Architecture Contract is required.

### Verdict

**Conditionally compliant for Task 3 implementation:** the root cause, exact file
manifest, rollback, contract impact, template parity, and intervention acceptance
are recorded. Completion still requires implementation and the unchanged
three-run 30% primary gate.

## Changelog

### 2026-07-30

- Initial standalone dev-memory reduction specification with a three-run 30%
  peak-RSS target and mandatory login, backend page, and module hot-reload gates.
- Confirmed app-root module-resource telemetry snapshots as the recurring
  Turbopack invalidation trigger; recorded the isolated `distDir` relocation
  experiment, exact Task 3 files/tests, rollback, and acceptance criteria.

### Review — 2026-07-30

- **Reviewer**: Agent plus fresh-context scope review
- **Security**: Passed; no data or authorization contract changes proposed
- **Performance**: Passed; deterministic primary metric and comparison controls
- **Cache**: N/A; no cache behavior proposed
- **Commands**: N/A; no business mutation proposed
- **Risks**: Passed; false savings and likely intervention hazards covered
- **Verdict**: Approved for baseline and attribution; production amendment required
