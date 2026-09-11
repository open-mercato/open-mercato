/** @type {import('jest').Config} */
const base = require('../../jest.config.base.cjs')

module.exports = {
  ...base,
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@open-mercato/web-research/(.*)$': '<rootDir>/../web-research/src/$1',
    '^@open-mercato/web-research$': '<rootDir>/../web-research/src/index.ts',
    '^@open-mercato/web-research-serp$': '<rootDir>/../web-research-serp/src/index.ts',
  },
  // Shared transformer rather than plain ts-jest: `client.ts` reads
  // `import.meta.url` to locate the sidecar script, which a CJS test transform
  // cannot parse. This is the same transformer the CLI and enterprise use.
  transform: {
    '^.+\\.(t|j)sx?$': [
      '<rootDir>/../../scripts/jest-mikroorm-transformer.cjs',
      {
        tsconfig: {
          rootDir: '.',
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
