# Execution plan — AST-first source generation in package build scripts

Source doc: .ai/specs/2026-07-30-ast-first-package-build-scripts.md
Tracking issue: #4671 (design PR #4636, merged into `develop`)
Base branch: develop
Branch: feat/ast-first-package-build-scripts

## Goal

Move the two remaining string-interpolating package build scripts onto `ts-morph`:
`packages/ui/build.mjs` (which writes the committed
`src/backend/icons/lucideRegistry.generated.tsx`) and `packages/shared/build.mjs`
(which synthesizes `lib/version.ts` inside an esbuild `onLoad` hook). The lucide
generator gets an enabling refactor first: the three hand-written helpers that
today live *inside* the generated artifact move into a checked-in source file, so
the generated file shrinks to two imports and one object literal — no JSX, no
`React` type import — and becomes fully expressible as AST.

## Scope

- `packages/ui/src/backend/icons/lucideRegistryRuntime.tsx` — NEW, hand-written home for
  `normalizeKebabIconName` (module-private), `resolveRegisteredLucideIcon`,
  `resolveRegisteredLucideIconNode`.
- `packages/ui/src/backend/icons/lucideRegistry.ts` — public barrel; export list unchanged.
- `packages/ui/src/backend/icons/lucideRegistry.generated.tsx` — regenerated, shrunk.
- `packages/ui/build.mjs` + a new side-effect-free generator module — AST-built registry source.
- `packages/shared/build.mjs` + a new side-effect-free version module — AST-built `APP_VERSION`.
- New tests: generator registry content, empty icon set, syntactic validity, unchanged barrel,
  no out-of-folder importer of the generated file, version-source emitter.

## Non-goals

- `addJsExtension` post-build path rewriting / shebang insertion in any `build.mjs`
  (they rewrite already-emitted JS; issue #1637 scopes them out).
- Anything under `packages/cli` (sibling spec, issue #4672) or the public
  `GeneratorPlugin` output contract (sibling spec, issue #4673 — parked on maintainer
  decision D1). This run must not pull either forward.
- Renaming `lucideRegistry.generated.tsx` or changing its extension.

## Deviations from the spec's letter (flagged in the PR body)

- The spec's step 2 says "export the pure part of the lucide generator **from `build.mjs`**".
  `packages/ui/build.mjs` ends in a top-level `await buildPackage(...)`, so importing it from a
  Jest test would run the whole package build on import. The pure function therefore lands in a
  side-effect-free sibling module (`packages/ui/scripts/lucideRegistrySource.mjs`) that
  `build.mjs` imports; the spec's intent (a pure, testable `buildLucideRegistrySource`) is met.
  Same shape for `packages/shared` (`scripts/versionSource.mjs`).
- Jest in both packages transforms only `.ts/.tsx/.js/.jsx`, so each package's `jest.config.cjs`
  gains `.mjs` to its `transform` pattern and `moduleFileExtensions`. This is the minimum change
  that lets a test import a build-time ESM module.

## Risks

- The committed generated file reformats wholesale (expected; behavioral parity bar, spec D3).
- A third-party deep-importing `@open-mercato/ui/backend/icons/lucideRegistry.generated`
  would lose the two resolvers. Not a documented import surface; guarded by a repo-grep test.
- `ts-morph` becomes a dev dependency of two more packages (spec D2), pinned to the
  `^28.0.0` range `packages/cli` already uses, so the workspace resolves one copy.

## Validation gate

`.ai/agentic.config.json` order: `yarn build:packages`, `yarn generate`, `yarn build:packages`,
`yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.
Plus `yarn lint`, which the spec's own gate names.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Extract the hand-written helpers out of the generated artifact

- [x] 1.1 Add `lucideRegistryRuntime.tsx` with the three helpers moved verbatim — dc7e07b58
- [x] 1.2 Stop emitting them from `build.mjs`, drop the now-unused `React` type import, repoint the barrel — dc7e07b58
- [x] 1.3 Rebuild `@open-mercato/ui` and confirm `lucideRegistry.test.tsx` passes unmodified — dc7e07b58 (15/15 passed, file unmodified)

### Phase 2: Pin the current generator behavior with tests

- [x] 2.1 Extract the pure `buildLucideRegistrySource` into a side-effect-free module consumed by `build.mjs` — 0d6a37f81
- [x] 2.2 Add `lucideRegistryGenerator.test.ts` (populated / empty / duplicate-export / non-identifier-key / syntax / barrel / importer-grep) — 0d6a37f81 (14 tests, green against the string implementation)

### Phase 3: Migrate the lucide generator to ts-morph

- [x] 3.1 Add `ts-morph@^28.0.0` to `packages/ui` devDependencies — 0d6a37f81 (landed with Phase 2; the syntax-validity test needs the parser)
- [x] 3.2 Reimplement `buildLucideRegistrySource` on an in-memory ts-morph project with a syntactic-diagnostics assertion — 6233b34b8
- [x] 3.3 Regenerate and commit `lucideRegistry.generated.tsx`; adjust step-2 assertions to parsed structure — 6233b34b8

### Phase 4: Migrate the shared version injection to ts-morph

- [x] 4.1 Add `ts-morph@^28.0.0` to `packages/shared` devDependencies and add `buildVersionSource` — 0d6a37f81 / 1c3b2217a
- [x] 4.2 Add `versionSource.test.ts` and confirm `dist/lib/version.js` still exports both values — 1c3b2217a (6 tests; `dist/lib/version.js` exports `APP_VERSION = "0.6.6"` + `appVersion`)

### Phase 5: Validation gate

- [x] 5.1 Run the full configured validation gate plus `yarn lint` — green except two pre-existing `@open-mercato/core` failures documented below

### Validation gate result (2026-08-01, local runner)

| Command | Result |
|---|---|
| `yarn build:packages` (×2, around `yarn generate`) | ✅ 21/21 tasks |
| `yarn generate` | ✅ |
| `yarn i18n:check-sync` / `yarn i18n:check-usage` | ✅ (unused-key report is advisory) |
| `yarn typecheck` | ✅ 21/21 tasks |
| `yarn test` | ⚠️ 23/24 packages green; `@open-mercato/core` fails — see below |
| `yarn lint` | ✅ 0 errors (12 pre-existing warnings in `@open-mercato/app`) |
| `yarn build:app` | ✅ |

Both `@open-mercato/core` failures are unrelated to this change, which touches no file under
`packages/core`:

1. `sales/api/__tests__/documents.routes.test.ts` — 3 tests expect `201`, receive `400`. Pre-existing
   collision on `develop` between `7b1dab910 fix(sales): deprecate ignored order payment totals with
   warnings (#4796)` (added the tests) and `76604da24 fix(sales): require at least one line item on
   orders (#4093)` (made their item-less payloads invalid).
2. `customer_accounts/.../user-detail.route.test.ts` and `query_index/__tests__/coverage-warmup.test.ts`
   — jest worker `SIGSEGV` under the full fan-out; both pass in isolation (14/14).

`yarn test` at the repo's pinned `--max-old-space-size=768` also OOMs in `open-mercato-docs`; the run
above used a 4 GB heap. Both are known local-runner limits, not regressions from this branch.
