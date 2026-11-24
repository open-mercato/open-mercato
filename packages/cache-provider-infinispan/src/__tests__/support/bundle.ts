import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { build, type Plugin } from 'esbuild'

const PACKAGE_DIR = path.resolve(__dirname, '../../..')
const PACKAGES_DIR = path.resolve(PACKAGE_DIR, '..')

function resolveSource(base: string): string | null {
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

const workspaceSources: Plugin = {
  name: 'workspace-sources',
  setup(context) {
    context.onResolve({ filter: /^@open-mercato\/[^/]+\/.+/ }, (args) => {
      const [, scopeName, ...rest] = args.path.split('/')
      const resolved = resolveSource(path.join(PACKAGES_DIR, scopeName, 'src', ...rest))
      return resolved ? { path: resolved } : { path: args.path, external: true }
    })
    context.onResolve({ filter: /^[^./]/ }, (args) => (path.isAbsolute(args.path) ? undefined : { path: args.path, external: true }))
  },
}

export const CHILD_RUNNER = path.join(__dirname, 'conformance-child.mjs')

export async function buildConformanceBundle(name: string): Promise<string> {
  const outDir = path.join(PACKAGE_DIR, 'node_modules', '.cache', 'om-infinispan-conformance')
  mkdirSync(outDir, { recursive: true })
  const outfile = path.join(outDir, `${name}-${process.pid}.mjs`)
  await build({
    stdin: {
      contents: [
        "export { createCacheService } from '@open-mercato/cache/service'",
        "export { defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'",
        "export { serveConformanceRemoteOps } from '@open-mercato/cache/testing/remote'",
        `export { provider } from ${JSON.stringify(path.join(PACKAGE_DIR, 'src', 'index.ts'))}`,
      ].join('\n'),
      resolveDir: PACKAGE_DIR,
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
  return outfile
}
