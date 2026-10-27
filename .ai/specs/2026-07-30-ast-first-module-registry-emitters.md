# Retiring the String Emitters in `module-registry.ts`

> One of three specs split out of issue [#1637](https://github.com/open-mercato/open-mercato/issues/1637).
> Siblings: [`2026-07-30-ast-first-package-build-scripts.md`](2026-07-30-ast-first-package-build-scripts.md) (package build scripts),
> [`2026-07-30-generator-plugin-ast-output-contract.md`](2026-07-30-generator-plugin-ast-output-contract.md) (public plugin contract).
> Each is independently deployable and carries no dependency on the others.

## TLDR

**Key Points:**
- `module-registry.ts` currently contains **two parallel implementations of the same generator**. `generateModuleRegistryApp` / `generateModuleRegistryCli` build module entries as `ts-morph` `WriterFunction`s and emit through `renderAstModuleRegistryFile`. The main `generateModuleRegistry` path builds the same entries as ~320 lines of template literals and emits through `renderAstLegacyModuleRegistryOutput`.
- The fix is therefore **deletion, not rewriting**: convert the main path's entry builders to the object-literal vocabulary the app/cli paths already use, then route them through the emitter that already exists and delete the legacy renderers.
- Two further string emitters are in scope, both self-contained and both missed by issue #1637: `renderCommandLoadersFile` (`command-loaders.generated.ts`) and the inline `bootstrap-registrations.generated.ts` emission.
- One function the original bundled spec listed as a string emitter — `renderAstLegacyAliasFile` — **is already fully AST-based**. Only its name is legacy. It is out of scope.

**Scope:**
- `renderCommandLoadersFile` (`module-registry.ts:1235`) → AST
- the `bootstrap-registrations.generated.ts` emission (`module-registry.ts:3426`) → AST
- `renderAstLegacyManifestOutput` (`:2437`) → deleted; its three call sites move to an AST manifest emitter
- `renderAstLegacyModuleRegistryOutput` (`:2416`) and `renderLegacyCompatibleArray` (`:2406`) → deleted; the main path's entry builders converted and routed through the existing `renderAstModuleRegistryFile` (`:2288`)

**Out of scope:**
- `renderAstLegacyAliasFile` (`:2343`) and `renderEnabledModuleIdsFile` (`:2377`) — already AST-based.
- `buildImportStatement` / `serializeGeneratedImport` — see Non-Goals.
- The `GeneratorPlugin` contract and its `buildOutput` / `configExpr` / `bootstrapRegistration` strings — see the sibling contract spec.
- `packages/enterprise` — commercially licensed, external contributions not accepted.

## Overview

The [2026-04-06 ts-morph migration](implemented/2026-04-06-module-registry-ast-codegen-ts-morph.md) moved most of the generator stack onto an in-memory `ts-morph` project via `packages/cli/src/lib/generators/ast/`. It reached the app and CLI registry variants but stopped before the main registry path, leaving the two implementations side by side in one 4000-line file:

| Generator | Entry type | Emitter | State |
|---|---|---|---|
| `generateModuleRegistryAppFromDiscovery` (`:3438`) | `WriterFunction[]` via `objectLiteral(...)` | `renderAstModuleRegistryFile` (`:2288`) | AST |
| `generateModuleRegistryCliFromDiscovery` (`:3799`) | `WriterFunction[]` via `objectLiteral(...)` | `renderAstModuleRegistryFile` | AST |
| `generateModuleRegistryFromDiscovery` (`:2830`) | `string[]` via template literals (`:3153`, `:3173`) | `renderAstLegacyModuleRegistryOutput` (`:2416`) | **string** |

`renderAstModuleRegistryFile` and `renderAstLegacyModuleRegistryOutput` produce the same file shape from the same inputs. They differ only in statement order (`modulesInfo` before vs. after `export default modules` — both valid, `modules` is already initialised either way) and in formatting. That duplication is the actual defect: two code paths that must be kept in lockstep by hand, and a reviewer has no way to tell which one a given generated file came from.

Verified against `develop@ecc10b3db`; the file is unchanged from `4efa7961c`.

> **Market Reference**: Nx solved the same drift by collapsing its "old" and "new" generator hosts onto one tree API rather than porting the old one, and Babel's plugin ecosystem converged on `@babel/types` builders for exactly this reason — two emitters for one output shape reliably diverge. Adopted: delete the duplicate host and converge on the surviving AST emitter. Rejected: keeping both behind a feature flag, which is how the divergence arose.

## Problem Statement

**1. Duplicated emitters.** Described above. Any change to the generated registry shape must be made twice, in two different languages (writer calls vs. template literals), with no test asserting the two stay equivalent.

**2. Entry builders assemble TypeScript by conditional string interpolation.** `module-registry.ts:3153-3196` builds each module entry as:

```ts
moduleDecls.push(`{
  id: ${toLiteral(modId)},
  ${infoImportName ? `info: ${infoImportName}.metadata,` : ''}
  ${frontendRoutes.length ? `frontendRoutes: [${frontendRoutes.join(', ')}],` : ''}
  …
}`)
```

Every optional property is an interpolated empty string, so the emitted object is full of blank lines and depends on each fragment carrying its own trailing comma. This is the precise failure mode issue #1637 names: a missing comma produces a file that breaks at the *consumer's* compile step. The app/cli paths express the same thing as `GeneratedObjectEntry[]` pushed onto an array, where an absent property is simply not pushed.

**3. `renderLegacyCompatibleArray` exists only to reproduce legacy formatting.**

```ts
function renderLegacyCompatibleArray(entries: readonly string[]): string {
  return `[\n  ${entries.join(',\n  ')}\n]`
}
```

It is called by both legacy renderers and by nothing else. On an empty entry list it emits `[\n  \n]`.

**4. Two self-contained string emitters remain, neither listed in issue #1637.**
- `renderCommandLoadersFile` (`:1235`) builds `command-loaders.generated.ts` by pushing `  { moduleId: …, id: …, key: …, load: () => import(…) },` lines into an array and joining them. Entries are built inside the function, so nothing outside it must change.
- The `bootstrap-registrations.generated.ts` emission (`:3403-3432`) joins import statements and call expressions into a template literal wrapping a `runBootstrapRegistrations()` function body.

**5. No test asserts the two implementations agree.** `output-snapshots.test.ts` snapshots each file's text independently; `structural-contracts.test.ts` parses every generated file and asserts syntax validity plus export shapes. Neither compares `modules.generated.ts` against `modules.app.generated.ts` for the properties they should share.

## Proposed Solution

Converge on the existing AST emitters and delete the legacy ones, in three phases of ascending size. Each phase ships as its own PR and reverts on its own; the order is a recommendation (ascending blast radius), not a build dependency — no phase needs code that a previous phase introduces.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Delete `renderAstLegacyModuleRegistryOutput` and route the main path through the existing `renderAstModuleRegistryFile`, rather than rewriting the legacy renderer in AST | Rewriting leaves two emitters. Converging removes the duplication that caused the drift, and the surviving emitter is already covered by the app/cli snapshots. |
| Convert the entry builders to `GeneratedObjectEntry[]` + `objectLiteral(...)`, mirroring `:3690-3722` line for line | The vocabulary already exists in `ast/writers.ts` and is already used for the same data by the app path. Introducing anything new here would be a third pattern. |
| Add `renderAstManifestFile` modelled on `renderAstModuleRegistryFile`, and delete `renderAstLegacyManifestOutput` | There is no AST manifest emitter today, so this one genuinely is a rewrite — but it is ~20 lines and replaces a renderer used by three call sites. |
| Parity bar is **structural**, not byte-identical | `ts-morph` normalises quoting, indentation, trailing commas, and blank lines, and the surviving emitter orders `modulesInfo` differently. Byte parity is unreachable. The prior migration set the precedent explicitly: "when ts-morph produces output that differs only in whitespace/formatting … update the snapshot. The structural contract tests ensure no semantic change." |
| `structural-contracts.test.ts` must pass **unmodified** at every phase | It is the existing hard safety net: every generated file parses with zero syntax errors, every downstream-consumed export exists, entry counts and nested property shapes match. It is formatting-agnostic by construction, which is exactly what this migration needs. |
| Add a cross-implementation equivalence test before Phase 3 | The duplication is the defect; a test that asserts `modules.generated.ts` and `modules.app.generated.ts` agree on the properties they share is the regression net that should have existed all along, and it is what makes the Phase-3 conversion safe to review. |
| Phase order: leaf emitters → manifests → main registry | Ascending blast radius and ascending diff size. Phases 1 and 2 also prove the approach on small files before the 320-line entry-builder conversion. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Rewrite each legacy renderer in AST, keeping both hosts | Preserves the duplication and therefore the drift risk. Twice the code for the same output. |
| Also convert `buildImportStatement`'s ~30 call sites to structured import specs | See Non-Goals — worth doing, but it would dominate the diff and it is not what makes generation fragile. |
| Delete the `generateModuleRegistryApp` / `Cli` AST paths and keep the legacy one | Backwards: the AST path is the target state and produces committed app artifacts. |
| Split each phase into its own spec | The three phases share one file (`module-registry.ts`), one surviving emitter (`renderAstModuleRegistryFile`), one test harness (`output-snapshots` + `structural-contracts`) and one parity method; they are refinements of a single capability — "this file stops assembling TypeScript from strings" — not independent capabilities, and reviewing any one of them means holding the same emitter contract in mind. Each still ships as its own PR. |
| Attempt byte-identical output by teaching the AST emitter the legacy formatting | `renderLegacyCompatibleArray` is exactly that attempt, and it is one of the things being deleted. |

### Non-Goals

`buildImportStatement(importClause, importPath)` builds import statements as strings at ~30 call sites; those strings are collected into arrays and handed to `addImportStatements`, which **parses them back** into `ImportDeclarationStructure`s via `toImportSpec` (`ast/imports.ts:11`). The round-trip is wasteful, but it is not a correctness hazard: `toImportSpec` throws on anything it cannot parse, so a malformed import fails at generation time with the offending statement in the message — the property this whole effort is trying to obtain. Converting the call sites is a mechanical follow-up that would triple the diff of Phase 3 without changing any failure mode. Left as a follow-up issue, referenced from this spec: [#5035](https://github.com/open-mercato/open-mercato/issues/5035).

## Architecture

```
packages/cli/src/lib/generators/module-registry.ts

  BEFORE                                          AFTER
  ─────────────────────────────────────────────   ─────────────────────────────────────────────
  generateModuleRegistry                          generateModuleRegistry
    moduleDecls: string[]        (template lits)     moduleDecls: WriterFunction[]  (objectLiteral)
    └─► renderAstLegacyModuleRegistryOutput          └─► renderAstModuleRegistryFile   ◄──┐
        └─► renderLegacyCompatibleArray                                                   │
    manifestDecls: string[]                          manifestDecls: WriterFunction[]      │
    └─► renderAstLegacyManifestOutput                └─► renderAstManifestFile  [NEW]     │
    renderCommandLoadersFile      (template lit)     renderCommandLoadersFile  (AST)      │
    bootstrap-registrations       (template lit)     renderBootstrapRegistrationsFile [NEW, AST]
                                                                                          │
  generateModuleRegistryApp ──► renderAstModuleRegistryFile ───────────────────────────────┤
  generateModuleRegistryCli ──► renderAstModuleRegistryFile ───────────────────────────────┘

  DELETED: renderAstLegacyModuleRegistryOutput, renderAstLegacyManifestOutput, renderLegacyCompatibleArray
  UNCHANGED: renderAstLegacyAliasFile, renderEnabledModuleIdsFile (already AST)
```

Existing helpers used, all from `packages/cli/src/lib/generators/ast/`: `createGeneratedSourceFile`, `addAutoGeneratedComment`, `addImportSpec(s)`, `addImportStatements`, `getSourceText`, and from `writers.ts`: `objectLiteral`, `arrayLiteral`, `writeValue`, `variableStatement`, `arrowFunction`, `block`, `awaitExpression`, `importExpression`, `methodCall`, `propertyAccess`, `asExpression`, `nullishCoalesce`. **No new helper primitive is required.** If a conversion proves one missing, it is added to `writers.ts` alongside the existing ~45 writers, never invented at the call site.

Generated files affected (all under `apps/mercato/.mercato/generated/`):

| File | Phase | Emitter after |
|---|---|---|
| `command-loaders.generated.ts` | 1 | `renderCommandLoadersFile` (AST) |
| `bootstrap-registrations.generated.ts` | 1 | `renderBootstrapRegistrationsFile` |
| `frontend-routes.generated.ts`, `backend-routes.generated.ts`, `api-routes.generated.ts` | 2 | `renderAstManifestFile` |
| `modules.generated.ts`, `modules.runtime.generated.ts` | 3 | `renderAstModuleRegistryFile` |

### Data Models

None. No entity, table, migration or persisted field is introduced or changed.

## API Contracts

No HTTP endpoint, CLI command, exported type or import path changes. Every function in scope is module-private to `module-registry.ts`.

The affected surface is **BACKWARD_COMPATIBILITY.md § 14 (Generated File Contracts, STABLE)**, which requires that generated files keep their export names and that the output shape stays compatible with the bootstrap consumer. This spec changes only formatting and statement order:

| Generated file | Exports before | Exports after |
|---|---|---|
| `modules.generated.ts`, `modules.runtime.generated.ts` | `modules`, `modulesInfo`, default | unchanged (order of the `modulesInfo` statement relative to the default export changes) |
| `frontend-routes.generated.ts` | `frontendRoutes`, default | unchanged |
| `backend-routes.generated.ts` | `backendRoutes`, default | unchanged |
| `api-routes.generated.ts` | `apiRoutes`, default | unchanged |
| `command-loaders.generated.ts` | `commandLoaderEntries`, default | unchanged |
| `bootstrap-registrations.generated.ts` | `runBootstrapRegistrations` | unchanged |

`structural-contracts.test.ts` already asserts each of these export names and is the enforcement mechanism.

## Edge Cases & Failure Scenarios

| Scenario | Behavior | Test |
|---|---|---|
| Zero modules discovered | Every array literal emits `[]` instead of today's `[\n  \n]`. Files stay valid modules with empty exports | `output-snapshots.test.ts` empty-set fixture (add if absent) |
| A module contributes no optional properties (no info, no routes, no subscribers) | The entry is `{ id: "…", customFieldSets: … }` with no blank lines — today it is an object literal padded with empty interpolations | new entry-builder unit test |
| Duplicate command id across modules | Unchanged: `renderCommandLoadersFile` throws `[generate] Duplicate command id "…" discovered in "…" and "…"`. The check runs before any AST construction | existing behavior, covered by a new test asserting the throw survives the migration |
| No plugin contributes a bootstrap registration | Unchanged: the file is still written with the two core route registrations, so `bootstrap.ts` can import it unconditionally | `structural-contracts.test.ts` |
| A plugin's `registrationImports` / `buildCall` string is malformed | Import strings now fail at generation time with the offending statement named, because `addImportStatements` parses them. Call expressions remain raw strings inside the function body — see the sibling contract spec, which is where that input is typed | new test feeding a malformed `registrationImports` entry |
| An entry expression cannot be expressed with existing writers (the lazy route component arrow) | Use `buildRuntimeRouteComponent` (`:2462`), which already builds exactly this expression with `arrowFunction` / `block` writers for the app path | Phase 3 reuses it directly |
| Snapshot mismatch after a phase | Expected. Snapshots are re-recorded with `npx jest --updateSnapshot output-snapshots` and the formatting delta is described in the PR. `structural-contracts.test.ts` must pass **without modification** — if it fails, the change is semantic and the phase is not done | both suites |
| `yarn generate` re-runs on an app with existing checksums | Content changes, so `writeGeneratedFile` rewrites every affected file and its `.checksum`. Harmless — the files are regenerated artifacts — but the first post-upgrade generate is a full rewrite rather than a no-op | manual verification in Implementation Plan |

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| A property silently dropped while converting 320 lines of interpolated entry builders | **High** | every generated registry consumer | Phase 3 is gated on the new cross-implementation equivalence test plus `structural-contracts.test.ts` (which asserts entry counts, `moduleId` presence, nested properties and type annotations) passing unmodified; the conversion mirrors `:3690-3722` property by property | A property that neither suite asserts and that the app path also omits could be lost. Mitigated by converting one property per commit within the phase |
| Statement-order change in `modules.generated.ts` (`modulesInfo` after `export default`) | Low | consumers of the generated module | Semantically identical — `modules` is initialised before either statement runs. Both orders already ship today (app variant uses the new order) | None |
| Generated-file checksums all change | Low | first `yarn generate` after upgrade | Documented; the files are regenerated artifacts, gitignored in standalone apps | One full rewrite per app |
| Large review diff | Medium | review quality | Three phases, three PRs; Phase 3 converts one property group per commit | Phase 3 remains the largest single review in this spec |
| `yarn build:app` regression from a formatting change Turbopack caches | Low | dev experience | `yarn generate` already performs structural cache invalidation by touching every generated file (see `packages/cli/AGENTS.md`); `yarn dev:reset` is the documented escape hatch | None |
| Lost work if the migration is abandoned mid-phase | Low | — | Each phase reverts independently; no phase leaves a half-converted emitter, because a call site is converted together with its emitter in one commit | None |

**Blast radius.** Internal to `packages/cli`. Nothing outside the package imports any function in scope. The observable output is the text of six generated files, whose export surface is unchanged and asserted by an existing test.

**Compatibility.** § 14 (Generated File Contracts, STABLE) is the only contract category touched, and only in formatting. No export is added, removed or renamed. No public type, import path, event ID, route, or DI name is involved. No deprecation protocol is required because nothing public is deprecated.

**Rollback.** Per phase, a single revert. Generated files are rebuilt from whichever generator version is checked out, so there is no persisted state to migrate back.

## Phasing

**Phase 1 — Self-contained emitters.** `renderCommandLoadersFile` and the `bootstrap-registrations.generated.ts` emission. Both build their own entries, so no call site outside the emitter changes. Smallest diff, proves the approach.

**Phase 2 — Route manifests.** Add `renderAstManifestFile`, convert the three manifest entry producers to `WriterFunction[]`, delete `renderAstLegacyManifestOutput`.

**Phase 3 — Main module registry.** Convert `moduleDecls` and `runtimeModuleDecls` to `objectLiteral(...)`, route both through `renderAstModuleRegistryFile`, delete `renderAstLegacyModuleRegistryOutput` and `renderLegacyCompatibleArray`.

Stopping after Phase 1 or Phase 2 leaves a coherent codebase: fewer string emitters, no half-migrated file.

## Implementation Plan

### Phase 1 — Self-contained emitters

1. Add `packages/cli/src/lib/generators/__tests__/command-loaders.test.ts`: pins the current output of `renderCommandLoadersFile` for a multi-module fixture, an empty fixture, a module whose `ids` list is empty, and the duplicate-command-id throw. Test the exported render function directly, not through a full generate run.
2. Rewrite `renderCommandLoadersFile` on `createGeneratedSourceFile` + `addImportSpec` + a `variableStatement` whose initializer is `arrayLiteral(entries, …)` built from `objectLiteral` entries, with `load` built via `arrowFunction` + `importExpression`. Keep the duplicate-id check ahead of construction so its error message is unchanged. Update the Step-1 expectations to assert parsed structure rather than exact text.
3. Extract the inline `bootstrap-registrations.generated.ts` emission (`:3403-3432`) into `renderBootstrapRegistrationsFile({ entryImports, registrationImports, calls })` and implement it on the AST helpers: `addImportStatements` for the de-duplicated import list, and a `runBootstrapRegistrations` function declaration whose body is the call statements. Add a test covering: no plugins (core registrations only), one plugin, two plugins with overlapping imports (de-duplication), and a malformed `registrationImports` entry (asserts a generation-time error naming the statement).
4. Run `yarn workspace @open-mercato/cli test`, then `yarn generate`. Re-record `output-snapshots` and confirm `structural-contracts.test.ts` passes **unmodified**.

### Phase 2 — Route manifests

5. Add `renderAstManifestFile({ fileName, typeName, exportName, imports, entries })` next to `renderAstModuleRegistryFile`, reproducing its structure: banner, the `resolvePageRouteMetadata` value import for `FrontendRouteManifestEntry` / `BackendRouteManifestEntry` (type-only import otherwise — the branch at `:2444`), `addImportStatements`, the exported typed array, and the default export.
6. Convert `frontendRouteManifestDecls`, `backendRouteManifestDecls` and `apiRouteManifestDecls` from `string[]` to `WriterFunction[]` at their producers, using `objectLiteral` / `arrayLiteral` and `buildRuntimeRouteComponent` where a route component expression is needed.
7. Point the three call sites (`:3303`, `:3310`, `:3317`) at `renderAstManifestFile` and delete `renderAstLegacyManifestOutput`.
8. Run the suite; re-record `output-snapshots`; `structural-contracts.test.ts` unmodified. Verify `yarn build:app` compiles against the regenerated manifests.

### Phase 3 — Main module registry

9. Add `packages/cli/src/lib/generators/__tests__/registry-variant-parity.test.ts`: generates the main and app registries from one fixture, parses both, and asserts that for every module id present in both, the properties they are both expected to carry (`id`, `info`, `frontendRoutes`, `backendRoutes`, `apis`, `translations`, `subscribers`, `workers`, `entityExtensions`, `customFieldSets`, `features`, `customEntities`, `setup`, `defaultEncryptionMaps`, `integrations`, `bundles`) are present or absent identically. This is the net for step 11 and the regression test the duplication always lacked.
10. Convert `runtimeModuleDecls` (`:3173`, the smaller of the two) to `GeneratedObjectEntry[]` + `objectLiteral(...)`, pushing each optional property only when present, and switch that one call site (`:3297`) to `renderAstModuleRegistryFile` in the **same commit** — entry type and emitter must change together so the commit is self-consistent and revertible on its own. `modules.generated.ts` keeps using the legacy renderer until step 12.
11. Convert `moduleDecls` (`:3153`) the same way, one property group per commit (identity, routes, apis, i18n, subscribers/workers, extensions/custom fields, setup/encryption, integrations), running the step-9 parity test after each.
12. Point both call sites at `renderAstModuleRegistryFile` with `generator: 'registry'`, then delete `renderAstLegacyModuleRegistryOutput` and `renderLegacyCompatibleArray`. Confirm no caller of `serializeGeneratedImport` remains in the legacy path; leave the function if other call sites still use it.
13. Run the full gate. Re-record `output-snapshots`. `structural-contracts.test.ts` and the step-9 parity test pass unmodified. Run `yarn generate && yarn build:app` and confirm the app compiles and boots against the regenerated registry.
14. File the follow-up issue for converting `buildImportStatement`'s call sites to structured import specs, referencing this spec's Non-Goals.

**Validation gate per phase:** `yarn generate`, `yarn build:packages`, `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build:app`.

## Final Compliance Report

| Criterion | Verdict | Note |
|---|---|---|
| Naming conventions | Pass | New identifiers camelCase (`renderAstManifestFile`, `renderBootstrapRegistrationsFile`); no module, table or event introduced. |
| No cross-module ORM relationships | N/A | Build-time only. |
| Tenant / organization scoping | N/A | No data access. |
| Canonical primitives reused | Pass | Uses the existing `ast/` helpers and `writers.ts` vocabulary exclusively; the plan explicitly forbids inventing a local writer. Converges two hosts onto one instead of adding a third. |
| Contracts and compatibility | Pass | Only `BACKWARD_COMPATIBILITY.md` § 14 is touched, and only in formatting; export names are unchanged and asserted by `structural-contracts.test.ts`. No deprecation needed. |
| Reversibility | Pass | Three independent phases, each a single revert; within Phase 3, one property group per commit. |
| Sensitive data | N/A | No PII, credentials or GDPR-relevant fields. |
| Failure scenarios documented | Pass | See Edge Cases & Failure Scenarios, each row with its test. |
| Testability of each step | Pass | Steps 1 and 9 are test-first; every other step lands against a suite that must pass unmodified. |
| No hardcoded user-facing strings / DS tokens | N/A | No UI surface. Generator error strings are developer-facing and stay prefixed as they are today. |
| Enterprise boundary respected | Pass | `packages/enterprise` untouched; the plugin contract it implements is a separate spec. |
| Scope cohesion | Pass | One capability: retire the string emitters in `module-registry.ts`. The three phases are refinements of it over one file and one surviving emitter, ordered by ascending blast radius rather than by dependency, and are not independently deployable capabilities in the sense the split review used. |

## Changelog

| Date | Change |
|---|---|
| 2026-08-21 | Review response on PR [#5034](https://github.com/open-mercato/open-mercato/pull/5034) (@adeptofvoltron's re-review of `9e80621b3`), plus the second base merge. **Two pieces of work this document did not describe, both introduced by conflict resolutions rather than by the plan above.** **(1) The route-shard integration** (merge `9e80621b3`, `develop@e380625fe`). `develop@59e96b5e1` landed request-scoped route sharding while this branch was open: `processPageFiles` / `processApiRoutes` gained a second output, a `RouteManifestShardEntry[]` whose `declaration` is a **string** consumed by `route-manifest-shards.ts` — exactly the producers this spec converts to `WriterFunction`s. The resolution bridges the two instead of reviving a template, and it adds roughly forty lines the plan above does not cover. `renderGeneratedValue` is a **new export** on the AST helper surface (`ast/source-file.ts`, re-exported from `ast/index.ts`): it renders one writer to source text outside any source file, so a shard `declaration` is produced by the same writer as its manifest entry rather than concatenated a second time by hand. The `metadataEntries` / `manifestEntry` split then makes the metadata declaration provably the manifest declaration minus `load`, which is stronger than `develop`'s two independent template strings. And `indentDeclaration` (`route-manifest-shards.ts`) re-indents every line of a declaration — changing `renderArray` for every shard consumer, in a file this spec never scoped — because AST-produced declarations are multi-line where the template ones were single-line. **The writer→string round-trip is deliberate and partly inverts this spec's stated direction:** the Architecture section and Non-Goals are written around "expressions stop being strings", and the shard boundary now turns one back into a string because `RouteManifestShardEntry.declaration` is typed `string`. It is the right trade — converting the shard renderer is a separate change, and re-serialising through the same writers is strictly better than maintaining a second hand-written template — but it means `renderGeneratedValue` is **not** a leftover to delete, which matters because the follow-up this spec links, [#5035](https://github.com/open-mercato/open-mercato/issues/5035), is the next work in this area and would otherwise read it as one. `indentDeclaration` now also carries a direct unit fixture in `route-manifest-shards.test.ts` asserting that continuation lines gain the extra two spaces; before this pass it was covered only end-to-end, where a regression would have surfaced as a diff in generated formatting rather than as a failing test naming the helper. **(2) The abandon-hook merge** (`develop@33a7d00c4`, 431 commits, three of them touching `module-registry.ts`). `develop@a461d0499` added `metadata.onJobAbandoned` support to the registry after this branch was cut, in **both** emitters — the string `processWorkers` and its AST twin `processWorkersAst` — plus an `includeAbandonHookImport` flag on `renderAstModuleRegistryFile` and, inside the legacy `renderAstLegacyModuleRegistryOutput`, a `needsAbandonHookImport` derivation that scanned the rendered entry **strings** for the factory name. Deleting the string emitters therefore had to keep, not drop, `ABANDON_HOOK_FACTORY` and `workersDeclareAbandonHook`: the AST twin and all six render sites use them. The main path's worker step now resolves the discovered workers once, sets `hasAbandonHookWorkers`, and feeds `processWorkersAst` — exactly what the app and CLI paths already did. **The string-scanning derivation is gone by construction**, because `renderAstModuleRegistryFile` receives `WriterFunction` entries, which cannot be searched for a substring; the flag is explicit at every call site instead. That is the same contract `develop`'s own AST variants already relied on, and the safety net it replaces is `generated-registry-imports.test.ts`, which drives all three generators and asserts that every emitted file calling the factory also imports it — an output-level check that covers a renderer added later without anyone remembering to extend it. |
| 2026-08-06 | Review response on PR [#5034](https://github.com/open-mercato/open-mercato/pull/5034). **Correction to the row below:** the previous entry recorded both `structural-contracts.test.ts` widenings as meaning-preserving, and for the `methods` assertion that was wrong. Swapping `.` for `[\s\S]` does not confine the match to one entry's `methods` array — it lets it span the whole emitted file, so `products API route has all 4 methods` passed against a products route holding only `PUT` and `DELETE`, with the orders entry supplying `GET` and `POST`. It is now asserted as an exact array — `/methods:\s*\[\s*"GET",\s*"POST",\s*"PUT",\s*"DELETE",?\s*\]/` — which is stricter than the pre-migration regex and genuinely formatting-agnostic. The same over-widening in `module-subset.test.ts` (dropping the `apis: [` prefix from a byte-exact `toContain`, leaving the entry unasserted as an `apis` element) was fixed by restoring a prefix `toMatch` alongside the byte-exact expectation. The `'en':` widening needed no change. Two further review findings folded into the same pass: the escaping rule that `toLiteral` and the new `stringLiteral` each carried a copy of now has one definition, `escapeGeneratedJsonLiteral`, which both call — deliberately **not** by making `toLiteral` delegate to `stringLiteral`, because two of `toLiteral`'s call sites (the API-method and page-metadata literals) serialize **objects**, whose nested strings would have lost the hardening under a string-only delegation; and the member-fallback JSDoc block that hoisting `preRenderedExpressionList` had stranded above the wrong function now sits on `legacyNamespaceMemberFallback`. |
| 2026-08-06 | Implemented (issue [#4672](https://github.com/open-mercato/open-mercato/issues/4672)). All three phases landed together on one pull request, as separate commit groups, because they edit one file and a stacked chain would sit blocked behind an unmerged base. Five corrections to this document, found during implementation: (1) `output-snapshots.test.ts` contains **no** jest snapshots — it asserts structurally — so "re-record the snapshots" applied only to the byte-exact expectations in `module-subset.test.ts`; (2) `structural-contracts.test.ts` is **not** formatting-agnostic by construction, so the "must pass unmodified" bar could not hold: `/methods:.*GET.*POST.*PUT.*DELETE/` relies on `.` not crossing lines, and `toContain("'en':")` pins a quote style. The `'en':` widening to `/['"]en['"]:/` is meaning-preserving; the `methods` one was **not** — see the 2026-08-06 review-response row below, which records the correction — and nothing else in that file was touched; (3) the app variant builds no `apis` property, so the parity test asserts `apis` between the main and runtime variants instead, and records `cli`, `apis` and unconditional `dashboardWidgets` as known divergences; (4) steps 10 and 11 ship in one commit because both entry builders read the same `translations` collection, whose type changes when the main path adopts `processTranslationsAst`; (5) the main path's `imports` array carries structured import specs pushed by generator extensions, not only strings — `renderAstModuleRegistryFile` had to normalise them through `serializeGeneratedImport`, which the deleted legacy renderer was doing. `processTranslations`, `processSubscribers` and `processWorkers` were deleted too: each had an exact AST twin already used by the app and CLI paths. Expression semantics were preserved rather than converged on `namespaceFallback`, which is a different expression. |
| 2026-07-30 | Re-review pass on PR [#4636](https://github.com/open-mercato/open-mercato/pull/4636), against the branch brought up to date with `develop@7dad6df29` — every cited offset in `module-registry.ts` re-verified on that tree and unchanged. Removed the contradiction between "each phase is independently shippable" and the claim that Phase 3 depends on Phase 2's manifest emitter. Phase 3 routes through `renderAstModuleRegistryFile`, which already exists, so the phase order is a blast-radius recommendation, not a build dependency; the reason for keeping the three phases in one spec is the shared file, emitter, test harness and parity method. |
| 2026-07-30 | Split out of `2026-07-29-ts-morph-generator-migration.md` (issue #1637 finding 5) after PR [#4636](https://github.com/open-mercato/open-mercato/pull/4636) review found the original spec bundled three independently deployable capabilities. Re-verified against `develop@ecc10b3db`, which corrected three inaccuracies in the bundled spec: `renderAstLegacyAliasFile` is already AST-based and is now out of scope; `renderCommandLoadersFile` (`:1235`) is a string emitter that neither the issue nor the spec listed and is now in scope; and the real work is converting the main path's entry builders and deleting the duplicate emitter, not rewriting it. Parity bar corrected from "byte-identical" to structural, per the precedent in the 2026-04-06 migration spec. |
