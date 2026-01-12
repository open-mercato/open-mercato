/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchman: false,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/generated/(.*)$': '<rootDir>/generated/$1',
    '^@/lib/(.*)$': '<rootDir>/packages/shared/src/lib/$1',
    '^@/types/(.*)$': '<rootDir>/packages/shared/src/types/$1',
    '^@/modules/registry$': '<rootDir>/packages/shared/src/modules/registry.ts',
    '^@open-mercato/core/generated/(.*)$': '<rootDir>/packages/core/generated/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/packages/core/src/$1',
    '^@open-mercato/content/(.*)$': '<rootDir>/packages/content/src/$1',
    '^@open-mercato/cli/(.*)$': '<rootDir>/packages/cli/src/$1',
    '^@open-mercato/events/(.*)$': '<rootDir>/packages/events/src/$1',
    '^@open-mercato/cache/(.*)$': '<rootDir>/packages/cache/src/$1',
    '^@open-mercato/cache$': '<rootDir>/packages/cache/src/index.ts',
    '^@open-mercato/queue/worker$': '<rootDir>/packages/queue/src/worker/runner.ts',
    '^@open-mercato/queue/(.*)$': '<rootDir>/packages/queue/src/$1',
    '^@open-mercato/queue$': '<rootDir>/packages/queue/src/index.ts',
    '^@open-mercato/search/(.*)$': '<rootDir>/packages/search/src/$1',
    '^@open-mercato/search$': '<rootDir>/packages/search/src/index.ts',
    '^@open-mercato/shared/(.*)$': '<rootDir>/packages/shared/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
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
  setupFilesAfterEnv: ['<rootDir>/jest.dom.setup.ts'],
  collectCoverageFrom: ['src/**/*.(ts|tsx)', '!src/modules/**/migrations/**'],
}
