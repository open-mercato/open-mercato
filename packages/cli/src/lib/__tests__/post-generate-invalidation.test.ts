import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { purgeConfiguredCachePatternsAcrossTenantScopes } from '@open-mercato/shared/lib/cache/maintenance'
import {
  CacheProviderError,
  prepareCacheProviderSelection,
} from '@open-mercato/shared/lib/cache/providers'
import { loadCacheProviderManifest } from '../cache-provider-manifest'
import { runPostGenerateStructuralInvalidation } from '../post-generate-invalidation'

jest.mock('@open-mercato/shared/lib/cache/maintenance', () => ({
  purgeConfiguredCachePatternsAcrossTenantScopes: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/cache/providers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/cache/providers')
  return { ...actual, prepareCacheProviderSelection: jest.fn() }
})
jest.mock('../cache-provider-manifest', () => ({ loadCacheProviderManifest: jest.fn() }))

const purgeCache = jest.mocked(purgeConfiguredCachePatternsAcrossTenantScopes)
const prepareSelection = jest.mocked(prepareCacheProviderSelection)
const loadManifest = jest.mocked(loadCacheProviderManifest)
const STRUCTURAL_PATTERNS = ['nav:*', 'crud|*|*|*/admin/nav|*', 'crud|*|*|*/portal/nav|*']

describe('runPostGenerateStructuralInvalidation', () => {
  const originalProvider = process.env.CACHE_PROVIDER

  beforeEach(() => {
    purgeCache.mockReset().mockResolvedValue(3)
    prepareSelection.mockReset().mockResolvedValue(null)
    loadManifest.mockReset().mockResolvedValue([])
    delete process.env.CACHE_PROVIDER
  })

  afterAll(() => {
    if (originalProvider === undefined) delete process.env.CACHE_PROVIDER
    else process.env.CACHE_PROVIDER = originalProvider
  })

  it('never touches provider loading when no cache provider is selected', async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-generate-invalidation-stock-'))
    try {
      const result = await runPostGenerateStructuralInvalidation(appDir)
      expect(result.cacheEntriesDeleted).toBe(3)
      expect(loadManifest).not.toHaveBeenCalled()
      expect(prepareSelection).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  it('loads the generated manifest and prepares the selected provider before purging', async () => {
    process.env.CACHE_PROVIDER = 'acme/fake'
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-generate-invalidation-provider-'))
    const calls: string[] = []
    loadManifest.mockImplementation(async () => { calls.push('load'); return [] })
    prepareSelection.mockImplementation(async () => { calls.push('prepare'); return null })
    purgeCache.mockImplementation(async () => { calls.push('purge'); return 5 })
    try {
      const result = await runPostGenerateStructuralInvalidation(appDir)
      expect(loadManifest).toHaveBeenCalledWith(appDir)
      expect(calls).toEqual(['load', 'prepare', 'purge'])
      expect(purgeCache).toHaveBeenCalledWith(STRUCTURAL_PATTERNS)
      expect(result.cacheEntriesDeleted).toBe(5)
      expect(result.cacheError).toBeNull()
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  it('reports a provider selection failure through cacheError and still refreshes artifacts', async () => {
    process.env.CACHE_PROVIDER = 'acme/fake'
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-generate-invalidation-provider-fail-'))
    const selectionError = new CacheProviderError('not_registered', 'Cache provider "acme/fake" is selected but not registered by the application')
    prepareSelection.mockRejectedValue(selectionError)
    try {
      const generatedDir = path.join(appDir, '.mercato', 'generated')
      fs.mkdirSync(generatedDir, { recursive: true })
      const generatedTs = path.join(generatedDir, 'modules.generated.ts')
      fs.writeFileSync(generatedTs, 'export {}\n')

      const result = await runPostGenerateStructuralInvalidation(appDir)

      expect(result.cacheError).toBe(selectionError)
      expect(result.cacheEntriesDeleted).toBe(0)
      expect(purgeCache).not.toHaveBeenCalled()
      expect(result.generatedFilesTouched).toEqual([generatedTs])
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  it('sanitizes raw driver failures from the provider purge', async () => {
    process.env.CACHE_PROVIDER = 'acme/fake'
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-generate-invalidation-provider-sanitize-'))
    purgeCache.mockRejectedValue(new Error('connect ECONNREFUSED rediss://user:secret@cache.internal:6380'))
    try {
      const result = await runPostGenerateStructuralInvalidation(appDir)

      expect(result.cacheError).toBeInstanceOf(CacheProviderError)
      expect((result.cacheError as CacheProviderError).code).toBe('unavailable')
      expect((result.cacheError as Error).message).not.toContain('secret')
      expect(JSON.stringify(result.cacheError)).not.toContain('secret')
      expect((result.cacheError as { cause?: unknown }).cause).toBeUndefined()
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  it('reports a manifest load failure through cacheError without purging', async () => {
    process.env.CACHE_PROVIDER = 'acme/fake'
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-generate-invalidation-manifest-fail-'))
    loadManifest.mockRejectedValue(new Error('mercato.cache.ts failed to compile'))
    try {
      const result = await runPostGenerateStructuralInvalidation(appDir)

      expect(result.cacheError).toBeInstanceOf(CacheProviderError)
      expect(prepareSelection).not.toHaveBeenCalled()
      expect(purgeCache).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  it('purges structural cache patterns and refreshes only generated artifacts', async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-generate-invalidation-'))
    try {
      const generatedDir = path.join(appDir, '.mercato', 'generated')
      fs.mkdirSync(generatedDir, { recursive: true })
      const generatedTs = path.join(generatedDir, 'modules.app.generated.ts')
      const generatedChecksum = path.join(generatedDir, 'modules.app.generated.checksum')
      const unrelated = path.join(generatedDir, 'README.md')
      fs.writeFileSync(generatedTs, 'export const modules = []\n')
      fs.writeFileSync(generatedChecksum, 'abc\n')
      fs.writeFileSync(unrelated, 'keep\n')

      const result = await runPostGenerateStructuralInvalidation(appDir)

      expect(purgeCache).toHaveBeenCalledWith([
        'nav:*',
        'crud|*|*|*/admin/nav|*',
        'crud|*|*|*/portal/nav|*',
      ])
      expect(result).toEqual({
        cacheEntriesDeleted: 3,
        generatedFilesTouched: [generatedChecksum, generatedTs],
        cacheError: null,
        generatedFilesError: null,
      })
      expect(fs.readFileSync(generatedTs, 'utf8')).toBe('export const modules = []\n')
      expect(fs.readFileSync(unrelated, 'utf8')).toBe('keep\n')
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  it('advances mtime without reopening generated artifacts for writing', async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-generate-invalidation-mtime-'))
    try {
      const generatedDir = path.join(appDir, '.mercato', 'generated')
      fs.mkdirSync(generatedDir, { recursive: true })
      const generatedTs = path.join(generatedDir, 'modules.generated.ts')
      fs.writeFileSync(generatedTs, 'export const modules = []\n')
      const staleTime = new Date(Date.now() - 60_000)
      fs.utimesSync(generatedTs, staleTime, staleTime)
      const before = fs.statSync(generatedTs)

      await runPostGenerateStructuralInvalidation(appDir)

      const after = fs.statSync(generatedTs)
      expect(after.mtimeMs).toBeGreaterThan(before.mtimeMs)
      expect(after.size).toBe(before.size)
      // ctime advances on a metadata-only touch; a rewrite would also bump the
      // inode's write generation, so assert the content survived byte for byte.
      expect(fs.readFileSync(generatedTs, 'utf8')).toBe('export const modules = []\n')
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  it('still refreshes generated artifacts when cache maintenance fails', async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-generate-invalidation-failure-'))
    const error = new Error('cache unavailable')
    try {
      const generatedDir = path.join(appDir, '.mercato', 'generated')
      fs.mkdirSync(generatedDir, { recursive: true })
      const generatedTs = path.join(generatedDir, 'modules.generated.ts')
      fs.writeFileSync(generatedTs, 'export {}\n')
      purgeCache.mockRejectedValueOnce(error)

      const result = await runPostGenerateStructuralInvalidation(appDir)

      expect(result.cacheEntriesDeleted).toBe(0)
      expect(result.cacheError).toBe(error)
      expect(result.generatedFilesTouched).toEqual([generatedTs])
      expect(result.generatedFilesError).toBeNull()
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  it('treats a missing generated directory as a successful no-op', async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-generate-invalidation-empty-'))
    try {
      const result = await runPostGenerateStructuralInvalidation(appDir)
      expect(result.generatedFilesTouched).toEqual([])
      expect(result.generatedFilesError).toBeNull()
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })
})
