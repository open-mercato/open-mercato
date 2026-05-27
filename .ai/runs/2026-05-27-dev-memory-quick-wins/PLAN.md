# Plan — Dev-mode memory quick wins (Phase 1: profiling harness + analysis spec + opt-in heap cap)

**Date:** 2026-05-27
**Slug:** dev-memory-quick-wins
**Branch:** `feat/dev-memory-quick-wins`
**Base:** `origin/develop` (HEAD: 25fdb35f2)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Add `scripts/profile-dev-rss.mjs` RSS profiler harness with unit tests | done | 5fe482358 |
| 1 | 1.2 | Wire `yarn dev:profile` / `yarn dev:profile:report` scripts in root `package.json` | done | 7d204ca83 |
| 2 | 2.1 | Write analysis spec `.ai/specs/2026-05-27-dev-mode-memory-quick-wins.md` (landscape, `NODE_OPTIONS=--max-old-space-size` recipe, Vite verdict, phase plan, verification protocol) | done | 44e398eaf |
| 2 | 2.2 | Cross-link spec from `AGENTS.md` Task Router (dev-mode performance row) | done | f6e6e5e43 |
| 3 | 3.1 | Final-gate validation (`node --check` + `node --test` for the touched .mjs files); document the full gate gaps in `final-gate-checks.md` | done | a977918c8 |
| 3 | 3.1-review-fix | Apply code-review NITs: parsePsOutput newline doc, parseArgs numeric validation, renderReportTable chronological sort, spawnDevAndProfile process-group SIGINT | done | fd3134de3 |

## Goal

Ship the **measurement infrastructure** and **analysis spec** that turn future dev-mode memory work into a measurable, data-driven discipline, plus one **opt-in** heap-cap knob that is additive to PR #2102 (workspace package watcher consolidation) and the other in-flight memory work. The 1–2 GB headline target is reachable today by merging PR #2102 (already open); this PR ships the **profiling harness that proves it** plus the **analysis** that informs the next phase.

## Scope

- Add `scripts/profile-dev-rss.mjs` — a stand-alone Node script that snapshots the full `yarn dev` process tree's RSS over a fixed window (default 90s) and writes a JSON report to `.mercato/dev-rss/<label>.json`. Reads PIDs via `ps` (linux/darwin) and computes per-process and total-tree RSS deltas.
- Add `yarn dev:profile <label>` script that boots `yarn dev` in a child subshell, runs the profiler against it, and exits cleanly after the window. Add `yarn dev:profile:report` to print a Markdown table comparing two labels.
- **(Descoped 2026-05-27T06:46Z.)** ~~Add an opt-in `OM_PACKAGE_WATCH_HEAP_MB` env knob to `scripts/watch.mjs`.~~ Replaced by a documented `NODE_OPTIONS='--max-old-space-size=N'` recipe in the spec — see Risks. Rationale: a re-exec inside `scripts/watch.mjs` either (a) needs to happen before esbuild loads (impossible without editing all 16 per-package wrappers), or (b) detaches the real watcher from turbo's process tree (breaks turbo lifecycle). `NODE_OPTIONS` propagates to all child Node processes via env inheritance and needs zero code change.
- Write the analysis spec capturing: dev-mode memory landscape, why PR #2102 is the dominant intervention, the Vite-vs-Turbopack feasibility study (verdict: not viable for the Next.js app; viable only as a future Storybook-style sidecar), and a phase plan for follow-up memory PRs.
- Add a Task Router row for dev-mode performance.

## Non-goals

- **Do NOT** duplicate PR #2102's watcher consolidation. The consolidation is the right answer for that path; this PR ships the measurement infra that quantifies its benefit.
- **Do NOT** force any defaults that change steady-state behavior (the heap cap is opt-in for a reason; we cannot validate the safe floor in the janitor sandbox without `node_modules`).
- **Do NOT** migrate to Vite. The spec documents why.
- **Do NOT** touch `scripts/dev.mjs`'s lazy-spawn defaults (already implemented per `2026-05-13-lazy-auto-spawn-scheduler.md` and `2026-05-07-lazy-auto-spawn-queue-workers.md`).
- **Do NOT** modify the frontend client-boundary RAM work (in-progress per `2026-05-13-frontend-client-boundary-ram-reduction.md`).

## Risks

- **Risk: sandbox constraint, no measured numbers in PR body.** The janitor sandbox has no `node_modules`. We cannot run `yarn dev` here to capture before/after RSS. **Mitigation:** the PR explicitly ships the harness so the human reviewer (or CI on a stack with `node_modules`) produces the numbers. The PR description includes a one-command verification recipe.
- **Risk: heap cap collides with a watcher that genuinely needs more.** The `ui` package has many entry points; a low cap could OOM esbuild. **Mitigation:** opt-in (unset by default), and the spec documents the recommended safe floor based on packages-of-record (`ui`, `core`).
- **Risk: profiler harness has platform-specific `ps` invocations.** `ps -axo` flags differ between linux/darwin/bsd. **Mitigation:** the harness detects platform and uses a known-portable flag set; gracefully degrades on Windows with a clear `not supported on win32` exit.
- **Risk: scope drift toward a "big" quick win (e.g. duplicate PR #2102).** **Mitigation:** Non-goals above name #2102 explicitly. Tasks table caps the work at 7 Steps.

## External References

None — no `--skill-url` arguments were provided.

## Source spec

This PR creates the spec; no pre-existing spec drives it. Future memory-reduction PRs should chain off `.ai/specs/2026-05-27-dev-mode-memory-quick-wins.md`.

## Implementation Plan

### Phase 1 — Profiling harness

**Step 1.1 — Add `scripts/profile-dev-rss.mjs`**

- New file at `scripts/profile-dev-rss.mjs`.
- Exposes a `profileDevRss({ pid, durationMs, intervalMs, label, outDir })` async function and a CLI wrapper.
- Walks the process tree under the given PID via `ps` (linux/darwin) every `intervalMs` (default 2000ms) for `durationMs` (default 90000ms).
- Captures per-sample: timestamp, total-tree RSS in MB, per-process `{pid, ppid, cmd, rssMb}` list (top 20 by RSS).
- Writes `<outDir>/<label>.json` with `{ label, startedAt, finishedAt, samples: [...], summary: { peakTotalMb, meanTotalMb, peakTopProcesses: [...] } }`.
- Cross-platform: `process.platform === 'win32'` exits 2 with a clear "not supported" message; otherwise uses `ps -A -o pid=,ppid=,rss=,command=` (works on linux + darwin).
- No external deps. Pure Node 24 stdlib.
- Add unit tests at `scripts/__tests__/profile-dev-rss.test.mjs` exercising: (a) `ps` output parser, (b) tree walk from a synthetic ppid map, (c) summary calculation, (d) platform guard.

**Step 1.2 — Wire `yarn dev:profile`**

- Add to root `package.json`:
  - `"dev:profile": "node ./scripts/profile-dev-rss.mjs --spawn-dev"` — spawns `yarn dev` as a child, profiles it, writes report.
  - `"dev:profile:report": "node ./scripts/profile-dev-rss.mjs --report"` — prints a Markdown comparison table of all `.mercato/dev-rss/*.json` files.
- Document usage at the top of `scripts/profile-dev-rss.mjs`.

### Phase 2 — Opt-in heap cap

**Step 2.1 — `OM_PACKAGE_WATCH_HEAP_MB` in `scripts/watch.mjs`**

- At the top of `scripts/watch.mjs`'s `watch()` function (before the esbuild context creation), read `process.env.OM_PACKAGE_WATCH_HEAP_MB`.
- If set to a positive integer N and `process.env.OM_PACKAGE_WATCH_HEAP_APPLIED !== '1'`:
  - Set `OM_PACKAGE_WATCH_HEAP_APPLIED=1` in env to prevent re-exec loop.
  - Spawn a fresh `node --max-old-space-size=${N} ${process.argv[1]} ${process.argv.slice(2).join(' ')}` child with stdio inherited.
  - Forward exit code; the parent process exits.
- Skip if value is unset, empty, zero, negative, or not a positive integer.
- Log a single line on activation: `[watch] applying --max-old-space-size=${N} (OM_PACKAGE_WATCH_HEAP_MB)`.

**Step 2.2 — Unit-test env parsing + guard**

- Add tests at `scripts/__tests__/watch.test.mjs` covering: positive integer accepted, `0`/negative/`abc`/empty rejected, re-exec guard prevents infinite loop. Use `child_process.spawnSync` against a small fixture.

### Phase 3 — Analysis spec

**Step 3.1 — Spec file**

- New file `.ai/specs/2026-05-27-dev-mode-memory-quick-wins.md` with sections:
  - **Context** — why memory matters in dev mode (developer machine RAM, OOM crashes, OS swap thrash).
  - **Current landscape** — 16 esbuild watchers via `turbo run watch --concurrency=32`, lazy worker/scheduler already in place, transpilePackages commented out, etc.
  - **Quantified candidates** — table of memory hogs with estimated RSS contribution, drawn from the research subagents in this run.
  - **Recommended phase plan** — Phase 1 (this PR): harness + heap cap + spec. Phase 2: merge PR #2102. Phase 3: investigate per-watcher heap caps with measured data. Phase 4: frontend client-boundary work (already underway).
  - **Vite-vs-Turbopack feasibility** — verdict: Next.js dev cannot run on Vite (RSC + server actions tightly coupled to Turbopack/Webpack); `--webpack` fallback exists but is heavier than Turbopack; Vite sidecar for component-library dev is viable as a future spec. Concrete recommendation: stay on Turbopack, defer Vite to a separate spec if/when a sidecar is wanted.
  - **Verification protocol** — exact commands to reproduce a memory measurement with the new harness; one-line README block reviewers can run.
  - **Migration & Backward Compatibility** — no contract surface touched. `OM_PACKAGE_WATCH_HEAP_MB` is additive and unset by default.

**Step 3.2 — Task Router cross-link**

- Add a row to the Task Router in `AGENTS.md` under a "Performance" subgroup pointing dev-mode memory work at this spec + the future PRs that chain off it. Pattern: `Dev-mode memory profiling, identifying memory hogs, evaluating watcher / dev orchestration tradeoffs | .ai/specs/2026-05-27-dev-mode-memory-quick-wins.md`.

### Phase 4 — Final gate

**Step 4.1 — Validation**

- `node --check` every `.mjs` file we touched (sandbox has no `node_modules`).
- `node --test scripts/__tests__/profile-dev-rss.test.mjs scripts/__tests__/watch.test.mjs` (uses Node's built-in test runner; no workspace deps).
- Document in `final-gate-checks.md` that the full validation gate (`yarn typecheck`, `yarn test`, `yarn build:packages`, `yarn build:app`, `yarn lint`, `yarn test:integration`) requires a stack with installed deps — CI is the gate.
- Cite that `yarn test:create-app:integration` is skipped (no packaging changes).
- Run `ds-guardian` if the changes touch UI — they do not, so it's a no-op acknowledgement.

## Verification (what a reviewer will run)

After merging this PR (and ideally also PR #2102):

```bash
# Baseline
yarn dev:profile baseline-pre-2102
# (wait for "[profile] done → .mercato/dev-rss/baseline-pre-2102.json")

# After applying PR #2102 (or any other change)
yarn dev:profile baseline-post-2102

# Compare
yarn dev:profile:report
```

The report prints a Markdown table that's safe to paste into a PR body.
