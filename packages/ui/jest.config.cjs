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
    'node_modules/(?!(@mikro-orm|kysely|ai|@ai-sdk|ai-sdk-ollama|@workflow|@standard-schema|@tanstack/react-table|@tanstack/table-core|@tanstack/react-store|@tanstack/store)/)',
  ],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)',
    // `.spec.tsx` is a jsdom/RTL integration test run by Jest (see
    // TC-AI-UI-003's doc comment — `packages/ui` has no runnable Next.js
    // route, so these dress up as integration specs under jsdom). A plain
    // `.spec.ts` is a genuine Playwright browser spec, discovered and run by
    // `.ai/qa/tests/playwright.config.ts` instead — Jest must not import it.
    '<rootDir>/__integration__/**/*.spec.tsx',
  ],
  passWithNoTests: true,
}
