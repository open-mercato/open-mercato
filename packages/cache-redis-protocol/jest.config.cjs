/** @type {import('jest').Config} */
const base = require('../../jest.config.base.cjs')

module.exports = {
  ...base,
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@open-mercato/cache-redis-protocol$': '<rootDir>/src/index.ts',
    '^@open-mercato/cache-redis-protocol/test-support/(.*)$': '<rootDir>/test-support/$1',
    '^@open-mercato/cache/(.*)$': '<rootDir>/../cache/src/$1',
    '^@open-mercato/cache$': '<rootDir>/../cache/src/index.ts',
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
  passWithNoTests: true,
}
