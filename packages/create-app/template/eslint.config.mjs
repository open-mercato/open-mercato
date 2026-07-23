import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Flat ESLint config for a scaffolded app. `next lint` was removed in Next 16,
// so `yarn lint` runs the ESLint CLI directly and needs a config to exist.
// eslint-config-next ships the Next/React/a11y rule set; resolve it through
// createRequire so the subpath works regardless of hoisting.
const require = createRequire(import.meta.url)
const nextCoreWebVitals = (
  await import(pathToFileURL(require.resolve('eslint-config-next/core-web-vitals')).href)
).default

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.mercato/**',
      'dist/**',
      'out/**',
      'build/**',
      'generated/**',
      '**/generated/**',
      'next-env.d.ts',
    ],
  },
  ...(Array.isArray(nextCoreWebVitals) ? nextCoreWebVitals : [nextCoreWebVitals]),
  {
    rules: {
      'react/display-name': 'off',
      'react/no-unescaped-entities': 'off',
      '@next/next/no-img-element': 'warn',
    },
  },
]
