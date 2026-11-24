import fs from 'node:fs'
import path from 'node:path'
import { componentPortability, componentPortabilitySchema } from '../portability'

const repoRoot = path.resolve(__dirname, '../../../../../..')

describe('component portability inventory', () => {
  it('every entry matches the schema', () => {
    for (const entry of componentPortability) {
      const result = componentPortabilitySchema.safeParse(entry)
      expect({ id: entry.id, success: result.success }).toEqual({ id: entry.id, success: true })
    }
  })

  it('ids are unique', () => {
    const ids = componentPortability.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every source path exists in the repository', () => {
    const missing = componentPortability
      .map((entry) => entry.sourcePath)
      .filter((sourcePath) => !fs.existsSync(path.join(repoRoot, sourcePath)))
    expect(missing).toEqual([])
  })

  it('public exports declare an import path and module examples do not', () => {
    for (const entry of componentPortability) {
      expect({ id: entry.id, hasImport: entry.importPath !== undefined }).toEqual({
        id: entry.id,
        hasImport: entry.availability === 'public-export',
      })
    }
  })
})
