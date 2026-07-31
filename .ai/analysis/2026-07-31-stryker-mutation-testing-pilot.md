# StrykerJS pilot (Phase 0) — measured feasibility on `packages/shared`

Date: 2026-07-31 · Branch: `chore/stryker-pilot` · Machine: local dev box, `concurrency: 4`

Goal: decide whether diff-scoped mutation testing can run in CI without pushing the pipeline
into hours, and surface every monorepo-specific blocker before a spec is written.

## Verdict

Feasible for `packages/shared` at PR-diff scale (**44 s – 1 min 25 s** per run). Four blockers were
hit and three are worked around; one (`coverageAnalysis`) is unresolved and constrains the design.

## Setup

- `@stryker-mutator/core` + `@stryker-mutator/jest-runner` as devDependencies of `packages/shared`
- `packages/shared/stryker.conf.json`, `testRunner: jest`, `jest.projectType: custom`,
  `jest.configFile: jest.config.cjs`
- `mutator.excludedMutations: ["StringLiteral", "Regex"]`
- `thresholds.break: 70`

## Blockers found

### 1. TypeScript 7 breaks Stryker's tsconfig preprocessor — BLOCKER, worked around

```
TypeError: ts.parseConfigFileTextToJson is not a function
  at TSConfigPreprocessor.rewriteTSConfigFile
```

The repo runs `typescript@7.0.2` (Go compiler, no JS compiler API) with `typescript-js`
(`npm:typescript@6.0.3`) as the JS-API alias — see `scripts/jest-typescript-resolver.cjs`.
Stryker's sandbox preprocessor does a bare `await import('typescript')` and dies.

Workarounds: (a) `inPlace: true` short-circuits the preprocessor entirely, (b) point
`tsconfigFile` at a non-existent path so the rewrite is skipped. The pilot uses (a),
which also solves blocker 2.

### 2. Sandbox copy breaks every relative path in the jest config — BLOCKER, worked around

Stryker copies the package into `packages/shared/.stryker-tmp/sandbox-XXXX/`, one level deeper
than the real package, so `require('../../jest.config.base.cjs')` and the transformer path
`<rootDir>/../../scripts/jest-mikroorm-transformer.cjs` both resolve outside the sandbox:

```
Cannot find module '../../jest.config.base.cjs'
```

Every package in this monorepo shares that pattern, so this would hit all ~20 of them.
`inPlace: true` removes the sandbox and fixes it. Cost: Stryker mutates real source files during
the run and restores them from `.stryker-tmp/backup-XXXX` afterwards — verified clean
(`git status` clean after every run, including after a crashed run). A killed process
(`SIGKILL`, runner eviction) can leave mutated sources behind; recovery is `git checkout`.

### 3. `@jest-environment` docblocks block coverage analysis — UNRESOLVED

`coverageAnalysis: "perTest"` and `"all"` both fail the dry run:

```
Missing coverage results for:
  * src/modules/widgets/__tests__/injection-loader.required-modules.test.ts
  * src/lib/bootstrap/__tests__/dynamicLoader.cacheRecovery.test.ts
  (and 4 more)
```

Stryker needs its own jest environment (`@stryker-mutator/jest-runner/jest-env/node`) to report
coverage. Setting it via `jest.config.testEnvironment` does not help, because these files declare
`@jest-environment node|jsdom` in a docblock, which always wins. `packages/shared` has 10+ such
files; the pattern is used repo-wide.

The pilot therefore runs `coverageAnalysis: "off"`: no coverage-driven test selection, only
jest's `--findRelatedTests`. This is the single biggest performance lever left on the table.

Options for the spec: drop the docblocks where they only restate the config default (most of the
`@jest-environment node` ones do), or ship a `mixinJestEnvironment` wrapper module and point the
docblocks at it.

### 4. Diff-based selection must be hand-rolled — by design

StrykerJS has no `--since` flag (only `--incremental` + `--incrementalFile` + `--force`, which
diff internally, not against a git branch). Diff scoping = compute the file list ourselves from
`git diff --name-only origin/<base>...HEAD`, filter to the domain layer, pass as `--mutate`.

## Measurements

| Target | LOC | Scored mutants | Wall time | Score | Tests run per mutant |
|--------|-----|----------------|-----------|-------|----------------------|
| `src/lib/boolean.ts` | 28 | 30 | **1 m 18 s** | 93.3 % | 530 |
| `featureMatch.ts` + `phone.ts` + `number.ts` | 134 | 119 | **44 s** | 78.2 % | 68 |
| `src/lib/crud/optimistic-lock.ts` | 396 | 200 | **1 m 25 s** | 74.5 % | 127 |

Baseline for comparison: a single jest test file in this package runs in ~4 s; the full
`packages/shared` suite is 140 test files.

**The cost driver is fan-in, not mutant count.** A 28-line file that half the package imports
(`boolean.ts`) is slower than a 396-line leaf file, because `--findRelatedTests` pulls in 530
tests per mutant instead of 127. Any per-PR budget must be expressed in "tests per mutant",
not "lines changed".

## Score findings (substantive, not tooling)

Real gaps surfaced on the first run, on code the repo treats as load-bearing:

- `boolean.ts` — `if (!trimmed) return null` and `typeof value === 'string'` both survive:
  the empty-string and non-string paths of `parseBooleanToken` are untested.
- `optimistic-lock.ts` — 74.5 %, i.e. **just above** a 70 % gate on a file guarding concurrent edits.
- `phone.ts` — 57.1 %, would fail the gate today. 24 of 26 survivors are `ObjectLiteral`
  (`return { valid: false, reason: 'too_long' }` → `return {}`): tests assert `valid` but never
  the `reason`. Genuine gap, but also the noisiest mutator in the set.

Survivor distribution on `optimistic-lock.ts` (200 mutants):

| Mutator | Total | Survived |
|---------|-------|----------|
| ConditionalExpression | 71 | 23 |
| BlockStatement | 23 | 9 |
| ObjectLiteral | 26 | 6 |
| LogicalOperator | 15 | 4 |
| EqualityOperator | 27 | 3 |
| MethodExpression | 8 | 3 |
| BooleanLiteral | 25 | 3 |
| StringLiteral | 34 | 0 (excluded → Ignored) |

`StringLiteral` exclusion works as intended — 34 mutants ignored, no effect on the score. In this
repo those literals are event IDs (`module.entity.action`), i18n keys and ACL feature IDs; mutating
them would have produced exactly the brittle string-assertion tests the initiative wants to avoid.

## Implications for the design

1. `inPlace: true` is mandatory in this monorepo — the sandbox cannot survive the shared jest
   config. That makes CI (ephemeral runners) the natural home and makes local runs a
   "commit first" operation.
2. Per-package Stryker config + a CI matrix over changed packages. One root config cannot work:
   each package has its own `rootDir`, `moduleNameMapper` and transformer.
3. `packages/shared` numbers do **not** transfer to `packages/core` (bigger suites, 30 s test
   timeouts, DI/ORM bootstrapping). A second measurement on `core` belongs in the spec before
   the gate is turned on there.
4. A minimum-mutant floor is needed before any break threshold is enforced — at 4 mutants one
   survivor is 75 %.
5. `phone.ts` at 57 % shows the gate cannot be switched on retroactively for whole files. It must
   score **only the changed lines/files of the PR**, and land advisory-first.
