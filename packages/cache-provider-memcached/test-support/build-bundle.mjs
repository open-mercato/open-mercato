// Bundles the @open-mercato/cache host (service, provider contract, conformance
// remote server, tenant context) and optionally this provider from source into
// one ESM file, so child processes and the qualification script run plain node
// without depending on any package's dist.
// Usage: node build-bundle.mjs <outfile> [--host-only]
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const supportDir = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(supportDir, '..')
const packagesDir = path.resolve(packageDir, '..')

function resolveSource(base) {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

const workspaceSources = {
  name: 'workspace-sources',
  setup(context) {
    context.onResolve({ filter: /^@open-mercato\/[^/]+(\/.+)?$/ }, (args) => {
      const [, scopeName, ...rest] = args.path.split('/')
      const resolved = resolveSource(path.join(packagesDir, scopeName, 'src', ...rest))
      return resolved ? { path: resolved } : { path: args.path, external: true }
    })
  },
}

export async function buildTestBundle(outfile, options = {}) {
  const lines = [
    "export { createCacheService } from '@open-mercato/cache/service'",
    "export { defineCacheProviderRegistration, resolveCacheProvider, createCacheProviderHostContext } from '@open-mercato/cache/provider'",
    "export { serveConformanceRemoteOps } from '@open-mercato/cache/testing/remote'",
    "export { runWithCacheTenant } from '@open-mercato/cache/tenantContext'",
  ]
  if (!options.hostOnly) {
    lines.push(`export { provider, memcachedSettingsSchema } from ${JSON.stringify(path.join(packageDir, 'src', 'index.ts'))}`)
    lines.push(`export { createMemcachedClient, createTcpTransport } from ${JSON.stringify(path.join(packageDir, 'src', 'protocol', 'index.ts'))}`)
  }
  await build({
    stdin: { contents: lines.join('\n'), resolveDir: packageDir, loader: 'ts', sourcefile: 'memcached-test-bundle.ts' },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'error',
    external: ['ioredis', 'better-sqlite3'],
    banner: { js: "import { createRequire as __omCreateRequire } from 'node:module'; const require = __omCreateRequire(import.meta.url);" },
    plugins: [workspaceSources],
  })
  return outfile
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outfile = process.argv[2]
  if (!outfile) {
    process.stderr.write('[internal] usage: build-bundle.mjs <outfile> [--host-only]\n')
    process.exit(2)
  }
  await buildTestBundle(path.resolve(outfile), { hostOnly: process.argv.includes('--host-only') })
}
