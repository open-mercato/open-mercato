import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_DIR } from './ignite-container'

const PACKAGES_DIR = path.resolve(PACKAGE_DIR, '..')

function resolveSource(base: string): string | null {
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export async function buildConformanceChild(): Promise<string> {
  const { build } = await import('esbuild')
  const outDir = path.join(PACKAGE_DIR, 'node_modules', '.om-ignite-test')
  mkdirSync(outDir, { recursive: true })
  const outfile = path.join(outDir, `conformance-child-${process.pid}.mjs`)
  await build({
    entryPoints: [path.join(__dirname, 'conformance-child.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'error',
    plugins: [{
      name: 'workspace-sources',
      setup(context) {
        context.onResolve({ filter: /^@open-mercato\/[^/]+\/.+/ }, (args) => {
          const [, scopeName, ...rest] = args.path.split('/')
          const resolved = resolveSource(path.join(PACKAGES_DIR, scopeName, 'src', ...rest))
          return resolved ? { path: resolved } : { path: args.path, external: true }
        })
        context.onResolve({ filter: /^[^./]/ }, (args) => (path.isAbsolute(args.path) ? undefined : { path: args.path, external: true }))
      },
    }],
  })
  return outfile
}
