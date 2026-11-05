import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'

const packageDir = dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

await buildPackage(packageDir, {
  name: 'documents',
  clearDist: true,
  watch,
})

// The collaboration server is a separate production workload rather than a
// Next.js route. Compile its public entry so scaffolded apps can run the same
// package image after development dependencies (including tsx) are pruned.
await buildPackage(packageDir, {
  name: 'documents-collab',
  entryPoints: [join(packageDir, 'server', 'documents-collab-server.ts')],
  outdir: 'dist',
  outbase: '.',
  watch,
})
