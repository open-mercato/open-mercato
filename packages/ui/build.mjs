import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'
import { discoverResolvedIcons } from './scripts/lucideIconDiscovery.cjs'
import { buildLucideRegistrySource } from './scripts/lucideRegistrySource.cjs'

const packageDir = dirname(fileURLToPath(import.meta.url))

async function generateLucideRegistry() {
  const repoRoot = join(packageDir, '..', '..')
  const resolved = await discoverResolvedIcons(repoRoot)

  const outPath = join(packageDir, 'src/backend/icons/lucideRegistry.generated.tsx')
  writeFileSync(outPath, buildLucideRegistrySource(resolved))
  console.log(`Generated lucide registry with ${resolved.length} icons -> ${outPath}`)
}

await buildPackage(packageDir, {
  name: 'ui',
  beforeBuild: generateLucideRegistry,
})
