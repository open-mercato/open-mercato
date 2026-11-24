import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_DIR } from './ignite-container'

const PACKAGES_DIR = path.resolve(PACKAGE_DIR, '..')
const CACHE_DIR = path.join(PACKAGES_DIR, 'cache')
const HOST_SUBPATHS = ['provider', 'service', 'types', 'tenantContext']

function resolveSource(base: string): string | null {
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export async function installHostCachePackage(appDir: string): Promise<string> {
  const { build } = await import('esbuild')
  const target = path.join(appDir, 'node_modules', '@open-mercato', 'cache')
  mkdirSync(target, { recursive: true })
  await build({
    stdin: {
      contents: [
        "export * from './index'",
        "export * from './provider'",
        "export * from './service'",
        "export * from './tenantContext'",
      ].join('\n'),
      resolveDir: path.join(CACHE_DIR, 'src'),
      loader: 'ts',
      sourcefile: 'host.ts',
    },
    outfile: path.join(target, 'index.mjs'),
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
  const typesDir = path.join(target, 'types')
  execFileSync(process.execPath, [
    path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc'),
    '-p', path.join(CACHE_DIR, 'tsconfig.build.json'),
    '--emitDeclarationOnly', '--declarationMap', 'false', '--outDir', typesDir,
  ], { cwd: CACHE_DIR, stdio: 'pipe', timeout: 180_000 })
  const exportsMap: Record<string, { types: string; default: string }> = {
    '.': { types: './types/index.d.ts', default: './index.mjs' },
  }
  for (const subpath of HOST_SUBPATHS) exportsMap[`./${subpath}`] = { types: `./types/${subpath}.d.ts`, default: './index.mjs' }
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: '@open-mercato/cache',
    version: '0.11.0',
    type: 'module',
    exports: exportsMap,
  }, null, 2))
  return target
}
