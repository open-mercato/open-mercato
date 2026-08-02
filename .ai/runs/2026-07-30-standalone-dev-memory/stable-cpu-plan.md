# Stable Standalone Memory and CPU Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce a scaffolded standalone app's median peak dev-mode process-tree
RSS by at least 30% on the current locked toolchain, while measuring CPU reduction
toward 30% and preserving the full developer workflow.

**Architecture:** Extend the existing external process-tree sampler with CPU-time
accounting from the same `ps` snapshots, then create a fresh three-run
pre-optimization cohort and a matched three-run candidate cohort from one retained
Next 16.2.11 cache/source seed. Compose only current runtime controls—telemetry
placement, opt-in targeted warmup, and the embedded scheduler—and ship only the
controls proven load-bearing by the stable fixture experiment.

**Tech Stack:** Node.js 24.13.1, Yarn 4.17.1, built-in `node:*` modules, platform
`ps`, Next.js/Turbopack 16.2.11, Verdaccio 6, Playwright, and the existing Open
Mercato dev/profiling scripts.

## Global Constraints

- Use `/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin` first in `PATH` for
  profiler, dev runtime, browser workflow, build, and tests.
- Do not change `package.json`, `apps/mercato/package.json`,
  `packages/create-app/template/package.json.template`, or `yarn.lock`.
- Do not install, update, or pin any dependency. Next, `@next/env`, and the active
  platform SWC package remain exactly `16.2.11`; React and React DOM remain
  `19.2.7`.
- The only hard performance gate is at least 30% reduction in the median of three
  `summary.peakTotalMb` values against the fresh CPU-capable baseline cohort.
- CPU is measured from the same six runs as median `cpuCoreSeconds`, with
  `meanTotalCpuPercent` and `peakTotalCpuPercent` retained as diagnostics. Aim
  toward 30%; CPU cannot block a passing memory candidate, and any remaining work
  or regression is documented and parked.
- Every measured run lasts `180000 ± 2000` ms, samples every 1000 ms, and retains
  at least 170 successful samples.
- Restore and hash-verify one stable Next 16.2.11 cache seed and `Baseline marker
  A` source before every baseline and candidate run.
- The profiler's first successful sample is `T+0`; start the browser at `T+60s`,
  edit marker A to B at `T+100s`, observe HMR by `T+140s`, and stop at `T+180s`.
- Every run logs in with the default initialized super-administrator fixture,
  visits `/backend/memory-probe`, observes A then B without navigation/reload, and
  proves the actual Next server PID/start identity is unchanged across the edit.
- Every run starts from a global zero-process/zero-listener audit and ends with a
  bounded audit proving no fixture processes and no listeners on ports 3000/4000.
- Preserve scheduler functionality: execute, enqueue, consume, complete, and
  graceful shutdown must be retained when scheduler embedding is selected.
- Mirror runtime behavior between `apps/mercato/scripts/dev.mjs` and
  `packages/create-app/template/scripts/dev-runtime.mjs`, and between
  `scripts/dev.mjs` and `packages/create-app/template/scripts/dev.mjs`.
- Preserve `BACKWARD_COMPATIBILITY.md`; all environment changes are additive and
  keep explicit overrides working.
- Runner: local host mode. No Docker app container is used for validation.

---

## File Structure

- `scripts/dev-memory-sampler.mjs`
  - Parses RSS/CPU process snapshots, walks the descendant tree, and summarizes
    memory plus CPU core-seconds.
- `scripts/profile-dev-rss.mjs`
  - Keeps the existing CLI and JSON shape, appends CPU fields, and renders CPU in
    comparison tables.
- `scripts/__tests__/dev-memory-sampler.test.mjs`
  - Covers CPU-time parsing, legacy snapshot compatibility, descendant totals,
    PID churn, and empty/legacy reports.
- `scripts/__tests__/profile-dev-rss.test.mjs`
  - Covers CPU report/table rendering while preserving chronological RSS deltas.
- `apps/mercato/scripts/dev.mjs`
  - Monorepo runtime implementation of opt-in targeted route warmup.
- `packages/create-app/template/scripts/dev-runtime.mjs`
  - Standalone mirror of the targeted-warmup behavior.
- `scripts/dev.mjs`
  - Root wrapper whose existing embedded-scheduler default is the reference.
- `packages/create-app/template/scripts/dev.mjs`
  - Standalone wrapper that must mirror the embedded-scheduler default and honor
    explicit `false`.
- `scripts/__tests__/dev-cache-purge.test.mjs`
  - Guards warmup runtime parity, ready-state completion, and root/template
    scheduler-default parity.
- `packages/create-app/src/lib/template-dev-log-files.test.ts`
  - Executes the template wrapper and proves inherited default/override values.
- `packages/create-app/README.md`
  - Documents `OM_DEV_TARGETED_WARMUP=1` as the opt-in for the old eager warmup.
- `.ai/runs/2026-07-30-standalone-dev-memory/{baseline,root-cause,verification}.md`
  - Retains the authoritative six-run CPU/RSS evidence and selected file manifest.
- `.ai/specs/2026-07-30-standalone-dev-memory-reduction.md`
  - Receives the confirmed stable composition, exact results, and completion audit.

---

### Task 1: Add CPU-time accounting to the process-tree sampler

**Files:**

- Modify: `scripts/dev-memory-sampler.mjs`
- Modify: `scripts/__tests__/dev-memory-sampler.test.mjs`

**Interfaces:**

- Consumes: `ps -A -o pid=,ppid=,rss=,time=,args=` output.
- Produces: `parseCpuTimeSeconds(raw): number | null`.
- Produces: `parsePsOutput(stdout)` records with additive
  `cpuTimeSeconds: number | null`.
- Produces: `summarizeMemorySamples()` fields
  `cpuCoreSeconds`, `meanTotalCpuPercent`, `peakTotalCpuPercent`, and
  `peakCpuTimestamp`; every field is `null` when no CPU-bearing samples exist.
- Preserves: existing RSS fields, process classes, `parsePsOutput()` support for
  historical four-column snapshots, and the sampler's public function names.

- [ ] **Step 1: Write failing CPU-time parser and legacy-compatibility tests**

  Add imports for `parseCpuTimeSeconds` and `parsePsOutput`, then add:

  ```js
  test('parseCpuTimeSeconds accepts Darwin and Linux ps time formats', () => {
    assert.equal(parseCpuTimeSeconds('0:01.25'), 1.25)
    assert.equal(parseCpuTimeSeconds('01:02:03'), 3723)
    assert.equal(parseCpuTimeSeconds('2-03:04:05'), 183845)
    assert.equal(parseCpuTimeSeconds('not-a-time'), null)
  })

  test('parsePsOutput keeps legacy snapshots and adds cpu time when present', () => {
    const processes = parsePsOutput([
      '100 1 1024 0:01.50 node ./scripts/dev.mjs',
      '101 100 2048 node next-server (v16.2.11)',
    ].join('\n'))
    assert.equal(processes[0].cpuTimeSeconds, 1.5)
    assert.equal(processes[0].command, 'node ./scripts/dev.mjs')
    assert.equal(processes[1].cpuTimeSeconds, null)
    assert.equal(processes[1].command, 'node next-server (v16.2.11)')
  })
  ```

- [ ] **Step 2: Run the focused test and confirm red**

  Run:

  ```bash
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH node --test scripts/__tests__/dev-memory-sampler.test.mjs
  ```

  Expected: failure because `parseCpuTimeSeconds` is not exported and CPU-bearing
  `ps` rows are not parsed.

- [ ] **Step 3: Implement compatible CPU-time parsing and sampling**

  Implement the parser with this contract:

  ```js
  export function parseCpuTimeSeconds(raw) {
    const match = String(raw ?? '').trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/)
    if (!match) return null
    const days = Number(match[1] ?? 0)
    const hours = Number(match[2] ?? 0)
    const minutes = Number(match[3])
    const seconds = Number(match[4])
    const total = (((days * 24) + hours) * 60 + minutes) * 60 + seconds
    return Number.isFinite(total) ? total : null
  }
  ```

  Change the live `ps` columns to `pid=,ppid=,rss=,time=,args=`. In
  `parsePsOutput`, parse the first token after RSS as CPU time only when it matches
  the supported time grammar; otherwise retain the entire remainder as the legacy
  command. Add `cpuTimeSeconds` to retained sample-process entries.

- [ ] **Step 4: Write failing aggregation tests for child churn and legacy data**

  Add samples where PID 10 advances `1.0 → 2.5` seconds, PID 11 first appears with
  `0.5`, and PID 12 exits after `0.25`. Assert total CPU core-seconds `3.25`, a
  finite peak/mean CPU percentage, and `null` CPU summary fields for historical
  RSS-only samples.

- [ ] **Step 5: Run the focused test and confirm the aggregation assertions fail**

  Run the same `node --test` command. Expected: parsing passes, but CPU summary
  fields are missing.

- [ ] **Step 6: Implement CPU aggregation in `summarizeMemorySamples`**

  Walk samples chronologically. Track the last non-negative CPU time per PID. Add
  the full observed CPU time for a newly seen PID and only positive deltas for a
  known PID. For each interval after the first, compute
  `intervalCpuPercent = intervalCoreSeconds / elapsedSeconds * 100`. Return rounded
  two-decimal totals and `null` fields when no sample contains CPU time. Do not
  remove existing RSS summary fields.

  Use an internal accumulator with this shape:

  ```js
  const previousCpuByPid = new Map()
  let cpuCoreSeconds = 0
  let peakTotalCpuPercent = null
  let peakCpuTimestamp = null

  for (const sample of samples) {
    let intervalCoreSeconds = 0
    for (const proc of sample.processes ?? []) {
      if (!Number.isFinite(proc.cpuTimeSeconds) || proc.cpuTimeSeconds < 0) continue
      const previous = previousCpuByPid.get(proc.pid)
      const delta = previous == null
        ? proc.cpuTimeSeconds
        : Math.max(0, proc.cpuTimeSeconds - previous)
      previousCpuByPid.set(proc.pid, proc.cpuTimeSeconds)
      intervalCoreSeconds += delta
    }
    cpuCoreSeconds += intervalCoreSeconds
    // For samples after the first, divide intervalCoreSeconds by timestamp delta.
  }
  ```

- [ ] **Step 7: Run focused sampler tests**

  Run the Task 1 test command. Expected: all tests pass.

- [ ] **Step 8: Commit Task 1**

  ```bash
  git add scripts/dev-memory-sampler.mjs scripts/__tests__/dev-memory-sampler.test.mjs
  git commit -m "feat(dev): measure process-tree cpu time"
  ```

---

### Task 2: Surface CPU metrics in profiler reports without breaking RSS reports

**Files:**

- Modify: `scripts/profile-dev-rss.mjs`
- Modify: `scripts/__tests__/profile-dev-rss.test.mjs`

**Interfaces:**

- Consumes: Task 1 CPU fields from `summarizeMemorySamples`.
- Produces: Markdown columns `CPU core-s`, `Mean CPU`, and `Peak CPU`.
- Preserves: existing CLI flags, report JSON fields, chronological ordering, and
  RSS delta text.

- [ ] **Step 1: Write the failing CPU table test**

  Add CPU fields to both report fixtures and assert:

  ```js
  assert.match(table, /\| CPU core-s \| Mean CPU \| Peak CPU \|/)
  assert.match(table, /120\.5/)
  assert.match(table, /66\.25%/)
  assert.match(table, /310\.75%/)
  ```

  Add one legacy report without CPU fields and assert its cells render `?`, while
  the existing `-1172.5 MB` delta assertion still passes.

- [ ] **Step 2: Run the focused profiler test and confirm red**

  ```bash
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH node --test scripts/__tests__/profile-dev-rss.test.mjs
  ```

  Expected: failure because the CPU columns do not exist.

- [ ] **Step 3: Extend the report table and completion log**

  Render CPU values from `summary.cpuCoreSeconds`,
  `summary.meanTotalCpuPercent`, and `summary.peakTotalCpuPercent`; use `?` for
  `null`/missing values. Keep the RSS columns and final RSS delta unchanged. Append
  one profiler completion line showing CPU core-seconds and mean/peak percentages
  only when CPU data is present.

  Use `formatCpuPercent(value)` returning `?` for non-finite values and
  `${value}%` otherwise, and append cells in this order:

  ```js
  const cpuCoreSeconds = Number.isFinite(r.summary?.cpuCoreSeconds)
    ? r.summary.cpuCoreSeconds
    : '?'
  const meanCpu = formatCpuPercent(r.summary?.meanTotalCpuPercent)
  const peakCpu = formatCpuPercent(r.summary?.peakTotalCpuPercent)
  ```

- [ ] **Step 4: Run profiler and sampler tests**

  ```bash
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH node --test scripts/__tests__/dev-memory-sampler.test.mjs scripts/__tests__/profile-dev-rss.test.mjs
  ```

  Expected: all tests pass.

- [ ] **Step 5: Verify the live platform snapshot format**

  Run a 5-second profiler smoke against a Node child and inspect the JSON. Confirm
  `cpuTimeSeconds` exists on sampled processes and all four CPU summary fields are
  finite, without changing any package manifest or lockfile.

- [ ] **Step 6: Commit Task 2**

  ```bash
  git add scripts/profile-dev-rss.mjs scripts/__tests__/profile-dev-rss.test.mjs
  git commit -m "feat(dev): report cpu alongside rss"
  ```

---

### Task 3: Measure the authoritative stable baseline cohort

**Files:**

- Modify: `.ai/runs/2026-07-30-standalone-dev-memory/baseline.md`
- Create runtime evidence below:
  `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/evidence/stable-cpu-baseline/`
- Create reports:
  `stable-cpu-baseline-{1,2,3}.json` and matching browser JSON/screenshots.

**Interfaces:**

- Consumes: Task 2 profiler, merge-base runtime identity
  `77c0a5591b1faba5781b91ed102c89950ac66e7c`, Node 24.13.1, and the restored
  standalone fixture.
- Produces: the only authoritative RSS/CPU baseline denominator and one exact
  cache/source seed manifest shared by candidate runs.

- [ ] **Step 1: Record no-dependency and runtime identity gates**

  Save SHA-256 hashes for the four prohibited files, installed Next/`@next`/React
  versions, Node executable/version, merge-base SHA, fixture package/lockfile, and
  the probe marker-A source into `stable-cpu-baseline/identity.txt`.

- [ ] **Step 2: Create one authoritative stable seed**

  Restore the fixture to the merge-base runtime behavior, run one unmeasured
  preparatory login/page/A→B HMR workflow, stop cleanly, restore marker A, and copy
  `.mercato/next/dev` plus the marker-A source into a timestamped seed directory.
  Retain sorted SHA-256 manifests for every seed file and the marker source.

- [ ] **Step 3: Upgrade the fixture-only browser runner**

  Keep it under `.mercato/dev-rss/` (never commit it). It must wait for absolute
  profiler offsets, submit the default fixture credentials without logging the
  password, record login status, assert marker A at `T+60s`, record the actual
  `next-server` PID/start identity before `T+100s`, apply A→B at `T+100s`, observe
  marker B by `T+140s` without navigation/reload, and re-check the same Next
  identity. Store timings and identities in browser JSON.

- [ ] **Step 4: Run baseline 1 from global clean state**

  Prove zero fixture/profiler/browser/worker/scheduler processes and no listeners
  on 3000/4000. Restore the exact seed and marker-A hash. Start standalone
  `yarn dev`, attach the CPU/RSS profiler within two seconds, execute the one
  browser pass at fixed offsets, exercise scheduler lifecycle, stop the complete
  root tree, and retain a bounded zero-state post-audit.

- [ ] **Step 5: Repeat independently as baseline 2 and baseline 3**

  Do not start the next run until the previous post-audit passes. Each report must
  span `180000 ± 2000` ms, contain at least 170 samples, prove Node 24 for dev,
  profiler, and browser, and use the same seed/source manifests.

- [ ] **Step 6: Compute and record baseline medians**

  Record all three values and medians for peak/mean total RSS, CPU core-seconds,
  mean/peak CPU percentage, dominant class, browser timings, Next identity, and
  shutdown audits. State explicitly that this cohort supersedes the historical RSS
  denominator for final acceptance.

- [ ] **Step 7: Verify prohibited files are unchanged and commit evidence docs**

  ```bash
  git diff --exit-code -- package.json apps/mercato/package.json packages/create-app/template/package.json.template yarn.lock
  git add .ai/runs/2026-07-30-standalone-dev-memory/baseline.md
  git commit -m "docs: record stable cpu and rss baseline"
  ```

---

### Task 4: Confirm the stable runtime composition in the disposable fixture

**Files:**

- Modify: `.ai/runs/2026-07-30-standalone-dev-memory/root-cause.md`
- Modify: `.ai/specs/2026-07-30-standalone-dev-memory-reduction.md`
- Temporary fixture-only edits: `scripts/dev.mjs` and `scripts/dev-runtime.mjs`
- Runtime reports: `stable-composition-telemetry-warmup.json` and
  `stable-composition-embedded-scheduler.json`

**Interfaces:**

- Consumes: Task 3 baseline/seed and existing environment controls
  `OM_MODULE_RESOURCE_USAGE_DIR` and
  `OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER`.
- Produces: one isolated warmup result, one composed stable result, and the exact
  load-bearing production/test file manifest for Task 5.

- [ ] **Step 1: State the stable composition hypothesis**

  Record: “Watched telemetry snapshots plus automatic authenticated route warmup
  and a separate scheduler process cause avoidable compile invalidation, startup
  work, and process overhead; relocating telemetry, skipping automatic warmup, and
  embedding scheduler polling should reduce total RSS and CPU while preserving the
  user-driven first compile and scheduler behavior.”

- [ ] **Step 2: Run an isolated warmup-suppression arm**

  Apply a reversible fixture-only guard that marks the runtime ready and writes
  `warmup-skipped` without issuing the three automatic HTTP requests. Keep baseline
  telemetry and scheduler topology unchanged. Restore the exact Task 3 seed, run
  the fixed 180-second workflow once, and record RSS/CPU deltas versus the baseline
  median. Revert the fixture edit afterward.

- [ ] **Step 3: Run the complete current-tool composition**

  From a fresh exact seed clone, combine the same warmup guard with
  `OM_MODULE_RESOURCE_USAGE_DIR=.mercato/next/module-resource-usage` and
  `OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER=true`. Run one fixed workflow and retain
  one embedded `queue worker --all --with-scheduler`, no scheduler child, repeated
  scheduler execute/enqueue/consume/complete evidence, and clean shutdown.

- [ ] **Step 4: Decide from evidence without dependency changes**

  If the composition's peak total RSS is at or below 70% of the Task 3 median,
  select its load-bearing controls. If it is above 70%, test the already available
  lightweight-supervisor arm once from the same seed; retain it only when its own
  RSS delta is positive. If the stable stack still misses the hard threshold,
  return to one new source-graph hypothesis rather than changing dependencies or
  stacking a falsified control.

- [ ] **Step 5: Restore the fixture and amend the spec**

  Restore exact package, lockfile, runtime, cache, and marker hashes. Record the
  experiment values, CPU result, exact selected production/test files, additive
  environment contract, rollback for every selected control, and the focused red
  assertions. The amendment must remove generic file-boundary wording before Task
  5 begins.

- [ ] **Step 6: Commit the confirmed stable manifest**

  ```bash
  git add .ai/runs/2026-07-30-standalone-dev-memory/root-cause.md .ai/specs/2026-07-30-standalone-dev-memory-reduction.md
  git commit -m "docs: confirm stable standalone memory controls"
  ```

---

### Task 5: Implement the selected runtime controls test-first

**Files:**

- Modify: `apps/mercato/scripts/dev.mjs`
- Modify: `packages/create-app/template/scripts/dev-runtime.mjs`
- Modify: `packages/create-app/template/scripts/dev.mjs`
- Verify/modify only if Task 4 requires it: `scripts/dev.mjs`
- Modify: `scripts/__tests__/dev-cache-purge.test.mjs`
- Modify: `packages/create-app/src/lib/template-dev-log-files.test.ts`
- Modify: `packages/create-app/README.md`

**Interfaces:**

- Consumes: Task 4 exact selected-control manifest.
- Produces: additive `OM_DEV_TARGETED_WARMUP=1` opt-in; default no-request ready
  completion; root/template embedded-scheduler parity with explicit `false`
  preserved.

- [ ] **Step 1: Write failing runtime parity assertions**

  In `scripts/__tests__/dev-cache-purge.test.mjs`, inspect both runtime sources and
  assert they contain the same `OM_DEV_TARGETED_WARMUP` resolution, a
  `warmup-skipped` ready-file state, and a disabled path that sets
  `runtimeWarmupState.completed = true` before publishing ready state. Inspect both
  wrapper sources and assert they default
  `OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER` to `'true'` only when the inherited
  value is absent/blank.

  Add this source-contract test using the existing `here` path pattern:

  ```js
  test('targeted route warmup is opt-in and mirrored by both runtimes', () => {
    for (const runtimePath of runtimeSources) {
      const source = fs.readFileSync(runtimePath, 'utf8')
      assert.match(source, /process\.env\.OM_DEV_TARGETED_WARMUP/)
      assert.match(source, /writeWarmupReadyFile\('warmup-skipped'\)/)
      assert.match(source, /runtimeWarmupState\.completed = true/)
      assert.match(source, /if \(!targetedRouteWarmupEnabled\)/)
    }
  })
  ```

- [ ] **Step 2: Write failing executable template-wrapper assertions**

  Extend `runTemplateDevWrapper` to print both
  `OM_MODULE_RESOURCE_USAGE_DIR` and
  `OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER`. Add tests asserting default `'true'`
  and explicit shell `'false'` preservation. Keep all existing module-resource
  precedence assertions unchanged.

  Make the fake runtime print one JSON object and assert:

  ```ts
  assert.equal(result.value.moduleResourceUsageDir, expectedPath)
  assert.equal(result.value.embedSchedulerInSharedWorker, 'true')

  const explicit = runTemplateDevWrapper({ embedSchedulerOverride: 'false' })
  assert.equal(explicit.value.embedSchedulerInSharedWorker, 'false')
  ```

- [ ] **Step 3: Run focused tests and confirm red**

  ```bash
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH node --test scripts/__tests__/dev-cache-purge.test.mjs
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH node --import tsx --test --test-timeout=120000 packages/create-app/src/lib/template-dev-log-files.test.ts
  ```

  Expected: failures for missing warmup opt-in/default-skip and missing template
  embedded-scheduler default.

- [ ] **Step 4: Implement default warmup skip with explicit opt-in**

  In both runtime files, resolve
  `const targetedRouteWarmupEnabled =
  isEnabledEnvFlag(process.env.OM_DEV_TARGETED_WARMUP)`. When runtime URL and ready
  signal exist but the flag is false, set the warmup state completed/healthy,
  publish normal ready splash state, write `warmup-skipped`, and do not issue any
  warmup request. When the flag is true, preserve the existing three-request flow
  unchanged.

  Mirror this control flow in both runtime files:

  ```js
  const targetedRouteWarmupEnabled = isEnabledEnvFlag(process.env.OM_DEV_TARGETED_WARMUP)

  function completeTargetedRouteWarmupWithoutRequests() {
    runtimeWarmupState.started = true
    runtimeWarmupState.completed = true
    runtimeWarmupState.failed = false
    runtimeWarmupState.promise = null
    writeWarmupReadyFile('warmup-skipped')
    updateSplashState({
      phase: 'App is ready',
      detail: 'Runtime ready; targeted warmup skipped',
      ready: true,
      readyUrl: runtimeWarmupState.baseUrl,
      progressCurrent: runtimeReadyProgressCurrent,
      progressTotal: startupProgress.total,
      progressPercent: resolveProgressPercent(runtimeReadyProgressCurrent, startupProgress.total),
      progressLabel: 'App is ready',
      activity: 'Runtime ready; targeted warmup skipped',
    })
  }

  function maybeStartTargetedRouteWarmup() {
    if (runtimeWarmupState.started || runtimeWarmupState.failed) return
    if (!runtimeWarmupState.baseUrl || !runtimeWarmupState.readySignalSeen) return
    if (!targetedRouteWarmupEnabled) {
      completeTargetedRouteWarmupWithoutRequests()
      return
    }
    runtimeWarmupState.promise = runTargetedRouteWarmup()
  }
  ```

- [ ] **Step 5: Mirror the embedded-scheduler wrapper default**

  Add to the template wrapper's `applyLocalDevBackgroundServiceDefaults` the same
  absent-or-blank check already used by root `scripts/dev.mjs`, assigning
  `env.OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER = 'true'`. Do not overwrite inherited
  `'false'`, `'0'`, or any other non-empty explicit value. Change root only if Task
  4 identified a parity defect.

  Add the root-equivalent block to the template wrapper:

  ```js
  if (
    typeof process.env.OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER !== 'string'
    || process.env.OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER.trim() === ''
  ) {
    env.OM_DEV_EMBED_SCHEDULER_IN_SHARED_WORKER = 'true'
  }
  ```

- [ ] **Step 6: Document the additive opt-in**

  Add `OM_DEV_TARGETED_WARMUP` to the standalone dev environment table in
  `packages/create-app/README.md`: default `0`; set `1` to precompile login, login
  POST, and authenticated backend routes automatically before reporting warmup
  completion.

- [ ] **Step 7: Run focused and adjacent tests**

  ```bash
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH node --test scripts/__tests__/dev-cache-purge.test.mjs scripts/__tests__/dev-memory-sampler.test.mjs scripts/__tests__/profile-dev-rss.test.mjs
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH node --import tsx --test --test-timeout=120000 packages/create-app/src/lib/template-dev-log-files.test.ts
  ```

  Expected: all tests pass.

- [ ] **Step 8: Verify no dependency drift and commit Task 5**

  ```bash
  git diff --exit-code -- package.json apps/mercato/package.json packages/create-app/template/package.json.template yarn.lock
  git add apps/mercato/scripts/dev.mjs packages/create-app/template/scripts/dev-runtime.mjs packages/create-app/template/scripts/dev.mjs scripts/dev.mjs scripts/__tests__/dev-cache-purge.test.mjs packages/create-app/src/lib/template-dev-log-files.test.ts packages/create-app/README.md
  git commit -m "perf(dev): reduce standalone warmup overhead"
  ```

---

### Task 6: Prove candidate acceptance and complete repository validation

**Files:**

- Modify: `.ai/runs/2026-07-30-standalone-dev-memory/verification.md`
- Modify: `.ai/runs/2026-07-30-standalone-dev-memory/root-cause.md`
- Modify: `.ai/specs/2026-07-30-standalone-dev-memory-reduction.md`
- Runtime reports: `stable-cpu-candidate-{1,2,3}.json` and matching browser/audit
  evidence.

**Interfaces:**

- Consumes: Tasks 1–5 and the exact Task 3 seed/baseline cohort.
- Produces: three accepted candidate reports, CPU result, repository gates, one
  final fresh scaffold smoke, and a requirement-by-requirement completion audit.

- [ ] **Step 1: Rebuild current packages without dependency changes**

  Run local mode once for the ordered gate:

  ```bash
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH yarn build:packages
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH yarn generate
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH yarn build:packages
  ```

  Publish to the isolated Verdaccio and update only repository packages/template
  runtime files in the existing fixture. Keep its app module, database, locked
  dependencies, and seed unchanged.

- [ ] **Step 2: Run candidate 1, 2, and 3 from independently clean states**

  Before each run, restore and verify the exact Task 3 cache/source seed and all
  dependency hashes. Use the fixed timing/browser workflow, prove the same Next
  identity survives A→B, exercise the selected scheduler topology, and require the
  bounded global post-stop audit before the next run.

- [ ] **Step 3: Compute the hard RSS result and report CPU**

  Compute medians for peak/mean RSS, CPU core-seconds, mean/peak CPU percentage,
  HMR timing, and relevant process classes. The hard formula is
  `(fresh baseline median peak RSS - candidate median peak RSS) / fresh baseline
  median peak RSS >= 0.30`. Record the CPU percentage from the analogous
  core-seconds formula; if it is below 30% or negative, park a focused follow-up
  without expanding this implementation.

- [ ] **Step 4: Run repository validation**

  ```bash
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH node --test scripts/__tests__/dev-memory-sampler.test.mjs scripts/__tests__/profile-dev-rss.test.mjs scripts/__tests__/dev-cache-purge.test.mjs
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH node --import tsx --test --test-timeout=120000 packages/create-app/src/lib/template-dev-log-files.test.ts
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH yarn typecheck
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH yarn test:create-app
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH yarn test:create-app:integration
  PATH=/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin:$PATH yarn build:app
  ```

- [ ] **Step 5: Run one final fresh scaffold smoke**

  Scaffold a new Verdaccio-backed standalone app from the validated current
  template, initialize it with its isolated database, add the memory-probe module,
  run `yarn dev`, log in, visit the page, edit A→B, prove unchanged Next identity,
  verify selected scheduler lifecycle, and stop with a clean global audit.

- [ ] **Step 6: Complete evidence docs and dependency audit**

  Update the run/spec documents with raw paths, all medians, formulas, CPU parked
  work, exact implementation/rollback, commands and exit codes, fresh scaffold
  evidence, and the final requirement matrix. Verify the four prohibited files
  match their pre-plan hashes and the worktree contains no unrelated changes.

- [ ] **Step 7: Commit final evidence**

  ```bash
  git add .ai/runs/2026-07-30-standalone-dev-memory/root-cause.md .ai/runs/2026-07-30-standalone-dev-memory/verification.md .ai/specs/2026-07-30-standalone-dev-memory-reduction.md
  git commit -m "docs: verify stable standalone memory reduction"
  ```
