import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomNamespace } from '@open-mercato/cache/testing/conformance'
import { CACHE_HOST_WORKSPACES, packCacheWorkspaces } from '../../../cache/fixtures/packed-workspaces'
import { containerTestsEnabled, PACKAGE_DIR, startIgnite, type StartedIgnite } from './support/ignite-container'

const describeContainer = containerTestsEnabled ? describe : describe.skip
const PACKAGE_NAME = '@open-mercato/cache-provider-ignite'

const APP_SCRIPT = `
import { defineCacheProviderRegistration, resolveCacheProvider, createCacheService, runWithCacheTenant } from '@open-mercato/cache'

export const cacheProviders = [
  defineCacheProviderRegistration({
    id: 'open-mercato/ignite',
    load: () => import('${PACKAGE_NAME}').then((module) => module.provider),
    settings: () => ({ endpoints: [process.env.IGNITE_ENDPOINT], commandTimeoutMs: 10000 }),
  }),
]

const resolved = await resolveCacheProvider(cacheProviders, { env: process.env })
const cache = createCacheService({ provider: resolved })
const report = { id: resolved.id, placement: resolved.placement, namespace: resolved.namespace }
await cache.healthcheck()
await runWithCacheTenant('tenant-a', async () => {
  await cache.set('product:1', { name: 'Kettle', price: 42 }, { tags: ['products', 'product:1'] })
  await cache.set('product:2', { name: 'Mug', price: 7 }, { tags: ['products'] })
  await cache.set('session', 'short', { ttl: 200 })
  report.hit = await cache.get('product:1')
  report.keys = (await cache.keys('product:*')).sort()
  report.stats = await cache.stats()
  report.invalidated = await cache.deleteByTags(['product:1'])
  report.afterInvalidation = await cache.get('product:1')
  await new Promise((resolve) => setTimeout(resolve, 400))
  report.expired = await cache.get('session')
  report.cleanup = await cache.cleanup()
  report.cleared = await cache.clear()
  report.remaining = await cache.keys()
})
await cache.close()
await cache.close()
process.stdout.write(JSON.stringify(report))
`

const APP_TYPES = `
import { provider, igniteCacheProviderSettingsSchema, IGNITE_PROVIDER_ID, type IgniteCacheProviderSettingsInput, type IgniteCacheProviderConfig } from '${PACKAGE_NAME}'
import type { CacheProviderDefinition } from '@open-mercato/cache/provider'

const settings: IgniteCacheProviderSettingsInput = { endpoints: ['ignite:10800'], tls: { ca: '-----BEGIN CERTIFICATE-----' } }
const parsed = igniteCacheProviderSettingsSchema.safeParse(settings)
const definition: CacheProviderDefinition<IgniteCacheProviderConfig> = provider
const id: string = IGNITE_PROVIDER_ID
export const checks = [parsed.success, definition.id, id]
`

describeContainer('packed @open-mercato/cache-provider-ignite installed into a fresh app', () => {
  let ignite: StartedIgnite
  let workDir = ''
  let appDir = ''
  let tarball = ''

  beforeAll(async () => {
    ignite = await startIgnite()
    workDir = mkdtempSync(path.join(os.tmpdir(), 'om-ignite-packed-'))
    const packDir = path.join(workDir, 'pack')
    mkdirSync(packDir, { recursive: true })
    const tarballs = packCacheWorkspaces(packDir, [...CACHE_HOST_WORKSPACES, 'cache-provider-ignite'])
    tarball = tarballs['cache-provider-ignite']
    appDir = path.join(workDir, 'app')
    mkdirSync(appDir, { recursive: true })
    writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'ignite-consumer-app', private: true, version: '0.0.0', type: 'module' }))
    execFileSync('npm', ['install', ...Object.values(tarballs), '--no-audit', '--no-fund', '--legacy-peer-deps', '--ignore-scripts', '--no-package-lock'], {
      cwd: appDir,
      stdio: 'pipe',
      timeout: 300_000,
    })
    writeFileSync(path.join(appDir, 'app.mjs'), APP_SCRIPT)
    writeFileSync(path.join(appDir, 'consumer.ts'), APP_TYPES)
  }, 600_000)

  afterAll(async () => {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
    await ignite?.container.stop()
  }, 60_000)

  it('ships only built ESM, declarations, the docker recipe and docs', () => {
    const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n').filter(Boolean).sort()
    expect(listing).toEqual(expect.arrayContaining([
      'package/package.json',
      'package/README.md',
      'package/dist/index.js',
      'package/dist/index.d.ts',
      'package/docker/ignite-config.xml',
      'package/docker/ignite-secure-config.xml',
    ]))
    expect(listing.filter((entry) => entry.includes('__tests__') || entry.startsWith('package/src/'))).toEqual([])
  })

  it('installs outside the workspace without sibling adapters', () => {
    const installed = path.join(appDir, 'node_modules', '@open-mercato')
    expect(readdirSync(installed).sort()).toEqual([...CACHE_HOST_WORKSPACES, 'cache-provider-ignite'].sort())
    expect(existsSync(path.join(appDir, 'node_modules', 'apache-ignite-client', 'package.json'))).toBe(true)
  })

  it('selects the provider through a registration and runs a cache workflow against Ignite', () => {
    const namespace = randomNamespace('packed')
    const output = execFileSync(process.execPath, ['app.mjs'], {
      cwd: appDir,
      env: { ...process.env, CACHE_PROVIDER: 'open-mercato/ignite', CACHE_PROVIDER_NAMESPACE: namespace, IGNITE_ENDPOINT: ignite.endpoint },
      encoding: 'utf8',
      timeout: 120_000,
    })
    expect(JSON.parse(output)).toEqual({
      id: 'open-mercato/ignite',
      placement: 'shared',
      namespace,
      hit: { name: 'Kettle', price: 42 },
      keys: ['product:1', 'product:2'],
      stats: { size: 3, expired: 0 },
      invalidated: 1,
      afterInvalidation: null,
      expired: null,
      cleanup: 1,
      cleared: 1,
      remaining: [],
    })
  }, 180_000)

  it('type-checks consumer code against the packed declarations', () => {
    const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
    const output = (() => {
      try {
        return execFileSync(process.execPath, [
          tsc, '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', '--moduleResolution', 'nodenext',
          '--target', 'es2022', '--types', 'node', '--typeRoots', path.resolve(PACKAGE_DIR, '../../node_modules/@types'), 'consumer.ts',
        ], { cwd: appDir, encoding: 'utf8', stdio: 'pipe', timeout: 180_000 })
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string }
        return `FAILED\n${failure.stdout ?? ''}${failure.stderr ?? ''}`
      }
    })()
    expect(output).toBe('')
  }, 240_000)
})
