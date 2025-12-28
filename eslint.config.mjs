import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

const ignores = [
  'node_modules/**',
  '.next/**',
  'dist/**',
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
