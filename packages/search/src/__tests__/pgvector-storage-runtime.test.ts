jest.mock('pg', () => ({ Pool: jest.fn() }))
jest.mock('@open-mercato/shared/lib/db/runtime', () => ({
  configureDatabasePool: jest.fn(), databaseStorageMode: jest.fn(), resolveDatabaseConnectionUrl: jest.fn((_purpose, url) => url),
}))
jest.mock('../vector', () => ({
  EmbeddingService: jest.fn(),
  createPgVectorDriver: jest.requireActual('../vector/drivers/pgvector').createPgVectorDriver,
  createChromaDbDriver: jest.fn(() => ({ id: 'chromadb' })),
  createQdrantDriver: jest.fn(() => ({ id: 'qdrant' })),
}))
jest.mock('../queue/vector-indexing', () => ({ createVectorIndexingQueue: jest.fn(() => ({ close: jest.fn().mockResolvedValue(undefined) })) }))
jest.mock('../queue/fulltext-indexing', () => ({ createFulltextIndexingQueue: jest.fn(() => ({ close: jest.fn().mockResolvedValue(undefined) })) }))

import { Pool } from 'pg'
import { createContainer } from 'awilix'
import { configureDatabasePool, databaseStorageMode, resolveDatabaseConnectionUrl } from '@open-mercato/shared/lib/db/runtime'
import { createPgVectorDriver, type PgPool } from '../vector/drivers/pgvector'
import { createPgVectorDatabaseDeclarations, resolvePgVectorStorage, validatePgVectorStorage, type PgVectorStorageOptions } from '../vector/drivers/pgvector/storage'
import { createFulltextIndexingQueue } from '../queue/fulltext-indexing'
import { register } from '../modules/search/di'

type Column = { table_name: string; name: string; type: string; nullable: boolean; default_expression: string | null }
type Index = { table_name: string; name: string; method: string; unique: boolean; primary: boolean; valid: boolean; partial: boolean; columns: string[]; operator_classes: string[]; options: string[] | null }

function fixture(options: PgVectorStorageOptions = {}) {
  const storage = resolvePgVectorStorage(options)
  const columns: Column[] = []
  const add = (table: string, name: string, type: string, nullable: boolean, defaultExpression: string | null = null) => {
    columns.push({ table_name: table, name, type, nullable, default_expression: defaultExpression })
  }
  add(storage.tableName, 'id', 'uuid', false, 'gen_random_uuid()')
  for (const name of ['driver_id', 'entity_id', 'record_id', 'checksum']) add(storage.tableName, name, 'text', false)
  add(storage.tableName, 'tenant_id', 'uuid', false)
  add(storage.tableName, 'organization_id', 'uuid', true)
  add(storage.tableName, 'embedding', `vector(${storage.dimension})`, false)
  for (const name of ['url', 'result_title', 'result_subtitle', 'result_icon', 'result_badge', 'result_snapshot', 'primary_link_href', 'primary_link_label']) add(storage.tableName, name, 'text', true)
  for (const name of ['presenter', 'links', 'payload']) add(storage.tableName, name, 'jsonb', true)
  for (const name of ['created_at', 'updated_at']) add(storage.tableName, name, 'timestamp with time zone', false, 'now()')
  add(storage.migrationsTable, 'id', 'text', false)
  add(storage.migrationsTable, 'applied_at', 'timestamp with time zone', false, 'now()')
  const index = (table: string, names: string[], unique: boolean, primary = false): Index => ({
    table_name: table, name: `${table}_${names.join('_')}`, method: 'btree', unique, primary, valid: true, partial: false,
    columns: names, operator_classes: [], options: null,
  })
  const indexes: Index[] = [
    index(storage.tableName, ['id'], true, true), index(storage.migrationsTable, ['id'], true, true),
    index(storage.tableName, ['driver_id', 'entity_id', 'record_id', 'tenant_id'], true),
    index(storage.tableName, ['tenant_id', 'organization_id', 'entity_id'], false),
  ]
  if (storage.dimension <= 2000) indexes.push({ ...index(storage.tableName, ['embedding'], false), method: 'ivfflat', operator_classes: [storage.operatorClass], options: ['lists=100'] })
  const environment = { installed: true, visible: true, application_schema: storage.applicationSchema, correlated_reads_match: true }
  const ledger = [{ id: '0001_init' }]
  const query = jest.fn(async (text: string) => {
    if (text.includes('current_schema()')) return { rows: [environment] }
    if (text.includes('format_type')) return { rows: columns }
    if (text.includes('FROM pg_index')) return { rows: indexes }
    if (text.startsWith('SELECT id FROM')) return { rows: ledger }
    if (text.includes('count(*)')) return { rows: [{ total: '2' }] }
    return { rows: [] }
  })
  const release = jest.fn()
  const pool: PgPool = { query: query as PgPool['query'], connect: jest.fn(async () => ({ query: query as PgPool['query'], release })), end: jest.fn(async () => {}) }
  return { pool, query, columns, indexes, environment, ledger, release, storage }
}

const ready = jest.fn<Promise<void>, []>()
const dispose = jest.fn()
const env = { ...process.env }
const singletonKeys = ['__omSearchEmbeddingService__', '__omSearchVectorDrivers__', '__omSearchVectorIndexQueue__', '__omSearchFulltextIndexQueue__', '__omSearchVectorPgPool__', '__omSearchSingletonsShutdown__']

beforeEach(() => {
  jest.clearAllMocks()
  ready.mockResolvedValue(undefined)
  jest.mocked(configureDatabasePool).mockReturnValue({ ready, dispose })
  jest.mocked(databaseStorageMode).mockReturnValue('validate')
  process.env = { ...env, DATABASE_URL: 'postgres://runtime/db' }
  for (const key of singletonKeys) delete (globalThis as Record<string, unknown>)[key]
})
afterEach(() => { process.env = { ...env } })

describe('pgvector runtime pool integration', () => {
  it('registers a supplied pool, awaits readiness and uses only SELECTs before count', async () => {
    const data = fixture()
    let resolveReady!: () => void
    ready.mockReturnValue(new Promise<void>((resolve) => { resolveReady = resolve }))
    const driver = createPgVectorDriver({ pool: data.pool })
    const operation = driver.count!({ tenantId: 'tenant' })
    await Promise.resolve()
    expect(data.query).not.toHaveBeenCalled()
    resolveReady()
    await expect(operation).resolves.toBe(2)
    expect(configureDatabasePool).toHaveBeenCalledWith(data.pool, {
      id: 'search.pgvector:public.vector_search', purpose: 'runtime',
      tables: ['public.vector_search', 'public.vector_search_migrations', 'public.entity_indexes', 'public.custom_entities_storage'],
    })
    expect(data.query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true)
    expect(data.release).toHaveBeenCalledTimes(1)
    await driver.close()
    expect(data.pool.end).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('registers the default internally constructed pool with resolved runtime credentials', async () => {
    const data = fixture()
    jest.mocked(Pool).mockImplementation(() => data.pool as unknown as Pool)
    jest.mocked(resolveDatabaseConnectionUrl).mockReturnValueOnce('postgres://restricted/db')
    const driver = createPgVectorDriver()
    await driver.ensureReady()
    expect(Pool).toHaveBeenCalledWith({ connectionString: 'postgres://restricted/db' })
    expect(configureDatabasePool).toHaveBeenCalledWith(data.pool, expect.objectContaining({ purpose: 'runtime' }))
    await driver.close()
  })

  it('registers and reuses the DI-created singleton pool and closes it through the driver', async () => {
    const data = fixture()
    jest.mocked(Pool).mockImplementation(() => data.pool as unknown as Pool)
    const registrations: Record<string, { resolve: () => unknown }> = {}
    const container = { register: (values: typeof registrations) => Object.assign(registrations, values) }
    register(container as never)
    const drivers = registrations.vectorDrivers.resolve() as ReturnType<typeof createPgVectorDriver>[]
    await drivers[0].ensureReady()
    register(container as never)
    expect(Pool).toHaveBeenCalledTimes(1)
    expect(configureDatabasePool).toHaveBeenCalledTimes(1)
    await drivers[0].close()
    expect(data.pool.end).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes cache-disabled DI pools with their owning container', async () => {
    process.env.SEARCH_DISABLE_SINGLETON_CACHE = '1'
    const data = fixture()
    jest.mocked(Pool).mockImplementation(() => data.pool as unknown as Pool)
    const container = createContainer()
    register(container)
    const drivers = container.resolve<ReturnType<typeof createPgVectorDriver>[]>('vectorDrivers')
    await drivers[0].ensureReady()
    await container.dispose()
    expect(data.pool.end).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('closes a newly created pool when registration itself fails', async () => {
    const data = fixture()
    jest.mocked(Pool).mockImplementation(() => data.pool as unknown as Pool)
    jest.mocked(configureDatabasePool).mockImplementationOnce(() => { throw new Error('configuration rejected') })
    expect(() => createPgVectorDriver()).toThrow('configuration rejected')
    await Promise.resolve()
    expect(data.pool.end).toHaveBeenCalledTimes(1)
  })

  it('reuses the same supplied pool configuration and rejects conflicting dimensions', async () => {
    const data = fixture()
    const driver = createPgVectorDriver({ pool: data.pool })
    expect(createPgVectorDriver({ pool: data.pool })).toBe(driver)
    expect(() => createPgVectorDriver({ pool: data.pool, dimension: 12 })).toThrow('Conflicting pgvector storage')
    expect(configureDatabasePool).toHaveBeenCalledTimes(1)
    expect(data.pool.end).not.toHaveBeenCalled()
    await driver.close()
  })

  it('closes the DI pool when later resource initialization fails', async () => {
    const data = fixture()
    jest.mocked(Pool).mockImplementation(() => data.pool as unknown as Pool)
    jest.mocked(createFulltextIndexingQueue).mockImplementationOnce(() => { throw new Error('queue unavailable') })
    expect(() => register({ register: jest.fn() } as never)).toThrow('queue unavailable')
    await Promise.resolve()
    await Promise.resolve()
    expect(data.pool.end).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('registers custom table/schema/dimension settings exactly', async () => {
    const options = { schema: 'custom', tableName: 'vectors', migrationsTable: 'vector_ledger', dimension: 3072 } as const
    const data = fixture(options)
    const driver = createPgVectorDriver({ ...options, pool: data.pool })
    await driver.ensureReady()
    expect(configureDatabasePool).toHaveBeenCalledWith(data.pool, expect.objectContaining({
      tables: ['custom.vectors', 'custom.vector_ledger', 'custom.entity_indexes', 'custom.custom_entities_storage'],
    }))
    expect(databaseStorageMode).toHaveBeenCalledWith(createPgVectorDatabaseDeclarations(options).storageProviders![0].descriptor)
    await expect(driver.recreateWithDimension!(1536)).rejects.toThrow('maintenance')
    expect(data.query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true)
    await driver.close()
  })

  it('declares correlated reads independently of a custom vector schema', async () => {
    const options = { schema: 'vectors', applicationSchema: 'public' }
    const data = fixture(options)
    const driver = createPgVectorDriver({ ...options, pool: data.pool })
    await driver.ensureReady()
    expect(configureDatabasePool).toHaveBeenCalledWith(data.pool, expect.objectContaining({
      tables: ['vectors.vector_search', 'vectors.vector_search_migrations', 'public.entity_indexes', 'public.custom_entities_storage'],
    }))
    await driver.close()
  })

  it('closes and unregisters on failed boundary readiness without checking out a client', async () => {
    const data = fixture()
    ready.mockRejectedValue(new Error('role rejected'))
    const driver = createPgVectorDriver({ pool: data.pool })
    await expect(driver.ensureReady()).rejects.toThrow('role rejected')
    expect(data.pool.connect).not.toHaveBeenCalled()
    expect(data.pool.end).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    await driver.close()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('releases the validation client and closes before unregistering after catalog failure', async () => {
    const data = fixture()
    data.columns.length = 0
    const driver = createPgVectorDriver({ pool: data.pool })
    await expect(driver.ensureReady()).rejects.toThrow('maintenance connection')
    expect(data.release).toHaveBeenCalledTimes(1)
    expect(data.pool.end).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(data.release.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(data.pool.end).mock.invocationCallOrder[0])
    expect(jest.mocked(data.pool.end).mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0])
  })

  it('makes active availability probes validate storage and propagate failures', async () => {
    const data = fixture()
    data.environment.installed = false
    const driver = createPgVectorDriver({ pool: data.pool })
    await expect(driver.isHealthy!()).rejects.toThrow('vector extension')
    expect(data.query.mock.calls.some(([sql]) => /CREATE|ALTER|DROP|INSERT/.test(sql))).toBe(false)
  })
})

describe('owner-local storage declarations', () => {
  it.each(['cosine', 'euclidean', 'inner'] as const)('provisions %s storage using only the supplied maintenance connection', async (distanceMetric) => {
    const data = fixture({ distanceMetric })
    const declarations = createPgVectorDatabaseDeclarations({ distanceMetric })
    await declarations.storageProviders![0].provision(data.pool)
    const sql = data.query.mock.calls.map(([text]) => text).join('\n')
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS vector')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public"."vector_search_migrations"')
    expect(sql).toContain(`embedding ${data.storage.operatorClass}`)
    expect(sql).toContain('WITH (lists = 100)')
    expect(sql).toContain('ALTER TABLE "public"."vector_search"')
    expect(Pool).not.toHaveBeenCalled()
    expect(declarations.storageTables).toEqual([
      expect.objectContaining({ table: 'vector_search', tenantColumn: 'tenant_id', tenantNullable: false, classification: 'deferred' }),
      expect.objectContaining({ table: 'vector_search_migrations', tenantColumn: null, classification: 'global' }),
    ])
  })

  it('rejects existing storage dimension drift during maintenance provisioning', async () => {
    const data = fixture()
    const connection = { query: jest.fn(async (sql: string) => sql.includes('SELECT a.atttypmod')
      ? { rows: [{ atttypmod: 3072 }] } : data.pool.query(sql)) }
    await expect(createPgVectorDatabaseDeclarations().storageProviders![0].provision(connection)).rejects.toThrow('dimension differs')
  })

  it('preserves disabled runtime provisioning', async () => {
    const data = fixture()
    jest.mocked(databaseStorageMode).mockReturnValue('provision')
    const driver = createPgVectorDriver({ pool: data.pool })
    await driver.ensureReady()
    expect(data.query.mock.calls.some(([sql]) => sql.includes('CREATE TABLE'))).toBe(true)
    await driver.close()
  })

  it.each([
    ['dimension mismatch', (data: ReturnType<typeof fixture>) => { data.columns.find((column) => column.name === 'embedding')!.type = 'vector(7)' }],
    ['nullable tenant', (data: ReturnType<typeof fixture>) => { data.columns.find((column) => column.name === 'tenant_id')!.nullable = true }],
    ['missing result column', (data: ReturnType<typeof fixture>) => { data.columns.splice(data.columns.findIndex((column) => column.name === 'result_title'), 1) }],
    ['missing ledger', (data: ReturnType<typeof fixture>) => { data.ledger.length = 0 }],
    ['invalid index', (data: ReturnType<typeof fixture>) => { data.indexes[0].valid = false }],
    ['wrong metric', (data: ReturnType<typeof fixture>) => { data.indexes.at(-1)!.operator_classes = ['vector_l2_ops'] }],
    ['wrong lists', (data: ReturnType<typeof fixture>) => { data.indexes.at(-1)!.options = ['lists=3'] }],
    ['ambiguous vector indexes', (data: ReturnType<typeof fixture>) => { data.indexes.push(data.indexes.at(-1)!) }],
    ['correlated relation shadowed', (data: ReturnType<typeof fixture>) => { data.environment.correlated_reads_match = false }],
    ['wrong search path', (data: ReturnType<typeof fixture>) => { data.environment.application_schema = 'shadow' }],
    ['invisible extension', (data: ReturnType<typeof fixture>) => { data.environment.visible = false }],
  ] as const)('rejects %s with maintenance guidance and no DDL', async (_name, corrupt) => {
    const data = fixture()
    corrupt(data)
    await expect(validatePgVectorStorage(data.pool, data.storage)).rejects.toThrow('maintenance connection')
    expect(data.query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true)
  })

  it.each([
    { tableName: 'bad.name' }, { schema: '' }, { tableName: 'same', migrationsTable: 'same' },
    { dimension: 0 }, { dimension: 1.5 }, { dimension: NaN }, { tableName: 'a'.repeat(55) },
  ])('rejects ambiguous configuration %j before opening pools', (options) => {
    expect(() => createPgVectorDriver(options)).toThrow()
    expect(Pool).not.toHaveBeenCalled()
  })
})
