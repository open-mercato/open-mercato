/**
 * Shared jest config for the managed cache kit and the official managed
 * cache provider packages: workspace sources for the cache host, the RESP
 * protocol library and this kit (including its `./testing` subpath).
 *
 * @param {string} packageDir absolute directory of the package under test
 * @returns {import('jest').Config}
 */
module.exports = function createManagedProviderJestConfig(packageDir) {
  const base = require('../../jest.config.base.cjs')
  return {
    ...base,
    testEnvironment: 'node',
    watchman: false,
    rootDir: packageDir,
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    moduleNameMapper: {
      '^@open-mercato/cache-provider-managed-kit$': '<rootDir>/../cache-provider-managed-kit/src/index.ts',
      '^@open-mercato/cache-provider-managed-kit/testing$': '<rootDir>/../cache-provider-managed-kit/test-support/index.ts',
      '^@open-mercato/cache-provider-managed-kit/testing/(.*)$': '<rootDir>/../cache-provider-managed-kit/test-support/$1',
      '^@open-mercato/cache-redis-protocol$': '<rootDir>/../cache-redis-protocol/src/index.ts',
      '^@open-mercato/cache-redis-protocol/test-support/(.*)$': '<rootDir>/../cache-redis-protocol/test-support/$1',
      '^@open-mercato/cache-redis-protocol/(.*)$': '<rootDir>/../cache-redis-protocol/src/$1',
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
}
