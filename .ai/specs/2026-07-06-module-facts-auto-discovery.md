# Module Fact-Sheets — Auto-Discovery Beyond the Core Allowlist

- **Status:** Proposed (design only — not yet implemented)
- **Date:** 2026-07-06
- **Scope:** OSS — `packages/cli` module-facts generator + `packages/create-app` bundling wiring
- **Related:** [`.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md`](2026-06-27-ts-morph-module-fact-sheets.md) (parent — PR #3715), GitHub issue #3752, `packages/cli/src/lib/generators/module-facts.ts`, `packages/cli/src/lib/generators/module-facts-generate.ts`, `packages/cli/src/lib/resolver.ts` (`loadEnabledModules`, `getModulePaths`, `discoverPackages`), `packages/create-app/build.mjs`, `packages/create-app/src/setup/tools/shared.ts`, `BACKWARD_COMPATIBILITY.md`

## TLDR

The `module-facts` generator (PR #3715) hard-codes a 9-entry `MODULE_FACTS_ALLOWLIST` and reads a single `coreSrcRoot` (`packages/core/src/modules`). Three gaps (issue #3752): a new core module needs a manual allowlist edit; modules in `apps/*` or non-core packages are ineligible; standalone custom modules get nothing. **Option A — auto-discovery:** replace the fixed allowlist + single-root read with a discovery pass. The monorepo `yarn generate` becomes **registry-driven** — it enumerates the app's *enabled* module set via `resolver.loadEnabledModules()` and resolves each module's source dir via `resolver.getModulePaths(entry)`, so every enabled module (core, app-local, other packages) gets a fact-sheet with **no allowlist maintenance**. Scope is **source-available `.ts` modules**; extracting facts from compiled `.js` in `node_modules` (the parent spec's R1 item) stays a deferred follow-up. The `MODULE_FACTS_ALLOWLIST` export is retained `@deprecated` for BC but is no longer the generation gate. `create-app`'s `build.mjs` bundles a sheet per package-provided module; `shared.ts` needs no change because it already links `enabled ∩ bundled`. Updated cli tests + a regenerated `apps/mercato/src/module-facts.generated.json` snapshot are part of the change.

## 1. Problem

`module-facts-generate.ts` hard-codes `coreSrcRoot = packages/core/src/modules` and `extractAllModuleFacts` defaults `moduleIds` to `MODULE_FACTS_ALLOWLIST` (9 modules). Consequences:

1. **New core modules are invisible** until someone edits the `MODULE_FACTS_ALLOWLIST` array *and* the `bc-guard` / `TC-INT-008` tests that pin the emitted set to it.
2. **Non-core locations are ineligible** — the generator only ever joins `packages/core/src/modules/<id>`, so `apps/mercato/src/modules/*` and other packages (`onboarding`, `webhooks`, …) produce nothing.
3. **Standalone custom modules get nothing** — no discovery path reaches an app's own `src/modules/*`.

The parent spec locked this narrow scope on purpose (D5) and filed the expansion under §12 Deferred. Issue #3752 is that follow-up.

## 2. Goals / Non-Goals

**Goals**
- The monorepo `yarn generate` emits a fact-sheet for **every enabled module** (core, app-local, other packages) with **zero allowlist maintenance**.
- Discovery is **registry-driven**: the module set is the app's enabled set (`resolver.loadEnabledModules()`), the single source of truth already used by the module registry; each module's source dir is resolved via `resolver.getModulePaths()`.
- `create-app` scaffolds bundle a fact-sheet for **every package-provided module**, and their `AGENTS.md` links one per **enabled** module — the curated 9-module display list disappears (Q3-A).
- Facts stay re-derived from AST on every run; the parent spec's version-stamp and "never crash on malformed" guarantees are preserved.

**Non-Goals**
- **Not** parsing compiled `.js` (`node_modules/@open-mercato/*/dist/modules`). Source-available `.ts` only (Q2). Regenerating installed-package facts at a standalone app's `yarn generate` remains the parent spec's deferred R1 item (§8 Deferred).
- Not changing the extraction *content* (the per-module fact shape from PR #3715 is unchanged) — only *which* modules are extracted and *from where*.
- Not changing runtime behaviour of any module — docs/tooling only.

## 3. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| A1 | Discovery driver (Q1) | **Registry-driven.** The monorepo generator enumerates `resolver.loadEnabledModules()` (the enabled set, backing the module registry) rather than scanning every folder on disk. Disabled/example modules that are not in `enabledModules` get no sheet — matching what the app actually runs. |
| A2 | Per-module source resolution | For each `ModuleEntry`, resolve the source dir via `resolver.getModulePaths(entry)`: prefer `appBase` (`apps/*/src/modules/<id>`) when it exists (app override / `@app` module), else `pkgBase` (`packages/<pkg>/src/modules/<id>`). The extractor is generalised from one fixed `coreSrcRoot` to a per-module root. |
| A3 | Compiled-standalone scope (Q2) | **Source-only.** Modules whose resolved root exposes no readable `.ts`/`.tsx` convention files (i.e. `.js`-only installed packages in standalone mode) are **skipped**, never emitted empty. Their facts remain available via the create-app-bundled `.ai/guides/module-facts.json`. |
| A4 | Allowlist fate (Q3) | **Drop it as the gate.** `MODULE_FACTS_ALLOWLIST` / `ModuleFactsModuleId` remain **exported and `@deprecated`** (BC — importable subpath `@open-mercato/cli/lib/generators/module-facts`), but nothing consumes them for generation. `create-app` bundles a sheet per package module; `shared.ts`'s existing `enabled ∩ bundled` intersection yields the full enabled set automatically. |
| A5 | create-app bundle scope | `build.mjs` (runs in the monorepo at publish) discovers **package-provided** modules via `resolver.discoverPackages()` + `discoverModulesInPackage()` — core **plus** other `@open-mercato/*` packages — but **not** `apps/mercato`'s demo modules (a scaffolded app must not inherit the reference app's local modules). Discovery **MUST** route through the resolver, never a hardcoded `packages/core/...` path (`.ai/lessons.md` §161-169); the current hardcoded `coreSrcRoot` in `build.mjs` is removed. |
| A6 | `@app` module scope by mode (resolves the enterprise/app-local decision) | **Enterprise included; app-local mode-gated.** The generator includes every enabled source-available module — including `@open-mercato/enterprise` (`security`, `sso`, `record_locks`, `system_status_overlays`). App-local (`from: '@app'`) modules are gated on `resolver.isMonorepo()`: in the **monorepo** reference app, `@app` modules are the demo/probe fixtures (`example`, `example_customers_sync`, `ratelimit_probe`) and are **excluded** from the committed `module-facts.generated.json`; in a **standalone** user app, `@app` modules are the user's own custom modules and are **included** (issue #3752 problem #3). Accepted residual: the committed OSS artifact includes enterprise facts, so it differs on checkouts where the enterprise package is absent (see R7). |

## 4. Architecture

### 4.1 Discovery helper (`packages/cli`)

Add a single discovery function that yields `{ moduleId, moduleRoot }[]`, used by both invocation sites:

```ts
// packages/cli/src/lib/generators/module-facts-discovery.ts
export type ModuleFactSource = { moduleId: string; moduleRoot: string; from: string }

// Registry-driven (monorepo/standalone yarn generate): the app's enabled set.
export function discoverEnabledModuleSources(resolver: PackageResolver): ModuleFactSource[] {
  const sources: ModuleFactSource[] = []
  const isMonorepo = resolver.isMonorepo()
  for (const entry of resolver.loadEnabledModules()) {
    const from = entry.from ?? '@open-mercato/core'
    // A6: exclude the reference app's demo/probe modules from the committed OSS artifact,
    // but keep a real user's own @app modules in their standalone build (issue #3752 §3).
    if (isMonorepo && from === '@app') continue
    const { appBase, pkgBase } = resolver.getModulePaths(entry)
    const moduleRoot = fs.existsSync(appBase) ? appBase : pkgBase
    if (!hasReadableModuleSource(moduleRoot)) continue // A3 source-only skip (.js-only installs)
    sources.push({ moduleId: entry.id, moduleRoot, from })
  }
  return dedupeById(sources) // first-wins on id collision (app override already preferred)
}

// Package-scan (create-app build.mjs): every package-provided module, core + others.
export function discoverPackageModuleSources(resolver: PackageResolver): ModuleFactSource[] { … }
```

`hasReadableModuleSource` returns true when at least one recognised convention file (`data/entities.ts`, `acl.ts`, `events.ts`, `index.ts`, …) exists as `.ts`/`.tsx` — the A3 boundary that skips `.js`-only installs.

### 4.2 Generalise the extractor (`module-facts.ts`)

`extractModuleFacts` currently computes `moduleRoot = path.join(coreSrcRoot, moduleId)`. Add an optional explicit `moduleRoot` to `ExtractModuleFactsOptions`; when present it wins, else the legacy `coreSrcRoot + moduleId` join is used (BC preserved for any external caller of the old shape).

`extractAllModuleFacts` gains an optional `sources?: ModuleFactSource[]`. When provided it iterates those `{ moduleId, moduleRoot }` pairs; otherwise it falls back to the legacy `coreSrcRoot + (moduleIds ?? MODULE_FACTS_ALLOWLIST)` path. The legacy default is retained **only** so the deprecated signature keeps working — `generateModuleFacts` (§4.3) always passes `sources` and never relies on it.

The registry-derived API-route auth (`apis[].metadata` from `modules.runtime.generated.ts`) is unchanged — it is already keyed by `moduleId`, independent of where the module's source lives.

### 4.3 Monorepo generator (`module-facts-generate.ts`)

Replace the `coreSrcRoot` existence gate + allowlist iteration with:

```ts
const sources = discoverEnabledModuleSources(resolver)
if (sources.length === 0) { /* warn + skip, as today */ return result }
const { factsByModule, warnings } = extractAllModuleFacts({
  sources, registryPath, coreVersion, // coreVersion still from @open-mercato/core package.json
})
```

Output path is unchanged: the versioned `apps/mercato/src/module-facts.generated.json` (never `.mercato/generated/`, per parent D4). The file simply now contains every enabled module, alphabetically keyed (existing `buildModuleFactsJsonObject` already sorts).

### 4.4 create-app wiring

- **`build.mjs`**: replace the `coreSrcRoot`-only extraction with `discoverPackageModuleSources(resolver)` (A5), bundling `dist/agentic/guides/modules/<module>.md` per package module + the combined `module-facts.json`. The legacy `core.<module>.md` redirect-stub loop (parent §7 BC bridge) is retained unchanged.
- **`shared.ts`**: **no logic change.** `selectModuleFactSheets` already returns `available (bundled) ∩ enabled`; widening `available` to all package modules makes it link one row per enabled module automatically. The R5 fallback (full bundled set when the enabled set can't be read) is unchanged.

## 5. Data Models / API Contracts

- **JSON sidecar schema** (`ModuleFactsJsonEntry`) — **unchanged**. Only the number of top-level keys grows (9 → the full enabled/bundled set). It remains the authoritative data contract from the parent spec.
- **API Contracts** — N/A. No runtime HTTP surface added or changed.
- **BC surface** — `MODULE_FACTS_ALLOWLIST` and `ModuleFactsModuleId` stay exported (`@deprecated` JSDoc + `RELEASE_NOTES.md` entry); `extractAllModuleFacts`/`extractModuleFacts` stay call-compatible via additive optional fields (`sources`, `moduleRoot`). No FROZEN/STABLE surface is removed. See §7.

## 6. Phasing

1. **Discovery + extractor generalisation (cli).** Add `module-facts-discovery.ts`; add optional `moduleRoot`/`sources` to the extractor; switch `generateModuleFacts` to `discoverEnabledModuleSources`. Run `yarn generate`; commit the widened `apps/mercato/src/module-facts.generated.json` snapshot.
2. **Tests (cli).** Rewrite `module-facts.bc-guard.test.ts` and `TC-INT-008.spec.ts` to derive the module set from discovery instead of `MODULE_FACTS_ALLOWLIST`; keep the `customers` fixture test as the content lock; add a discovery unit test (A1 enabled-set intersection, A2 app-override preference, A3 `.js`-only skip). See §9.
3. **create-app bundle (create-app).** `build.mjs` → replace the hardcoded `coreSrcRoot = join(packagesDir, 'core', …)` with resolver-routed `discoverPackageModuleSources` (A5 + lessons §161-169); update `agents-md.module-guides.test.ts` to assert `enabled ∩ bundled` over the widened bundle (drop the "∩ allowlisted" framing). `shared.ts` unchanged. If the guides-table shape/behavior changes, sync `packages/create-app/agentic/shared/AGENTS.md.template` in the same step (create-app AGENTS rule).
4. **BC + docs.** `@deprecated` the allowlist export; `RELEASE_NOTES.md` deprecation note; confirm the parent's redirect stubs still emit.

## 7. Backward Compatibility

Per `BACKWARD_COMPATIBILITY.md` (exported values/types from an importable subpath are a STABLE contract surface):

- **Retain** `MODULE_FACTS_ALLOWLIST` and `ModuleFactsModuleId` as `@deprecated` re-exports for ≥1 minor (values unchanged). They are dead-weight for generation but keep the import path valid.
- **Additive-only** signature changes: `ExtractModuleFactsOptions.moduleRoot?` and `ExtractAllModuleFactsOptions.sources?` are new optional fields; the legacy `{ coreSrcRoot, moduleIds? }` shape still works and still defaults to the allowlist, so an external caller of the old API sees no change.
- **Generated-file contract**: `apps/mercato/src/module-facts.generated.json` is a versioned generated artifact; content widening is additive (new keys), consumers key by module id. The parent's `core.<module>.md` redirect stubs are untouched.
- **`RELEASE_NOTES.md`**: document the allowlist deprecation and the widened generated artifact.

## 8. Risks & Impact Review

| ID | Risk / failure scenario | Severity | Affected area | Mitigation | Residual |
|----|--------------------------|----------|---------------|------------|----------|
| R1 | **Strict namespacing assertion breaks the BC guard on real modules.** The pre-implementation audit confirmed three enabled modules emit ids not prefixed by their folder id: `ai_assistant` → `ai.action.*` / `ai.token_usage.recorded` events; `dashboards` → ACL `analytics.view`; `storage_s3` → ACL `storage_providers.manage`. These are intentional cross-namespace choices, not bugs. A blanket `id.startsWith(`${moduleId}.`)` assertion over the widened set red-fails CI immediately. | Medium→resolved | cli test suite / CI | **The rewritten guard (T2) drops the strict module-prefix assertion** and keeps the invariants that actually protect against drift: id **uniqueness** + **resolve-against-live-source** (every emitted entity/event/ACL/search id still resolves against `E` / `events.ts` / `acl.ts` / `search.ts`) — the parent spec's real T3 purpose. No hand-maintained exemption list (which would contradict the point of Option A). | The guard no longer enforces the `module.*` naming convention; that convention is a separate lint concern, not this generator's job. |
| R2 | **Sparse/empty sheets** for framework-only modules (no entities/events/acl, e.g. pure-UI modules). | Low | fact-sheet quality | Emit the sheet anyway (transparency); empty sections already render `_none_`. A module with **zero** readable source is skipped (A3), not emitted empty. | Some sheets are mostly `_none_` — accurate, low noise. |
| R3 | **Committed artifact churn.** `module-facts.generated.json` grows ~9 → the enabled package + enterprise set (~52, after excluding the 3 `@app` demo modules per A6), enlarging the diff and every future regeneration diff. | Low | repo hygiene | Deterministic + alphabetically sorted output keeps diffs stable; one-time growth is expected and reviewed. | Larger committed file (bounded, generated). |
| R4 | **Generation cost.** Extracting ~40 modules (incl. recursive `backend/**` scan for table ids) instead of 9 slows `yarn generate`. | Low | build time | Build-time only, bounded by module count; measure in Phase 1 and, if material, cache per-module by mtime (not expected necessary). | Marginally slower generate. |
| R5 | **create-app bundles the wrong set.** Using the enabled set (mercato app) instead of package modules would leak `apps/mercato` demo modules into scaffolds, or miss non-core package modules. | Medium | scaffolded apps | A5 pins `build.mjs` to `discoverPackageModuleSources` (package scan: core + other `@open-mercato/*` packages, excluding `apps/*`). Covered by the updated `agents-md.module-guides.test.ts`. | Scaffolds list all package modules; `shared.ts` narrows to the app's enabled subset. |
| R6 | **Standalone `yarn generate` degrades the first-party artifact.** In standalone mode package modules are `.js`-only; naive extraction would emit empty facts. | Low | standalone apps | A3 skips `.js`-only roots; app-local `.ts` modules still extract (A6 includes `@app` in standalone mode). The create-app-bundled `.ai/guides/module-facts.json` (separate artifact) retains the core facts. | Standalone `src/module-facts.generated.json` covers only source-available modules — the deferred R1 follow-up closes this. |
| R7 | **Committed OSS artifact not reproducible without the enterprise package.** A6 includes enterprise module facts; a checkout lacking `@open-mercato/enterprise` regenerates a smaller file (those roots fail `hasReadableModuleSource` and are skipped), so `yarn generate` there produces a diff. | Low (accepted) | repo reproducibility | Accepted per user decision — enterprise facts are non-sensitive contract metadata (ids only, no logic). Contributors without the enterprise package MUST NOT commit the shrunken regeneration; note this in `RELEASE_NOTES.md` / the generator's header comment. | OSS-only contributors must avoid committing an enterprise-stripped artifact; enforced by review, not tooling. |

## 9. Integration & Test Coverage

This is a generator: coverage means unit/snapshot tests in `packages/cli` (`yarn test`) plus the create-app wiring tests (`yarn test:create-app`). No HTTP/UI surface is added.

| # | Test | Package | Type | Asserts |
|---|------|---------|------|---------|
| T1 | `module-facts.discovery.test.ts` (new) | cli | unit | `discoverEnabledModuleSources` returns exactly the enabled set (A1); prefers `appBase` over `pkgBase` when an app override exists (A2); skips a module whose root has only `.js`/no readable `.ts` (A3); **excludes `from: '@app'` in monorepo mode but includes it in standalone mode (A6)**; dedupes id collisions first-wins. Uses a synthetic resolver/fixture tree, not the live repo, so mode-gating is deterministic. |
| T2 | `module-facts.bc-guard.test.ts` (rewrite) | cli | guard | Derive the module set from discovery over live `packages/*/src/modules` (no `MODULE_FACTS_ALLOWLIST` import). For every discovered module: **entity ids are colon-namespaced under the module id** (guaranteed by construction — `extractEntities` builds `${moduleId}:…`), all emitted entity/event/ACL/search ids are **unique**, and search/host tokens **resolve to the module's own entity set**. **Does NOT assert `module.` prefix on event/ACL ids** (R1 — `ai_assistant`/`dashboards`/`storage_s3` legitimately deviate); the meaningful invariant is resolve-against-source, not folder-name prefix. Guards R1/R3. |
| T3 | `module-facts.customers.fixture.test.ts` (keep) | cli | snapshot | Unchanged content lock for `customers` (21 ACL features, 49 events, colon-form entity ids, empty `diTokens`/`cli`) — proves the widening did not alter extraction content. |
| T4 | `TC-INT-008.spec.ts` (update) | cli | integration | Replace the `MODULE_FACTS_ALLOWLIST` loop with the discovered set; assert every enabled module appears in the emitted `module-facts.generated.json`. |
| T5 | `agents-md.module-guides.test.ts` (update) | create-app | unit | With a widened bundle, the generated `AGENTS.md` Module-Specific Guides block lists exactly the **enabled** modules (rows point at `.ai/guides/modules/<id>.md`); a present-but-disabled module yields no row; second pass is idempotent between the markers. Drops the "enabled ∩ allowlisted" framing (now "enabled ∩ bundled"). |
| T6 | `module-facts.malformed.test.ts` (keep) | cli | unit | Unchanged: an unparseable section yields an empty section + warning, never a throw (R2/R1 safety). |

## 10. Open Questions

_None blocking._ Q1 resolved as A1 (registry-driven), Q2 as A3 (source-only, `.js` deferred), Q3 as A4/A5 (drop the allowlist gate; retain deprecated export; create-app bundles package modules), and the pre-implementation audit's committed-scope question resolved as A6 (enterprise included; `@app` mode-gated).

## 11. Deferred / Future

- **Compiled-`.js` extraction / generate-time regeneration in standalone apps** (parent R1): teach the reader to parse `dist/modules/*.js` so installed-package facts track the actually-installed version. Separate spec.
- **Remove the deprecated `MODULE_FACTS_ALLOWLIST` export** after the ≥1-minor bridge window.

## 12. Changelog

- **2026-07-06** — Initial draft for issue #3752 (Option A auto-discovery). Decisions A1–A5 locked from user input (Q1 registry-driven, Q2 source-only, Q3 drop the allowlist gate). Grounded on the existing `resolver.loadEnabledModules()`/`getModulePaths()`/`discoverPackages()` infra and the fact that `create-app`'s `shared.ts` already links `enabled ∩ bundled`, so the create-app change reduces to widening the bundle.
- **2026-07-06** — Pre-implementation analysis applied ([`.ai/specs/analysis/ANALYSIS-2026-07-06-module-facts-auto-discovery.md`](analysis/ANALYSIS-2026-07-06-module-facts-auto-discovery.md)). Audit confirmed the enabled set is ~55 modules and that three modules (`ai_assistant` → `ai.*` events, `dashboards` → `analytics.view`, `storage_s3` → `storage_providers.manage`) would break a strict `startsWith(moduleId)` guard. Changes: **T2/R1** rewritten to drop strict module-prefix namespacing and keep uniqueness + resolve-against-source; **A6** added (enterprise included, `@app` mode-gated on `isMonorepo()` — excluded in the monorepo reference app, included for standalone user modules per issue §3); **A5** strengthened to require resolver-routed discovery in `build.mjs` (lessons §161-169) and to sync the `agentic/` template; **R3** count corrected to ~52; **R7** added (committed OSS artifact not reproducible without the enterprise package — accepted). Confirmed `loadEnabledModules()` handles `.push()`/official-module spreads, so A1 is sound.
