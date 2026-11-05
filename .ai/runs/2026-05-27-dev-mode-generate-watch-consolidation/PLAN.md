# Dev-mode generate watcher consolidation

**Date:** 2026-05-27
**Slug:** `dev-mode-generate-watch-consolidation`
**Source spec:** `.ai/specs/2026-05-13-frontend-client-boundary-ram-reduction.md` (Phase E — Dev memory defaults)
**Sibling PR:** [#2102 — feat(dev): consolidate workspace package watchers](https://github.com/open-mercato/open-mercato/pull/2102) (already shipped the ~1.1 GB watch:packages collapse)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Add run folder (plan + handoff + notify + POC) | done | 1cd2d885d |
| 2 | 2.1 | Extract `startInProcessGenerateWatcher` helper, refactor `generate watch` CLI to use it, and wire it into `mercato server dev` (gated by `OM_DEV_GENERATE_WATCH_MODE`) | done | 4e3238a61 |
| 2 | 2.2 | Drop the standalone `generate watch --skip-initial` spawn in `apps/mercato/scripts/dev.mjs` (and the standalone template) | done | af568087c |
| 3 | 3.1 | Add `scripts/profile-generate-watch-rss.mjs` (Linux `/proc/<pid>/status` walker) | done | 315b04994 |
| 3 | 3.2 | Unit-test the new helper start/stop/poll behavior | done | 816b8a2a9 |
| 4 | 4.1 | Update spec changelog (Phase E note) + run-folder final-gate log | done | c6a0fb82c |

## Goal

Eliminate the standalone long-running `mercato generate watch --skip-initial` Node process from `yarn dev` by moving its polling logic into `mercato server dev` as an in-process module.

## Scope

- `packages/cli/src/lib/in-process-generate-watcher.ts` (new, extracted from the existing `generate watch` CLI command).
- `packages/cli/src/mercato.ts` — call the helper inside the `server dev` lifecycle; keep the existing `generate watch` CLI command intact for direct invocation.
- `apps/mercato/scripts/dev.mjs` — drop the second `startFilteredChild(['generate', 'watch', '--skip-initial'], ...)` call (and the classic-mode equivalent), gate the legacy behavior behind `OM_DEV_GENERATE_WATCH_MODE=legacy`.
- `packages/create-app/template/scripts/dev-runtime.mjs` — mirror the same removal for standalone apps so the template stays aligned.
- `scripts/profile-generate-watch-rss.mjs` — Linux-only `/proc/<pid>/status` walker (mirrors `scripts/profile-dev-rss.mjs` from PR 2102).
- Unit tests in `packages/cli/src/lib/__tests__/in-process-generate-watcher.test.ts`.
- Spec changelog entry in `.ai/specs/2026-05-13-frontend-client-boundary-ram-reduction.md` (Phase E sub-note).

## Non-goals

- No change to the `mercato generate watch` CLI command itself — direct invocation still works for CI and one-off scripts.
- No change to generator outputs or `yarn generate` semantics.
- No change to Turbopack defaults, `serverExternalPackages`, or any UI compile graph.
- No change to the lazy worker/scheduler supervisors (still per-queue, still lazy).

## Risks

- **In-process polling stalls the dev server event loop.** Mitigation: keep the poll interval at the current 1 s, defer the expensive `runGeneratorSuite` to a separate microtask, and serialize concurrent runs the same way the standalone watcher does.
- **Generator imports leak into `mercato server dev`'s module cache.** Mitigation: lazy-import the generator helpers inside the polling callback (same `await import('./lib/utils')` + `await import('./lib/generators')` shape the standalone watcher already uses).
- **Standalone-app template drift.** Mitigation: apply the matching dev-runtime change in `packages/create-app/template/scripts/dev-runtime.mjs` in the same PR.
- **Power-user expectations.** Some devs may prefer the standalone watcher for log isolation. Mitigation: leave the `generate watch` CLI command alive and add `OM_DEV_GENERATE_WATCH_MODE=legacy` to opt back into the old behavior.

## External References

None — `--skill-url` not provided.

## Implementation Plan

### Phase 1 — Run folder

#### Step 1.1 — Seed commit
Add this `PLAN.md`, `HANDOFF.md`, `NOTIFY.md`, the bundle-size POC carried over from the option-B investigation (kept for transparency), and the measured baseline note for the standalone watcher process (193 MB RSS measured on this machine).

### Phase 2 — In-process consolidation

#### Step 2.1 — Extract helper
Move the polling loop body from `packages/cli/src/mercato.ts` (`generate watch` command) into a new `packages/cli/src/lib/in-process-generate-watcher.ts`. The helper exposes:
- `startInProcessGenerateWatcher({ pollMs, skipInitial, logger, runGenerators })` → returns `{ close(): Promise<void> }`.
- `runGenerators` defaults to the existing `runGeneratorSuite` + `runPostGenerateStructuralCachePurge` pair so tests can inject a spy.
- Polling uses `setTimeout` + `unref()` so the timer never blocks shutdown.

The existing `generate watch` CLI command becomes a thin adapter that calls `startInProcessGenerateWatcher` and awaits `done`.

#### Step 2.2 — Wire into `server dev`
Inside the `server dev` command in `packages/cli/src/mercato.ts`, after the lazy worker / scheduler supervisors are wired, call `startInProcessGenerateWatcher({ ... })` and register its `close()` in the same cleanup path used for the supervisors. Skip entirely when `OM_DEV_GENERATE_WATCH_MODE=legacy` is set, so the developer can fall back to the old out-of-process watcher.

#### Step 2.3 — Drop spawn
Remove `startFilteredChild(['generate', 'watch', '--skip-initial'], ...)` (and the matching `runClassicRuntime()` spawn) in `apps/mercato/scripts/dev.mjs`. Apply the same removal in `packages/create-app/template/scripts/dev-runtime.mjs`. Honor `OM_DEV_GENERATE_WATCH_MODE=legacy` to spawn the old process for opt-out parity.

### Phase 3 — Measurement + tests

#### Step 3.1 — Profile script
Add `scripts/profile-generate-watch-rss.mjs`. Same shape as PR 2102's `scripts/profile-dev-rss.mjs`: walks `/proc/<pid>/status` for `VmRSS:` across a PID and its descendants. Invocation prints a side-by-side `legacy` (out-of-process) vs `default` (in-process) RSS comparison.

#### Step 3.2 — Unit tests
`packages/cli/src/lib/__tests__/in-process-generate-watcher.test.ts` covers:
- starting the watcher invokes `runGenerators` once when `skipInitial` is false,
- `close()` cancels the pending poll and resolves `done`,
- a polling cycle re-runs `runGenerators` when the supplied checksum function returns a new value,
- a polling cycle stays idle when the checksum is stable.

### Phase 4 — Documentation

#### Step 4.1 — Spec changelog
Append a Phase E sub-note to `.ai/specs/2026-05-13-frontend-client-boundary-ram-reduction.md` with the measurement table and a link to this run folder. Write `final-gate-checks.md` summarizing the validation gate, including which checks ran in the sandbox vs. deferred to CI.

## Measurement

POC carried over from the broader investigation:

| Configuration | Processes | Idle RSS (this machine) |
|---|---|---|
| Current `yarn dev` (standalone `mercato generate watch`) | 1 dedicated Node | **193 MB** (measured 8 s after start, `--skip-initial --quiet`) |
| Consolidated (in-process inside `mercato server dev`) | 0 dedicated Node | **0 MB** (folded into the existing server process; <5 MB of additional heap from the polling closure) |
| **Net savings** | | **~190 MB** of resident RSS |

Combined with [PR 2102](https://github.com/open-mercato/open-mercato/pull/2102)'s 1.1 GB collapse of `watch:packages`, total dev-mode RSS reduction across the two PRs lands at **~1.3 GB** on this machine.

**Honest note on the 1-2 GB target:** the user brief asked for "at least 1-2 GB" of savings from a single quick win. This PR alone harvests ~190 MB. The remaining gap belongs to follow-up work that touches Turbopack's compile graph directly (server-only deps in `serverExternalPackages`, `ClientBootstrap` registry slimming, per-queue worker consolidation) — all higher-risk and harder to measure in isolation. See **Follow-up candidates** below.

## Follow-up candidates (NOT this PR)

1. **`serverExternalPackages` extension.** Add MikroORM, `pg`, `bullmq`, `ioredis`, `pdfjs-dist`, `@napi-rs/canvas`, `newrelic`, `@react-email/components`, `react-email`, `resend`, `awilix`, `ai`, `@ai-sdk/openai`. POC (`poc-bundle-size.mjs` in this run folder) shows ~19 MB of raw bundle savings; Turbopack dev RSS would shrink by an estimated 80–200 MB. Risk: medium (need to verify each package is truly server-only across the codebase).
2. **Per-queue lazy supervisor → single consolidated worker process.** Today the lazy supervisor spawns `node mercato queue worker <queueName>` per active queue. Each child holds ~150–300 MB. With ~25 declared queues and 3–5 typically active in dev, this can cost 500 MB – 1 GB. Risk: medium-high (semantics change: a single process exits for all queues instead of per-queue).
3. **`ClientBootstrap` registry slimming.** The 8 generated registries imported by `apps/mercato/src/components/ClientBootstrap.tsx` (`injection-widgets`, `injection-tables`, `enabled-module-ids`, `dashboard-widgets`, `notification-handlers`, `translations-fields`, `messages.client`, `payments.client`) pull every module's UI surface into the client compile graph for every route. Lazy-loading them via `dynamic()` / `import()` would shrink Turbopack client RSS — but registration order is sensitive and SSR hydration must be preserved. Also fixes a duplicate `translations-fields.generated` import noted while researching this PR.

## Backward Compatibility

No contract surface from `BACKWARD_COMPATIBILITY.md` is touched. The `mercato generate watch` CLI command stays functional; only the dev orchestrator stops spawning it as a sidecar. Developers who depend on the out-of-process watcher can opt back in with `OM_DEV_GENERATE_WATCH_MODE=legacy`.
