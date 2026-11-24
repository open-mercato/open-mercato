import fs from 'node:fs'
import path from 'node:path'
import type { PackageResolver } from '../resolver'
import { calculateStructureChecksum, createGeneratorResult, type GeneratorResult, writeGeneratedFile } from '../utils'

/**
 * App cache-provider manifest generator.
 *
 * An app opts into third-party cache providers with `<app root>/mercato.cache.ts`
 * (or `mercato.cache.js`) — next to `package.json`, NOT under `src/`. The file must
 * export a named array:
 *
 * ```ts
 * import type { CacheProviderRegistration } from '@open-mercato/cache/provider'
 *
 * export const cacheProviders: CacheProviderRegistration[] = [
 *   { id: 'acme/example', load: () => import('@acme/cache-example').then((mod) => mod.default), settings: () => ({}) },
 * ]
 * ```
 *
 * The generator only checks that the file exists — it never evaluates it — and
 * writes `cache-providers.generated.ts`, which re-exports `cacheProviders` through a
 * literal relative import (so bundlers and Next build tracing follow it) or, when
 * the app has no manifest, exports an empty list.
 */

export const CACHE_PROVIDERS_GENERATED_FILE = 'cache-providers.generated.ts'
export const CACHE_PROVIDERS_CHECKSUM_FILE = 'cache-providers.generated.checksum'
export const CACHE_MANIFEST_BASENAME = 'mercato.cache'

const SUPPORTED_MANIFEST_EXTENSIONS = ['.ts', '.js'] as const
const UNSUPPORTED_MANIFEST_EXTENSIONS = ['.tsx', '.mts', '.cts', '.mjs', '.cjs'] as const

export interface CacheProvidersOptions {
  resolver: PackageResolver
  quiet?: boolean
}

function manifestCandidates(appDir: string, extensions: readonly string[]): string[] {
  return extensions
    .map((extension) => path.join(appDir, `${CACHE_MANIFEST_BASENAME}${extension}`))
    .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}

export function findCacheProviderManifest(appDir: string): string | null {
  const unsupported = manifestCandidates(appDir, UNSUPPORTED_MANIFEST_EXTENSIONS)
  if (unsupported.length > 0) {
    throw new Error(
      `[internal] Unsupported cache provider manifest ${unsupported.map((file) => path.basename(file)).join(', ')}: ` +
        `rename it to ${CACHE_MANIFEST_BASENAME}.ts (or ${CACHE_MANIFEST_BASENAME}.js).`,
    )
  }
  const supported = manifestCandidates(appDir, SUPPORTED_MANIFEST_EXTENSIONS)
  if (supported.length > 1) {
    throw new Error(
      `[internal] Multiple cache provider manifests found (${supported.map((file) => path.basename(file)).join(', ')}): keep exactly one.`,
    )
  }
  return supported[0] ?? null
}

function toImportSpecifier(fromDir: string, manifestFile: string): string {
  const withoutExtension = manifestFile.slice(0, -path.extname(manifestFile).length)
  const relative = path.relative(fromDir, withoutExtension).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

export function renderCacheProvidersRegistry(outputDir: string, manifestFile: string | null): string {
  const header = `// AUTO-GENERATED — do not edit by hand.
// Source: <app root>/${CACHE_MANIFEST_BASENAME}.ts (optional)
// Regenerate with: yarn generate
import type { CacheProviderRegistration } from '@open-mercato/cache/provider'
`
  if (!manifestFile) {
    return `${header}
export const cacheProviders: CacheProviderRegistration[] = []
`
  }
  return `${header}import { cacheProviders as appCacheProviders } from '${toImportSpecifier(outputDir, manifestFile)}'

export const cacheProviders: CacheProviderRegistration[] = appCacheProviders
`
}

export async function generateCacheProviders(options: CacheProvidersOptions): Promise<GeneratorResult> {
  const { resolver, quiet } = options
  const result = createGeneratorResult()
  const outputDir = resolver.getOutputDir()
  const appDir = resolver.getAppDir()
  const manifestFile = findCacheProviderManifest(appDir)

  writeGeneratedFile({
    outFile: path.join(outputDir, CACHE_PROVIDERS_GENERATED_FILE),
    checksumFile: path.join(outputDir, CACHE_PROVIDERS_CHECKSUM_FILE),
    content: renderCacheProvidersRegistry(outputDir, manifestFile),
    structureChecksum: calculateStructureChecksum(
      SUPPORTED_MANIFEST_EXTENSIONS.map((extension) => path.join(appDir, `${CACHE_MANIFEST_BASENAME}${extension}`)),
    ),
    result,
    quiet,
  })

  return result
}
