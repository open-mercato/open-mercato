> **Repo-local override.** Points the base `om-smart-test` selection at this monorepo's Jest + Playwright suites and module test map, and adds the integration-env, enterprise-overlay, and template-scope rules.

## Step 1 — resolve the suites (add)

Suites are `smartTest.suites` in `.ai/agentic.config.json`: `unit` (Jest; `related` via `--findRelatedTests`, `direct` for changed `__tests__/**/*.test.ts(x)`, `full` = `yarn test`) and `integration` (Playwright; `direct` for changed or mapped `__integration__/**/*.spec.ts`, `full` = `yarn test:integration`, `needsApp: true`). Change commands there, never in this file.

## Step 3 — collect the changed files (add)

The base branch is `develop` (config `baseBranch`). Never diff a develop-based branch against `main`: it pulls in unrelated `packages/shared/` history and forces a needless full run.

## Step 4 — map changes to affected units (add)

- The map is `.ai/test-map.json` (`smartTest.map`): modules are the units (`**/src/modules/{unit}/**`); cross-module integration dependencies come from the `dependsOnModules` / `requiredModules` / `requiresModules` arrays in `__integration__/meta.ts`, cascaded `__integration__/**/index.ts`, and per-test `*.meta.ts` files; `wide` lists the cross-cutting packages (`shared`, `events`, `queue`, `cache`, `ui/src/backend`) and root build/test config. When a new cross-cutting package or test-support path appears, propose the map change in the report.
- The same module name can exist in several runtime roots (`apps/mercato/src/modules/example`, `packages/create-app/template/src/modules/example`, `packages/<pkg>/src/modules/<module>`). They are different units: an app-only page change never selects template integration specs, and specs under `packages/create-app/template` are pulled in through a dependency declaration only when a module under the template root changed.
- Pure style changes (`*.css`, `packages/ui/src/primitives/**`) skip the `integration` suite — they cannot change DOM structure or interactivity.
- React components, widgets, `frontend/**`, and `backend/**/*.tsx` pages still run their own module's integration specs (a broken render or a changed selector fails Playwright) but do not pull in dependent modules. Module `backend/page.tsx` / `backend/[id]/page.tsx` are UI pages; module `api/<METHOD>/route.ts` files are API logic and follow dependents.

## Step 6 — prepare the environment (add)

- This repo's `om-prepare-test-env` override (`.ai/skills/om-prepare-test-env/SKILL.md`) owns the ephemeral boot, reuse TTL, and teardown behind `.ai/qa/test-env.json`. Never build and `yarn start` the app on port 3000 as a substitute.
- The `integration` suite commands need the full runner env block from the descriptor exported (at minimum `BASE_URL`, the ephemeral `DATABASE_URL`, and `QUEUE_BASE_DIR`) — with `BASE_URL` alone, DB-fixture helpers fall back to the dev database. See `.ai/skills/om-integration-tests/SKILL.md`.
- Enterprise overlay specs are selected only when `OM_ENABLE_ENTERPRISE_MODULES=true` (overlay root: `OM_INTEGRATION_OVERLAY_ROOT`, default `packages/enterprise`); say in the report whether the overlay was on.
- Runnable specs are discovered by `packages/cli/src/lib/testing/integration-discovery.ts` (used by `.ai/qa/tests/playwright.config.ts`); a mapped spec that discovery filters out (module disabled) is reported as `not run`, not as a pass.

## Rules (add)

The merge gate stays the ordered `validation.commands` in `.ai/agentic.config.json` (run with the Docker-vs-local runner choice from `.ai/docs/agent-instructions.md`) plus CI (`yarn test` and `yarn test:integration:coverage` on every PR).
