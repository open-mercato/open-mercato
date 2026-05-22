/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  testTimeout: 30000,
  watchman: false,
  rootDir: '.',
  maxWorkers: 4,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@open-mercato/ui/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/../core/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^react-markdown$': '<rootDir>/jest.markdown-mock.tsx',
    '^remark-gfm$': '<rootDir>/jest.markdown-mock.tsx',
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
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)',
    '<rootDir>/__integration__/**/*.spec.(ts|tsx)',
  ],
  passWithNoTests: true,
}
