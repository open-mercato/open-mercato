# Stabilize the standalone integration lane on main

## Goal

Make the `Develop Snapshot Release` → `Standalone App Integration Tests` job on `main` stop failing for structural reasons, fixing the root causes rather than individual assertions.

## Evidence

Run `41392794720` (main @ `185c04f3b`): 157 failed / 2737 passed. The same set fails on every main run since at least 2026-10-31.

- **139 failures** are specs of modules the create-app template ships commented out (`ecommerce`, `customer_groups`, `availability`, `promotions`, `cart`) plus `TC-CAT-PRICES-001`, which needs `customer_groups`. Every request returns 404 because the module is not registered in the standalone app.
  - Root cause: `packages/cli/src/lib/testing/integration-discovery.ts` reads the standalone app's `src/modules.ts` when `OM_TEST_APP_ROOT` is set, but it skips a non-overlay spec only when its *declared* `dependsOnModules` are missing. It never checks the spec's own module.
- **2 failures** (`TC-AUTH-066`, `TC-PHONE-HUB-006`) throw `Command handler not registered for id X. Registered commands …: [X]`.
  - Root cause: the specs bootstrap the standalone app in-process. Their static `@open-mercato/shared` imports (bootstrap, container, flush, transaction lifetime) resolve to the monorepo copy, while the app's generated lazy command loaders import the copy in the app's `node_modules`. Handlers register in one module-local `commandRegistry` while the bus looks them up in the other.
  - A `globalThis` registry (step 2.1) was tried and reverted (step 2.2): `yarn build:app` then failed with `Duplicate command registration for id wms.warehouses.create`, because Next loads the same command module from two bundle chunks and the production duplicate-id guard fires. The split belongs to the specs, not to the shared registry contract.
- **12 failures** wait on worker side effects or assert lane-specific environment. Two child tasks root-caused and fixed them (Phase 3).

## Scope

- Discovery: in standalone mode (`OM_TEST_APP_ROOT`), a non-overlay spec inside a real module (the module root has `index.ts`) runs only when that module is enabled in the app's `modules.ts`. Monorepo discovery is unchanged.
- `TC-CAT-PRICES-001`: declare `dependsOnModules: ['catalog', 'customer_groups']`.
- In-process specs: `importFromAppRuntime()` loads the runtime modules from the app's own package copy when `OM_TEST_APP_ROOT` is set (a plain import otherwise).
- Spec-level fixes for the remaining standalone-only failures (Phase 3).
- Unit tests for every helper and discovery change.

## Non-goals

- Enabling the ecommerce modules in the template. That is a maintainer decision about the harness and its instruction budget, documented in the template's `modules.ts`.
- `TC-SALES-7782` (covered by open PR #8391).
- Changing the snapshot workflow env so the standalone lane also covers `TC-START-001` and `TC-TELEMETRY-002` (Ask-first CI change; reported as a follow-up).

## Risks

- Gating on the spec's own module could hide specs whose module is enabled only through a conditional `enabledModules.push(...)`. Mitigation: the standalone enabled set also collects ids from every object literal in `modules.ts` (array literal + pushes, an over-approximation) and from `official-modules.generated.ts`. Enterprise overlays keep their existing rule.
- `importFromAppRuntime` resolves through the app's `package.json`; a module the app does not ship throws loudly instead of silently falling back to the monorepo copy.

## Implementation Plan

### Phase 1: Discovery gating

1.1 Gate standalone specs on their own module's enablement and widen the standalone enabled set to conditional pushes, with unit tests.
1.2 Declare the `customer_groups` dependency on `TC-CAT-PRICES-001`.

### Phase 2: Command registry singleton

2.1 Make `commandRegistry` a `globalThis` singleton, with a unit test.
2.2 Revert the singleton (it breaks the production duplicate-id guard in `build:app`).
2.3 Load in-process spec runtime from the app's own package copy (`importFromAppRuntime`).

### Phase 3: Standalone-only spec failures

3.1 `TC-ENTITIES-002`/`008`, `TC-QIDX-5723`, `TC-START-001`, `TC-TELEMETRY-002` (child task).
3.2 Drain the worker queues the eight queue-dependent specs wait on (child task).

## Progress

PR: #8452

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Discovery gating

- [x] 1.1 Gate standalone specs on their own module's enablement — f2e929bf4
- [x] 1.2 Declare the customer_groups dependency on TC-CAT-PRICES-001 — 3bdf9dc23

### Phase 2: Command registry singleton

- [x] 2.1 Make commandRegistry a globalThis singleton — aa7302eef
- [x] 2.2 Revert the singleton — ca8e3fb29
- [x] 2.3 Load in-process spec runtime from the app's own package copy — 8a9d528d0

### Phase 3: Standalone-only spec failures

- [x] 3.1 Fix ENTITIES-002/QIDX-5723/START-001/TELEMETRY-002 — d2a323aab
- [x] 3.2 Drain worker queues in the eight queue-dependent specs — ec83cf1a9
