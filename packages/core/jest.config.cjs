/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^#generated/entities/(.*)$': '<rootDir>/generated/entities/$1/index.ts',
    '^#generated/entities\\.ids\\.generated$': '<rootDir>/generated/entities.ids.generated.ts',
    '^#generated/entity-fields-registry$': '<rootDir>/src/generated-shims/entity-fields-registry.ts',
    '^@open-mercato/core/generated/(.*)$': '<rootDir>/generated/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@open-mercato/ui/(.*)$': '<rootDir>/../ui/src/$1',
    '^@/\\.mercato/generated/inbox-actions\\.generated$': '<rootDir>/jest.mocks/inbox-actions.generated.js',
    '^react-markdown$': '<rootDir>/jest.mocks/react-markdown.js',
    '^remark-gfm$': '<rootDir>/jest.mocks/remark-gfm.js',
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
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
