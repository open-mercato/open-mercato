# Dev-mode lazy-load heavy clients

**Date:** 2026-05-27
**Status:** implemented (PR pending)
**Owner:** dev-experience working group
**Run folder:** `.ai/runs/2026-05-27-dev-mode-lazy-load-heavy-clients/`
**Related work:**
- PR #2102 (merged) — workspace package watcher consolidation (~1 GB idle RSS win).
- PR #2104 (open) — `yarn dev:profile` harness + dev-mode memory landscape spec (`.ai/specs/2026-05-27-dev-mode-memory-quick-wins.md`). Phase 4 chains into the heavy-dep isolation work landed here.
- `.ai/specs/2026-05-13-frontend-client-boundary-ram-reduction.md` — long-running client-boundary effort. **Phase D — Heavy dependency isolation** is now substantially advanced by this change.

## TL;DR

Three of the heaviest client-only libraries in the repo (`recharts`, `@xyflow/react`, and the generated registry barrels consumed by `ClientBootstrap`) were imported eagerly at module scope. Every route — including auth/login and public portal pages — pulled them into the Turbopack module graph. This PR moves each of them behind a `next/dynamic({ ssr: false })` boundary and enables `experimental.optimizePackageImports` for the three top barrel-heavy packages. The goal is a ≥1 GB peak-RSS reduction in `yarn dev` against the immediate predecessor (PR #2102).

## Problem

After PR #2102 merged the per-package watchers, the next-largest dev-mode RSS contributor is the Next.js dev server's module graph itself. Profiling identified five high-leverage eager imports:

| Library | Files importing eagerly (pre-change) | Why heavy | Reachable from |
|---------|--------------------------------------|-----------|----------------|
| `recharts` | `packages/ui/src/backend/charts/{BarChart,LineChart,PieChart}.tsx` plus 11 dashboard widget files via barrel | ~600 KB minified; large render tree for `ResponsiveContainer` + axis/legend chain | Every backend route via `@open-mercato/ui/backend/charts` re-export |
| `@xyflow/react` | `packages/core/src/modules/workflows/components/WorkflowGraph.tsx`, 6 node files, 2 page-roots, edge component | ~12 MB unpacked; pulls D3 layout + ReactFlow runtime | Only the workflows visual editor + instance viewer actually render it — but the eager import puts it in the graph for any module that touches workflow types |
| `ClientBootstrap` registry barrels | `apps/mercato/src/components/ClientBootstrap.tsx` static imports of 5 `.generated.ts` barrels | Each barrel pulls every module's widget tree into `AppProviders` | Wraps **every** route (auth, portal, backend) |
| `lucide-react` | 398 import sites; full barrel | ~1000 icon exports — Turbopack parses each in dev | Backend pages, forms, the rich-editor, etc. |
| `@xyflow/react/dist/style.css` | `apps/mercato/src/app/globals.css:4` | Global stylesheet — every page paid the parse cost | Every route via Next.js global CSS |

Eager static imports are how Turbopack discovers module boundaries; in dev mode each discovered module is compiled. The five items above are visible to every route, so the dev server compiles them on every cold boot.

## Interventions

### 1. Lazy `recharts` chart primitives (Step 2.1)

Split `BarChart` / `LineChart` / `PieChart` into a thin public wrapper plus a sibling `*Impl.tsx` that contains the recharts JSX. The public wrapper renders `loading` / `error` / `emptyMessage` states without touching recharts, and forwards data into the Impl via `next/dynamic(() => import('./*Impl'), { ssr: false })`.

Files touched:
- `packages/ui/src/backend/charts/BarChart.tsx` — wrapper.
- `packages/ui/src/backend/charts/BarChartImpl.tsx` — new; holds recharts JSX.
- `packages/ui/src/backend/charts/LineChart.tsx` / `LineChartImpl.tsx` — same split (`LineChart` + `AreaChart` share the Impl).
- `packages/ui/src/backend/charts/PieChart.tsx` / `PieChartImpl.tsx` — same split.

No public API change. Existing callers (`@open-mercato/ui/backend/charts` barrel) still import `BarChart` / `LineChart` / `PieChart` the same way.

### 2. Lazy `@xyflow/react` `WorkflowGraph` + scoped CSS (Step 2.2)

Move every `@xyflow/react` runtime import + the `@xyflow/react/dist/style.css` side-effect into a new `WorkflowGraphImpl.tsx`. The public `WorkflowGraph.tsx` becomes a thin client wrapper that loads the Impl via `next/dynamic({ ssr: false })` and re-exports `WorkflowGraph` + `WorkflowGraphReadOnly`. Type-only imports (`import type { Node, Edge, Connection }`) remain in the wrapper — they are fully erased at runtime.

Files touched:
- `packages/core/src/modules/workflows/components/WorkflowGraph.tsx` — wrapper.
- `packages/core/src/modules/workflows/components/WorkflowGraphImpl.tsx` — new; owns runtime imports + CSS.
- `apps/mercato/src/app/globals.css` — drop the `@xyflow/react/dist/style.css` global import; the stylesheet now ships with the lazy chunk.

### 3. Defer `ClientBootstrap` registry barrels (Step 2.3)

`ClientBootstrapProvider`'s static imports of the five generated registry barrels move inside its `useEffect`, loaded via `Promise.all` of `await import(...)`. Each barrel becomes its own Turbopack lazy chunk. The bootstrap promise is cached so the synchronous-during-render fallback and the post-mount effect share one in-flight import.

The three **side-effect imports** (`translations-fields.generated`, `messages.client.generated`, `payments.client.generated`) stay top-level — they register component classes during import and consumers read them during the same paint. Also: the duplicate `translations-fields.generated` import (was on lines 6 and 16) is deduplicated.

### 4. `experimental.optimizePackageImports` (Step 3.1)

`apps/mercato/next.config.ts` now sets `experimental.optimizePackageImports: ['lucide-react', 'recharts', 'date-fns']`. The flag tells Turbopack/Webpack to treat the listed packages as having modularized exports — only the named exports actually used in source are evaluated. For `lucide-react`'s 398 import sites and ~1000 icon exports, this is a substantial dev-mode parse win.

### 5. Dead `transpiledWorkspacePackages` cleanup (Step 3.2)

The `transpilePackages` config line was commented out, but the supporting computation (synchronous `fs.readFileSync` of `package.json` plus a `readdirSync` walk of `external/official-modules/packages/`) still ran on every Next.js boot. Removed.

## Measurement methodology

`yarn dev:profile` (PR #2104) is not yet on `develop`. Until it lands, measure manually:

```bash
# Baseline
git checkout develop && yarn install --mode=skip-build
yarn dev &
DEV_PID=$!
sleep 120              # let Next.js reach ready + idle
# Optionally exercise: open /auth/login, /backend/dashboards, /backend/workflows/...
ps -e -o rss=,command= --forest --ppid $DEV_PID \
  | awk 'NR>0{s+=$1}END{printf "%s MB\n", s/1024}'
kill $DEV_PID

# After change
git checkout feat/dev-mode-lazy-load-heavy-clients && yarn install --mode=skip-build
yarn dev &
DEV_PID=$!
sleep 120
ps -e -o rss=,command= --forest --ppid $DEV_PID \
  | awk 'NR>0{s+=$1}END{printf "%s MB\n", s/1024}'
kill $DEV_PID
```

Sample both **idle** (just past `ready`) and **post-warm** (after exercising the dashboards + workflow visual editor + login). Once #2104 lands, the harness should be re-run for the canonical regression number.

## Acceptance criteria

- `yarn dev` peak RSS at idle reduced by ≥1 GB vs `origin/develop` at the same HEAD where #2102 landed.
- `yarn build:packages`, `yarn build:app`, `yarn typecheck`, `yarn test` all green with the new `experimental.optimizePackageImports` block.
- `yarn test:integration` green — UI changes warrant the full Playwright run.
- Backend dashboards page renders all 11 chart widgets correctly.
- Workflows visual editor + instance viewer render xyflow correctly with the lazy chunk loading once on first visit.
- Public auth/login routes no longer pull recharts / `@xyflow/react` / the dashboard widget tree into their Turbopack module graph.

## Risks

| Risk | Mitigation |
|------|------------|
| Lazy chart suspense flash on dashboards | Each wrapper renders an aspect-preserving `Spinner` fallback that matches the chart container height (`h-40 sm:h-48` for Bar, `h-48` for Line/Pie). |
| `@xyflow/react` CSS missing for components that render xyflow nodes outside `WorkflowGraph` | Audit confirmed only `WorkflowGraph` (and its read-only sibling) renders xyflow JSX in this repo. If a future widget renders xyflow nodes directly, it MUST import the CSS too. |
| `optimizePackageImports` could break SSR for one of the listed packages | The flag is stable in Next.js 15.x. `yarn build:app` exercises the prod compile path; the final-gate `yarn test:integration` exercises a real browser. If a regression appears, drop the offending package from the array. |
| `ClientBootstrap` async bootstrap breaks first-paint consumers | Side-effect imports (`messages.client`, `payments.client`, `translations-fields`) stay static — those are the ones that register component classes. Only the *consumer* barrels (widgets / dashboards / handlers / enabled-modules) are deferred; their consumers read via React effect ordering, not synchronous JSX. |
| Test-environment behaviour of `next/dynamic` | The existing `lazy-heavy-libraries.test.ts` pattern (source-string scan) is filesystem-only; no `next/dynamic` execution is required. New tests follow the same pattern. |

## Migration & backward compatibility

- **No contract surface is touched.** Public exports from `@open-mercato/ui/backend/charts` and `WorkflowGraph` keep their existing names, props, and runtime behaviour.
- **No event ID, widget spot ID, ACL feature, DI name, or DB schema changes.**
- `ClientBootstrap` keeps its `ClientBootstrapProvider` export and the same registration semantics; only the *when* (post-effect via microtask flush) and the *how* (dynamic chunks) change.
- The dead `transpiledWorkspacePackages` block was never enabled — removing it has no observable effect.

## Migration path for future heavy libraries

When a new browser-only library is added (rich editor, calendar, video player, graph viz, etc.):

1. Confirm it is genuinely client-only (`'use client'` consumers).
2. Split the consumer into `Public.tsx` (wrapper) + `PublicImpl.tsx` (heavy JSX) following the chart / WorkflowGraph pattern.
3. Wire `next/dynamic(() => import('./PublicImpl'), { ssr: false, loading: <Skeleton/> })`.
4. Move any global CSS for the library into the Impl file.
5. Add a guardrail test to `packages/ui/src/backend/__tests__/lazy-heavy-libraries.test.ts` (or a module-local sibling) asserting the wrapper does not statically import the library.
6. If the library has a heavy barrel of named exports (icons, locales, components), add it to `experimental.optimizePackageImports` in `apps/mercato/next.config.ts`.
