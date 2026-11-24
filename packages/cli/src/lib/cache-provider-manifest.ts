import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import {
  setCacheProviderRegistrations,
  type CacheProviderRegistration,
} from '@open-mercato/shared/lib/cache/providers'
import { CACHE_PROVIDERS_GENERATED_FILE } from './generators/cache-providers'

const COMPILED_MANIFEST_BASENAME = 'cache-providers.compiled'

export function resolveCacheProviderManifestPath(appDir: string): string {
  return path.join(appDir, '.mercato', 'generated', CACHE_PROVIDERS_GENERATED_FILE)
}

function isJestRuntime(): boolean {
  return typeof process.env.JEST_WORKER_ID === 'string'
}

async function importCompiledManifest(appDir: string, manifestPath: string): Promise<{ cacheProviders?: unknown }> {
  const format = isJestRuntime() ? 'cjs' : 'esm'
  const { compileAppSourceFile } = await import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
  const compiledPath = await compileAppSourceFile(manifestPath, {
    appRoot: appDir,
    outFile: path.join(path.dirname(manifestPath), `${COMPILED_MANIFEST_BASENAME}.${format === 'cjs' ? 'cjs' : 'mjs'}`),
    format,
  })
  if (format === 'cjs') {
    const requireCompiled = createRequire(compiledPath)
    delete requireCompiled.cache[compiledPath]
    return requireCompiled(compiledPath) as { cacheProviders?: unknown }
  }
  const outputHash = crypto.createHash('sha256').update(fs.readFileSync(compiledPath)).digest('hex')
  return (await import(`${pathToFileURL(compiledPath).href}?cache=${outputHash}`)) as { cacheProviders?: unknown }
}

async function resolveDefaultAppDir(): Promise<string> {
  const { createResolver } = await import('./resolver')
  return createResolver().getAppDir()
}

/**
 * Loads `<app>/.mercato/generated/cache-providers.generated.ts` (and through it the
 * app's `mercato.cache.ts`) in a plain Node CLI/worker/scheduler process, registers
 * the result with `setCacheProviderRegistrations`, and returns it.
 *
 * A missing generated file registers and returns an empty list, so bootstrap-free
 * commands keep working before `yarn generate` ran. A file that exists but fails to
 * compile, import, or export an array throws: silently falling back to the stock
 * cache would hide a misconfigured provider.
 */
export async function loadCacheProviderManifest(appDir?: string): Promise<CacheProviderRegistration[]> {
  const resolvedAppDir = appDir ?? (await resolveDefaultAppDir())
  const manifestPath = resolveCacheProviderManifestPath(resolvedAppDir)
  if (!fs.existsSync(manifestPath)) {
    setCacheProviderRegistrations([])
    return []
  }

  const loaded = await importCompiledManifest(resolvedAppDir, manifestPath)
  if (!Array.isArray(loaded.cacheProviders)) {
    throw new Error(
      `[internal] ${path.relative(resolvedAppDir, manifestPath)} must export a cacheProviders array. Run \`yarn generate\` and check mercato.cache.ts.`,
    )
  }
  const registrations = [...(loaded.cacheProviders as CacheProviderRegistration[])]
  setCacheProviderRegistrations(registrations)
  return registrations
}
