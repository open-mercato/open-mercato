/** @type {import('jest').Config} */
// Standalone app test config. Mirrors apps/mercato/jest.config.cjs, minus the
// monorepo-only `moduleNameMapper` entries: in a scaffolded app the
// @open-mercato/* packages resolve from node_modules, so only the app's own
// `@/…` and `#generated/…` aliases need mapping.
module.exports = {
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/\\.mercato/generated/(.*)$': '<rootDir>/.mercato/generated/$1',
    '^@/generated/(.*)$': '<rootDir>/.mercato/generated/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^#generated/(.*)$': '<rootDir>/.mercato/generated/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          rootDir: '.',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          useDefineForClassFields: false,
        },
      },
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@mikro-orm|kysely|meilisearch|ai|@ai-sdk|ai-sdk-ollama|@workflow|@standard-schema)/)',
    '\\.pnp\\.[^\\/]+$',
  ],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
