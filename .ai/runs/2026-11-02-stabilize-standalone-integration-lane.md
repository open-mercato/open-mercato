# Stabilize the standalone integration lane on main

## Goal

Make the `Develop Snapshot Release` → `Standalone App Integration Tests` job on `main` stop failing for structural reasons, fixing the root causes rather than individual assertions.

## Evidence

Run `41392794720` (main @ `185c04f3b`): 157 failed / 2737 passed. The same set fails on every main run since at least 2026-10-31.

- **139 failures** are specs of modules the create-app template ships commented out (`ecommerce`, `customer_groups`, `availability`, `promotions`, `cart`) plus `TC-CAT-PRICES-001`, which needs `customer_groups`. Every request returns 404 because the module is not registered in the standalone app.
  - Root cause: `packages/cli/src/lib/testing/integration-discovery.ts` reads the standalone app's `src/modules.ts` when `OM_TEST_APP_ROOT` is set, but it skips a non-overlay spec only when its *declared* `dependsOnModules` are missing. It never checks the spec's own module.
- **2 failures** (`TC-AUTH-066`, `TC-PHONE-HUB-006`) throw `Command handler not registered for id X. Registered commands …: [X]`.
  - Root cause: the specs bootstrap the standalone app in-process. The spec's `CommandBus` comes from the monorepo copy of `@open-mercato/shared`, while the app's lazy command loaders import the published `dist` copy, which registers handlers into its own module-local `commandRegistry`. That is the same module-duplication hazard that the modules, i18n and notification-handler registries already solve with a `globalThis` singleton.

## Scope

- Discovery: in standalone mode (`OM_TEST_APP_ROOT`), a non-overlay spec inside a real module (the module root has `index.ts`) runs only when that module is enabled in the app's `modules.ts`. Monorepo discovery is unchanged.
- `TC-CAT-PRICES-001`: declare `dependsOnModules: ['catalog', 'customer_groups']`.
- `commandRegistry`: process-wide `globalThis` singleton (`Symbol.for`).
- Unit tests for both code changes.

## Non-goals

- Enabling the ecommerce modules in the template. That is a maintainer decision about the harness and its instruction budget, documented in the template's `modules.ts`.
- `TC-SALES-7782` (covered by open PR #8391).
- The remaining standalone-only failures (queue-drain timeouts `TC-CAT-043` / `TC-SHIP-018` / `TC-SHIP-020` / `TC-WC-035` / `TC-WF-054` / `TC-WF-061`; invite e-mail capture `TC-AUTH-033` / `TC-CACC-INVITE-REUSE-001`; `TC-ENTITIES-002`, `TC-QIDX-5723`, `TC-START-001`, `TC-TELEMETRY-002`). Each has a distinct cause, and they are reported as follow-ups on the PR.

## Risks

- Gating on the spec's own module could hide specs whose module is enabled only through a conditional `enabledModules.push(...)`. Mitigation: the standalone enabled set also collects ids from every object literal in `modules.ts` (array literal + pushes, an over-approximation) and from `official-modules.generated.ts`. Enterprise overlays keep their existing rule.
- Sharing the registry across copies: whichever copy initializes first owns the instance. Both copies come from the same commit in the snapshot lane, and the API surface is unchanged.

## Implementation Plan

### Phase 1: Discovery gating

1.1 Gate standalone specs on their own module's enablement and widen the standalone enabled set to conditional pushes, with unit tests.
1.2 Declare the `customer_groups` dependency on `TC-CAT-PRICES-001`.

### Phase 2: Command registry singleton

2.1 Make `commandRegistry` a `globalThis` singleton, with a unit test.

## Progress

PR: #8452

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Discovery gating

- [x] 1.1 Gate standalone specs on their own module's enablement — f2e929bf4
- [x] 1.2 Declare the customer_groups dependency on TC-CAT-PRICES-001 — 3bdf9dc23

### Phase 2: Command registry singleton

- [x] 2.1 Make commandRegistry a globalThis singleton — aa7302eef
