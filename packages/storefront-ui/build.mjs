import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'

const packageDir = dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

// Browser-only package: no Node built-ins, no server code (storefront-app spec §3.2).
await buildPackage(packageDir, {
  name: 'storefront-ui',
  platform: 'browser',
  target: 'es2022',
  extraIgnore: ['**/*.stories.tsx', '**/.storybook/**'],
  clearDist: true,
  watch,
})
