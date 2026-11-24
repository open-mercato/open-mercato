import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  CacheProviderError,
  defineCacheProviderRegistration,
  resolveCacheProvider,
  type CacheProviderDefinition,
  type CacheProviderSettingsSchema,
  type ResolvedCacheProvider,
} from '../provider'
import { createCacheService } from '../service'
import { defineCacheProviderConformance } from '../testing/conformance'
import { spawnConformanceRemoteProcess } from '../testing/remote'

type FixtureConfig = { directory: string; maxBatch: number }

type FixtureModule = {
  provider: CacheProviderDefinition<FixtureConfig>
  settings: CacheProviderSettingsSchema<FixtureConfig>
  fixtureEntryPath(directory: string, namespace: string, physicalKey: string): string
}

const PROVIDER_ID = 'acme/fixture-fs'
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures')
const FIXTURE_PACKAGE_DIR = path.join(FIXTURES_DIR, 'cache-provider-fixture')
const CHILD_RUNNER = path.join(FIXTURES_DIR, 'conformance-child.mjs')
const HOST_BUILDER = path.join(FIXTURES_DIR, 'build-conformance-host.mjs')
const SETUP_TIMEOUT_MS = 180_000

jest.setTimeout(120_000)

let workDir = ''
let dataDir = ''
let hostModule = ''
let providerEntry = ''
let installMode: 'npm' | 'tar' = 'tar'

function installTarball(tarball: string, appDir: string): 'npm' | 'tar' {
  try {
    execFileSync('npm', [
      'install',
      tarball,
      '--no-save',
      '--no-package-lock',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--offline',
      '--legacy-peer-deps',
    ], { cwd: appDir, stdio: 'pipe', timeout: 60_000 })
    if (existsSync(path.join(appDir, 'node_modules', '@acme', 'cache-provider-fixture', 'package.json'))) return 'npm'
  } catch {
    // offline installs may be refused; fall back to extracting the tarball
  }
  const target = path.join(appDir, 'node_modules', '@acme', 'cache-provider-fixture')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  execFileSync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1'], { stdio: 'pipe' })
  return 'tar'
}

async function loadFixture(): Promise<FixtureModule> {
  return (await import(providerEntry)) as FixtureModule
}

function fixtureRegistration(settings: () => unknown = () => ({ directory: dataDir, maxBatch: 128 })) {
  return defineCacheProviderRegistration<FixtureConfig>({
    id: PROVIDER_ID,
    load: () => loadFixture().then((module) => module.provider),
    settings,
  })
}

async function resolveFixture(namespace: string): Promise<ResolvedCacheProvider> {
  const resolved = await resolveCacheProvider([fixtureRegistration()], {
    env: { CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: namespace },
  })
  if (!resolved) throw new Error('[internal] fixture provider was not selected')
  return resolved
}

beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'om-cache-provider-fixture-'))
  dataDir = path.join(workDir, 'data')
  mkdirSync(dataDir, { recursive: true })

  const packDir = path.join(workDir, 'pack')
  mkdirSync(packDir, { recursive: true })
  execFileSync('npm', ['pack', '--pack-destination', packDir, '--ignore-scripts', '--silent'], {
    cwd: FIXTURE_PACKAGE_DIR,
    stdio: 'pipe',
    timeout: 60_000,
  })
  const tarball = readdirSync(packDir).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('[internal] npm pack produced no tarball')

  const appDir = path.join(workDir, 'app')
  mkdirSync(appDir, { recursive: true })
  writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'conformance-app', private: true, version: '0.0.0' }))
  installMode = installTarball(path.join(packDir, tarball), appDir)
  providerEntry = path.join(appDir, 'node_modules', '@acme', 'cache-provider-fixture', 'index.js')

  hostModule = path.join(workDir, 'host', 'conformance-host.mjs')
  execFileSync(process.execPath, [HOST_BUILDER, hostModule], { stdio: 'pipe', timeout: 120_000 })
}, SETUP_TIMEOUT_MS)

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

describe('packed fixture provider installation', () => {
  it('installs only the packed files outside the workspace', () => {
    const installedDir = path.dirname(providerEntry)
    expect(['npm', 'tar']).toContain(installMode)
    expect(installedDir.startsWith(workDir)).toBe(true)
    expect(readdirSync(installedDir).sort()).toEqual(['index.d.ts', 'index.js', 'package.json'])
  })

  it('resolves through a registration with shared placement and validated settings', async () => {
    const resolved = await resolveFixture('fixture-ns')
    expect(resolved.id).toBe(PROVIDER_ID)
    expect(resolved.placement).toBe('shared')
    expect(resolved.namespace).toBe('fixture-ns')
    expect(resolved.config).toEqual({ directory: dataDir, maxBatch: 128 })
  })

  it('rejects invalid settings with field paths from the hand-written schema', async () => {
    const registration = fixtureRegistration(() => ({ directory: 'relative/path', maxBatch: 0, extra: true }))
    await expect(resolveCacheProvider([registration], {
      env: { CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'fixture-ns' },
    })).rejects.toMatchObject({
      code: 'invalid_settings',
      fieldPaths: expect.arrayContaining(['directory', 'maxBatch', 'extra']),
    })
    await expect(resolveCacheProvider([fixtureRegistration(() => ({}))], {
      env: { CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'fixture-ns' },
    })).rejects.toBeInstanceOf(CacheProviderError)
  })

  it('stores one file per physical key under a namespace subdirectory', async () => {
    const service = createCacheService({ provider: await resolveFixture('layout-ns') })
    try {
      await service.set('layout-key', { ok: true })
      const files = (await fs.readdir(path.join(dataDir, 'ns-layout-ns'))).filter((name) => name.endsWith('.json'))
      expect(files).toHaveLength(2)
    } finally {
      await service.clear()
      await service.close?.()
    }
  })
})

defineCacheProviderConformance({
  name: `${PROVIDER_ID} (packed tarball)`,
  createService: async (namespace, options) => createCacheService({
    provider: await resolveFixture(namespace),
    ...(options?.defaultTtl !== undefined ? { defaultTtl: options.defaultTtl } : {}),
  }),
  createIndependentProcess: (namespace) => spawnConformanceRemoteProcess({
    command: process.execPath,
    args: [CHILD_RUNNER],
    env: {
      CACHE_CONFORMANCE_HOST: hostModule,
      CACHE_CONFORMANCE_PROVIDER_ENTRY: providerEntry,
      CACHE_CONFORMANCE_DIRECTORY: dataDir,
      CACHE_PROVIDER: PROVIDER_ID,
      CACHE_PROVIDER_NAMESPACE: namespace,
    },
  }),
  corrupt: async ({ namespace, physicalKey }) => {
    const fixture = await loadFixture()
    await fs.writeFile(fixture.fixtureEntryPath(dataDir, namespace, physicalKey), '{"v":1,"key":', 'utf8')
  },
  supportsReturnExpired: true,
})
