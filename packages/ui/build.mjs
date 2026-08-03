import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'
import lucideRegistryGenerator from './scripts/lucideRegistryGenerator.cjs'

const packageDir = dirname(fileURLToPath(import.meta.url))
const { syncLucideRegistry } = lucideRegistryGenerator

async function generateLucideRegistry() {
  const result = await syncLucideRegistry({ packageDir })
  console.log(`Generated lucide registry with ${result.iconCount} icons -> ${result.outputPath}`)
}

await buildPackage(packageDir, {
  name: 'ui',
  beforeBuild: generateLucideRegistry,
})
