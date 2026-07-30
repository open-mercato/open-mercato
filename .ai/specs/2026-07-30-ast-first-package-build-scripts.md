# AST-First Source Generation in Package Build Scripts

> One of three specs split out of issue [#1637](https://github.com/open-mercato/open-mercato/issues/1637).
> Siblings: [`2026-07-30-ast-first-module-registry-emitters.md`](2026-07-30-ast-first-module-registry-emitters.md) (CLI-internal emitters),
> [`2026-07-30-generator-plugin-ast-output-contract.md`](2026-07-30-generator-plugin-ast-output-contract.md) (public plugin contract).
> Each is independently deployable and carries no dependency on the others. This one has the smallest blast radius and should ship first.

## TLDR

**Key Points:**
- Two package build scripts still assemble TypeScript source from template literals: `packages/ui/build.mjs` (writes `lucideRegistry.generated.tsx`) and `packages/shared/build.mjs` (synthesizes `lib/version.ts` inside an esbuild `onLoad` hook).
- Both move onto `ts-morph`. The lucide generator first gets an enabling refactor: the three hand-written helper functions currently living **inside** a generated artifact move to a checked-in source file, so the generated file shrinks to what is actually generated — two imports and one object literal.
- The parity bar is **behavioral, not byte-identical**: formatting of the committed `lucideRegistry.generated.tsx` changes on purpose. The existing `lucideRegistry.test.tsx` suite is the contract and must pass unchanged.

**Scope:**
- `packages/ui/build.mjs` → AST-built `src/backend/icons/lucideRegistry.generated.tsx`
- `packages/ui/src/backend/icons/` → extract `normalizeKebabIconName`, `resolveRegisteredLucideIcon`, `resolveRegisteredLucideIconNode` out of the generated file
- `packages/shared/build.mjs` → AST-built `APP_VERSION` / `appVersion` injection
- Tests: registry-content assertions, empty-icon-set case, syntax validity, unchanged public barrel

**Out of scope:**
- `addJsExtension` post-build path rewriting and shebang insertion in any `build.mjs` — these rewrite already-emitted JS, they do not generate source (issue #1637 scopes them out, correctly).
- Anything under `packages/cli` or `packages/shared/src/modules/generators` — see the sibling specs.

## Overview

`mercato generate` builds its output through an in-memory `ts-morph` project ([`2026-04-06-module-registry-ast-codegen-ts-morph.md`](implemented/2026-04-06-module-registry-ast-codegen-ts-morph.md)). Two generators were never part of that migration because they do not run inside `mercato generate` at all — they run inside the packages' own esbuild build scripts:

| Location | Emits | How today |
|---|---|---|
| `packages/ui/build.mjs:94-145` | `packages/ui/src/backend/icons/lucideRegistry.generated.tsx` (committed) | `importSection` via `.map().join('\n')`, `registryEntries` via `.map().join('\n')`, whole file interpolated into one template literal (`:101-144`); zero `ts-morph` usage |
| `packages/shared/build.mjs:11-22` | a virtual replacement for `lib/version.ts`, consumed directly by esbuild | `injectVersion.setup` returns raw TypeScript from `build.onLoad` |

Verified against `develop@ecc10b3db`; neither file changed between `4efa7961c` and that head.

> **Market Reference**: Nx and Angular's `@schematics/angular` both landed on the same division of labour that this spec adopts — *generated* artifacts hold only derived data, while behaviour lives in checked-in source that imports it (Angular's `ng-package` metadata vs. its runtime; Nx's `project graph` JSON vs. the executors that read it). Adopted: shrink the generated file to derived data, keep logic hand-written and tested. Rejected: their template-engine authoring layer — nothing here is authored from user-supplied templates.

## Problem Statement

**1. `lucideRegistry.generated.tsx` is a generated file containing hand-written logic.** Of the ~44 lines the template emits around the icon data, 33 (`build.mjs:111-143`) are three helper functions with regex normalisation and a JSX return. They never vary with the input. Because they live in a `.generated.tsx` file they cannot be edited without editing a template literal inside a build script, they are invisible to normal code search intent ("don't edit generated files"), and they are the sole reason the file needs JSX and a `React` type import at all. This is also what makes an AST migration look expensive: re-deriving regex-laden normalisation and a JSX element through `ts-morph` writers buys nothing.

**2. Both files are assembled by string interpolation.** A missing comma or newline in either template produces a file that fails at the consumer's compile step rather than at generation time. For `lucideRegistry.generated.tsx` the failure lands in every package that imports the UI backend barrel; there is currently no test that asserts the generated file even parses.

**3. There is no test on the generator itself.** `lucideRegistry.test.tsx` covers the *helpers* (through the barrel), against whatever the last build happened to write. Nothing asserts that the discovered icon set actually ends up in `LUCIDE_ICON_REGISTRY`, and nothing covers the empty-icon-set path, which today is guarded by two separate ternaries in the template.

## Proposed Solution

### Step order (one phase, four steps — see Implementation Plan)

1. Extract the static helpers out of the generated file, keeping the public barrel byte-identical in its exports.
2. Add generator tests against the extracted, still-string-based generator (so they pin current behaviour before anything moves).
3. Rewrite the lucide generator on `ts-morph`.
4. Rewrite the `packages/shared` version injection on `ts-morph`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Extract the helpers into `packages/ui/src/backend/icons/lucideRegistryRuntime.tsx` (checked in, hand-written); the generated file keeps only `LUCIDE_ICON_REGISTRY` | Removes hand-written logic from a generated artifact, drops the JSX and the `React` type import from generated output, and makes the generated file fully expressible as AST without a verbatim-text escape hatch. This is the enabling move, not a cosmetic one. |
| `packages/ui/src/backend/icons/lucideRegistry.ts` stays the compatibility boundary and keeps re-exporting all three symbols | `@open-mercato/ui/backend/icons/lucideRegistry` is the public import path (BACKWARD_COMPATIBILITY.md § 4, STABLE). Every existing consumer, including `lucideRegistry.test.tsx`, imports the barrel — not the generated file — so the extraction is invisible outside the folder. |
| Keep the generated file's name and `.tsx` extension | JSX disappears from it, so `.ts` would be more honest, but the filename is referenced from `.ai/docs/module-development.md` as the canonical example of a committed generated artifact, and renaming buys nothing. |
| `ts-morph` as a **dev** dependency of `packages/ui` and `packages/shared`; the AST helpers in `packages/cli` are *not* imported | Neither build script runs inside `mercato generate`, and `packages/cli` is not among their dependencies. Importing the helpers would create a `ui → cli` / `shared → cli` build edge. Both scripts follow the same create-file → add-imports → add-declarations → normalise-text shape the helpers encode, so the code reads the same without the edge. |
| Parity bar is **behavioral**, not byte-identical | `ts-morph` normalises quoting, indentation and trailing commas, and the extraction removes 33 lines. Byte parity is unreachable and would be the wrong goal. The bar is: the barrel's exports and the `lucideRegistry.test.tsx` suite are unchanged; the registry maps exactly the discovered icons; the emitted file parses with zero syntactic diagnostics. |
| One `ts-morph` `Project` per build script, created at module scope | `packages/shared`'s injection runs inside an esbuild `onLoad` callback. Creating a `Project` per invocation would pay in-memory-filesystem setup on every matching load. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Keep the helpers inside the generated file and rebuild them through `ts-morph` writers | Encodes two regex literals, a chained `.replace()` sequence and a JSX element as AST writer calls — high cost, zero benefit, and the result is harder to read and to test than the source it replaces. |
| Keep the helpers inside the generated file as a verbatim trailing string fragment | Leaves an unchecked raw-source escape hatch in the generator, which is exactly the property this work exists to remove. |
| Move the helpers into `lucideRegistry.ts` itself rather than a new file | Works, but `lucideRegistry.ts` is the public barrel; keeping it a pure re-export surface (plus `registerAdditionalIcons`) keeps the compatibility boundary obvious. |
| Import the `packages/cli` AST helpers into the build scripts | Creates a `ui → cli` / `shared → cli` dependency for build-time-only code. |
| Leave `packages/shared/build.mjs` alone (it is only two statements) | It is still generated source, and it is the cheapest possible regression test that the AST shape works outside `mercato generate`. Issue #1637 finding 2 asks for it explicitly. |

## Architecture

```
packages/ui/build.mjs
  └─ ts-morph (dev dep) ──► src/backend/icons/lucideRegistry.generated.tsx   [committed, generated]
                                    │ imports nothing from siblings
                                    ▼
                            src/backend/icons/lucideRegistryRuntime.tsx      [NEW, hand-written]
                                    │
                                    ▼
                            src/backend/icons/lucideRegistry.ts              [public barrel, UNCHANGED exports]
                                    ▲
                            consumers (@open-mercato/ui/backend/icons/lucideRegistry)

packages/shared/build.mjs
  └─ ts-morph (dev dep) ──► virtual lib/version.ts (esbuild onLoad, never written to disk)
```

Post-extraction content of each file in the icons folder:

| File | Contents |
|---|---|
| `lucideRegistry.generated.tsx` | banner comments, `import type { LucideIcon } from 'lucide-react'`, the named value import of the discovered lucide exports, `export const LUCIDE_ICON_REGISTRY: Record<string, LucideIcon> = { … }` |
| `lucideRegistryRuntime.tsx` | `normalizeKebabIconName` (module-private), `resolveRegisteredLucideIcon`, `resolveRegisteredLucideIconNode` — moved verbatim, importing `LUCIDE_ICON_REGISTRY` from the generated file |
| `lucideRegistry.ts` | unchanged export list: the three symbols (now re-exported from `lucideRegistryRuntime`, plus `LUCIDE_ICON_REGISTRY` from the generated file) and `registerAdditionalIcons` |

`resolveRegisteredLucideIconNode` returns JSX, so `lucideRegistryRuntime` is a `.tsx` file.

### Data Models

None. No entity, table, migration or persisted field is introduced or changed.

## API Contracts

No HTTP endpoint, CLI command or exported type signature changes.

The one contract touched is the **import path** `@open-mercato/ui/backend/icons/lucideRegistry`, and it is touched only in the sense that its implementation moves behind it. Its export list is unchanged:

```ts
// packages/ui/src/backend/icons/lucideRegistry.ts — export list before and after
export { resolveRegisteredLucideIcon, resolveRegisteredLucideIconNode, LUCIDE_ICON_REGISTRY }
export function registerAdditionalIcons(icons: Record<string, LucideIcon>): void
```

`LUCIDE_ICON_REGISTRY` must stay a mutable object literal: `registerAdditionalIcons` writes into it at runtime. The AST path emits a plain `export const … = { … }` with no `as const` and no `Object.freeze`, matching today.

## Edge Cases & Failure Scenarios

| Scenario | Behavior | Test |
|---|---|---|
| No icons discovered | The generated file is still a valid module exporting an empty `LUCIDE_ICON_REGISTRY`, with the named value import omitted entirely (an empty `import {} from 'lucide-react'` would be a lint error and a pointless side-effect import) | new generator test, empty fixture |
| Icon kebab name is not a valid JS identifier or property name (`'bar-chart-2'`) | Emitted as a quoted string key. `ts-morph`'s literal writer quotes every key it is given, so this is the default path, not a special case | new generator test asserts `'bar-chart-2'` resolves |
| Two kebab names map to the same lucide export | Both keys are emitted pointing at the same imported identifier; the value import is de-duplicated (today's `uniqueExports` set, preserved) | new generator test |
| Generated file fails to parse | Generation fails loudly at build time: after building the source file, the script asserts zero **syntactic** diagnostics before writing. Semantic diagnostics are deliberately not checked — `lucide-react` and `react` do not resolve inside the in-memory project | new generator test feeding a deliberately malformed export name |
| `packages/shared` `package.json` has no `version` | Unchanged from today: the value is read from `package.json` and interpolated. The AST path changes only how the statement is written | existing build |
| `ts-morph` is missing at build time (fresh clone, partial install) | The build script fails immediately with a module-resolution error, before writing anything. Both packages already fail the same way on a missing `esbuild` | n/a |
| A consumer imports `./lucideRegistry.generated` directly | None do today (verified: the only importer is the sibling barrel). Anyone who did would lose the two resolver functions — this is the one observable consequence of the extraction and is called out in Risks | grep guard in the new generator test |

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| The extraction removes two exports from `lucideRegistry.generated.tsx` | Low | `packages/ui` internals | The public barrel keeps all three exports; a test asserts the barrel's export list, and a repository grep confirms the generated file has exactly one importer today | A third-party module deep-importing `@open-mercato/ui/backend/icons/lucideRegistry.generated` would break. That path is not a documented import surface and is not in BACKWARD_COMPATIBILITY.md § 4 |
| The committed generated file reformats wholesale in the diff | Low | review noise | The PR describes the formatting delta, as [`2026-04-06-module-registry-ast-codegen-ts-morph.md`](implemented/2026-04-06-module-registry-ast-codegen-ts-morph.md) § "When ts-morph produces output that differs only in whitespace" requires | One large, one-time diff |
| `ts-morph` added as a dev dependency to two more packages | Low | install size, build time | Dev-only; `ts-morph` is already a dependency of `packages/cli`, so the version is resolved once in the workspace. Pin to the same `^28.0.0` range `packages/cli` uses | Slightly slower cold `yarn install` |
| `ts-morph` startup cost inside `packages/shared`'s `onLoad` | Low | `yarn build:packages` wall time | One `Project` created at module scope, reused across loads; the filter matches exactly one file | Negligible |
| Both packages build with esbuild, not `tsc`, so a type error in the extracted helpers would not surface at build time | Low | `packages/ui` | `yarn typecheck` covers the workspace and runs in CI; the extracted code is moved verbatim | None |

**Blast radius.** Two package build scripts plus three files in one folder of `packages/ui`. A mistake breaks `yarn build:packages` immediately and loudly. No runtime, tenant, or data surface is involved.

**Compatibility.** No contract surface from `BACKWARD_COMPATIBILITY.md` changes. § 4 (Import Paths, STABLE) is the nearest category and is preserved: `@open-mercato/ui/backend/icons/lucideRegistry` keeps its exports. § 14 governs `apps/mercato/.mercato/generated/` and does not apply to this file.

**Rollback.** A single revert. The generated file is regenerated on the next build from whichever version of the script is checked out, so there is no half-migrated state to clean up.

## Phasing

One phase. The four steps are ordered so the repository builds and tests green after each, but they are small enough to land as one PR.

## Implementation Plan

1. **Extract the helpers.** Create `packages/ui/src/backend/icons/lucideRegistryRuntime.tsx` containing `normalizeKebabIconName` (not exported), `resolveRegisteredLucideIcon` and `resolveRegisteredLucideIconNode`, moved verbatim from the template literal in `build.mjs:111-143`, importing `LUCIDE_ICON_REGISTRY` from `./lucideRegistry.generated`. Update `build.mjs` to stop emitting them and to drop the now-unused `import type * as React from 'react'` (`build.mjs:105`). Update `lucideRegistry.ts` to re-export the two resolvers from `./lucideRegistryRuntime` and `LUCIDE_ICON_REGISTRY` from `./lucideRegistry.generated`. Run `yarn workspace @open-mercato/ui build && yarn workspace @open-mercato/ui test` — `lucideRegistry.test.tsx` must pass **unmodified**.
2. **Test the generator.** Export the pure part of the lucide generator from `build.mjs` (a `buildLucideRegistrySource(resolvedIcons)` function returning the file text; the script keeps doing discovery and `writeFileSync`). Add `packages/ui/src/backend/icons/__tests__/lucideRegistryGenerator.test.ts` covering: populated fixture (asserts each kebab key maps to its export, and that the value import lists each export once), empty fixture (valid module, empty object literal, no `lucide-react` value import), duplicate-export fixture, non-identifier key `'bar-chart-2'`, zero syntactic diagnostics for every fixture, and an assertion that no file outside `src/backend/icons/` imports `lucideRegistry.generated`. These tests pin the **current string implementation** — they must pass before step 3 touches it.
3. **Migrate the lucide generator.** Add `ts-morph@^28.0.0` to `packages/ui` `devDependencies`. Reimplement `buildLucideRegistrySource` on an in-memory `ts-morph` source file: banner comments, the `LucideIcon` type-only import, the conditional named value import, and the `LUCIDE_ICON_REGISTRY` variable statement built from an object-literal writer. Assert zero syntactic diagnostics before returning the text; normalise to LF and a trailing newline. Step-2 tests pass with only their expected-formatting assertions updated (assert on parsed structure, not on exact text, wherever a test can). Commit the regenerated `lucideRegistry.generated.tsx`.
4. **Migrate the version injection.** Add `ts-morph@^28.0.0` to `packages/shared` `devDependencies`. Replace the template literal in `injectVersion` with a module-scope `Project` and a `buildVersionSource(version)` helper emitting the banner comment, `export const APP_VERSION = <literal>` and `export const appVersion = APP_VERSION`. Add `packages/shared/src/lib/__tests__/versionSource.test.ts` asserting both exports are present, the literal matches the input, and there are zero syntactic diagnostics. Run `yarn build:packages` and confirm `packages/shared/dist/lib/version.js` still exports both values with the `package.json` version.

**Validation gate for the PR:** `yarn build:packages`, `yarn typecheck`, `yarn lint`, `yarn test`. `yarn generate` and `yarn build:app` are unaffected but included because the regenerated registry is a committed artifact the app compiles against.

## Decisions for the maintainer

These are judgement calls the split review returned upstream. Each has a stated default; say the word and the spec is amended.

| # | Question | Default in this spec |
|---|---|---|
| D1 | Is extracting the three helper functions out of `lucideRegistry.generated.tsx` acceptable, given it removes two exports from a committed generated file (public barrel preserved)? | **Yes** — it is the enabling refactor; without it, migrating the file to AST means re-deriving regex-laden hand-written logic through writer calls for no benefit. |
| D2 | Is `ts-morph` acceptable as a dev dependency of `packages/ui` and `packages/shared`? | **Yes** — dev-only, same version range as `packages/cli`, and the alternative is a `ui → cli` build edge. |
| D3 | Is a behavioral parity bar acceptable where the prior migration used "identical modulo whitespace"? | **Yes** — the extraction removes 33 lines, so no whitespace-only framing is honest here. |

## Final Compliance Report

| Criterion | Verdict | Note |
|---|---|---|
| Naming conventions | Pass | New identifiers camelCase (`buildLucideRegistrySource`, `buildVersionSource`); new files match the folder's existing camelCase file naming (`lucideRegistry.ts`, `lucideRegistry.generated.tsx`). |
| No cross-module ORM relationships | N/A | Build-time only. |
| Tenant / organization scoping | N/A | No data access. |
| Canonical primitives reused | Pass with note | Reuses the AST *shape* established by `packages/cli/src/lib/generators/ast/` but not the module itself; the `ui → cli` / `shared → cli` edge it would create is the documented reason (see Architecture). |
| Contracts and compatibility | Pass | No `BACKWARD_COMPATIBILITY.md` surface changes. The public barrel's export list is asserted by test. |
| Reversibility | Pass | Single revert; generated artifact is rebuilt from the checked-out script. |
| Sensitive data | N/A | No PII, credentials, or GDPR-relevant fields. |
| Failure scenarios documented | Pass | See Edge Cases & Failure Scenarios, each row with its test. |
| Testability of each step | Pass | Step 2 is test-first against the pre-migration implementation; steps 1, 3, 4 each land against tests that already exist. |
| No hardcoded user-facing strings / DS tokens | N/A | No UI surface — `lucideRegistryRuntime` renders an icon component, no copy. |
| Enterprise boundary respected | Pass | `packages/enterprise` untouched. |
| Scope cohesion | Pass | One capability: AST-first source generation in the two package build scripts. The CLI emitters and the plugin contract are separate specs. |

## Changelog

| Date | Change |
|---|---|
| 2026-07-30 | Split out of `2026-07-29-ts-morph-generator-migration.md` (issue #1637 findings 1–2) after PR [#4636](https://github.com/open-mercato/open-mercato/pull/4636) review found the original spec bundled three independently deployable capabilities. Re-verified against `develop@ecc10b3db`. Corrected the parity bar from "byte-identical" to behavioral, and added the helper-extraction step that makes the generated file fully AST-expressible. |
