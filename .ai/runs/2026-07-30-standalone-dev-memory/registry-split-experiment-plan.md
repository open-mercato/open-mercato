# All-Enabled Bootstrap Registry Split Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to implement this plan task-by-task.
> The browser operator must also read and follow
> `browser:control-in-app-browser` before opening or controlling the browser.

**Goal:** Determine, with one reversible standalone-app run, whether splitting the
single bootstrap module barrel into one dynamically loaded chunk per enabled module
reduces peak dev-mode process-tree RSS to at most **6,025.52 MB** while preserving
the complete runtime module inventory, authentication, feature-filtered navigation,
subscribers, worker/scheduler activity, and in-place hot reload.

**Architecture:** Keep every current generated registry and export unchanged. In the
retained fixture only, derive additive per-module bootstrap files and an additive
loader map from the stock `modules.bootstrap.generated.ts`; temporarily switch only
the fixture's `src/bootstrap.ts` from the legacy array to
`await loadBootstrapModules()`. The loader still resolves all 52 enabled modules in
their configured order before the existing synchronous `bootstrap` export is
created. This isolates barrel graph shape without selecting a route subset or
removing module behavior.

**Tech Stack:** Node.js 24.13.1, Yarn 4.17.1, Next.js/Turbopack 16.2.11,
React/ReactDOM 19.2.7, the already-installed `typescript-js` 6.0.3 parser, built-in
`node:*` modules, the existing process-tree profiler/coordinator, and the in-app
browser.

## Global Constraints

- Worktree:
  `/Users/andrzejewsky/work/open-mercato/.worktrees/standalone-dev-memory-30pct`.
- Retained standalone fixture:
  `/private/tmp/open-mercato-standalone-memory-baseline`.
- Put `/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin` first in `PATH` for
  generator, coordinator, profiler, dev runtime, and browser controller processes.
- Do not update, install, pin, patch, or replace dependencies. `package.json`,
  `yarn.lock`, Next, React, and ReactDOM must remain byte-identical.
- Use the standard, unchanged `yarn dev` command. Preserve the authoritative
  baseline's normal warmup, telemetry location, separate worker, and separate
  scheduler topology. Do not compose any previously rejected or diagnostic runtime
  control.
- The user has explicitly authorized the architecture experiment and the automatic
  local database migration performed by this fixture's normal `yarn dev` startup.
- Do not change repository production code during Tasks 1–2. Fixture-only scripts,
  generated experiment files, and evidence live below ignored `.mercato/dev-rss/`.
- Do not hand-edit existing generated output. A deterministic experiment generator
  may read the stock generated barrel and emit only additive files.
- Keep `modules.app.generated.ts`, `/start`, `modules.cli.generated.ts`, all route
  registries, worker/scheduler code, dev scripts, `src/modules.ts`, and every
  pre-existing generated registry byte-identical.
- Do not run an ID-only, ID+i18n, or route-subset arm. Such arms remove complete
  module contracts and are not valid under the no-bypass requirement.
- The split arm must load all enabled modules before `createBootstrap()` executes.
  No fallback to the legacy barrel and no partial module array is permitted.
- Treat the single run as attribution evidence only. It advances to production
  design only if every gate passes and `summary.peakTotalMb <= 6025.52`.
- Restore the fixture exactly even after a failed preflight, failed chunk, browser
  error, timeout, or interrupted run.
- Runner: local host mode. No Docker app container is used.

## Fixed Preconditions

Abort before applying the arm if any value differs:

| Path | SHA-256 |
| --- | --- |
| `src/bootstrap.ts` | `a2629dadf4ce414b2ec33095b51bdf622717926bf10f13d020f3b12b0e5da28d` |
| `src/app/start/page.tsx` | `4f86d5583df68374fe975e860711d88b085e4abc7735f34419ea5b7416c1f373` |
| `.mercato/generated/modules.app.generated.ts` | `d93574307fab882881c260eb0638c950f2565eda875af4f539262e8750795ae4` |
| `.mercato/generated/modules.bootstrap.generated.ts` | `14ee1802929605834ce160bc104925a2d007d5fe93aee291718cba296dca7aca` |
| `.mercato/generated/modules.i18n.generated.ts` | `e73f6bc818c519418ee19891ed7301d45153d8f067b541bca375bd259e3c03c5` |
| `.mercato/generated/enabled-module-ids.generated.ts` | `493af7b2575396e502f8691f03e77af554a745d8f1656de512174bc2194cecf3` |
| installed CLI `dist/lib/generators/module-registry.js` | `4845552c060febb45fdb227fd1b0c45875fd5bf3397f665dfc3e4980b7be8783` |
| `package.json` | `b7f1aba393d1841e2c719efeb7478d7027fcd9d22f73d01f7fc3140e52dc7c84` |
| `yarn.lock` | `94cd39654752c9cfb73dce51def0475cac02d0facc137c101744f91e24a851be` |
| `scripts/dev.mjs` | `78b4b94d3dd2d5d855ae001ee3b2e5849e55392764c8f5f2566838f73180cac4` |
| `scripts/dev-runtime.mjs` | `e15fa5b889afc1e3b2474da92113441a9d967c1632eac71226723b4622bfa354` |

Also require:

- canonical newline-terminated sorted seed digest
  `27ed25b9dacd68c8b8f249086e4bb2e7b6096638e573ff99cfb75ac627a422ae`;
- exactly 5,629 seed entries;
- marker-A hash
  `8672e3cd23e43756f1a885b20724915c98110fff70a7c26da3cd756dcf516a6b`;
- zero matching fixture, profiler, browser-controller, worker, and scheduler
  processes and no listeners on ports 3000 or 4000.

## Experiment Files

All fixture experiment support files are ignored and absent after restoration. The
retained evidence directory is deliberately excluded from cleanup:

- `.mercato/dev-rss/experiments/registry-split/split-bootstrap-registry.mjs`
  - implements `verify`, `apply`, `check`, and `revert` modes;
- `.mercato/dev-rss/experiments/registry-split/manifest.json`
  - records original hashes, every owned support/additive path, every temporarily
    modified path, output hashes, module order, and contract inventory digests;
- `.mercato/dev-rss/experiments/registry-split/original-bootstrap.ts`
  - exact backup guarded by the expected source hash;
- `.mercato/dev-rss/registry-split-coordinator.mjs`
  - copies and narrows the accepted stable CPU coordinator to this one arm;
- `.mercato/generated/modules.bootstrap.loaders.generated.ts`
  - additive all-enabled loader map;
- `.mercato/generated/modules.bootstrap.{module-id}.generated.ts`
  - one additive full `Module` entry per enabled module;
- `.mercato/dev-rss/evidence/stable-registry-split-all-enabled/`
  - retained raw run, browser, identity, lifecycle, inventory, and restoration
    evidence; this is not an experiment support path and remains after restoration.

The repository receives only evidence documentation in Task 3. No fixture-only
script or generated output is committed.

---

### Task 1: Build and prove the deterministic fixture-only split arm

**Files:**

- Create in fixture:
  `.mercato/dev-rss/experiments/registry-split/split-bootstrap-registry.mjs`
- Create in fixture:
  `.mercato/dev-rss/experiments/registry-split/manifest.json`
- Create in fixture:
  `.mercato/generated/modules.bootstrap.loaders.generated.ts`
- Create in fixture:
  `.mercato/generated/modules.bootstrap.{module-id}.generated.ts`
- Temporarily modify in fixture: `src/bootstrap.ts`
- Read without modifying:
  `.mercato/generated/modules.bootstrap.generated.ts`
- Read without modifying:
  `.mercato/generated/modules.i18n.generated.ts`
- Read without modifying:
  `.mercato/generated/enabled-module-ids.generated.ts`

**Interfaces:**

```ts
import type { Module } from '@open-mercato/shared/modules/registry'

export declare const bootstrapModuleIds: readonly [
  'dashboards', 'auth', 'directory', 'customers', 'perspectives', 'entities',
  'configs', 'query_index', 'audit_logs', 'attachments', 'catalog', 'sales',
  'wms', 'api_keys', 'dictionaries', 'content', 'onboarding', 'api_docs',
  'business_rules', 'feature_toggles', 'workflows', 'search', 'currencies',
  'planner', 'resources', 'staff', 'events', 'notifications', 'progress',
  'integrations', 'data_sync', 'sync_excel', 'messages',
  'communication_channels', 'ai_assistant', 'translations', 'scheduler',
  'inbox_ops', 'payment_gateways', 'checkout', 'gateway_stripe', 'channel_imap',
  'channel_gmail', 'sync_akeneo', 'shipping_carriers', 'webhooks',
  'customer_accounts', 'portal', 'example', 'ratelimit_probe', 'memory_probe',
  'example_customers_sync',
]
export type BootstrapModuleId = (typeof bootstrapModuleIds)[number]
export type BootstrapModuleLoader = () => Promise<Module>

export declare const bootstrapModuleLoaders:
  Readonly<Record<BootstrapModuleId, BootstrapModuleLoader>>

export declare function loadBootstrapModules(
  moduleIds?: readonly BootstrapModuleId[],
): Promise<Module[]>
```

The emitted source uses the exact literal tuple above with `as const`. Omitting
`moduleIds` loads `bootstrapModuleIds`; every generated map value is one literal
dynamic import such as
`auth: () => import('./modules.bootstrap.auth.generated').then((entry) => entry.module)`.
The implementation validates each requested ID at runtime and loads it sequentially
in configured order; a missing loader throws before returning an array.

Each per-module file owns every static import and lazy edge needed by exactly one
legacy module object and exports:

```ts
import type { Module } from '@open-mercato/shared/modules/registry'

export declare const module: Module
export default module
```

The temporary fixture bootstrap replaces only:

```ts
import { modules } from '@/.mercato/generated/modules.bootstrap.generated'
```

with:

```ts
import { loadBootstrapModules } from '@/.mercato/generated/modules.bootstrap.loaders.generated'

const modules = await loadBootstrapModules()
```

All later imports, registration side effects, `createBootstrap(...)`, synchronous
`bootstrap` export, and `isBootstrapped` export remain textually unchanged.

- [ ] **Step 1: Capture preconditions and a complete legacy contract inventory**

  Run stock generation first and compute the fixed hashes, seed digest, marker hash,
  installed dependency versions, and zero-state audit. Parse the stock bootstrap
  registry with installed `typescript-js`; do not use regex to locate object or
  import boundaries.

  Record, in configured order, for every legacy module:

  - module ID and source object span;
  - every imported identifier referenced by that object, including lazy loader
    bindings;
  - normalized object-property inventory (`info`, `features`, `setup`,
    `translations`, `subscribers`, `workers`, `integrations`, `bundles`, encryption,
    extensions, CE declarations, and dashboard widgets when present);
  - a SHA-256 of the canonicalized full object initializer.

  Fail if the discovered IDs do not equal the enabled-ID registry, are duplicated,
  contain unsafe output-path characters, or total other than 52.

- [ ] **Step 2: Establish RED before emitting the split output**

  Invoke the experiment script in `check` mode before `apply`. It must fail with:

  ```text
  expected additive all-enabled bootstrap split output
  ```

  Retain the command, exit status, and stderr in
  `evidence/stable-registry-split-all-enabled/preflight-red.txt`.

- [ ] **Step 3: Implement AST-derived per-module files and loader map**

  For each module object, calculate its owning imports from identifier references and
  copy those complete non-registry import declarations plus the exact object
  initializer into one generated file. Preserve import order, string literals,
  comments inside the object, and lazy-import expressions. Never copy imports owned
  only by another module.

  Emit flat sibling files beside the legacy barrel. This keeps every relative static
  and dynamic specifier at the same directory depth; additionally resolve every
  original/emitted relative specifier to an absolute target and require equality.
  Nested `modules.bootstrap/` output is forbidden.

  Construct exactly one `@open-mercato/shared/modules/registry` import per file rather
  than copying the legacy combined import. It contains `type Module` plus only the
  runtime helpers referenced by that module object (`createLazyModuleSubscriber`
  and/or `createLazyModuleWorker`). Duplicate local bindings are a generation error.

  Generate safe filenames from IDs only after requiring
  `/^[a-z0-9_]+$/`; reject rather than sanitize an unexpected ID. Emit the loader map
  with literal dynamic import paths so Turbopack sees one boundary per module. Load
  requested modules with a `for...of` loop and `await` each loader before starting the
  next, preserving top-level evaluation order as well as result order. `Promise.all`
  is forbidden because concurrent evaluation would add a second experimental
  variable. Sort neither module order nor object properties: preserve the stock
  configured order.

  Write via temporary file + rename. Track every support, additive, backup, and
  temporarily modified path in `manifest.json` so revert restores or deletes only
  named experiment-owned targets. Reject an existing untracked target.

- [ ] **Step 4: Patch only fixture `src/bootstrap.ts` and prove allowlist scope**

  Require its original hash, save exact bytes, apply the two-line import/load change,
  and require a source-tree allowlist containing only `src/bootstrap.ts`. Record
  ignored experiment and additive generated files separately. Any package, lock,
  dev-script, `/start`, CLI registry, route registry, or pre-existing generated-file
  change aborts the arm.

- [ ] **Step 5: Run stock generation twice and prove deterministic GREEN**

  Use Node 24 and execute the fixture's normal `yarn generate`, followed by `apply`,
  twice. Require:

  - every pre-existing generated-file hash unchanged after each pass;
  - exactly 52 flat per-module files plus one loader file;
  - byte-identical additive inventory and hashes on the second pass;
  - no stale or extra split file;
  - loader has no static import of a module convention or locale;
  - runtime rejection for an unknown ID and for a rejected module load, with no
    partial array returned;
  - every relative static/dynamic specifier resolves to the same absolute target as
    in the legacy barrel;
  - every file has exactly one shared-registry import and no duplicate binding;
  - every convention sentinel occurs only in its owning per-module file;
  - `/start` and `modules.app.generated.ts` keep their fixed hashes;
  - installed CLI generator keeps its fixed hash.

- [ ] **Step 6: Prove semantic and async-order parity before measurement**

  Import legacy and split registries in isolated Node 24 child processes using the
  fixture's normal TypeScript loader. Canonicalize functions by their source/import
  identity and compare all serializable fields. Require identical module count,
  ordered IDs, property presence, translation locales, feature IDs/owners,
  subscriber IDs/counts, worker IDs/counts, integration/bundle IDs, setup presence,
  encryption/extension/CE inventories, and dashboard widget declarations.

  Instrument the temporary bootstrap evaluation once with an ignored test harness:
  defer one loader promise and prove `createBootstrap` cannot be observed before all
  loaders resolve; then prove its `modules` argument has the complete ordered
  inventory. Record module evaluation start/end order and require it equals the exact
  52-ID tuple. A rejected loader must reject module evaluation and never call
  `createBootstrap`; no partial registry or legacy fallback is allowed.

  Store `legacy-inventory.json`, `split-inventory.json`, `inventory-diff.json`, and
  `async-order.json`. `inventory-diff.json` must be an empty structured diff.

  After parity is proven, add two fixture-only process-local diagnostics to the
  emitted loader. First, after all modules resolve, write exactly one stderr record:

  ```text
  [registry-split:modules-loaded] pid={pid} moduleCount=52 orderedIdsSha256={digest} timestamp={iso}
  ```

  Second, locate module `query_index` and subscriber
  `query_index:coverage_warmup` for event `query_index.coverage.warmup`; fail apply if
  it is absent. Wrap only that handler with a transparent `try/finally` diagnostic
  that writes process PID, subscriber ID, event, and ISO timestamp on entry and exit,
  then invokes/awaits the original handler and preserves its value or error. The
  underlying lazy-handler import identity is captured before wrapping and must equal
  the legacy inventory. Record the deliberate wrapper separately from the empty
  semantic diff. No other module contract may be mutated.

- [ ] **Step 7: Review Task 1 before starting the app**

  A fresh reviewer inspects the script, manifest, outputs, bootstrap diff, RED/GREEN
  evidence, semantic inventory, and exact allowlist. Stop and repair any partial
  behavior, unsafe cleanup, regex-based AST extraction, dependency drift, or missing
  parity evidence before Task 2.

---

### Task 2: Run one valid 180-second standalone browser measurement

**Files:**

- Create in fixture: `.mercato/dev-rss/registry-split-coordinator.mjs`
- Create in fixture:
  `.mercato/dev-rss/evidence/stable-registry-split-all-enabled/**`
- Modify during HMR and restore in fixture:
  `src/modules/memory_probe/backend/memory-probe/page.tsx`
- Read profiler from worktree: `scripts/profile-dev-rss.mjs`

**Measurement label:** `stable-registry-split-all-enabled`

- [ ] **Step 1: Derive a single-arm coordinator from accepted evidence tooling**

  Copy the accepted stable CPU coordinator into the ignored fixture path and remove
  every selectable runtime arm. Add calls to the Task 1 script's `verify`, `check`,
  and inventory gates. Preserve the accepted profiler spawn, process-tree sampling,
  identity capture, browser schedule, topology capture, lifecycle parsing, graceful
  shutdown, and bounded audits.

  The coordinator must reject any `OM_*` value that changes warmup, telemetry,
  scheduler, worker, supervisor, bundler, source maps, minification, or memory limit
  from the authoritative standard composition. It may set only evidence paths,
  `OM_DEV_AUTO_OPEN=0`, credentials supplied to the browser controller, and the
  already accepted local database connection values required by the fixture.

- [ ] **Step 2: Extend browser evidence for feature and subscriber behavior**

  The browser operator must read the in-app browser skill completely. Use the real
  browser and default credentials `superadmin@acme.com` / `secret`.

  Capture, in one browser JSON:

  - login form interaction and successful authenticated redirect;
  - protected `/backend/memory-probe` URL and visible `Baseline marker A`;
  - `/api/auth/admin/nav` response or visible shell entries proving feature-filtered
    admin navigation remains populated, plus at least one off-convention feature
    ownership assertion selected from the legacy inventory;
  - the exact `[registry-split:modules-loaded]` record from the measured Next PID,
    with module count 52 and the expected ordered-ID digest, proving that process
    evaluated the split loader rather than the legacy bootstrap barrel;
  - entry and exit records from subscriber `query_index:coverage_warmup` handling the
    login-emitted `query_index.coverage.warmup` event, timestamped inside the login
    window and carrying that same measured Next PID;
  - source edit timestamp, visible `Baseline marker B`, same URL, and an explicit
    assertion that no browser `goto`, reload, or navigation occurred after the edit;
  - actual Next server PID/start identity immediately before and after hot reload.

  An HTTP 200 or offline inventory alone is insufficient for subscriber, split-loader,
  or feature parity.

- [ ] **Step 3: Execute the exact fixed-timing run with standard `yarn dev`**

  After the zero-state pre-audit and Task 1 checks, launch unchanged `yarn dev` and
  attach the worktree profiler to the dev root. The fixture's automatic local
  migration is authorized. Enforce:

  - profiler first successful sample no later than T+2 seconds;
  - 1,000 ms interval, duration `180000 ± 2000` ms, at least 170 samples;
  - browser work begins at T+60 seconds;
  - marker A→B source edit at T+100 seconds;
  - marker B, identity, feature, and subscriber assertions complete by T+140 seconds;
  - graceful complete-tree stop at T+180 seconds.

  Record raw profiler JSON, profiler log, dev log, browser JSON, screenshots,
  process identities, full topology, seed/source/generated hashes, inventory files,
  apply manifest, scheduler lifecycle, pre-audit, and post-audit together under the
  measurement label.

- [ ] **Step 4: Validate topology, scheduler lifecycle, and unchanged controls**

  Require Node 24.13.1 for coordinator, profiler, dev, browser controller, Next,
  worker, and scheduler processes. Require installed Next 16.2.11 and React 19.2.7.

  Require the same standard separate worker and scheduler process classes as the
  authoritative baseline, repeated scheduler execute/enqueue/consume/complete
  evidence, normal warmup evidence, unchanged telemetry location, and clean graceful
  shutdown. The Next PID and start identity must match across HMR.

- [ ] **Step 5: Compute the bounded decision**

  Compare the valid report with authoritative medians:

  | Metric | Baseline median |
  | --- | ---: |
  | Peak RSS | 8,607.89 MB |
  | Mean RSS | 6,643.70 MB |
  | CPU core-seconds | 130.24 |
  | Mean CPU | 72.43% |
  | Peak CPU | 876.91% |

  Calculate percentage deltas without rounding before the gate. The memory gate is
  `summary.peakTotalMb <= 6025.52`. Report CPU deltas as secondary evidence; CPU does
  not invalidate a memory pass, but a regression must be recorded.

  Mark the run invalid rather than interpreting it if any timing, sample count,
  browser, identity, inventory, feature, subscriber, scheduler, topology, seed,
  dependency, or audit gate fails. A retry must restore the exact seed and use a new
  label suffix; never overwrite the invalid attempt.

- [ ] **Step 6: Fresh evidence review**

  A fresh reviewer independently recalculates summary values from raw samples,
  verifies timestamps against root start, checks browser commands after the edit,
  compares identities, confirms contract inventory equality and standard topology,
  and classifies the run as valid pass, valid reject, or invalid. Do not update the
  repository evidence until review is approved.

---

### Task 3: Restore exactly, document the decision, and stop at the approved boundary

**Files:**

- Modify:
  `.ai/runs/2026-07-30-standalone-dev-memory/root-cause.md`
- Modify:
  `.ai/specs/2026-07-30-standalone-dev-memory-reduction.md`
- Read: Task 2 evidence and independent review
- Delete only fixture paths listed in the experiment manifest
- Restore fixture: `src/bootstrap.ts` and marker source

- [ ] **Step 1: Revert the fixture with manifest-guarded cleanup**

  In a `finally` path, require every owned support/additive file's recorded experiment
  hash before deleting it, except `manifest.json` itself: validate that file against
  its closed schema and exact path, and record the retained copy's hash externally in
  the restoration report. Refuse broad directory deletion. The retained
  `.mercato/dev-rss/evidence/stable-registry-split-all-enabled/` directory is not
  manifest-owned and must never be a cleanup target.

  Restore the exact saved bootstrap bytes and marker A, copy the manifest, support
  script hashes, and restoration report into that retained evidence directory, then
  remove only the individually named coordinator, backup, additive outputs, and
  experiment support files. The revert driver deletes `manifest.json` and its own
  script as its final two owned paths after the retained restoration report is
  durably renamed into place. Then run stock `yarn generate`.

  Verify every fixed precondition hash, the 5,629-entry canonical seed digest, marker
  A hash, package/lock/dependency hashes, zero additive registry files, zero source
  changes, zero experiment support files/additive registries outside the retained
  evidence directory, zero fixture processes, zero profiler/browser controllers,
  zero worker/scheduler processes, and no listeners on ports 3000 or 4000.

- [ ] **Step 2: Document one of three exact outcomes**

  Add the observed metrics, evidence paths, inventory result, and reviewer verdict to
  both run notes and the standalone memory spec:

  1. **Valid reject:** all behavior gates passed but peak exceeded 6,025.52 MB. Reject
     the all-enabled barrel-shape hypothesis for the 30% delivery goal and park it;
     do not implement production code.
  2. **Valid attribution pass:** all behavior gates passed and peak was at or below
     6,025.52 MB. Record that the experiment merits a production spec amendment and
     three-run candidate cohort, but do not implement it in this task.
  3. **Invalid:** identify the exact failed gate and retain the attempt outside all
     comparisons. Retry only after exact restoration and repair.

  State explicitly that a true route subset remains unapproved and would require a
  separate shared-bootstrap/module-registry architecture decision even if the
  all-enabled split passes.

- [ ] **Step 3: Validate and commit documentation only**

  Run:

  ```bash
  git diff --check
  git status --short
  ```

  Confirm the diff contains only the run/spec evidence documentation expected by
  this experiment and no fixture, dependency, generated, app, template, or runtime
  code. This plan is committed before execution and must remain unchanged.
  Commit with:

  ```bash
  git add .ai/runs/2026-07-30-standalone-dev-memory/root-cause.md \
    .ai/specs/2026-07-30-standalone-dev-memory-reduction.md
  git commit -m "docs: measure split bootstrap registry"
  ```

- [ ] **Step 4: Final boundary check**

  If the arm rejected, return the measured reason and the already parked CPU result.
  If it passed, request/obtain explicit production implementation authority only
  after presenting the proposed spec amendment, test list, app/template parity, and
  three-run verification gate. Do not infer approval for route-subset loading from
  approval of this all-enabled fixture experiment.

## Stop Conditions

Stop, restore, and classify the attempt invalid if any of these occurs:

- legacy and split module counts, ordered IDs, or normalized full-contract inventory
  differ;
- any module chunk fails, loads twice unexpectedly, or produces a partial registry;
- `createBootstrap()` runs before all 52 module promises resolve;
- module evaluation order differs from the configured tuple, the measured Next PID
  lacks the split-loader record, or the exact query-index subscriber lacks matching
  entry/exit records during login;
- a package, lockfile, installed dependency, dev script, `/start`, CLI registry,
  route registry, or existing generated file changes;
- login, admin nav feature filtering, subscriber behavior, protected probe, A→B hot
  reload, Next identity, worker, scheduler, warmup, telemetry, or shutdown evidence
  is incomplete;
- browser navigation/reload occurs after the marker edit;
- measurement timing/sample count or zero-state audit fails;
- the fixture cannot be restored to every fixed hash and zero-process state.

## Compatibility Boundary

The fixture arm is additive and preserves all frozen/stable generated filenames and
exports: `modules.app.generated.ts`, `modules.bootstrap.generated.ts`, named
`modules`, default exports, `modulesInfo`, and `bootstrapModules`. It changes no API,
database, event ID, ACL ID, DI key, CLI command, dependency, or package surface.

A future production all-enabled split would require repository generator tests,
app/create-app-template parity, top-level-await bootstrap tests, stale-output cleanup,
and three exact-seed standalone runs. A route-subset design would additionally change
the semantics of synchronous `BootstrapData.modules` and `getModules()` consumers;
that work is deliberately outside this approved experiment.
