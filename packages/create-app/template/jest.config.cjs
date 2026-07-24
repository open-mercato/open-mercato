/** @type {import('jest').Config} */
// Unit-test config for a standalone Open Mercato app.
// Integration tests run through Playwright (`yarn test:integration:ephemeral`)
// and are excluded here.
// `create-mercato-app` skips `__tests__`/`__integration__` while copying the
// template, so a freshly scaffolded app owns no test files until you write one.
module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  passWithNoTests: true,
  rootDir: '.',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/\\.mercato/(.*)$': '<rootDir>/.mercato/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^#generated/(.*)$': '<rootDir>/.mercato/generated/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowJs: true,
          isolatedModules: true,
        },
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@open-mercato)/)'],
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/.mercato/', '/.ai/qa/'],
}
