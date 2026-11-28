import fs from 'node:fs'
import path from 'node:path'
import { purgeConfiguredCachePatternsAcrossTenantScopes } from '@open-mercato/shared/lib/cache/maintenance'
import {
  CacheProviderError,
  isCacheProviderError,
  prepareCacheProviderSelection,
  readSelectedCacheProviderId,
} from '@open-mercato/shared/lib/cache/providers'
import { loadCacheProviderManifest } from './cache-provider-manifest'

const STRUCTURAL_CACHE_PATTERNS = [
  'nav:*',
  'crud|*|*|*/admin/nav|*',
  'crud|*|*|*/portal/nav|*',
]
const TOUCHABLE_GENERATED_FILE_PATTERN = /\.generated(?:\.[a-z0-9]+)?(?:\.ts|\.checksum)$/i

export type PostGenerateStructuralInvalidationResult = {
  cacheEntriesDeleted: number
  generatedFilesTouched: string[]
  cacheError: unknown | null
  generatedFilesError: unknown | null
}

function touchGeneratedFiles(appDir: string): string[] {
  const generatedDir = path.join(appDir, '.mercato', 'generated')
  if (!fs.existsSync(generatedDir) || !fs.statSync(generatedDir).isDirectory()) return []

  const touched: string[] = []
  // `utimes` advances mtime without opening the file for writing. Rewriting the
  // identical bytes would truncate multi-megabyte registries first, and Turbopack
  // reads them concurrently during a dev compile — it can observe the empty window.
  const touchedAt = new Date()
  const entries = fs.readdirSync(generatedDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    if (!entry.isFile() || !TOUCHABLE_GENERATED_FILE_PATTERN.test(entry.name)) continue
    const filePath = path.join(generatedDir, entry.name)
    fs.utimesSync(filePath, touchedAt, touchedAt)
    touched.push(filePath)
  }
  return touched
}

/**
 * Purge the structural patterns through the effective cache selection. With a registered
 * provider (`CACHE_PROVIDER`) the generated manifest is loaded and the same provider the app
 * resolves is prepared first; the purge closes its maintenance client itself. Provider
 * failures are reduced to a `CacheProviderError` so driver messages (which may embed
 * endpoints or credentials) never reach the CLI diagnostics.
 */
async function purgeStructuralCacheEntries(appDir: string): Promise<number> {
  const providerId = readSelectedCacheProviderId(process.env)
  if (!providerId) return purgeConfiguredCachePatternsAcrossTenantScopes(STRUCTURAL_CACHE_PATTERNS)
  try {
    await loadCacheProviderManifest(appDir)
    await prepareCacheProviderSelection()
    return await purgeConfiguredCachePatternsAcrossTenantScopes(STRUCTURAL_CACHE_PATTERNS)
  } catch (error) {
    if (isCacheProviderError(error)) throw error
    throw new CacheProviderError('unavailable', 'Cache provider structural purge failed', { cause: error })
  }
}

export async function runPostGenerateStructuralInvalidation(
  appDir: string,
): Promise<PostGenerateStructuralInvalidationResult> {
  let cacheEntriesDeleted = 0
  let generatedFilesTouched: string[] = []
  let cacheError: unknown | null = null
  let generatedFilesError: unknown | null = null

  try {
    generatedFilesTouched = touchGeneratedFiles(appDir)
  } catch (error) {
    generatedFilesError = error
  }

  try {
    cacheEntriesDeleted = await purgeStructuralCacheEntries(appDir)
  } catch (error) {
    cacheError = error
  }

  return {
    cacheEntriesDeleted,
    generatedFilesTouched,
    cacheError,
    generatedFilesError,
  }
}
