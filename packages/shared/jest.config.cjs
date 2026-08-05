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
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@open-mercato/shared/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/../core/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': transformer,
    // Keeps the build-time source emitters under scripts/ testable.
    [SCRIPTS_CJS_PATTERN]: transformer,
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@mikro-orm|kysely|ai|@ai-sdk|ai-sdk-ollama|@workflow|@standard-schema)/)',
  ],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
