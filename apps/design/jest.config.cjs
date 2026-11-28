/** @type {import('jest').Config} */
const base = require('../../jest.config.base.cjs')

module.exports = {
  ...base,
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/ui/(.*)$': '<rootDir>/../../packages/ui/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/../../packages/core/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      '<rootDir>/../../scripts/jest-mikroorm-transformer.cjs',
      { tsconfig: { jsx: 'react-jsx', rootDir: '.', ignoreDeprecations: '6.0', resolveJsonModule: true } },
    ],
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
}
