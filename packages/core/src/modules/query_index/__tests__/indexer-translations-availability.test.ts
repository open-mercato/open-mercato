import type { EntityManager } from '@mikro-orm/postgresql'
import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { buildIndexDoc } from '../lib/indexer'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/modules/registry'),
  tryGetModules: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))
jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: () => null,
}))

const recordId = '77777777-7777-4777-8777-777777777777'
const params = { entityType: 'availability:widget', recordId }
const translatedRow = { translations: { fr: { title: 'Traduit' } } }
const missingTableError = new Error('[internal] relation "entity_translations" does not exist')

function createEntityManager(options: {
  translationsDiscovered?: boolean
  dictionaryMetadata?: boolean
  translationsError?: Error
} = {}) {
  const metadataEntries = [
    { className: 'Widget', tableName: 'availability_widgets' },
    ...(options.translationsDiscovered ? [{ className: 'EntityTranslation', tableName: 'entity_translations' }] : []),
  ]
  const metadata = options.dictionaryMetadata
    ? Object.fromEntries(metadataEntries.map((entry) => [entry.className, entry]))
    : new Map(metadataEntries.map((entry) => [entry.className, entry]))
  const selectFrom = jest.fn((table: string) => {
    const query = {
      select: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue([]),
      executeTakeFirst: jest.fn(async () => {
        if (table === 'availability_widgets') return { id: recordId, title: 'Base title' }
        if (table === 'entity_translations') {
          if (options.translationsError) throw options.translationsError
          return translatedRow
        }
        return undefined
      }),
    }
    return query
  })
  const db = { selectFrom }
  const em = {
    getKysely: () => db,
    getMetadata: () => ({ getAll: () => metadata }),
  } as unknown as EntityManager
  return { em, db, selectFrom }
}

describe('buildIndexDoc optional translations availability', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(tryGetModules).mockReturnValue(null)
  })

  it('skips absent translation storage when the runtime module registry is unavailable', async () => {
    const { em, selectFrom } = createEntityManager({ translationsError: missingTableError })

    const doc = await buildIndexDoc(em, params)

    expect(doc?.title).toBe('Base title')
    expect(selectFrom).not.toHaveBeenCalledWith('entity_translations')
    expect(recordIndexerError).not.toHaveBeenCalled()
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it.each([{ modules: [] }, { modules: [{ id: 'query_index' }] }])('honors a registered module list without translations: $modules', async ({ modules }) => {
    jest.mocked(tryGetModules).mockReturnValue(modules)
    const { em, selectFrom } = createEntityManager({ translationsDiscovered: true })

    const doc = await buildIndexDoc(em, params)

    expect(doc?.title).toBe('Base title')
    expect(selectFrom).not.toHaveBeenCalledWith('entity_translations')
    expect(recordIndexerError).not.toHaveBeenCalled()
  })

  it.each([false, true])('hydrates discovered translations without a runtime registry (dictionary metadata: %s)', async (dictionaryMetadata) => {
    const { em, selectFrom } = createEntityManager({ translationsDiscovered: true, dictionaryMetadata })

    const doc = await buildIndexDoc(em, params)

    expect(selectFrom).toHaveBeenCalledWith('entity_translations')
    expect(doc?.['l10n:fr:title']).toBe('Traduit')
    expect(recordIndexerError).not.toHaveBeenCalled()
  })

  it('hydrates translations when the runtime module registry enables them', async () => {
    jest.mocked(tryGetModules).mockReturnValue([{ id: 'translations' }])
    const { em } = createEntityManager()

    const doc = await buildIndexDoc(em, params)

    expect(doc?.['l10n:fr:title']).toBe('Traduit')
    expect(recordIndexerError).not.toHaveBeenCalled()
  })

  it.each(['runtime registry', 'ORM discovery'])('keeps reporting real read failures when enabled via %s', async (source) => {
    if (source === 'runtime registry') jest.mocked(tryGetModules).mockReturnValue([{ id: 'translations' }])
    const { em, db } = createEntityManager({
      translationsDiscovered: source === 'ORM discovery',
      translationsError: missingTableError,
    })

    const doc = await buildIndexDoc(em, params)

    expect(doc?.title).toBe('Base title')
    expect(recordIndexerError).toHaveBeenCalledWith({ db }, expect.objectContaining({
      handler: 'query_index:build-index-doc:translations',
      error: missingTableError,
      entityType: params.entityType,
      recordId,
    }))
    expect(mockReportError).toHaveBeenCalledWith(missingTableError, {
      module: 'query_index',
      code: 'query_index.translations_read_failed',
    })
  })
})
