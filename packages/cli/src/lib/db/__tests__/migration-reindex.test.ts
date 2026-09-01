import path from 'node:path'
import {
  collectQueryIndexReindexEntityTypes,
  formatManualReindexInstructions,
  isMigrationReindexEnabled,
  requestQueryIndexReindex,
  resolveMigrationFilePath,
  type AppliedMigration,
} from '../migration-reindex'

const MIGRATIONS_PATH = '/repo/packages/core/src/modules/customers/migrations'

function migration(name: string, overrides: Partial<AppliedMigration> = {}): AppliedMigration {
  return { moduleId: 'customers', migrationsPath: MIGRATIONS_PATH, name, ...overrides }
}

describe('resolveMigrationFilePath', () => {
  const existing = new Set([path.join(MIGRATIONS_PATH, 'Migration20260901120000_reindex.ts')])
  const fileExists = (filePath: string) => existing.has(filePath)

  it('resolves a bare migration name to its source file', () => {
    expect(resolveMigrationFilePath(MIGRATIONS_PATH, 'Migration20260901120000_reindex', null, fileExists))
      .toBe(path.join(MIGRATIONS_PATH, 'Migration20260901120000_reindex.ts'))
  })

  it('accepts a name that already carries its extension', () => {
    expect(resolveMigrationFilePath(MIGRATIONS_PATH, 'Migration20260901120000_reindex.js', null, fileExists))
      .toBe(path.join(MIGRATIONS_PATH, 'Migration20260901120000_reindex.ts'))
  })

  it('prefers a path the migrator already resolved', () => {
    const known = path.join(MIGRATIONS_PATH, 'Migration20260901120000_reindex.ts')
    expect(resolveMigrationFilePath(MIGRATIONS_PATH, 'anything', known, fileExists)).toBe(known)
  })

  it('keeps a directory-qualified migration name inside the migrations directory', () => {
    expect(resolveMigrationFilePath(MIGRATIONS_PATH, '../../../etc/passwd', null, () => true))
      .toBe(path.join(MIGRATIONS_PATH, 'passwd.ts'))
  })

  it('refuses names that survive basename but are not a plausible file name', () => {
    expect(resolveMigrationFilePath(MIGRATIONS_PATH, 'migration name; rm -rf /', null, () => true)).toBeNull()
  })

  it('returns null when no file backs the migration name', () => {
    expect(resolveMigrationFilePath(MIGRATIONS_PATH, 'Migration20990101000000', null, fileExists)).toBeNull()
  })
})

describe('collectQueryIndexReindexEntityTypes', () => {
  const fileExists = () => true

  it('collects declarations across modules and deduplicates them', async () => {
    const modules: Record<string, unknown> = {
      [path.join(MIGRATIONS_PATH, 'a.ts')]: { queryIndexReindexEntityTypes: ['customers:customer_dictionary_entry'] },
      [path.join(MIGRATIONS_PATH, 'b.ts')]: {
        queryIndexReindexEntityTypes: ['customers:customer_dictionary_entry', 'workflows:workflow_definition'],
      },
      [path.join(MIGRATIONS_PATH, 'c.ts')]: {},
    }

    const collected = await collectQueryIndexReindexEntityTypes(
      [migration('a'), migration('b'), migration('c')],
      { importModule: async (filePath) => modules[filePath], fileExists },
    )

    expect(collected).toEqual(['customers:customer_dictionary_entry', 'workflows:workflow_definition'])
  })

  it('warns and keeps going when a migration file cannot be imported', async () => {
    const onWarn = jest.fn()
    const collected = await collectQueryIndexReindexEntityTypes(
      [migration('broken'), migration('good')],
      {
        fileExists,
        onWarn,
        importModule: async (filePath) => {
          if (filePath.endsWith('broken.ts')) throw new Error('boom')
          return { queryIndexReindexEntityTypes: ['dictionaries:dictionary_entry'] }
        },
      },
    )

    expect(collected).toEqual(['dictionaries:dictionary_entry'])
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('customers/broken'))
  })

  it('skips migrations whose file is gone', async () => {
    const importModule = jest.fn()
    const collected = await collectQueryIndexReindexEntityTypes(
      [migration('missing')],
      { importModule, fileExists: () => false },
    )

    expect(collected).toEqual([])
    expect(importModule).not.toHaveBeenCalled()
  })
})

describe('isMigrationReindexEnabled', () => {
  it('is on by default and opts out on an explicit falsy token', () => {
    expect(isMigrationReindexEnabled({})).toBe(true)
    expect(isMigrationReindexEnabled({ OM_MIGRATION_REINDEX: 'off' })).toBe(false)
    expect(isMigrationReindexEnabled({ OM_MIGRATION_REINDEX: 'false' })).toBe(false)
    expect(isMigrationReindexEnabled({ OM_MIGRATION_REINDEX: 'true' })).toBe(true)
  })
})

describe('requestQueryIndexReindex', () => {
  it('queues one persistent in-place reindex per entity type', async () => {
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const dispose = jest.fn().mockResolvedValue(undefined)

    const result = await requestQueryIndexReindex(
      ['customers:customer_dictionary_entry', 'workflows:workflow_definition'],
      { createContainer: async () => ({ resolve: () => ({ emitEvent }), dispose }) },
    )

    expect(result).toEqual({
      requested: ['customers:customer_dictionary_entry', 'workflows:workflow_definition'],
      queued: true,
    })
    expect(emitEvent).toHaveBeenCalledTimes(2)
    expect(emitEvent).toHaveBeenNthCalledWith(
      1,
      'query_index.reindex',
      { entityType: 'customers:customer_dictionary_entry', allowAllTenants: true, force: false },
      { persistent: true },
    )
    expect(dispose).toHaveBeenCalled()
  })

  it('does nothing when no migration declared a reindex', async () => {
    const createContainer = jest.fn()
    await expect(requestQueryIndexReindex([], { createContainer })).resolves.toEqual({ requested: [], queued: false })
    expect(createContainer).not.toHaveBeenCalled()
  })

  it('degrades to a manual-command warning instead of failing the migration run', async () => {
    const onWarn = jest.fn()

    const result = await requestQueryIndexReindex(['customers:deal'], {
      onWarn,
      createContainer: async () => {
        throw new Error('no event bus here')
      },
    })

    expect(result).toEqual({ requested: [], queued: false })
    expect(onWarn).toHaveBeenCalledTimes(1)
    const warning = onWarn.mock.calls[0][0] as string
    expect(warning).toContain('mercato query_index rebuild --entity customers:deal --global')
    expect(warning).toContain('no event bus here')
  })

  it('names only the entity types that did not make it into the queue', async () => {
    const onWarn = jest.fn()
    const emitEvent = jest.fn(async (_event: string, payload: Record<string, unknown>) => {
      if (payload.entityType === 'workflows:workflow_definition') throw new Error('queue went away')
    })

    const result = await requestQueryIndexReindex(
      ['customers:deal', 'workflows:workflow_definition'],
      { onWarn, createContainer: async () => ({ resolve: () => ({ emitEvent }) }) },
    )

    expect(result).toEqual({ requested: ['customers:deal'], queued: false })
    const warning = onWarn.mock.calls[0][0] as string
    expect(warning).toContain('mercato query_index rebuild --entity workflows:workflow_definition --global')
    expect(warning).not.toContain('--entity customers:deal')
  })
})

describe('formatManualReindexInstructions', () => {
  it('lists one rebuild command per entity type', () => {
    const message = formatManualReindexInstructions(['customers:deal', 'workflows:workflow_definition'])
    expect(message).toContain('mercato query_index rebuild --entity customers:deal --global')
    expect(message).toContain('mercato query_index rebuild --entity workflows:workflow_definition --global')
  })
})
