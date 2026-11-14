/** @type {import('jest').Config} */
const base = require('../../jest.config.base.cjs')

// react-markdown + remark-gfm and their unified/micromark dependency tree ship
// ESM only; transform them so the Markdown import helper is tested for real.
const MARKDOWN_ESM_PACKAGES = [
  '@ungap/structured-clone', 'bail', 'ccount', 'character-entities[a-z0-9-]*', 'character-reference-invalid',
  'comma-separated-tokens', 'decode-named-character-reference', 'devlop', 'escape-string-regexp', 'estree-util-[a-z-]+',
  'hast-util-[a-z-]+', 'html-url-attributes', 'is-alphabetical', 'is-alphanumerical', 'is-decimal',
  'is-hexadecimal', 'is-plain-obj', 'longest-streak', 'markdown-table', 'mdast-util-[a-z-]+',
  'micromark[a-z-]*', 'parse-entities', 'property-information', 'react-markdown', 'remark-[a-z-]+',
  'space-separated-tokens', 'stringify-entities', 'trim-lines', 'trough', 'unified', 'unist-util-[a-z-]+',
  'vfile[a-z-]*', 'zwitch',
].join('|')

module.exports = {
  ...base,
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@open-mercato/documents/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/cache$': '<rootDir>/../cache/src/index.ts',
    '^@open-mercato/cache/(.*)$': '<rootDir>/../cache/src/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/../core/src/$1',
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
    `node_modules/(?!(${[
      'sanitize-html|htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities|@mikro-orm|kysely',
      MARKDOWN_ESM_PACKAGES,
    ].join('|')})/)`,
  ],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
