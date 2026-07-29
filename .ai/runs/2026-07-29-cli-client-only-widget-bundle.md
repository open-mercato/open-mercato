# Keep client-only widget modules out of the CLI bundle graph

## Overview

Goal: fix issue #4623 — a dashboard widget in a standalone app that imports `@open-mercato/ui/backend/charts` from its `widget.client.tsx` kills every CLI entry point, including `yarn dev`, with `Cannot find module '.../node_modules/next/dynamic'`.

Root cause: `compileAndImport` in `packages/shared/src/lib/bootstrap/dynamicLoader.ts` bundles the generated CLI registry with esbuild. App-module sources are not external, so esbuild follows `lazyDashboardWidget(() => import('./widget.client'))`, inlines the client file into the single output bundle, and hoists its static imports to the top. `@open-mercato/ui/backend/charts` therefore executes on every CLI start, and `charts/BarChart.js` does `import dynamic from 'next/dynamic'` — a bare specifier Node's ESM resolver cannot resolve outside a bundler.

Package-provided widgets are unaffected because their sources stay external and their loaders are never invoked in CLI context.

## Scope

- Add a `client-only-stub` esbuild plugin that resolves local (`./`, `../`, `@/`) `*.client` imports to an inert stub inside the CLI bundle.
- Register the plugin ahead of the existing alias and external-import plugins in `compileAndImport`.
- Cover the behavior with unit tests, including a control case that proves the fixture regresses without the plugin.
- Document the `*.client.tsx` contract for module authors.

## Non-goals

- No change to `@open-mercato/ui` chart components. Keeping `next/dynamic` there is intentional: the wrappers are `"use client"` and are only ever loaded by the Next.js bundler. The class of failures is cut where the CLI graph is built, not per component.
- No change to the CLI registry shape. Dashboard widget loaders must keep working in CLI — `packages/core/src/modules/dashboards/cli.ts` calls `loadAllWidgets()` to seed default dashboards from widget metadata, so `widget.ts` has to stay importable in Node.
- No change to `modules.generated.ts` or the Next.js runtime, which resolve these imports through the app bundler.

## Implementation Plan

### Phase 1: Cut the browser-only subgraph

1. Add `packages/shared/src/lib/bootstrap/clientOnlyModules.ts` with `isClientOnlyModulePath`, `renderClientOnlyModuleStub`, and `createClientOnlyStubPlugin`.
2. Register the plugin first in the `compileAndImport` esbuild build so it wins over the alias and external plugins.

### Phase 2: Prove and document

1. Add `packages/shared/src/lib/bootstrap/__tests__/clientOnlyModules.test.ts` — predicate unit tests plus a real esbuild bundle over a fixture that mirrors the issue's reproduction, with and without the plugin.
2. Add the `*.client.tsx` rule to `.ai/docs/module-development.md`.
3. Run the configured validation gate.

## Risks

- Convention-based matching on the `*.client` suffix: a server module named `something.client.ts` and reachable from the CLI graph would be stubbed. Mitigated by restricting the match to local imports of files whose basename ends in `.client`, which is the repo-wide convention for browser components (65 `*.client.tsx` files), and by a stub that fails loudly with an `[internal]` message rather than silently returning `undefined`.
- Bare package specifiers are deliberately left to the existing external-import plugin, so package-provided client modules keep their current behavior.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Cut the browser-only subgraph

- [x] 1.1 Add the client-only stub helper — 98416658e
- [x] 1.2 Register the plugin in `compileAndImport` — 98416658e

### Phase 2: Prove and document

- [x] 2.1 Unit tests with an esbuild control case — 98416658e
- [x] 2.2 Module-development documentation — cdf7374fb
- [ ] 2.3 Full validation gate
