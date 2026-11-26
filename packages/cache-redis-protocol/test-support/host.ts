import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import type { Plugin } from 'esbuild'
import type { CacheProviderDefinition, CacheProviderHostContext, CacheProviderRegistration, ResolvedCacheProvider } from '@open-mercato/cache/provider'
import type { CacheServiceOptions, CacheStrategy } from '@open-mercato/cache/types'
import { spawnConformanceRemoteProcess } from '@open-mercato/cache/testing/remote'
import type { ConformanceRemoteProcess } from '@open-mercato/cache/testing/remote'

export const PACKAGES_DIR = path.resolve(__dirname, '../..')
export const REPO_ROOT = path.resolve(PACKAGES_DIR, '..')
export const CHILD_RUNNER = path.join(__dirname, 'conformance-child.mjs')

export type ConformanceHostModule = {
  createCacheService(options?: CacheServiceOptions): CacheStrategy
  createCacheProviderHostContext(provider: Pick<ResolvedCacheProvider, 'id' | 'namespace'>, options?: { defaultTtl?: number }): CacheProviderHostContext
  defineCacheProviderRegistration(registration: { id: string; load: () => Promise<CacheProviderDefinition<unknown>>; settings: () => unknown }): CacheProviderRegistration
  resolveCacheProvider(registrations: ReadonlyArray<CacheProviderRegistration>, options?: { env?: Record<string, string | undefined> }): Promise<ResolvedCacheProvider | null>
  provider: CacheProviderDefinition<unknown>
}

function resolveSource(base: string): string | null {
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

const workspaceSources: Plugin = {
  name: 'workspace-sources',
  setup(context) {
    context.onResolve({ filter: /^@open-mercato\/[^/]+(\/.+)?$/ }, (args) => {
      const [, packageName, ...rest] = args.path.split('/')
      const resolved = resolveSource(path.join(PACKAGES_DIR, packageName, 'src', ...(rest.length > 0 ? rest : ['index'])))
      return resolved ? { path: resolved } : { path: args.path, external: true }
    })
    context.onResolve({ filter: /^[^./]/ }, (args) => (path.isAbsolute(args.path) ? undefined : { path: args.path, external: true }))
  },
}

/**
 * Bundle the cache host (service, provider contract, remote op server) and the
 * provider under test from workspace sources into one ESM module. It is written
 * under the repo's node_modules so bare imports (ioredis, zod) still resolve.
 */
export async function buildConformanceHost(name: string, providerEntry: string): Promise<string> {
  const outDir = path.join(REPO_ROOT, 'node_modules', '.cache', 'om-resp-conformance')
  mkdirSync(outDir, { recursive: true })
  const outfile = path.join(outDir, `${name}-${process.pid}-host.mjs`)
  const cacheSrc = path.join(PACKAGES_DIR, 'cache', 'src')
  await build({
    stdin: {
      contents: [
        `export { createCacheService } from ${JSON.stringify(path.join(cacheSrc, 'service'))}`,
        `export { createCacheProviderHostContext, defineCacheProviderRegistration, resolveCacheProvider } from ${JSON.stringify(path.join(cacheSrc, 'provider'))}`,
        `export { serveConformanceRemoteOps } from ${JSON.stringify(path.join(cacheSrc, 'testing', 'remote'))}`,
        `export { provider } from ${JSON.stringify(providerEntry)}`,
      ].join('\n'),
      resolveDir: cacheSrc,
      loader: 'ts',
      sourcefile: 'resp-conformance-host.ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'error',
    plugins: [workspaceSources],
  })
  return outfile
}

export function spawnRespRemote(options: {
  hostModule: string
  providerId: string
  namespace: string
  settings: unknown
}): Promise<ConformanceRemoteProcess> {
  return spawnConformanceRemoteProcess({
    command: process.execPath,
    args: [CHILD_RUNNER],
    env: {
      CACHE_CONFORMANCE_HOST: options.hostModule,
      CACHE_CONFORMANCE_SETTINGS: JSON.stringify(options.settings),
      CACHE_PROVIDER: options.providerId,
      CACHE_PROVIDER_NAMESPACE: options.namespace,
    },
    readyTimeoutMs: 60_000,
    operationTimeoutMs: 60_000,
  })
}
