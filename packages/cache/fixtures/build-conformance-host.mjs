// Bundles the @open-mercato/cache host (service, provider contract, conformance
// remote server) from source into one ESM file for the independent-process
// conformance runner. Workspace packages resolve to their sources so the
// runner does not depend on any package's dist being built.
// Usage: node build-conformance-host.mjs <outfile>
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const outfile = process.argv[2]
if (!outfile) {
  process.stderr.write('[internal] usage: build-conformance-host.mjs <outfile>\n')
  process.exit(2)
}

const fixturesDir = path.dirname(fileURLToPath(import.meta.url))
const cacheSrc = path.resolve(fixturesDir, '../src')
const packagesDir = path.resolve(fixturesDir, '../..')

function resolveSource(base) {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

const workspaceSources = {
  name: 'workspace-sources',
  setup(context) {
    context.onResolve({ filter: /^@open-mercato\/[^/]+(?:\/.+)?$/ }, (args) => {
      const [, scopeName, ...rest] = args.path.split('/')
      const resolved = resolveSource(path.join(packagesDir, scopeName, 'src', ...(rest.length ? rest : ['index'])))
      return resolved ? { path: resolved } : { path: args.path, external: true }
    })
    context.onResolve({ filter: /^[^./]/ }, (args) => (path.isAbsolute(args.path) ? undefined : { path: args.path, external: true }))
  },
}

await build({
  stdin: {
    contents: [
      "export { createCacheService } from './service'",
      "export { defineCacheProviderRegistration, resolveCacheProvider } from './provider'",
      "export { serveConformanceRemoteOps } from './testing/remote'",
    ].join('\n'),
    resolveDir: cacheSrc,
    loader: 'ts',
    sourcefile: 'conformance-host.ts',
  },
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'error',
  plugins: [workspaceSources],
})
