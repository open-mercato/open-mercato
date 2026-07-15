import Module from 'node:module'

// TypeScript 7 is a native (Go) compiler and no longer ships the JavaScript
// programmatic API that @typescript-eslint requires (`require('typescript')`
// resolves to a stub exporting only `version`). Redirect `typescript` to the
// JS-based TypeScript installed under the `typescript-js` npm alias for the lint
// process, while the native `typescript` stays the typecheck/build compiler.
// The redirect must run before typescript-eslint loads, so `eslint-config-next`
// (which pulls it in) is imported dynamically AFTER this patch — a static import
// would be hoisted and evaluated first. Drop once @typescript-eslint supports the
// native TS 7 API.
const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'typescript') request = 'typescript-js'
  return originalResolveFilename.call(this, request, ...rest)
}

const { default: nextCoreWebVitals } = await import('eslint-config-next/core-web-vitals')

const ignores = [
  'node_modules/**',
  '.next/**',
  '**/.next/**',
  '.mercato/**',
  '**/.mercato/**',
  'dist/**',
  '**/dist/**',
  'packages/**/dist/**',
  'packages/**/src/**/*.jsx',
  'out/**',
  'build/**',
  'generated/**',
  '**/generated/**',
  'docs/.docusaurus/**',
  'docs/build/**',
  'next-env.d.ts',
]

const ruleOverrides = {
  'react/display-name': 'off',

  'react-hooks/immutability': 'off',
  'react-hooks/preserve-manual-memoization': 'off',
  'react-hooks/purity': 'off',
  'react-hooks/refs': 'off',
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/static-components': 'off',
}

export default [
  ...nextCoreWebVitals,
  { ignores },
  { name: 'project/rule-overrides', rules: ruleOverrides },
]
