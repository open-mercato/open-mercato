import { execFileSync } from 'node:child_process'
import path from 'node:path'

const PACKAGES_DIR = path.resolve(__dirname, '../..')

export const CACHE_REGISTRY_PATH = 'src/providers/cache.ts'

export const CACHE_HOST_WORKSPACES = [
  'cache-provider-kit',
  'cache-provider-jsonfile',
  'cache-provider-memory',
  'cache-provider-redis-legacy',
  'cache-provider-sqlite',
  'cache',
] as const

export function packCacheWorkspaces(packDir: string, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => {
    const packageDir = path.join(PACKAGES_DIR, name)
    const tarball = path.join(packDir, `${name}.tgz`)
    execFileSync(process.execPath, ['build.mjs'], { cwd: packageDir, stdio: 'pipe', timeout: 240_000 })
    execFileSync('yarn', ['pack', '--out', tarball], { cwd: packageDir, stdio: 'pipe', timeout: 120_000 })
    return [name, tarball]
  }))
}
