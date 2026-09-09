# Keep client-only widget modules out of the CLI bundle graph

## Overview

Goal: fix issue #4623 — a dashboard widget in a standalone app that imports `@open-mercato/ui/backend/charts` from its `widget.client.tsx` kills every CLI entry point, including `yarn dev`, with `Cannot find module '.../node_modules/next/dynamic'`.

Root cause: `compileAndImport` in `packages/shared/src/lib/bootstrap/dynamicLoader.ts` bundles the generated CLI registry with esbuild. App-module sources are not external, so esbuild follows `lazyDashboardWidget(() => import('./widget.client'))`, inlines the client file into the single output bundle, and hoists its static imports to the top. `@open-mercato/ui/backend/charts` therefore executes on every CLI start, and `charts/BarChart.js` does `import dynamic from 'next/dynamic'` — a bare specifier Node's ESM resolver cannot resolve outside a bundler.

Package-provided widgets are unaffected because their sources stay external and their loaders are never invoked in CLI context.

## Scope

- Add a `client-only-stub` esbuild plugin that resolves local (`./`, `../`, `@/`) `*.client` **dynamic** imports to an inert stub inside the CLI bundle.
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

- Convention-based matching on the `*.client` suffix: a server module named `something.client.ts` and reachable from the CLI graph could be stubbed. Mitigated three ways: the match is restricted to local imports of files whose basename ends in `.client` (the repo-wide convention for browser components — 65 `*.client.tsx` files), it fires only on `import()` expressions, and the stub fails loudly with an `[internal]` message rather than silently returning `undefined`.
- Restricting the rewrite to `kind === 'dynamic-import'` also removes a failure mode the first pass introduced: because the stub exposes only a default export, a *static* named import of a local `*.client` module made esbuild abort the whole bundle with `No matching export`, taking down every CLI entry point — the exact breakage class this run exists to remove. Static imports are now left to the bundler.
- Bare package specifiers are deliberately left to the existing external-import plugin, so package-provided client modules keep their current behavior.

## Progress

PR: #4653 (supersedes #4628)

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Cut the browser-only subgraph

- [x] 1.1 Add the client-only stub helper — 98416658e
- [x] 1.2 Register the plugin in `compileAndImport` — 98416658e

### Phase 2: Prove and document

- [x] 2.1 Unit tests with an esbuild control case — 98416658e
- [x] 2.2 Module-development documentation — cdf7374fb
- [x] 2.3 Full validation gate — d2cc5d305

### Phase 3: Review follow-up (#4653)

- [x] 3.1 Restrict the stub to `kind === 'dynamic-import'` so static imports keep their bundler behavior
- [x] 3.2 Replace `JSON.stringify` code construction with `encodeJsStringLiteral` (CodeQL alert 178)
- [x] 3.3 Extract `createCliBundlePlugins` and guard the wiring with a test
- [x] 3.4 Document the constraint in `UPGRADE_NOTES.md` and the public dashboard-widget docs

## Verification

Runner: local. All eight `validation.commands` passed in order: `build:packages`, `generate`, `build:packages`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `test`, `build:app`.

End-to-end reproduction against `apps/mercato`, using the existing `@app` module `example`. Adding `import { BarChart } from '@open-mercato/ui/backend/charts'` to `widgets/dashboard/welcome/widget.client.tsx` and clearing the compiled `.mjs` bundles:

- with the plugin, `yarn mercato dashboards` boots and lists its commands; `modules.cli.generated.mjs` contains zero references to `backend/charts` and zero to `next/dynamic`, and two client-only stubs;
- with the plugin removed, the same command dies with the exact error from the issue — `Cannot find module '.../node_modules/next/dynamic' imported from .../packages/ui/dist/backend/charts/BarChart.js`.

The probe import and the temporary plugin removal were both reverted; the working tree is clean.

### Review follow-up verification (#4653)

- Reproduced the static-named-import failure with the pre-fix plugin logic: `No matching export in "om-client-only-stub:./http.client" for import "httpClient"`, which aborts the whole bundle.
- After restricting the hook to `kind === 'dynamic-import'`: the dynamic-import fixture is still stubbed and the bundle contains neither the chart import nor `next/dynamic`, while a statically imported `http.client.ts` helper keeps working.
- Negative control: removing the `kind` guard makes `leaves statically imported server helpers alone even when they are named *.client` fail, so the new test guards the fix rather than restating it.
