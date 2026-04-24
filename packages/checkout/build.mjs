import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'

const packageDir = dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

await buildPackage(packageDir, {
  name: 'checkout',
  clearDist: true,
  watch,
})
