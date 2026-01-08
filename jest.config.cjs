/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchman: false,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    // New @open-mercato/generated package mappings
    '^@open-mercato/generated/modules$': '<rootDir>/packages/generated/.gen/modules.generated.ts',
    '^@open-mercato/generated/entities$': '<rootDir>/packages/generated/.gen/entities.generated.ts',
    '^@open-mercato/generated/di$': '<rootDir>/packages/generated/.gen/di.generated.ts',
    '^@open-mercato/generated/entity-ids$': '<rootDir>/packages/generated/.gen/entities.ids.generated.ts',
    '^@open-mercato/generated/dashboard-widgets$': '<rootDir>/packages/generated/.gen/dashboard-widgets.generated.ts',
    '^@open-mercato/generated/injection-widgets$': '<rootDir>/packages/generated/.gen/injection-widgets.generated.ts',
    '^@open-mercato/generated/injection-tables$': '<rootDir>/packages/generated/.gen/injection-tables.generated.ts',
    '^@open-mercato/generated/vector$': '<rootDir>/packages/generated/.gen/vector.generated.ts',
    '^@open-mercato/generated/modules/(.+)/entities$': '<rootDir>/packages/generated/.gen/modules/$1/entities.ts',
    '^@open-mercato/generated/(.*)$': '<rootDir>/packages/generated/src/$1.ts',
    '^@/lib/(.*)$': '<rootDir>/packages/shared/src/lib/$1',
    '^@/types/(.*)$': '<rootDir>/packages/shared/src/types/$1',
    '^@/modules/registry$': '<rootDir>/packages/shared/src/modules/registry.ts',
    '^@open-mercato/core/generated/(.*)$': '<rootDir>/packages/core/generated/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/packages/core/src/$1',
    '^@open-mercato/example/(.*)$': '<rootDir>/packages/example/src/$1',
    '^@open-mercato/content/(.*)$': '<rootDir>/packages/content/src/$1',
    '^@open-mercato/cli/(.*)$': '<rootDir>/packages/cli/src/$1',
    '^@open-mercato/example/generated/(.*)$': '<rootDir>/packages/example/generated/$1',
    '^@open-mercato/events/(.*)$': '<rootDir>/packages/events/src/$1',
    '^@open-mercato/cache/(.*)$': '<rootDir>/packages/cache/src/$1',
    '^@open-mercato/cache$': '<rootDir>/packages/cache/src/index.ts',
    '^@open-mercato/shared/(.*)$': '<rootDir>/packages/shared/src/$1',
    '^@/(.*)$': '<rootDir>/apps/mercato/src/$1',
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
