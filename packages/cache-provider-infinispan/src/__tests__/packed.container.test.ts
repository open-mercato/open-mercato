import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ADMIN_PASSWORD, ADMIN_USER, startInfinispanCluster, type InfinispanCluster } from './support/cluster'
import { skipUnlessContainers } from './support/env'

const SUITE = 'packed @open-mercato/cache-provider-infinispan installed into a fresh app'
const PACKAGE_DIR = path.resolve(__dirname, '../..')
const CACHE_PACKAGE_DIR = path.resolve(PACKAGE_DIR, '../cache')
const SHARED_PACKAGE_DIR = path.resolve(PACKAGE_DIR, '../shared')
const REPO_ROOT = path.resolve(PACKAGE_DIR, '../..')
const CACHE_NAME = 'om-cache-packed'

const SMOKE_SCRIPT = `
import { defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
import { createCacheService } from '@open-mercato/cache/service'
import { runWithCacheTenant } from '@open-mercato/cache/tenantContext'

const registrations = [
  defineCacheProviderRegistration({
    id: 'open-mercato/infinispan',
    load: () => import('@open-mercato/cache-provider-infinispan').then((module) => module.provider),
    settings: () => JSON.parse(process.env.SMOKE_SETTINGS),
  }),
]
const resolved = await resolveCacheProvider(registrations, { env: process.env })
const service = createCacheService({ provider: resolved })
await service.healthcheck()
const result = await runWithCacheTenant('packed-tenant', async () => {
  await service.set('product:1', { name: 'Widget' }, { tags: ['products'] })
  await service.set('product:2', { name: 'Gadget' }, { tags: ['products', 'featured'] })
  const first = await service.get('product:1')
  const keys = (await service.keys('product:*')).sort()
  const removed = await service.deleteByTags(['featured'])
  const afterFeatured = (await service.keys()).sort()
  const cleared = await service.clear()
  return { id: resolved.id, placement: resolved.placement, first, keys, removed, afterFeatured, cleared }
})
await service.close()
await service.close()
process.stdout.write(JSON.stringify(result))
process.exit(0)
`

const TYPES_SCRIPT = `
import { provider, infinispanSettingsSchema, type InfinispanSettingsInput } from '@open-mercato/cache-provider-infinispan'
import { defineCacheProviderRegistration } from '@open-mercato/cache/provider'

const settings: InfinispanSettingsInput = {
  servers: [{ host: 'ispn.internal', port: 11222 }],
  cacheName: 'open-mercato',
  auth: { username: 'svc', password: 'secret', mechanism: 'SCRAM-SHA-256' },
  tls: { enabled: true, caFiles: ['/etc/ssl/ispn-ca.pem'] },
}
export const registration = defineCacheProviderRegistration({
  id: provider.id,
  load: async () => provider,
  settings: () => infinispanSettingsSchema.parse(settings),
})
`

if (!skipUnlessContainers(SUITE)) {
  jest.setTimeout(600_000)
  let workDir = ''
  let appDir = ''
  let cluster: InfinispanCluster

  const run = (command: string, args: string[], cwd: string, env: Record<string, string> = {}) =>
    execFileSync(command, args, { cwd, stdio: 'pipe', timeout: 300_000, encoding: 'utf8', env: { ...process.env, TMPDIR: '/tmp', ...env } })

  beforeAll(async () => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'om-ispn-packed-'))
    const packDir = path.join(workDir, 'pack')
    mkdirSync(packDir)
    for (const directory of [SHARED_PACKAGE_DIR, CACHE_PACKAGE_DIR, PACKAGE_DIR]) {
      run('yarn', ['build'], directory)
      run('yarn', ['pack', '--out', path.join(packDir, '%s-%v.tgz')], directory)
    }
    const tarballs = readdirSync(packDir)
    const sharedTarball = tarballs.find((name) => name.startsWith('@open-mercato-shared-'))
    const cacheTarball = tarballs.find((name) => name.startsWith('@open-mercato-cache-0'))
    const providerTarball = tarballs.find((name) => name.startsWith('@open-mercato-cache-provider-infinispan'))
    if (!sharedTarball || !cacheTarball || !providerTarball) throw new Error(`[internal] missing tarballs: ${tarballs.join(', ')}`)

    appDir = path.join(workDir, 'app')
    mkdirSync(appDir)
    writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
      name: 'packed-infinispan-app',
      private: true,
      version: '0.0.0',
      type: 'module',
      dependencies: {
        '@open-mercato/shared': `file:${path.join(packDir, sharedTarball)}`,
        '@open-mercato/cache': `file:${path.join(packDir, cacheTarball)}`,
        '@open-mercato/cache-provider-infinispan': `file:${path.join(packDir, providerTarball)}`,
      },
    }, null, 2))
    run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock', '--legacy-peer-deps'], appDir)
    writeFileSync(path.join(appDir, 'smoke.mjs'), SMOKE_SCRIPT)
    writeFileSync(path.join(appDir, 'types-check.ts'), TYPES_SCRIPT)
    writeFileSync(path.join(appDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        esModuleInterop: true,
        types: ['node'],
        typeRoots: [path.join(REPO_ROOT, 'node_modules', '@types')],
      },
      files: ['types-check.ts'],
    }, null, 2))

    cluster = await startInfinispanCluster({ nodes: 1, tls: null, workDir })
    await cluster.createCache(CACHE_NAME)
  }, 900_000)

  afterAll(async () => {
    await cluster?.stop()
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  }, 120_000)

  describe(SUITE, () => {
    it('installs from tarballs without sibling adapters or workspace links', () => {
      const scope = path.join(appDir, 'node_modules', '@open-mercato')
      expect(readdirSync(scope).sort()).toEqual(['cache', 'cache-provider-infinispan', 'shared'])
      expect(readdirSync(scope).filter((name) => name.startsWith('cache-provider-'))).toEqual(['cache-provider-infinispan'])
      const installed = path.join(scope, 'cache-provider-infinispan')
      expect(readdirSync(installed).sort()).toEqual(['README.md', 'dist', 'package.json', 'src'])
      expect(existsSync(path.join(installed, 'src', '__tests__'))).toBe(false)
      expect(existsSync(path.join(appDir, 'node_modules', 'infinispan', 'package.json'))).toBe(true)
    })

    it('type-checks a registration against the installed package', () => {
      const tsc = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsc')
      expect(() => run(tsc, ['-p', 'tsconfig.json'], appDir)).not.toThrow()
    })

    it('resolves through a registration and runs a basic cache workflow on the real server', () => {
      const output = run(process.execPath, ['smoke.mjs'], appDir, {
        CACHE_PROVIDER: 'open-mercato/infinispan',
        CACHE_PROVIDER_NAMESPACE: `packed-${process.pid}`,
        SMOKE_SETTINGS: JSON.stringify({
          servers: cluster.servers,
          cacheName: CACHE_NAME,
          auth: { username: ADMIN_USER, password: ADMIN_PASSWORD, mechanism: 'SCRAM-SHA-256' },
          topologyUpdates: false,
        }),
      })
      expect(JSON.parse(output)).toEqual({
        id: 'open-mercato/infinispan',
        placement: 'shared',
        first: { name: 'Widget' },
        keys: ['product:1', 'product:2'],
        removed: 1,
        afterFeatured: ['product:1'],
        cleared: 1,
      })
    })
  })
}
