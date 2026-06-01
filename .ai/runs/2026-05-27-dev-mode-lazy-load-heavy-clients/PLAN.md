# Dev-mode lazy-load heavy clients — execution plan

**Date:** 2026-05-27
**Branch:** `feat/dev-mode-lazy-load-heavy-clients`
**Base:** `origin/develop` (commit `25fdb35f2` at run start)
**Status:** complete
**Related work:**
- PR #2102 (merged) — workspace package watcher consolidation (~1 GB idle RSS win).
- PR #2104 (open, `feat/dev-memory-quick-wins`) — `yarn dev:profile` harness + dev-mode memory landscape spec.
- `.ai/specs/2026-05-13-frontend-client-boundary-ram-reduction.md` — Phase D mandates lazy loading of heavy browser dependencies.

## Tasks

> Authoritative status table. `Status` is `todo` or `done`. On landing a Step, flip `Status` to `done` and fill `Commit`. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Seed run folder (PLAN, HANDOFF, NOTIFY) | done | (this commit) |
| 2 | 2.1 | Lazy-load recharts chart primitives via next/dynamic | done | 75877478e |
| 2 | 2.2 | Lazy-load @xyflow/react WorkflowGraph and scope its CSS | done | 33df9c787 |
| 2 | 2.3 | Defer ClientBootstrap registry barrels to client-side mount | done | 660e71351 |
| 3 | 3.1 | Enable Next.js optimizePackageImports for lucide-react, recharts, date-fns | done | 3808e42cc |
| 3 | 3.2 | Remove dead transpiledWorkspacePackages computation | done | 58993412c |
| 4 | 4.1 | Tests covering new lazy boundaries (recharts, xyflow) | done | 6e9f623ab |
| 4 | 4.2 | Spec: dev-mode lazy-load heavy clients + measurement methodology | done | 847208ed5 |
| 5 | 5.1 | Add ambient *.css module declaration for packages/core | done | pending |

## Goal

Reduce `yarn dev` peak RSS by **≥1 GB** on a fresh boot by lazy-loading the heaviest client-only libraries (`recharts`, `@xyflow/react`) and deferring generated registry barrels in `ClientBootstrap`. Layer in low-risk Turbopack `optimizePackageImports` for `lucide-react`/`recharts`/`date-fns` to shrink barrel evaluation.

## Scope

- `packages/ui/src/backend/charts/{BarChart,LineChart,PieChart}.tsx` — wrap recharts surface in `next/dynamic({ ssr: false })`.
- `packages/core/src/modules/workflows/components/WorkflowGraph.tsx` and its two page-root importers — wrap in `next/dynamic` at the page-root layer; move `@xyflow/react/dist/style.css` out of `apps/mercato/src/app/globals.css` and import it locally next to the lazy boundary.
- `apps/mercato/src/components/ClientBootstrap.tsx` — keep the side-effect registration imports static (they affect SSR), but move the generated *consumer* barrels (`injection-widgets`, `injection-tables`, `dashboard-widgets`, `notification-handlers`, `enabledModuleIds`) inside the existing `clientBootstrap()` effect via `await import(…)`. Deduplicate the double `translations-fields.generated` side-effect import.
- `apps/mercato/next.config.ts` — add `experimental.optimizePackageImports`; remove dead `transpiledWorkspacePackages` computation.
- `packages/ui/src/backend/__tests__/lazy-heavy-libraries.test.ts` (or new sibling) — extend coverage for recharts and xyflow.
- `.ai/specs/2026-05-27-dev-mode-lazy-load-heavy-clients.md` — new spec capturing changes + measurement methodology.

## Non-goals

- Not touching `@dnd-kit`, `@tanstack/react-table`, or `lucide-react` import sites individually — `optimizePackageImports` handles barrel optimization at the bundler layer without 398-file churn.
- Not migrating any page roots from `'use client'` to server components (that is Phase B/C of the existing client-boundary spec).
- Not adding the `yarn dev:profile` harness (it ships in PR #2104). This run uses manual `ps`/process-tree RSS snapshots for before/after numbers; future regressions are caught by #2104's harness once it lands.
- Not changing any contract surface (no event IDs, no widget spot IDs, no DI names, no DB schema).

## Risks

- **`ClientBootstrap` registration order.** Some renderers (messages, payments) look up registry entries during the first paint. The side-effect imports (`*.client.generated`) MUST stay static. Only the consumer barrels — already used inside the existing `clientBootstrap()` effect — are deferred.
- **`optimizePackageImports` regressions.** The flag is `experimental.*`. We test by running `yarn build:app` and `yarn dev` smoke on the dashboards page. If it breaks SSR for any chart consumer, we revert just that package from the list.
- **`@xyflow/react` CSS scope.** Moving the global stylesheet import is a behavior change for anyone relying on its rules existing before the WorkflowGraph mounts. We import it from `WorkflowGraph.tsx` so the styles ship with the lazy chunk; if a route renders xyflow nodes outside `WorkflowGraph`, we re-add the global import.
- **Lazy chart suspense.** The `next/dynamic` wrapper for recharts needs a small `loading` fallback that matches the existing chart container dimensions to avoid layout jank in dashboards.

## External References

- None passed via `--skill-url`.

## Implementation plan

### Phase 1 — Seed

**Step 1.1 — Seed run folder.** Create `PLAN.md` (this file), `HANDOFF.md`, `NOTIFY.md`. Commit as `docs(runs): add execution plan for dev-mode-lazy-load-heavy-clients` and push.

### Phase 2 — Lazy heavy clients

**Step 2.1 — Lazy-load recharts chart primitives.**
- Touch: `packages/ui/src/backend/charts/{BarChart,LineChart,PieChart}.tsx`.
- Each file already has a top-level `'use client'`. Convert the eager `import { … } from 'recharts'` into an inner `dynamic(() => import('recharts').then(m => m.BarChart), { ssr: false, loading: () => <ChartSkeleton/> })` pattern, OR move the recharts call into a sibling `*Impl.tsx` and have the public component re-export a dynamic-wrapped version. Preferred: introduce a tiny per-chart `*Impl.tsx` file that holds the recharts JSX and is imported via `next/dynamic({ ssr:false })` from the public file. Keeps the public API identical and gives test seams.
- Reuse the existing `ChartLoading`/skeleton pattern if one exists; otherwise add a minimal aspect-preserving div.
- Verify: `yarn typecheck` scoped to `@open-mercato/ui`, plus new test file in 4.1.

**Step 2.2 — Lazy-load @xyflow/react WorkflowGraph.**
- Touch: `packages/core/src/modules/workflows/components/WorkflowGraph.tsx`, `…/components/WorkflowGraphReadOnly.tsx` (if it exists; if it is exported from `WorkflowGraph.tsx`, restructure), `…/backend/definitions/visual-editor/page.tsx`, `…/backend/instances/[id]/page.tsx`, `apps/mercato/src/app/globals.css`.
- Strategy: split `WorkflowGraph.tsx` into a public wrapper file and a sibling `WorkflowGraphImpl.tsx` that contains every `@xyflow/react` runtime import + the node/edge subcomponents already in `packages/core/src/modules/workflows/components/{nodes,WorkflowTransitionEdge}`. The wrapper exports `WorkflowGraph` via `dynamic(() => import('./WorkflowGraphImpl').then(m => m.WorkflowGraphImpl), { ssr: false, loading: () => <WorkflowGraphSkeleton /> })`.
- The xyflow CSS (`@xyflow/react/dist/style.css`) moves from `apps/mercato/src/app/globals.css` into `WorkflowGraphImpl.tsx` so it ships with the lazy chunk.
- Page roots (`visual-editor/page.tsx`, `instances/[id]/page.tsx`) keep importing `WorkflowGraph` from the public wrapper — no API change.

**Step 2.3 — Defer ClientBootstrap registry barrels.**
- Touch: `apps/mercato/src/components/ClientBootstrap.tsx`.
- Move these imports from top-level to inside the existing `useEffect` via `await import(...)`:
  - `injectionWidgetEntries` (used to feed `registerInjectionWidget` calls in `clientBootstrap()`)
  - `injectionTables` (same)
  - `enabledModuleIds`
  - `dashboardWidgetEntries` (used to feed dashboard widget registry)
  - `notificationHandlerEntries`
- Keep these top-level (side-effect registration that may be needed during SSR/first paint): `translations-fields.generated`, `messages.client.generated`, `payments.client.generated`.
- Deduplicate the double `translations-fields.generated` side-effect import currently on lines 6 and 16.
- Replace the synchronous `clientBootstrap()` body with an `async` function that imports and invokes registration in sequence; `useEffect` becomes `void runClientBootstrap()`.

### Phase 3 — Config knobs

**Step 3.1 — Enable `experimental.optimizePackageImports`.**
- Touch: `apps/mercato/next.config.ts`.
- Add `experimental.optimizePackageImports: ['lucide-react', 'recharts', 'date-fns']`. Place under both dev and prod `experimental` blocks (the option is stable in Next 15.x and benefits both modes).
- Document in spec why this is safe: it tells Turbopack/Webpack to treat the package as having modularized exports — only named exports actually used in source are evaluated.

**Step 3.2 — Remove dead `transpiledWorkspacePackages`.**
- Touch: `apps/mercato/next.config.ts`.
- Delete the `appPackageJson` parse, `officialModulesPackages` derivation, and `transpiledWorkspacePackages` array (all currently dead because `transpilePackages` is commented out).
- Delete the `transpilePackages` comment line entirely; if we ever want it back, git history is canonical.
- Net: removes ~15 lines of work that runs on every Next.js boot.

### Phase 4 — Tests + spec

**Step 4.1 — Lazy-boundary tests.**
- Touch: `packages/ui/src/backend/__tests__/lazy-heavy-libraries.test.ts` (extend) and `packages/core/src/modules/workflows/components/__tests__/lazy-workflow-graph.test.ts` (new).
- Assert that:
  - `BarChart`/`LineChart`/`PieChart` modules do not statically import `recharts` at the top level (string scan of source). The static-grep style mirrors the existing `lazy-heavy-libraries.test.ts:10-14` pattern.
  - `WorkflowGraph.tsx` (public wrapper) does not statically import from `@xyflow/react`; only `WorkflowGraphImpl.tsx` may.
  - `apps/mercato/src/app/globals.css` does not contain `@xyflow/react/dist/style.css`.

**Step 4.2 — Spec.**
- Touch: `.ai/specs/2026-05-27-dev-mode-lazy-load-heavy-clients.md` (new).
- Sections: TL;DR, Problem, Interventions (one per Step), Measurement methodology, Acceptance criteria, Risks, Backward compatibility, Migration path for future heavy libs.
- Link as Phase D evidence in `.ai/specs/2026-05-13-frontend-client-boundary-ram-reduction.md` (single-line addition under Phase D status).

### Phase 5 — Verification

Checkpoint after Step 2.3 (5 Steps landed since seed):
- `yarn typecheck`, scoped unit tests for `@open-mercato/ui` and `@open-mercato/core/workflows`.
- Dev-mode smoke: boot `yarn dev`, hit `/backend/dashboards`, `/backend/workflows/definitions/<id>/visual-editor`, `/auth/login`. Capture `ps axo pid,rss,command` snapshot at each marker.
- Write `checkpoint-1-checks.md`, rewrite `HANDOFF.md`, append NOTIFY entry. Commit.

Final gate at spec completion:
- `yarn build:packages` → `yarn generate` → `yarn build:packages` → `yarn i18n:check-sync` → `yarn i18n:check-usage` → `yarn typecheck` → `yarn test` → `yarn build:app`.
- `yarn test:integration` (full Playwright suite) — UI changes warrant the full run.
- `yarn test:create-app:integration` — only if `packages/create-app` or shared exports were touched (likely skipped, document the skip).
- `ds-guardian` pass against the run diff; land any auto-fixes as `X.Y-ds-fix` Steps.
- Self code-review + BC self-review.
- `auto-review-pr` autofix pass against the opened PR; loop fixes as new Steps.

## Measurement methodology

`yarn dev:profile` (from PR #2104) is not yet on `develop`. Until it lands, capture RSS manually:

```bash
# baseline
git checkout develop && yarn install --mode=skip-build
yarn dev &
DEV_PID=$!
sleep 120  # wait for Next.js ready + idle settle
ps -e -o rss=,command= --forest --ppid $DEV_PID | awk 'NR>0{s+=$1}END{print s/1024" MB"}'
kill $DEV_PID

# after-change
git checkout feat/dev-mode-lazy-load-heavy-clients && yarn install --mode=skip-build
yarn dev &
DEV_PID=$!
sleep 120
ps -e -o rss=,command= --forest --ppid $DEV_PID | awk 'NR>0{s+=$1}END{print s/1024" MB"}'
kill $DEV_PID
```

Also hit each marker once before the snapshot (login → dashboard → workflow visual editor) to force compile.

Numbers land in `checkpoint-1-checks.md` and the spec.

## Acceptance criteria

- `yarn dev` peak RSS at idle reduced by ≥1 GB vs `origin/develop`.
- `yarn build:app` succeeds with the new `experimental.optimizePackageImports` block.
- `yarn typecheck` and `yarn test` green.
- `yarn test:integration` green (UI changes warrant the full Playwright run).
- No contract surface broken (no API route, event ID, widget spot ID, DI name, ACL feature, or DB schema change).
- Visual-editor and read-only workflow pages render xyflow correctly with the new lazy boundary.
- Dashboards backend page renders all 11 chart widgets correctly with the new recharts lazy boundary.
