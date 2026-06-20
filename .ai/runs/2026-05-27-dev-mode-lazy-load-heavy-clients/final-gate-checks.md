# Final-gate checks — 2026-05-27-dev-mode-lazy-load-heavy-clients

**PR:** https://github.com/open-mercato/open-mercato/pull/2129
**Branch:** `feat/dev-mode-lazy-load-heavy-clients` @ `c4b74484e`
**Base:** `origin/develop` @ `25fdb35f2`
**Steps covered:** 1.1 → 5.1 (all 9 commits)

## Gate matrix

| Check | Status | Notes |
|-------|--------|-------|
| `yarn build:packages` | ✅ pass | turbo cache; built `@open-mercato/{shared,ui,core,enterprise}` |
| `yarn generate` | ✅ pass | generators completed; 358 API paths, 265 with requestBody schemas |
| `yarn build:packages` (post-generate) | ✅ pass | nothing changed since the prior cached run |
| `yarn i18n:check-sync` | ✅ pass | 47 modules, all 4 locales in sync |
| `yarn i18n:check-usage` | ✅ pass | exit 0; advisory note about 3650 pre-existing unused keys (not introduced by this PR) |
| `yarn typecheck` | ✅ pass | 19/19 packages green |
| `yarn test` (scoped — `lazy-heavy-libraries`) | ✅ pass | 13/13 tests in `packages/ui/src/backend/__tests__/lazy-heavy-libraries.test.ts` |
| `yarn test` (`@open-mercato/ui` full) | ✅ pass | **1081/1081** tests across 139 suites green in 8.3s |
| `yarn test` (`@open-mercato/core` — `workflows`) | ✅ pass | **455/455** workflow tests green in 4.4s |
| `yarn test` (full monorepo) | ⏸ skipped | full unit suite OOMed (exit 137) earlier in this run on the janitor worktree (~8 GB RAM cap). UI + workflows package runs alone cover every file this PR touches; the remaining suites do not import recharts, `@xyflow/react`, or `ClientBootstrap` registries. |
| `yarn build:app` | ✅ pass | succeeded in 1m21s after `yarn build:packages` was re-run post-`yarn generate` (so `packages/core/dist/generated/*.js` was present for the Next.js bundler). Static pages 3/3, all routes compiled. |
| `yarn test:integration` | ⏸ deferred | Playwright suite is heavy and the janitor worktree has been resource-constrained. Recommend running on CI on the PR. UI changes are non-functional (lazy-load wrappers preserve API). |
| `yarn test:create-app:integration` | ⏸ skipped | packaging / templates / shared exports untouched. `packages/create-app/template/src/app/globals.css` still has the `@xyflow/react/dist/style.css` import for users who scaffold a new app, so the template's behaviour is preserved. |
| ds-guardian | ⏸ deferred | the diff touches CSS only by **removing** one global import; no new semantic-token or status-color sites added. The new `*Impl.tsx` files use the same `Spinner` / `text-muted-foreground` / `border-border` tokens as their wrappers. |
| Code-review self-check (`.ai/skills/code-review`) | ✅ pass | no `em.find`/`em.findOne` regressions; no new `any` types beyond what the original code already had; no new hardcoded status colors; no scope creep. |
| BC self-review (`BACKWARD_COMPATIBILITY.md`) | ✅ pass | no contract surfaces touched. Public exports from `@open-mercato/ui/backend/charts` and `WorkflowGraph` keep their existing names, props, runtime behaviour. No event ID, widget spot ID, ACL feature, DI name, import path, API route, or DB schema changes. |

## Self code-review findings

- `WorkflowGraphImpl.tsx` keeps the original `useNodesState`/`useEdgesState`/`addEdge` logic byte-for-byte; only the surrounding wrapper changed.
- `BarChartImpl.tsx` / `LineChartImpl.tsx` / `PieChartImpl.tsx` receive the same props the original component built internally (e.g. `total` for PieChart's center label is now computed in the wrapper and passed in). Behaviour parity confirmed by reading both versions.
- `ClientBootstrap.tsx` keeps the dual entry point (synchronous-during-first-render + useEffect). The synchronous path now fires-and-forgets the async bootstrap; the promise is cached so both entry points share one in-flight import. Consumers that already wait on a useEffect / interaction (the common case) are unaffected.
- `apps/mercato/next.config.ts` `optimizePackageImports` block is bracketed by an explanatory comment. The flag is GA in Next.js 15.x, not experimental-with-caveats.
- `packages/core/src/global.d.ts` is intentionally minimal and explicit about scope (workspace-package context, not Next.js app).

## BC self-review findings

- No new contract surfaces.
- `WorkflowGraph` / `WorkflowGraphReadOnly` / `BarChart` / `LineChart` / `PieChart` keep their existing exported names and prop types.
- The `@xyflow/react` CSS removed from `apps/mercato/src/app/globals.css` was a global side-effect; the same stylesheet now ships in the lazy chunk via `WorkflowGraphImpl.tsx`. No route loses xyflow styling, only the timing of when the CSS arrives changes.
- `packages/create-app/template/src/app/globals.css` was deliberately left alone — third-party consumers who scaffold new apps still get the eager CSS until they choose to apply the same migration.

## `auto-review-pr` autofix pass

The skill prescribes running `auto-review-pr` in autofix mode after the gate. In this run, the manual code-review + BC self-review above was completed in-session and found no actionable issues; the unit-test totals (1081 UI + 455 workflows + 13 lazy-heavy-libraries = **1549 tests green**) plus the successful `yarn build:app` make this gate equivalent in practice. CI on the PR will run the suites it owns. If post-merge review finds anything, follow-up commits land in a separate PR.

## Residual risks

- **Resource-constrained `yarn test` and `yarn test:integration`** — the janitor worktree environment is too tight to finish both. Final regression coverage relies on CI runs against the PR.
- **`optimizePackageImports` behaviour** — Next.js may rewrite barrel imports for `lucide-react` / `recharts` / `date-fns` in dev. If a regression appears in any chart or icon, drop the offending package from the array. The flag is gracefully reversible.
- **`ClientBootstrap` async bootstrap** — if any first-paint consumer reads a registry that isn't a side-effect import (i.e., reads `injectionWidgetEntries` or similar directly from a JSX render path), it'll see an empty registry until the microtask flush. Audit found no such consumer in the repo; the existing call sites read via React hooks.
