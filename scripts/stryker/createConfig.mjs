/**
 * Shared StrykerJS configuration factory — one source of truth for every package.
 *
 * Per-package configuration is forced, not chosen: every package carries its own
 * `jest.config.cjs` with its own `rootDir`, `moduleNameMapper`, and a transformer
 * referenced as `<rootDir>/../../scripts/jest-mikroorm-transformer.cjs`. A single
 * root Stryker config cannot drive them. This factory keeps the shared settings in
 * one file while each package's `stryker.conf.mjs` supplies only its own name.
 *
 * Three settings below are load-bearing workarounds measured in the Phase 0 pilot
 * (`.ai/analysis/2026-07-31-stryker-mutation-testing-pilot.md`) — changing them
 * breaks the run outright rather than degrading it:
 *
 *   inPlace: true          Stryker's default sandbox copies the package one directory
 *                          deeper, so every relative path in the per-package jest
 *                          config resolves outside the sandbox and the run dies with
 *                          `Cannot find module '../../jest.config.base.cjs'`.
 *                          `inPlace` also short-circuits Stryker's tsconfig
 *                          preprocessor, which calls `ts.parseConfigFileTextToJson` —
 *                          absent from this repo's typescript@7.0.2 (the Go compiler;
 *                          the JS API lives behind the `typescript-js` alias, see
 *                          scripts/jest-typescript-resolver.cjs).
 *
 *   coverageAnalysis: off  `@jest-environment` docblocks in existing suites block
 *                          `perTest` and `all`. Fixing that means editing dozens of
 *                          unrelated test files, which the spec rules out.
 *
 *   excludedMutations      `StringLiteral` and `Regex` mutants are the cheapest way to
 *                          game a mutation score — killing them rewards asserting exact
 *                          log strings and error copy instead of behaviour.
 *
 * @see .ai/specs/2026-07-31-stryker-mutation-testing-ci-gate.md
 */

export const DEFAULT_TIMEOUT_MS = 30000
export const DEFAULT_CONCURRENCY = 4
export const MUTATION_REPORT_PATH = 'reports/mutation/mutation.json'
export const MUTATION_HTML_REPORT_PATH = 'reports/mutation/mutation.html'

/**
 * Per-package `timeoutMS`. A mutant is only declared "timed out" after Stryker waits
 * this long, so the value must clear the package's own jest `testTimeout` — otherwise
 * slow-but-correct suites report timeouts instead of scores. `packages/core` sets
 * `testTimeout: 30000` in its jest config and needs the larger budget; every other
 * package runs on the default.
 */
export const PACKAGE_TIMEOUT_MS = Object.freeze({
  core: 60000,
})

export const IN_SCOPE_GLOBS = Object.freeze([
  'src/lib/**/*.ts',
  'src/modules/**/*.ts',
  'src/security/**/*.ts',
])

export const OUT_OF_SCOPE_GLOBS = Object.freeze([
  '!src/**/__tests__/**',
  '!src/**/*.test.ts',
  '!src/**/*.d.ts',
  '!src/lib/testing/**',
])

export const EXCLUDED_MUTATIONS = Object.freeze(['StringLiteral', 'Regex'])

export function createStrykerConfig(options = {}) {
  const { packageName, concurrency = DEFAULT_CONCURRENCY } = options

  if (typeof packageName !== 'string' || packageName.trim() === '') {
    throw new Error('[internal] createStrykerConfig requires a non-empty packageName')
  }

  const timeoutMS = options.timeoutMS ?? PACKAGE_TIMEOUT_MS[packageName] ?? DEFAULT_TIMEOUT_MS

  return {
    packageManager: 'yarn',
    testRunner: 'jest',
    jest: {
      projectType: 'custom',
      configFile: 'jest.config.cjs',
      enableFindRelatedTests: true,
      config: {
        testEnvironment: '@stryker-mutator/jest-runner/jest-env/node',
      },
    },
    coverageAnalysis: 'off',
    inPlace: true,
    mutate: [...IN_SCOPE_GLOBS, ...OUT_OF_SCOPE_GLOBS],
    mutator: {
      excludedMutations: [...EXCLUDED_MUTATIONS],
    },
    thresholds: {
      high: 85,
      low: 70,
      break: null,
    },
    reporters: ['clear-text', 'progress', 'json', 'html'],
    jsonReporter: {
      fileName: MUTATION_REPORT_PATH,
    },
    htmlReporter: {
      fileName: MUTATION_HTML_REPORT_PATH,
    },
    timeoutMS,
    timeoutFactor: 2,
    concurrency,
    tempDirName: '.stryker-tmp',
    cleanTempDir: true,
  }
}

export default createStrykerConfig
