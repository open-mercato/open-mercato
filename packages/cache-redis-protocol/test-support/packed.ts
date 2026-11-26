import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PACKAGES_DIR, REPO_ROOT } from './host'

export type PackedInstall = {
  workDir: string
  appDir: string
  installedScopePackages: string[]
  run(script: string, env: Record<string, string>): string
  typecheck(source: string): string
  dispose(): void
}

function exec(command: string, args: string[], cwd: string, timeout = 240_000, env?: Record<string, string>): string {
  return execFileSync(command, args, {
    cwd,
    stdio: 'pipe',
    timeout,
    env: { ...process.env, ...(env ?? {}) },
    encoding: 'utf8',
  })
}

/**
 * Build and pack (`yarn pack`, which resolves `workspace:*` exactly like the
 * publish script) @open-mercato/cache, the RESP protocol library and one
 * provider, then install only those tarballs (plus their registry dependencies)
 * into a fresh app outside the workspace.
 */
export function createPackedInstall(providerDirName: string): PackedInstall {
  const workDir = mkdtempSync(path.join(os.tmpdir(), `om-packed-${providerDirName}-`))
  const packDir = path.join(workDir, 'pack')
  const appDir = path.join(workDir, 'app')
  mkdirSync(packDir, { recursive: true })
  mkdirSync(appDir, { recursive: true })
  const packageDirs = ['cache', 'cache-redis-protocol', providerDirName].map((name) => path.join(PACKAGES_DIR, name))
  for (const packageDir of packageDirs) {
    exec(process.execPath, ['build.mjs'], packageDir)
    exec('yarn', ['pack', '--out', path.join(packDir, `${path.basename(packageDir)}.tgz`)], packageDir, 120_000)
  }
  const tarballs = readdirSync(packDir).filter((name) => name.endsWith('.tgz')).map((name) => path.join(packDir, name))
  writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'om-cache-packed-app', private: true, version: '0.0.0', type: 'module' }))
  exec('npm', ['install', ...tarballs, '@types/node@^22', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock', '--loglevel=error'], appDir, 300_000)
  const scopeDir = path.join(appDir, 'node_modules', '@open-mercato')
  const installedScopePackages = readdirSync(scopeDir).sort()
  const tsc = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

  return {
    workDir,
    appDir,
    installedScopePackages,
    run(script, env) {
      const file = path.join(appDir, `run-${Date.now()}.mjs`)
      writeFileSync(file, script)
      return exec(process.execPath, [file], appDir, 120_000, env)
    },
    typecheck(source) {
      const registryPath = 'src/providers/cache.ts'
      mkdirSync(path.join(appDir, path.dirname(registryPath)), { recursive: true })
      writeFileSync(path.join(appDir, registryPath), source)
      writeFileSync(path.join(appDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'esnext',
          moduleResolution: 'bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ['node'],
        },
        include: [registryPath],
      }))
      return exec(process.execPath, [tsc, '-p', 'tsconfig.json'], appDir, 180_000)
    },
    dispose() {
      rmSync(workDir, { recursive: true, force: true })
    },
  }
}

export function packedSmokeScript(packageName: string): string {
  return `
import { pathToFileURL } from 'node:url'
import { createCacheProviderHostContext, defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'

const registration = defineCacheProviderRegistration({
  id: process.env.CACHE_PROVIDER,
  load: () => import('${packageName}').then((module) => module.provider),
  settings: () => JSON.parse(process.env.SMOKE_SETTINGS),
})
const resolved = await resolveCacheProvider([registration], { env: process.env })
const strategy = await resolved.definition.create(resolved.config, createCacheProviderHostContext(resolved))
await strategy.healthcheck()
await strategy.set('smoke:a', { ok: 1 }, { tags: ['smoke'] })
await strategy.set('smoke:b', 'b', { tags: ['other'], ttl: 60000 })
const direct = {
  get: await strategy.get('smoke:a'),
  keys: (await strategy.keys('smoke:*')).sort(),
  invalidated: await strategy.deleteByTags(['smoke']),
  afterInvalidate: await strategy.get('smoke:a'),
  cleared: await strategy.clear(),
}
await strategy.close()
await strategy.close()

let service = null
if (process.env.SMOKE_HOST) {
  const host = await import(pathToFileURL(process.env.SMOKE_HOST).href)
  const cache = host.createCacheService({ provider: resolved })
  await cache.set('tenant-key', { via: 'service' }, { tags: ['records'] })
  service = {
    get: await cache.get('tenant-key'),
    keys: await cache.keys(),
    invalidated: await cache.deleteByTags(['records']),
    afterInvalidate: await cache.get('tenant-key'),
  }
  await cache.close()
}
process.stdout.write(JSON.stringify({ id: resolved.id, placement: resolved.placement, redacted: resolved.definition.redact(resolved.config), direct, service }))
`
}
