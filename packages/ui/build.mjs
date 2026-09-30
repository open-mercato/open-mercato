import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'
import { discoverResolvedIcons } from './scripts/lucideIconDiscovery.cjs'
import { buildLucideRegistrySource, checkLucideRegistryDrift } from './scripts/lucideRegistrySource.cjs'

const packageDir = dirname(fileURLToPath(import.meta.url))
// `--check` regenerates the lucide registry in memory and fails on drift
// without writing or building — the CI guard mode (`yarn ui:icons:check`).
const checkOnly = process.argv.includes('--check')

async function generateLucideRegistry() {
  const repoRoot = join(packageDir, '..', '..')
  const resolved = await discoverResolvedIcons(repoRoot)

  const outPath = join(packageDir, 'src/backend/icons/lucideRegistry.generated.tsx')
  const source = buildLucideRegistrySource(resolved)

  // `--check` makes this a drift guard instead of a writer. The committed
  // registry is a canonical mirror of a repo-wide scan, so nothing inside
  // `packages/ui`'s own test suite can protect it: a PR that adds
  // `icon: 'some-lucide-name'` in another package never selects `packages/ui`
  // under turbo's `--filter=[base]...` (ui is a dependency of those packages,
  // not a dependent), which is exactly how #4391 drifted unnoticed. CI calls
  // this unfiltered, mirroring `ds:tokens:check`.
  if (checkOnly) {
    const committed = existsSync(outPath) ? readFileSync(outPath, 'utf8') : ''
    const drift = checkLucideRegistryDrift(committed, source, outPath)
    if (drift.drifted) {
      console.error(drift.message)
      process.exit(1)
    }
    console.log(`Lucide registry is in sync (${resolved.length} icons).`)
    return
  }

  writeFileSync(outPath, source)
  console.log(`Generated lucide registry with ${resolved.length} icons -> ${outPath}`)
}

if (checkOnly) {
  await generateLucideRegistry()
} else {
  await buildPackage(packageDir, {
    name: 'ui',
    beforeBuild: generateLucideRegistry,
  })
}
