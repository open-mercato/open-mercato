# Execution Plan — Module Fact-Sheets Auto-Discovery (issue #3752)

**Source spec:** `.ai/specs/2026-07-06-module-facts-auto-discovery.md`
**Analysis:** `.ai/specs/analysis/ANALYSIS-2026-07-06-module-facts-auto-discovery.md`
**Branch:** `feat/module-facts-auto-discovery`

## Goal

Replace the hard-coded 9-entry `MODULE_FACTS_ALLOWLIST` + single `coreSrcRoot` in the `module-facts` generator with registry-driven auto-discovery, so every enabled source-available module (core, other packages, enterprise, standalone user modules) gets a fact-sheet with zero allowlist maintenance.

## Scope

- `packages/cli/src/lib/generators/module-facts.ts` — generalise extractor to per-module roots; add `sources`; deprecate the allowlist export.
- `packages/cli/src/lib/generators/module-facts-discovery.ts` (new) — `discoverEnabledModuleSources` (A1/A2/A3/A6) + `discoverPackageModuleSources` (A5).
- `packages/cli/src/lib/generators/module-facts-generate.ts` — switch to discovery.
- `packages/cli/src/lib/generators/__tests__/*` — rewrite bc-guard, add discovery test, keep customers fixture + malformed.
- `packages/cli/src/lib/__integration__/TC-INT-008.spec.ts` — derive set from discovery.
- `packages/create-app/build.mjs` — resolver-routed package discovery (A5).
- `packages/create-app/src/setup/tools/agents-md.module-guides.test.ts` — assert `enabled ∩ bundled`.
- `apps/mercato/src/module-facts.generated.json` — regenerated snapshot.
- `RELEASE_NOTES.md` — allowlist deprecation + widened artifact note.

## Non-goals

- Parsing compiled `.js` (`node_modules/@open-mercato/*/dist/modules`) — deferred (spec §11).
- Changing the per-module fact **content** shape (unchanged from PR #3715).
- Any runtime/module behavior change.

## Decisions carried from spec (locked)

- A1 registry-driven via `resolver.loadEnabledModules()`; A2 `getModulePaths` app-override-first; A3 skip `.js`-only roots; A4 drop allowlist gate, keep `@deprecated` export; A5 create-app package scan through resolver; A6 enterprise included, `@app` gated on `isMonorepo()`.
- BC-guard drops strict `startsWith(moduleId)` (R1: `ai_assistant`/`dashboards`/`storage_s3` legitimately deviate); keeps uniqueness + resolve-against-source.

## Risks (brief)

- Widened snapshot (~9 → ~52 modules) is a large but deterministic diff.
- A malformed/sparse module must yield empty sections + warning, never crash (keep parent R4 behavior).
- `build.mjs` must not regress the create-app bundle shape; `shared.ts` stays untouched.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: cli discovery + extractor generalisation

- [x] 1.1 Add `ModuleFactSource` type + `discoverEnabledModuleSources` / `discoverPackageModuleSources` in new `module-facts-discovery.ts` — 31ef54051
- [x] 1.2 Generalise `extractModuleFacts` (`moduleRoot?`) + `extractAllModuleFacts` (`sources?`); `@deprecate` `MODULE_FACTS_ALLOWLIST` / `ModuleFactsModuleId` — 31ef54051
- [x] 1.3 Switch `generateModuleFacts` to `discoverEnabledModuleSources` — 31ef54051
- [x] 1.4 Regenerate `apps/mercato/src/module-facts.generated.json` snapshot via `yarn generate` (9 → 47 modules; enterprise env-gated off by default, app-local excluded) — 31ef54051

### Phase 2: cli tests

- [x] 2.1 New `module-facts.discovery.test.ts` (A1/A2/A3/A6 + dedupe) — 9194f8042
- [x] 2.2 Rewrite `module-facts.bc-guard.test.ts` (discovery-derived set; drop strict namespacing; keep colon-namespacing + uniqueness) — 9194f8042
- [x] 2.3 `TC-INT-008.spec.ts` unchanged — its `MODULE_FACTS_ALLOWLIST` use is the legacy-redirect-stub set (historical 9), which stays correct; Phase 3 keeps the stub loop bound to the allowlist so no new stubs appear — 9194f8042
- [x] 2.4 `module-facts.customers.fixture.test.ts` + `module-facts.malformed.test.ts` pass unchanged (full cli suite green: 1173 tests) — 9194f8042

### Phase 3: create-app bundle wiring

- [x] 3.1 Both `cli/build.mjs` + `create-app/build.mjs` → resolver-routed `discoverPackageModuleSources` (9 → 53 bundled); stub loop bound to allowlist (9 stubs) — 4e5a6ccef
- [x] 3.2 Refreshed `agents-md.module-guides.test.ts` to `enabled ∩ bundled` framing; `agentic/` template unchanged (guides-table shape is data-driven, not restructured) — 4e5a6ccef

### Phase 4: BC + docs + gate

- [ ] 4.1 `RELEASE_NOTES.md` deprecation + widened-artifact note
- [ ] 4.2 Full validation gate (build:packages → generate → build:packages → i18n → typecheck → test → build:app)

## Changelog

- 2026-07-06 — Plan created; worktree `feat/module-facts-auto-discovery` off `origin/develop`.
