import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getCacheProviderRegistrations,
  setCacheProviderRegistrations,
} from '@open-mercato/cache/provider'
import type { PackageResolver } from '../resolver'
import { generateCacheProviders } from '../generators/cache-providers'
import { loadCacheProviderManifest } from '../cache-provider-manifest'

let appDir: string

function createMockResolver(): PackageResolver {
  return {
    getAppDir: () => appDir,
    getOutputDir: () => path.join(appDir, '.mercato', 'generated'),
  } as unknown as PackageResolver
}

beforeEach(() => {
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-cache-manifest-'))
  fs.mkdirSync(path.join(appDir, 'src/providers'), { recursive: true })
  fs.writeFileSync(
    path.join(appDir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', strict: true } }),
  )
  setCacheProviderRegistrations([{ id: 'stale/provider', load: async () => { throw new Error('unused') }, settings: () => ({}) }])
})

afterEach(() => {
  setCacheProviderRegistrations([])
  fs.rmSync(appDir, { recursive: true, force: true })
})

describe('loadCacheProviderManifest', () => {
  it('registers and returns an empty list when the generated manifest is missing', async () => {
    await expect(loadCacheProviderManifest(appDir)).resolves.toEqual([])
    expect(getCacheProviderRegistrations()).toEqual([])
  })

  it('loads the empty generated manifest', async () => {
    await generateCacheProviders({ resolver: createMockResolver(), quiet: true })

    await expect(loadCacheProviderManifest(appDir)).resolves.toEqual([])
    expect(getCacheProviderRegistrations()).toEqual([])
  })

  it('loads the app manifest through the generated re-export and registers it', async () => {
    fs.writeFileSync(
      path.join(appDir, 'src/providers/cache.ts'),
      [
        "import type { CacheProviderRegistration } from '@open-mercato/cache/provider'",
        'export const cacheProviders: CacheProviderRegistration[] = [',
        "  { id: 'acme/fixture', load: async () => { throw new Error('not loaded in this test') }, settings: () => ({ dir: '/tmp/x' }) },",
        ']',
        '',
      ].join('\n'),
    )
    await generateCacheProviders({ resolver: createMockResolver(), quiet: true })

    const registrations = await loadCacheProviderManifest(appDir)

    expect(registrations.map((registration) => registration.id)).toEqual(['acme/fixture'])
    expect(registrations[0].settings()).toEqual({ dir: '/tmp/x' })
    expect(getCacheProviderRegistrations().map((registration) => registration.id)).toEqual(['acme/fixture'])
  })

  it('rejects a generated manifest that does not export a cacheProviders array', async () => {
    const generatedDir = path.join(appDir, '.mercato', 'generated')
    fs.mkdirSync(generatedDir, { recursive: true })
    fs.writeFileSync(path.join(generatedDir, 'cache-providers.generated.ts'), 'export const cacheProviders = {}\n')

    await expect(loadCacheProviderManifest(appDir)).rejects.toThrow(/must export a cacheProviders array/)
  })
})
