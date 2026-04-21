/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@open-mercato/ai-assistant/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
    // Redirect core module imports to the TS source so Jest's ts-jest
    // transformer handles them cleanly. Without this, the built dist/
    // ESM output trips Jest's CJS-only parser (see
    // pending-action-recheck.ts importing `@open-mercato/core/modules/
    // attachments/data/entities` after Step 5.8).
    '^@open-mercato/core/(.*)$': '<rootDir>/../core/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
        },
      },
    ],
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
