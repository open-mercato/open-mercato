import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// `eslint-config-next` (and its @typescript-eslint parser) are dependencies of
// the app workspace, which is the only package that runs eslint. During the
// TypeScript 7 migration the app is pinned to JS TypeScript 6 for `next build`
// while the rest of the repo uses native TS 7, so yarn keeps these packages
// nested under apps/mercato instead of hoisting them to the repo root. Resolve
// them from the app directory rather than relative to this root config file, and
// let @typescript-eslint pick up the app's nested JS TypeScript. Simplify back to
// `import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'` once the
// app moves to native TS 7 (Next 16.3).
const require = createRequire(import.meta.url)
const appDir = path.join(import.meta.dirname, 'apps', 'mercato')
const nextCoreWebVitals = (await import(
  pathToFileURL(require.resolve('eslint-config-next/core-web-vitals', { paths: [appDir] })).href
)).default

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
