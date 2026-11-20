/** @type {import('jest').Config} */
const base = require('../../jest.config.base.cjs')

const transformer = [
  '<rootDir>/../../scripts/jest-mikroorm-transformer.cjs',
  {
    tsconfig: {
      jsx: 'react-jsx',
      rootDir: '.',
      ignoreDeprecations: '6.0',
    },
  },
]

// Jest does not interpolate `<rootDir>` in transform *keys* (only in the transformer
// path), so the repo's own `scripts/*.cjs` emitters are selected by requiring a
// `scripts/` segment and excluding `node_modules` outright — third-party `.cjs` inside
// the allowlisted ESM packages stays untransformed.
const SCRIPTS_CJS_PATTERN = '^(?!.*[\\\\/]node_modules[\\\\/]).*[\\\\/]scripts[\\\\/].+\\.cjs$'

module.exports = {
  ...base,
  testEnvironment: 'jsdom',
  testTimeout: 30000,
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@open-mercato/telemetry/browser$': '<rootDir>/../telemetry/src/browser/index.ts',
    '^@open-mercato/ui/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/../core/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^react-markdown$': '<rootDir>/jest.markdown-mock.tsx',
    '^remark-gfm$': '<rootDir>/jest.markdown-mock.tsx',
  },
  transform: {
    '^.+\\.(t|j)sx?$': transformer,
    // Keeps the build-time source emitters under scripts/ testable.
    [SCRIPTS_CJS_PATTERN]: transformer,
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(sanitize-html|htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities|@mikro-orm|kysely|ai|@ai-sdk|ai-sdk-ollama|@workflow|@standard-schema|@tanstack/react-table|@tanstack/table-core|@tanstack/react-store|@tanstack/store)/)',
  ],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)',
    // `.spec.tsx` is this package's jsdom/RTL "integration" convention (no
    // runnable Next.js route to drive with Playwright — see
    // TC-AI-UI-003-aichat-registry.spec.tsx). Plain `.spec.ts` under the same
    // directory is reserved for real Playwright browser specs (discovered by
    // the root `.ai/qa/tests/playwright.config.ts`, e.g.
    // TC-UI-FLASH-001-url-flash-browser-race.spec.ts) and must stay out of
    // Jest's run — it calls `@playwright/test`'s `test()`, which throws when
    // invoked outside the Playwright runner.
    '<rootDir>/__integration__/**/*.spec.tsx',
  ],
  passWithNoTests: true,
}
