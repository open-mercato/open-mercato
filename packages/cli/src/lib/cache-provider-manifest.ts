import type { CacheProviderRegistration } from '@open-mercato/shared/lib/cache/providers'

/** Load app provider registrations for CLI commands that do not bootstrap the full app. */
export async function loadCacheProviderManifest(appDir: string): Promise<CacheProviderRegistration[]> {
  const { loadCacheProviderManifestFromAppRoot } = await import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
  const format = typeof process.env.JEST_WORKER_ID === 'string' ? 'cjs' : 'esm'
  return loadCacheProviderManifestFromAppRoot(appDir, { format })
}
