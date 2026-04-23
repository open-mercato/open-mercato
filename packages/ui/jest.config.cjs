/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@open-mercato/ui/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/../core/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
  },
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
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(@mikro-orm)/)',
  ],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
