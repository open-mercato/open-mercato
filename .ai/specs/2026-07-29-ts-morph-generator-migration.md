# AST-First Code Generation for the Remaining String Emitters

## TLDR

**Key Points:**
- The module-registry generator stack already builds TypeScript through `ts-morph`, but five paths still assemble source files from template literals and `Array.join('\n')`.
- This spec extends `GeneratorPlugin` with an **additive** AST hook, migrates the legacy emitters inside `module-registry.ts`, and moves the two standalone build-script generators onto the same helpers — with generated output proven unchanged at every step.

**Scope:**
- Additive AST hook on the `GeneratorPlugin` contract, with the string hook kept and deprecated
- Migration of `renderAstLegacyModuleRegistryOutput`, `renderAstLegacyManifestOutput`, `renderAstLegacyAliasFile` and the `bootstrap-registrations.generated.ts` emission
- Migration of the `lucideRegistry.generated.tsx` generator in `packages/ui/build.mjs` and the version injection in `packages/shared/build.mjs`
- Output-parity tests for every migrated emitter

**Concerns:**
- `GeneratorPlugin` is a public contract for third-party modules; the change must be additive only, per [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md).
- The repository's only implementation of that contract lives in `packages/enterprise`, which is commercially licensed and does not accept external contributions. It is scoped **out** of this plan and must keep working untouched.

## Overview

`mercato generate` builds the module registry, manifests, DI wiring and per-plugin outputs. Since [`2026-04-06-module-registry-ast-codegen-ts-morph.md`](implemented/2026-04-06-module-registry-ast-codegen-ts-morph.md) most of that stack constructs code through an in-memory `ts-morph` project via `packages/cli/src/lib/generators/ast/`. That migration deliberately stopped short of a handful of emitters, and the plugin API it left in place still speaks in pre-rendered strings.

This spec finishes that work: it removes the remaining manual string assembly from paths that emit `.ts` / `.tsx` **source**, and it lets a plugin author describe a generated file structurally instead of concatenating text.

> **Market Reference**: Nx and Angular's `@schematics/angular` both went through the same transition and settled on the same shape — a typed AST/tree API as the primary authoring surface, with the older string-template path kept alive behind a deprecation window (Nx generators still accept raw file writes; Angular kept `Rule`-based text edits long after `ts.transform` became the norm). Adopted: additive hook plus deprecation rather than replacement, and snapshot-based output parity as the migration gate. Rejected: their template/schematic *authoring* layer — this repository generates from discovered convention files, not from user-supplied templates, so a template engine would add surface without removing any.

## Problem Statement

Five paths still assemble TypeScript by hand. Verified against `develop@4efa7961c`:

| # | Location | What it does today |
|---|---|---|
| 1 | `packages/ui/build.mjs` | builds `importSection` and `registryEntries` with `.map(...).join('\n')` and interpolates the whole of `src/backend/icons/lucideRegistry.generated.tsx` into one template literal; the file contains **no `ts-morph` usage at all** |
| 2 | `packages/shared/build.mjs` | `injectVersion` returns raw TypeScript from an esbuild `onLoad` hook, defining `APP_VERSION` / `appVersion` |
| 3 | `packages/shared/src/modules/generators/types.ts` | `GeneratorPlugin.buildOutput({ importSection, entriesLiteral }) => string` forces every plugin author to emit text; `configExpr`, `registrationImports` and `buildCall` are string expressions too |
| 4 | `packages/enterprise/src/modules/security/generators.ts` | the only implementation of that contract — **out of scope, see Risks** |
| 5 | `packages/cli/src/lib/generators/module-registry.ts` | `renderAstLegacyModuleRegistryOutput` (`:2416`), `renderAstLegacyManifestOutput` (`:2437`), `renderAstLegacyAliasFile` (`:2343`) and the `bootstrap-registrations.generated.ts` emission (`:2846`) each return raw file text built around `renderLegacyCompatibleArray` (`:2406`) |

Why it matters, concretely: these are the files where a missing comma, newline or import silently produces a broken generated module, and the failure surfaces at the consumer's compile step rather than at generation time. The AST path cannot emit an unparseable file — that is the whole point of the baseline that already exists. Leaving five paths outside it also means plugin authors are still steered toward string emitters by the type signature itself, which is the opposite of the direction the codebase has committed to.

## Proposed Solution

Three independently shippable phases, ordered by ascending blast radius, each leaving `yarn generate` byte-compatible:

1. **Standalone build-script generators** (findings 1–2) — no shared contract involved, no consumer outside the package.
2. **`module-registry` legacy emitters** (finding 5) — internal to `packages/cli`, no public surface.
3. **Additive AST hook on `GeneratorPlugin`** (finding 3) — the only public-contract change, done last so the two migrations above prove the helper API is sufficient before it is frozen into a contract.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Additive optional hook; `buildOutput` kept and marked `@deprecated` | `GeneratorPlugin` is a documented contract surface. `BACKWARD_COMPATIBILITY.md` requires a bridge for ≥1 minor and forbids removal in one release. |
| The new hook's parameter type is defined **structurally in `packages/shared`**, with no `ts-morph` import | `packages/shared` is imported by every package and by third-party modules. Leaking a `ts-morph` type into its public API would make a codegen-only dependency part of everyone's type graph. The builder interface is declared as a plain TypeScript interface in `shared` and implemented in `packages/cli`. |
| Contract phase last, not first | The issue proposes it first. Migrating two real emitters onto the AST helpers first tells us what a plugin actually needs; designing the hook before that risks freezing the wrong shape into a public contract. |
| Output parity enforced by tests, not by review | Same gate the prior ts-morph migration used ("identical output modulo whitespace normalization"), now with the emitters under `packages/cli/src/lib/generators/__tests__/`. |
| `packages/enterprise` untouched | Commercial licence; external contributions are not accepted there. The additive contract is precisely what lets that consumer migrate later, on its owner's schedule. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Replace `buildOutput` with an AST-only hook | Breaks the contract for any third-party plugin in one release; explicitly forbidden by `BACKWARD_COMPATIBILITY.md`. |
| Expose `ts-morph`'s `SourceFile` directly in the hook signature | Pulls a build-time dependency into `packages/shared`'s public types for every consumer; also couples the contract to a specific `ts-morph` major. |
| Do finding 4 (enterprise) as part of this work | Not legally available to external contributors. |
| Also convert `addJsExtension` / shebang rewriting in `build.mjs` files | The issue scopes these out, correctly: they are post-build text rewrites of already-emitted JS, not source generation. |

## Architecture

Nothing new is introduced at runtime — this is a build-time refactor. The components involved:

```
packages/shared/src/modules/generators/types.ts   ← contract (Phase 3)
        ▲ implements
packages/enterprise/.../security/generators.ts    ← only consumer, NOT TOUCHED
        ▼ consumed by
packages/cli/src/lib/generators/module-registry.ts ← host + legacy emitters (Phase 2)
        │ uses
packages/cli/src/lib/generators/ast/              ← existing helpers, unchanged
  source-file.ts  createGeneratedSourceFile / addAutoGeneratedComment / getSourceText
  imports.ts      addImportSpec(s) / addImportStatement(s)
  writers.ts      ~45 expression + statement writers

packages/ui/build.mjs        ← lucideRegistry.generated.tsx (Phase 1)
packages/shared/build.mjs    ← APP_VERSION injection (Phase 1)
```

The AST helper module is already sufficient for every emitter listed here; this spec adds **no new helper primitives** unless a migration proves one missing, in which case it is added to `writers.ts` alongside the existing ones rather than invented locally.

One constraint shapes Phase 1: `packages/ui/build.mjs` and `packages/shared/build.mjs` are ESM build scripts run by esbuild, outside the `mercato generate` process, and `packages/cli` is not among their dependencies. The AST helpers therefore cannot be imported from `packages/cli` there. Phase 1 uses `ts-morph` directly in those scripts (both packages can take it as a dev dependency), following the same three-step shape the helpers encode — create in-memory source file, add imports, add declarations, normalize text — so the code reads the same without creating a `ui → cli` or `shared → cli` build edge.

### Data Models

None. No entity, table, migration or persisted field is introduced or changed.

## API Contracts

No HTTP endpoint or command changes. The single contract touched is the `GeneratorPlugin` interface, in Phase 3, additively:

```ts
// packages/shared/src/modules/generators/types.ts

/** Structural builder handed to `buildAstOutput`. Implemented by the CLI generator host;
 *  declared here without importing ts-morph so the contract stays dependency-free. */
export interface GeneratedFileBuilder {
  addImportStatement(statement: string): void
  addNamedImport(moduleSpecifier: string, names: readonly string[], isTypeOnly?: boolean): void
  addNamespaceImport(moduleSpecifier: string, alias: string): void
  addStatement(statement: string): void
  addExportedConst(options: { name: string; type?: string; initializer: string }): void
  addDefaultExport(expression: string): void
}

export interface GeneratorPlugin {
  // … unchanged fields …

  /**
   * @deprecated Use `buildAstOutput` instead. Kept for backward compatibility and
   * still honoured when `buildAstOutput` is absent; scheduled for removal no earlier
   * than the second minor release after `buildAstOutput` ships.
   */
  buildOutput: (params: { importSection: string; entriesLiteral: string }) => string

  /** Preferred over `buildOutput` when present. */
  buildAstOutput?: (params: {
    builder: GeneratedFileBuilder
    imports: readonly string[]
    entries: readonly string[]
  }) => void
}
```

Resolution rule in the host (`module-registry.ts`, at the current `plugin.buildOutput(...)` call site): call `buildAstOutput` when defined, otherwise `buildOutput`. A plugin defining neither is a generation-time error naming the plugin id — today the same situation is a `TypeError`.

`buildOutput` stays **required** in the type. Making it optional would be a breaking change for anyone reading the interface structurally, and it costs nothing to keep it mandatory until the removal release.

## Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| Plugin defines both hooks | `buildAstOutput` wins; a one-line warning names the plugin id so the author knows the deprecated path is dead code. |
| Plugin defines neither | Generation fails with an error naming the plugin id and the expected hooks, instead of a bare `TypeError`. |
| Migrated emitter produces different bytes | The parity test for that emitter fails; the migration step is not complete until it passes. |
| `ts-morph` cannot represent an expression (e.g. the lazy route component arrow) | Fall back to `writers.ts`' existing `arrowFunction` / `block` writers, which already build exactly this expression at `module-registry.ts:2464`; no raw-string escape hatch is added. |
| Icon set is empty in `packages/ui/build.mjs` | The generated registry must still be a valid module with an empty object literal — today's template produces this via a ternary; the AST path must be covered by a test for the empty case. |
| `packages/shared` version string missing at build time | Unchanged from today: the value comes from `package.json`; the AST path only changes how the statement is written, not where the value comes from. |

## Risks & Impact Review

**Blast radius.** Phase 1 touches two package build scripts; a mistake breaks those packages' builds loudly and immediately. Phase 2 is internal to `packages/cli`; a mistake shows up as changed generated output, which the parity tests catch. Phase 3 changes a public contract and carries the only cross-release risk.

**Compatibility.** `GeneratorPlugin` is listed among the contract surfaces governed by `BACKWARD_COMPATIBILITY.md`. This spec adds an optional member and deprecates an existing one; it removes nothing. The deprecation protocol applies: `@deprecated` JSDoc in Phase 3, a bridge kept for at least one minor, an `UPGRADE_NOTES.md` entry, and this spec as the referenced document.

**The enterprise consumer.** `packages/enterprise/src/modules/security/generators.ts` is the repository's only `GeneratorPlugin` implementation. `packages/enterprise/LICENSE.md` prohibits modifying or deriving from that package without a commercial licence, and external contributions to it are not accepted. It is therefore excluded from every phase here. The additive design means it keeps working with no change at all — which is also why the contract must not become AST-only in this change. **Consequence for issue #1637: finding 4 cannot be delivered by an external contributor and stays open after this spec is implemented.**

**Rollback.** Each phase is a self-contained revert. Phase 3's hook is opt-in, so reverting it cannot strand a plugin that never adopted it.

**What this does not change.** `writeGeneratedFile`, the structure-checksum mechanism, the set of generated files, their paths, and their public exports all stay exactly as they are — as in the prior ts-morph migration, how content is *built* is orthogonal to how it is *written*.

## Phasing

Each phase is independently shippable and independently revertible. Stopping after any phase leaves a working, coherent codebase.

**Phase 1 — Standalone build-script generators.** Findings 1 and 2. No shared contract, no consumers outside the two packages.

**Phase 2 — `module-registry` legacy emitters.** Finding 5. Internal to `packages/cli`; no public surface changes.

**Phase 3 — Additive AST hook on `GeneratorPlugin`.** Finding 3. The only contract change, informed by Phases 1–2.

## Implementation Plan

### Phase 1 — Standalone build-script generators

1. Add `ts-morph` as a dev dependency of `packages/ui`; add a parity test that captures the current bytes of `src/backend/icons/lucideRegistry.generated.tsx` for a fixed icon-name fixture (populated **and** empty).
2. Rewrite the generator in `packages/ui/build.mjs` to build the file through an in-memory `ts-morph` source file — named import declaration for the lucide exports, the typed `LUCIDE_ICON_REGISTRY` object literal, and the existing helper functions — asserting the Step-1 test still passes.
3. Repeat for `packages/shared/build.mjs`: add the dev dependency, capture the current `injectVersion` output in a test, then build the two statements through `ts-morph` inside the `onLoad` hook.
4. Run `yarn build:packages` and confirm both packages build and the generated registry is byte-identical to the pre-change artifact.

### Phase 2 — `module-registry` legacy emitters

5. Add parity tests under `packages/cli/src/lib/generators/__tests__/` that pin the current output of `renderAstLegacyModuleRegistryOutput`, `renderAstLegacyManifestOutput`, `renderAstLegacyAliasFile` and the `bootstrap-registrations.generated.ts` builder for representative inputs, including the empty-entries case for each.
6. Migrate `renderAstLegacyManifestOutput` first (the simplest: one import line, one exported const, one default export) using `createGeneratedSourceFile` + `addImportStatements` + the `writers.ts` helpers; delete its `renderLegacyCompatibleArray` usage.
7. Migrate `renderAstLegacyModuleRegistryOutput` the same way, reusing the existing `arrowFunction` / `block` writers for the lazy route components rather than re-deriving them.
8. Migrate `renderAstLegacyAliasFile`.
9. Migrate the `bootstrap-registrations.generated.ts` emission, which currently interpolates plugin-contributed `registrationImports` and `buildCall(...)` strings; keep consuming those as strings — they belong to the contract that Phase 3 changes.
10. Delete `renderLegacyCompatibleArray` once no caller remains; run `yarn generate` in `apps/mercato` and confirm every file under `.mercato/generated/` is unchanged.

### Phase 3 — Additive AST hook on `GeneratorPlugin`

11. Add `GeneratedFileBuilder` and the optional `buildAstOutput` member to `packages/shared/src/modules/generators/types.ts`, with the `@deprecated` tag on `buildOutput`; export the new type from `packages/shared/src/modules/generators/index.ts`.
12. Implement `GeneratedFileBuilder` in `packages/cli` on top of the existing AST helpers, and change the plugin loop in `module-registry.ts` to prefer `buildAstOutput`, fall back to `buildOutput`, and fail with a named error when neither exists.
13. Add unit tests for all four resolution cases: AST hook only, string hook only, both (AST wins, warning emitted), neither (named error).
14. Add the deprecation entry to `UPGRADE_NOTES.md` referencing this spec, and document the new hook in `packages/cli/AGENTS.md` where the plugin contract is described.
15. Run the full validation gate; confirm `yarn generate` output is unchanged with the enterprise plugin still on the string hook.

## Resolved assumptions (autonomous defaults)

This spec was produced by an unattended `om-auto-write-spec` run. Each open question below was resolved by the run, not by a human. Override any of them before merge.

| # | Question | Resolution | Rationale |
|---|---|---|---|
| Q1 | The issue bundles two independently deployable capabilities — the plugin-contract work and the standalone build-script generators. Split into separate specs? | **No — one spec, three independently shippable phases.** | They share one theme, one helper library and one parity-testing method; splitting would duplicate all three. Each phase is independently revertible, so a reviewer can still cut the spec in half cheaply by dropping a phase. |
| Q2 | Which of the three hook shapes proposed in the issue? | **A structural `GeneratedFileBuilder` interface declared in `packages/shared`, no `ts-morph` types in the contract.** | Smallest new public surface, and it keeps a codegen-only dependency out of the type graph of a package every module imports. |
| Q3 | Contract phase first (as the issue proposes) or last? | **Last.** | Designing a public contract before two real migrations have exercised the helpers risks freezing the wrong shape into a surface governed by `BACKWARD_COMPATIBILITY.md`. |
| Q4 | What is the output-parity bar? | **Byte-identical generated output, enforced by tests per emitter.** | Stricter than the prior migration's "identical modulo whitespace", and cheap here because every emitter is pure text-in/text-out. |
| Q5 | How is finding 4 (`packages/enterprise`) handled? | **Excluded from all phases; the additive contract lets its owner migrate it later.** | The package is commercially licensed and does not accept external contributions — this is the only available option, not a preference. |
| Q6 | Does `buildOutput` become optional in the interface? | **No — it stays required until the removal release.** | Making it optional is itself an observable change for structural readers, and keeping it required costs nothing. |

## Final Compliance Report

| Criterion | Verdict | Note |
|---|---|---|
| Naming conventions (modules plural/snake_case, camelCase identifiers) | Pass | No new module, table or event; new identifiers are camelCase (`buildAstOutput`, `GeneratedFileBuilder`). |
| No cross-module ORM relationships | N/A | Build-time only; no ORM involvement. |
| Tenant / organization scoping | N/A | No data access. |
| Canonical primitives reused | Pass | Uses the existing `packages/cli/src/lib/generators/ast/` helpers; adds no parallel utility. Phase 1's direct `ts-morph` use is justified in Architecture (no `ui → cli` build edge). |
| Contracts and compatibility | Pass | One contract surface touched, additively, with `@deprecated` + bridge + `UPGRADE_NOTES.md`, per `BACKWARD_COMPATIBILITY.md`. |
| Reversibility | Pass | Each phase is a self-contained revert; the new hook is opt-in. |
| Sensitive data | N/A | No PII, credentials or free-text-about-people fields. |
| Failure scenarios documented | Pass | See Edge Cases & Failure Scenarios. |
| Testability of each step | Pass | Every step lands with or against a parity/unit test; Steps 1, 5 and 13 are test-first. |
| Scope cohesion | Pass with note | Raised as Q1 and resolved in favour of one spec with three independently shippable phases. |
| No hardcoded user-facing strings / DS tokens | N/A | No UI surface. |
| Enterprise boundary respected | Pass | `packages/enterprise` and `.ai/specs/enterprise/` untouched. |

## Changelog

| Date | Change |
|---|---|
| 2026-07-29 | Initial specification, written from issue #1637 against `develop@4efa7961c`. |
