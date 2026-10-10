import fs from 'node:fs'
import path from 'node:path'
import type { PackageResolver } from '../resolver'
import { calculateChecksum, createGeneratorResult, type GeneratorResult, writeGeneratedFile } from '../utils'

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

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

function readJson(file: string, fullReasons: Set<string>): unknown {
  let source: string
  try {
    source = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (!isMissing(error)) fullReasons.add(`Cannot read web-research adapter manifest: ${file}`)
    return null
  }
  try {
    return JSON.parse(source)
  } catch {
    return null
  }
}

function readManifest(packageJsonPath: string, fullReasons: Set<string>): DiscoveredAdapter | null {
  const parsed = readJson(packageJsonPath, fullReasons)
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

function scanDirectory(root: string, manifestPaths: string[], fullReasons: Set<string>): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch (error) {
    if (!isMissing(error)) fullReasons.add(`Cannot scan web-research adapter packages: ${root}`)
    return
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (entry.name === '.bin' || entry.name === '.cache') continue
    const child = path.join(root, entry.name)
    // Scoped packages nest one level deeper (`@scope/name`).
    if (entry.name.startsWith('@')) {
      scanDirectory(child, manifestPaths, fullReasons)
      continue
    }
    manifestPaths.push(path.join(child, 'package.json'))
  }
}

/**
 * Shares candidate discovery with generation. Directory paths are coarse roots
 * watched recursively; package implementations are not registry inputs. Missing
 * manifests are retained so declaring an adapter in an existing package is seen.
 */
export type WebResearchAdapterWatchInputs = {
  manifestPaths: string[]
  directoryPaths: string[]
  fullReasons: string[]
}

export function getWebResearchAdapterWatchInputs(
  resolver: PackageResolver,
): WebResearchAdapterWatchInputs {
  const rootDir = resolver.getRootDir()
  const appDir = resolver.getAppDir()
  const manifestPaths: string[] = []
  const fullReasons = new Set<string>()
  const directoryPaths = [...new Set([
    path.join(rootDir, 'packages'),
    path.join(rootDir, 'node_modules'),
    path.join(appDir, 'node_modules'),
  ].map((directory) => path.resolve(directory)))]
  for (const root of directoryPaths) scanDirectory(root, manifestPaths, fullReasons)
  return {
    manifestPaths: [...new Set(manifestPaths)],
    directoryPaths,
    fullReasons: [...fullReasons].sort((left, right) => left.localeCompare(right)),
  }
}

function renderEntries(adapters: readonly DiscoveredAdapter[]): string {
  if (adapters.length === 0) return 'export const webResearchAdapterEntries: AdapterRegistryEntry[] = []\n'
  const loaders = adapters
    .map(
      (adapter) =>
        `  loadAdapterEntry('${adapter.packageName}', () => import('${adapter.packageName}')),`,
    )
    .join('\n')
  return `const MISSING_MODULE_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'])

async function loadAdapterEntry(
  packageName: string,
  load: () => Promise<unknown>,
): Promise<AdapterRegistryEntry | null> {
  try {
    return { packageName, module: await load() }
  } catch (error) {
    const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
    const isMissingCode = typeof code === 'string' && MISSING_MODULE_CODES.has(code)
    const namesThisPackage = typeof message === 'string' && message.includes(\`'\${packageName}'\`)
    if (isMissingCode && namesThisPackage) return null
    throw error
  }
}

const loadedEntries = await Promise.all([
${loaders}
])

export const webResearchAdapterEntries: AdapterRegistryEntry[] = loadedEntries.filter(
  (entry): entry is AdapterRegistryEntry => entry !== null,
)
`
}

/**
 * Emits the adapter registry. Discovery happens here, at build time, because a
 * bundler cannot follow `import()` with a runtime-computed specifier — a dynamic
 * registry would resolve to nothing under Turbopack. Each adapter is imported
 * with a literal specifier and a package that is not installed where the
 * registry runs is skipped: discovery scans the whole workspace, but a process
 * such as a worker in a production image only has the app's own dependencies.
 */
export async function generateWebResearchAdapters(
  options: WebResearchAdaptersOptions,
): Promise<GeneratorResult> {
  const { resolver, quiet } = options
  const result = createGeneratorResult()
  const outputDir = resolver.getOutputDir()
  const outFile = path.join(outputDir, 'web-research-adapters.generated.ts')
  const checksumFile = path.join(outputDir, 'web-research-adapters.checksum')

  const { manifestPaths, fullReasons: scanFullReasons } = getWebResearchAdapterWatchInputs(resolver)
  const fullReasons = new Set(scanFullReasons)
  const discovered = new Map<string, DiscoveredAdapter>()
  for (const manifestPath of manifestPaths) {
    const adapter = readManifest(manifestPath, fullReasons)
    if (adapter && !discovered.has(adapter.packageName)) discovered.set(adapter.packageName, adapter)
  }
  if (fullReasons.size > 0) {
    throw new Error([...fullReasons].sort((left, right) => left.localeCompare(right)).join('\n'))
  }

  const adapters = [...discovered.values()].sort((left, right) =>
    left.packageName.localeCompare(right.packageName),
  )

  const content = `// AUTO-GENERATED — do not edit by hand.
// Source: packages declaring \`${MANIFEST_NAMESPACE}.${ADAPTER_MANIFEST_KEY}\` in package.json.
// Regenerate with: yarn generate
// Adapter packages that are not installed where this registry runs are skipped.
import type { AdapterRegistryEntry } from '@open-mercato/web-research'

${renderEntries(adapters)}`

  writeGeneratedFile({
    outFile,
    checksumFile,
    content,
    // Discovery rereads candidate manifests on every run; adapter implementations
    // cannot affect these static imports, so do not walk their package trees.
    structureChecksum: calculateChecksum(JSON.stringify(adapters)),
    result,
    quiet,
  })

  return result
}
