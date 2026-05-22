/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^#generated/(.*)$': '<rootDir>/generated/$1',
    '^@open-mercato/core/generated/(.*)$': '<rootDir>/generated/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@open-mercato/ui/(.*)$': '<rootDir>/../ui/src/$1',
    '^@open-mercato/ai-assistant/(.*)$': '<rootDir>/../ai-assistant/src/$1',
    '^@/\\.mercato/generated/inbox-actions\\.generated$': '<rootDir>/jest.mocks/inbox-actions.generated.js',
    '^react-markdown$': '<rootDir>/jest.mocks/react-markdown.js',
    '^remark-gfm$': '<rootDir>/jest.mocks/remark-gfm.js',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      '<rootDir>/../../scripts/jest-mikroorm-transformer.cjs',
      {
        tsconfig: {
          jsx: 'react-jsx',
          rootDir: '.',
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(@mikro-orm|kysely)/)',
  ],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
