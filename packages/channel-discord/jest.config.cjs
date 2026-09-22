/** @type {import('jest').Config} */
const base = require('../../jest.config.base.cjs')

module.exports = {
  ...base,
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@open-mercato/channel-discord/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/../core/src/$1',
    // Test-only: lets the policy/runtime integration spec drive the REAL
    // `agent-policy` / `agent-runtime` instead of a stub. The runtime dependency
    // stays soft — production code reaches the peer through a dynamic import.
    '^@open-mercato/ai-assistant/(.*)$': '<rootDir>/../ai-assistant/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@open-mercato/queue/(.*)$': '<rootDir>/../queue/src/$1',
    '^@open-mercato/ui/(.*)$': '<rootDir>/../ui/src/$1',
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
  transformIgnorePatterns: [
    'node_modules/(?!(@mikro-orm|kysely|ai|@ai-sdk|ai-sdk-ollama|@workflow|@standard-schema)/)',
  ],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
