/** @type {import('jest').Config} */
const base = require('../../jest.config.base.cjs')

module.exports = {
  ...base,
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@open-mercato/cache$': '<rootDir>/../cache/src/index.ts',
    '^@open-mercato/cache/(.*)$': '<rootDir>/../cache/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
  },
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
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: process.env.OM_CACHE_PROVIDER_CONTAINER_TESTS === '1' ? [] : ['\\.container\\.test\\.ts$'],
  passWithNoTests: true,
}
