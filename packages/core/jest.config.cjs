/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^#generated/(.*)$': '<rootDir>/generated/$1',
    '^@open-mercato/core/generated/(.*)$': '<rootDir>/generated/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/src/$1',
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
