/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/\\.mercato/generated/(.*)$': '<rootDir>/.mercato/generated/$1',
    '^@/generated/(.*)$': '<rootDir>/.mercato/generated/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^#generated/(.*)$': '<rootDir>/../../packages/core/generated/$1',
    '^@open-mercato/core/generated/(.*)$': '<rootDir>/../../packages/core/generated/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/../../packages/core/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^@open-mercato/ui/(.*)$': '<rootDir>/../../packages/ui/src/$1',
    '^@open-mercato/cache$': '<rootDir>/../../packages/cache/src/index.ts',
    '^@open-mercato/cache/(.*)$': '<rootDir>/../../packages/cache/src/$1',
    '^@open-mercato/queue$': '<rootDir>/../../packages/queue/src/index.ts',
    '^@open-mercato/queue/(.*)$': '<rootDir>/../../packages/queue/src/$1',
    '^@open-mercato/search$': '<rootDir>/../../packages/search/src/index.ts',
    '^@open-mercato/search/(.*)$': '<rootDir>/../../packages/search/src/$1',
    '^@open-mercato/events/(.*)$': '<rootDir>/../../packages/events/src/$1',
    '^@open-mercato/cli/(.*)$': '<rootDir>/../../packages/cli/src/$1',
    '^@open-mercato/content/(.*)$': '<rootDir>/../../packages/content/src/$1',
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
  setupFiles: ['<rootDir>/../../jest.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/../../jest.dom.setup.ts'],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
