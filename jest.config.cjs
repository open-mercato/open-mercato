/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/generated/(.*)$': '<rootDir>/generated/$1',
    '^@/lib/(.*)$': '<rootDir>/packages/shared/src/lib/$1',
    '^@/types/(.*)$': '<rootDir>/packages/shared/src/types/$1',
    '^@/modules/registry$': '<rootDir>/packages/shared/src/modules/registry.ts',
    '^@mercato-core/(.*)$': '<rootDir>/packages/core/src/$1',
    '^@mercato-example/(.*)$': '<rootDir>/packages/example/src/$1',
    '^@mercato-cli/(.*)$': '<rootDir>/packages/cli/src/$1',
    '^@mercato-events/(.*)$': '<rootDir>/packages/events/src/$1',
    '^@mercato-shared/(.*)$': '<rootDir>/packages/shared/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
        },
      },
    ],
  },
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  collectCoverageFrom: ['src/**/*.(ts|tsx)', '!src/modules/**/migrations/**'],
}
