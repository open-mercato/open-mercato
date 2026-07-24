import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { purgeConfiguredCachePatternsAcrossTenantScopes } from '@open-mercato/shared/lib/cache/maintenance'
import { runPostGenerateStructuralInvalidation } from '../post-generate-invalidation'

jest.mock('@open-mercato/shared/lib/cache/maintenance', () => ({
  purgeConfiguredCachePatternsAcrossTenantScopes: jest.fn(),
}))

const purgeCache = jest.mocked(purgeConfiguredCachePatternsAcrossTenantScopes)

describe('runPostGenerateStructuralInvalidation', () => {
  beforeEach(() => {
    purgeCache.mockReset().mockResolvedValue(3)
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
