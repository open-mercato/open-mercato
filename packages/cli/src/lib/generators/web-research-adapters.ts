import fs from 'node:fs'
import path from 'node:path'
import type { PackageResolver } from '../resolver'
import { calculateStructureChecksum, createGeneratorResult, type GeneratorResult, writeGeneratedFile } from '../utils'

export interface WebResearchAdaptersOptions {
  resolver: PackageResolver
  quiet?: boolean
}

/**
 * Mirrors `openMercato.webResearchAdapter` in `@open-mercato/web-research`. It is
 * duplicated rather than imported because the CLI must not depend on the engine
 * package to run its generators.
 */
const MANIFEST_NAMESPACE = 'openMercato'
const ADAPTER_MANIFEST_KEY = 'webResearchAdapter'

type DiscoveredAdapter = {
  packageName: string
  adapterId: string
  sourceRoot: string
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readManifest(packageJsonPath: string): DiscoveredAdapter | null {
  const parsed = readJson(packageJsonPath)
  if (typeof parsed !== 'object' || parsed === null) return null
  const pkg = parsed as Record<string, unknown>
  const namespace = pkg[MANIFEST_NAMESPACE]
  if (typeof namespace !== 'object' || namespace === null) return null
  const manifest = (namespace as Record<string, unknown>)[ADAPTER_MANIFEST_KEY]
  if (typeof manifest !== 'object' || manifest === null) return null
  const adapterId = (manifest as Record<string, unknown>).id
  const packageName = pkg.name
  if (typeof packageName !== 'string' || packageName.length === 0) return null
  if (typeof adapterId !== 'string' || adapterId.length === 0) return null
  return { packageName, adapterId, sourceRoot: path.dirname(packageJsonPath) }
}

function scanDirectory(root: string, results: Map<string, DiscoveredAdapter>): void {
  if (!fs.existsSync(root)) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (entry.name === '.bin' || entry.name === '.cache') continue
    const child = path.join(root, entry.name)
    // Scoped packages nest one level deeper (`@scope/name`).
    if (entry.name.startsWith('@')) {
      scanDirectory(child, results)
      continue
    }
    const discovered = readManifest(path.join(child, 'package.json'))
    if (discovered && !results.has(discovered.packageName)) results.set(discovered.packageName, discovered)
  }
}

function identifierFor(index: number): string {
  return `adapter${index}`
}

/**
 * Emits the statically imported adapter registry. Discovery happens here, at
 * build time, because a bundler cannot follow `import()` with a runtime-computed
 * specifier — a dynamic registry would resolve to nothing under Turbopack.
 */
export async function generateWebResearchAdapters(
  options: WebResearchAdaptersOptions,
): Promise<GeneratorResult> {
  const { resolver, quiet } = options
  const result = createGeneratorResult()
  const outputDir = resolver.getOutputDir()
  const outFile = path.join(outputDir, 'web-research-adapters.generated.ts')
  const checksumFile = path.join(outputDir, 'web-research-adapters.checksum')

  const appDir = resolver.getAppDir()
  const repoRoot = path.resolve(appDir, '..', '..')
  const discovered = new Map<string, DiscoveredAdapter>()
  const scanRoots = [
    path.join(repoRoot, 'packages'),
    path.join(repoRoot, 'node_modules'),
    path.join(appDir, 'node_modules'),
  ]
  for (const root of scanRoots) scanDirectory(root, discovered)

  const adapters = [...discovered.values()].sort((left, right) =>
    left.packageName.localeCompare(right.packageName),
  )

  const imports = adapters
    .map((adapter, index) => `import * as ${identifierFor(index)} from '${adapter.packageName}'`)
    .join('\n')
  const entries = adapters
    .map(
      (adapter, index) =>
        `  { packageName: '${adapter.packageName}', module: ${identifierFor(index)} },`,
    )
    .join('\n')

  const content = `// AUTO-GENERATED — do not edit by hand.
// Source: packages declaring \`${MANIFEST_NAMESPACE}.${ADAPTER_MANIFEST_KEY}\` in package.json.
// Regenerate with: yarn generate
import type { AdapterRegistryEntry } from '@open-mercato/web-research'
${imports}

export const webResearchAdapterEntries: AdapterRegistryEntry[] = [
${entries}
]
`

  writeGeneratedFile({
    outFile,
    checksumFile,
    content,
    structureChecksum: calculateStructureChecksum(adapters.map((adapter) => adapter.sourceRoot)),
    result,
    quiet,
  })

  return result
}
