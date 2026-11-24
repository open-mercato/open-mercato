import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PackageResolver } from '../../resolver'
import {
  CACHE_PROVIDERS_CHECKSUM_FILE,
  CACHE_PROVIDERS_GENERATED_FILE,
  generateCacheProviders,
} from '../cache-providers'

let appDir: string
let outputDir: string

function createMockResolver(): PackageResolver {
  return {
    getAppDir: () => appDir,
    getOutputDir: () => outputDir,
  } as unknown as PackageResolver
}

function readGenerated(): string {
  return fs.readFileSync(path.join(outputDir, CACHE_PROVIDERS_GENERATED_FILE), 'utf8')
}

beforeEach(() => {
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-cache-providers-'))
  outputDir = path.join(appDir, '.mercato', 'generated')
})

afterEach(() => {
  fs.rmSync(appDir, { recursive: true, force: true })
})

describe('generateCacheProviders', () => {
  it('emits an empty typed manifest when the app has no mercato.cache file', async () => {
    const result = await generateCacheProviders({ resolver: createMockResolver(), quiet: true })

    const content = readGenerated()
    expect(result.filesWritten).toEqual([path.join(outputDir, CACHE_PROVIDERS_GENERATED_FILE)])
    expect(content).toContain("import type { CacheProviderRegistration } from '@open-mercato/cache/provider'")
    expect(content).toContain('export const cacheProviders: CacheProviderRegistration[] = []')
    expect(content).not.toContain('mercato.cache\'')
    expect(fs.existsSync(path.join(outputDir, CACHE_PROVIDERS_CHECKSUM_FILE))).toBe(true)
  })

  it('re-exports the app manifest through a literal extensionless relative import', async () => {
    fs.writeFileSync(path.join(appDir, 'mercato.cache.ts'), 'throw new Error("must not be evaluated")\n')

    await generateCacheProviders({ resolver: createMockResolver(), quiet: true })

    const content = readGenerated()
    expect(content).toContain("import { cacheProviders as appCacheProviders } from '../../mercato.cache'")
    expect(content).toContain('export const cacheProviders: CacheProviderRegistration[] = appCacheProviders')
    expect(path.resolve(outputDir, '../../mercato.cache.ts')).toBe(path.join(appDir, 'mercato.cache.ts'))
  })

  it('accepts a JavaScript manifest', async () => {
    fs.writeFileSync(path.join(appDir, 'mercato.cache.js'), 'export const cacheProviders = []\n')

    await generateCacheProviders({ resolver: createMockResolver(), quiet: true })

    expect(readGenerated()).toContain("from '../../mercato.cache'")
  })

  it('rejects ambiguous and unsupported manifest files', async () => {
    fs.writeFileSync(path.join(appDir, 'mercato.cache.ts'), '')
    fs.writeFileSync(path.join(appDir, 'mercato.cache.js'), '')
    await expect(generateCacheProviders({ resolver: createMockResolver(), quiet: true })).rejects.toThrow(
      /Multiple cache provider manifests/,
    )

    fs.rmSync(path.join(appDir, 'mercato.cache.js'))
    fs.writeFileSync(path.join(appDir, 'mercato.cache.mts'), '')
    await expect(generateCacheProviders({ resolver: createMockResolver(), quiet: true })).rejects.toThrow(
      /Unsupported cache provider manifest mercato\.cache\.mts/,
    )
  })

  it('is deterministic and leaves the output untouched on rerun', async () => {
    fs.writeFileSync(path.join(appDir, 'mercato.cache.ts'), 'export const cacheProviders = []\n')
    await generateCacheProviders({ resolver: createMockResolver(), quiet: true })
    const first = readGenerated()

    const rerun = await generateCacheProviders({ resolver: createMockResolver(), quiet: true })

    expect(rerun.filesWritten).toEqual([])
    expect(rerun.filesUnchanged).toEqual([path.join(outputDir, CACHE_PROVIDERS_GENERATED_FILE)])
    expect(readGenerated()).toBe(first)
  })

  it('switches back to the empty manifest when the app file is removed', async () => {
    fs.writeFileSync(path.join(appDir, 'mercato.cache.ts'), 'export const cacheProviders = []\n')
    await generateCacheProviders({ resolver: createMockResolver(), quiet: true })
    fs.rmSync(path.join(appDir, 'mercato.cache.ts'))

    const result = await generateCacheProviders({ resolver: createMockResolver(), quiet: true })

    expect(result.filesWritten).toHaveLength(1)
    expect(readGenerated()).toContain('export const cacheProviders: CacheProviderRegistration[] = []')
  })
})
