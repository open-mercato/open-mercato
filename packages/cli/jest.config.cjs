/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      '<rootDir>/../../scripts/jest-mikroorm-transformer.cjs',
      {
        tsconfig: {
          jsx: 'react-jsx',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@open-mercato/queue$': '<rootDir>/../queue/src/index.ts',
    '^@open-mercato/queue/worker$': '<rootDir>/../queue/src/worker/runner.ts',
    '^@open-mercato/queue/(.*)$': '<rootDir>/../queue/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@mikro-orm)/)',
  ],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
