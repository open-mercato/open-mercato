import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { reindexEntity } from '../lib/reindexer'
import { upsertIndexBatch } from '../lib/batch'
import { buildIndexDoc, upsertIndexRow } from '../lib/indexer'
import { refreshCoverageSnapshot } from '../lib/coverage'
import queryIndexCli, { findUnindexedRecordIds } from '../cli'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/cli/progress', () => ({
  createProgressBar: () => ({ update: () => undefined, complete: () => undefined }),
}))

jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: () => null,
}))

jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: () => ({ customers: { customer_person_profile: 'customers:customer_person_profile' } }),
}))

jest.mock('../lib/batch', () => {
  const actual = jest.requireActual('../lib/batch')
  return { ...actual, upsertIndexBatch: jest.fn() }
})

jest.mock('../lib/jobs', () => ({
  prepareJob: jest.fn(async () => undefined),
  updateJobProgress: jest.fn(async () => undefined),
  finalizeJob: jest.fn(async () => undefined),
}))

jest.mock('../lib/stale', () => ({
  purgeOrphans: jest.fn(async () => undefined),
  retireScopedCatalogueRows: jest.fn(async () => undefined),
}))

const mockCreateRequestContainer = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>
const mockUpsertIndexBatch = upsertIndexBatch as jest.MockedFunction<typeof upsertIndexBatch>

const PERSON_PROFILE = 'customers:customer_person_profile'
const COMPANY_PROFILE = 'customers:customer_company_profile'
const TENANT = '0e40f2bf-a7ab-465c-8040-20abbd8ad398'
const ORG = '8a3b2c1d-1111-4222-8333-444455556666'
const PROFILE_ID = '5d2f4a8e-7a1b-4c3d-9e8f-0a1b2c3d4e5f'
const PARENT_ID = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

const PROFILE_COLUMNS = ['id', 'organization_id', 'tenant_id', 'entity_id', 'first_name', 'last_name', 'created_at', 'updated_at']
const TODO_COLUMNS = ['id', 'organization_id', 'tenant_id', 'title', 'created_at', 'updated_at', 'deleted_at']

const TABLES: Record<string, { className: string; columns: string[] }> = {
  customer_people: { className: 'CustomerPersonProfile', columns: PROFILE_COLUMNS },
  customer_companies: { className: 'CustomerCompanyProfile', columns: PROFILE_COLUMNS },
  todos: { className: 'Todo', columns: TODO_COLUMNS },
}

type Responder = (query: CompiledQuery) => Array<Record<string, unknown>> | undefined

function createRecordingDb(respond: Responder = () => undefined) {
  const statements: CompiledQuery[] = []
  const answer = (query: CompiledQuery): Array<Record<string, unknown>> => {
    const custom = respond(query)
    if (custom) return custom
    if (!query.sql.includes('"information_schema"."columns"')) return []
    const table = Object.keys(TABLES).find((name) => query.parameters.includes(name))
    const columns = table ? TABLES[table].columns : []
    if (query.sql.includes('"column_name" =')) {
      return query.parameters.some((param) => typeof param === 'string' && columns.includes(param)) ? [{ present: 1 }] : []
    }
    return columns.map((column_name) => ({ column_name }))
  }
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      statements.push(query)
      return { rows: answer(query) as R[], numAffectedRows: BigInt(0) }
    },
    async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
      throw new Error('[internal] streaming is not supported by the recording driver')
    },
  }
  const driver: Driver = {
    init: async () => undefined,
    acquireConnection: async () => connection,
    beginTransaction: async () => undefined,
    commitTransaction: async () => undefined,
    rollbackTransaction: async () => undefined,
    releaseConnection: async () => undefined,
    destroy: async () => undefined,
  }
  const db = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance) => new PostgresIntrospector(instance),
    },
  })
  return { db, statements }
}

function createEm(db: Kysely<Record<string, never>>): EntityManager {
  const metadata = new Map(Object.entries(TABLES).map(([tableName, { className }]) => [className, {
    className,
    tableName,
    properties: {
      tenantId: { fieldNames: ['tenant_id'] },
      organizationId: { fieldNames: ['organization_id'] },
    },
  }]))
  const fakeEm = {
    getKysely: () => db,
    getMetadata: () => ({ find: (className: string) => metadata.get(className), getAll: () => metadata }),
  }
  return fakeEm as unknown as EntityManager
}

const countOneRow: Responder = (query) => (query.sql.startsWith('select count(*)') ? [{ count: 1 }] : undefined)

const sqlTouching = (statements: CompiledQuery[], table: string) =>
  statements.filter((statement) => statement.sql.includes(`from "${table}"`)).map((statement) => statement.sql)

const parentActiveOn = (profileRef: string) =>
  `exists (select 1 from "customer_entities" as "parent_entity" where "parent_entity"."id" = ${profileRef}."entity_id" and "parent_entity"."deleted_at" is null)`

async function runCli(name: string, args: string[]) {
  const command = queryIndexCli.find((entry) => entry.command === name)
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  try {
    await command!.run(args)
    return { warnings: warn.mock.calls.map((call) => String(call[0])), logs: log.mock.calls.map((call) => String(call[0])) }
  } finally {
    log.mockRestore()
    warn.mockRestore()
  }
}

function useContainer(db: Kysely<Record<string, never>>) {
  mockCreateRequestContainer.mockResolvedValue({ resolve: () => createEm(db) } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
}

describe('query index skips customer profiles whose parent entity is soft-deleted (#8638)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpsertIndexBatch.mockResolvedValue({ attempted: 0, written: 0, failedRecordIds: [], searchTokenFailures: 0 })
  })

  it.each([
    [PERSON_PROFILE, 'customer_people'],
    [COMPANY_PROFILE, 'customer_companies'],
  ])('reindexEntity reads %s rows only when the parent is active', async (entityType, table) => {
    const { db, statements } = createRecordingDb(countOneRow)

    await reindexEntity(createEm(db), { entityType, tenantId: TENANT, organizationId: ORG, force: true })

    const sourceStatements = sqlTouching(statements, table)
    expect(sourceStatements.length).toBeGreaterThanOrEqual(2)
    for (const statement of sourceStatements) expect(statement).toContain(parentActiveOn('"b"'))
  })

  it('applies the parent predicate inside a partitioned reindex', async () => {
    const { db, statements } = createRecordingDb(countOneRow)

    await reindexEntity(createEm(db), { entityType: PERSON_PROFILE, tenantId: TENANT, organizationId: ORG, force: true, partitionCount: 2, partitionIndex: 1 })

    const sourceStatements = sqlTouching(statements, 'customer_people')
    const partitionStatements = sourceStatements.filter((statement) => statement.includes('hashtext(b.id::text)'))
    expect(partitionStatements.length).toBeGreaterThanOrEqual(1)
    for (const statement of sourceStatements) expect(statement).toContain(parentActiveOn('"b"'))
  })

  it('leaves the source query of other entity types unchanged', async () => {
    const { db, statements } = createRecordingDb(countOneRow)

    await reindexEntity(createEm(db), { entityType: 'example:todo', tenantId: TENANT, organizationId: ORG, force: true })

    const sourceStatements = sqlTouching(statements, 'todos')
    expect(sourceStatements.length).toBeGreaterThanOrEqual(2)
    for (const statement of sourceStatements) {
      expect(statement).not.toContain('customer_entities')
      expect(statement).toContain('"b"."deleted_at" is null')
    }
  })

  it('counts coverage base rows only for profiles with an active parent', async () => {
    const { db, statements } = createRecordingDb()

    await refreshCoverageSnapshot(createEm(db), { entityType: PERSON_PROFILE, tenantId: TENANT, organizationId: ORG })

    const baseCounts = sqlTouching(statements, 'customer_people')
    expect(baseCounts).toHaveLength(1)
    expect(baseCounts[0]).toContain(parentActiveOn('"b"'))
  })

  it('keeps soft-deleted parents in a withDeleted coverage count', async () => {
    const { db, statements } = createRecordingDb()

    await refreshCoverageSnapshot(createEm(db), { entityType: PERSON_PROFILE, tenantId: TENANT, organizationId: ORG, withDeleted: true })

    const baseCounts = sqlTouching(statements, 'customer_people')
    expect(baseCounts).toHaveLength(1)
    expect(baseCounts[0]).not.toContain('customer_entities')
  })

  it('findUnindexedRecordIds lists only profiles with an active parent', async () => {
    const { db, statements } = createRecordingDb()

    await findUnindexedRecordIds(db, { entityType: PERSON_PROFILE, tableName: 'customer_people', tenantId: TENANT, organizationId: ORG, limit: 10 })

    const sourceStatements = sqlTouching(statements, 'customer_people')
    expect(sourceStatements).toHaveLength(1)
    expect(sourceStatements[0]).toContain(parentActiveOn('"b"'))
  })

  it('query_index rebuild selects profiles only when the parent is active, without a deleted_at warning', async () => {
    const { db, statements } = createRecordingDb((query) => (
      query.sql.includes('from "customer_people"') ? [{ count: 0 }] : undefined
    ))
    useContainer(db)

    const { warnings } = await runCli('rebuild', ['--entity', PERSON_PROFILE, '--tenant', TENANT, '--org', ORG])

    const sourceStatements = sqlTouching(statements, 'customer_people')
    expect(sourceStatements).toHaveLength(1)
    expect(sourceStatements[0]).toContain(parentActiveOn('"customer_people"'))
    expect(warnings.filter((warning) => warning.includes('does not expose deleted_at'))).toEqual([])
  })

  it('query_index rebuild --withDeleted keeps profiles of soft-deleted parents', async () => {
    const { db, statements } = createRecordingDb((query) => (
      query.sql.includes('from "customer_people"') ? [{ count: 0 }] : undefined
    ))
    useContainer(db)

    await runCli('rebuild', ['--entity', PERSON_PROFILE, '--tenant', TENANT, '--org', ORG, '--withDeleted'])

    const sourceStatements = sqlTouching(statements, 'customer_people')
    expect(sourceStatements).toHaveLength(1)
    expect(sourceStatements[0]).not.toContain('customer_entities')
  })

  it('query_index rebuild-all applies the parent predicate to profile types', async () => {
    const { db, statements } = createRecordingDb((query) => (
      query.sql.includes('from "customer_people"') ? [{ count: 0 }] : undefined
    ))
    useContainer(db)

    const { warnings } = await runCli('rebuild-all', ['--tenant', TENANT, '--org', ORG])

    const sourceStatements = sqlTouching(statements, 'customer_people')
    expect(sourceStatements).toHaveLength(1)
    expect(sourceStatements[0]).toContain(parentActiveOn('"customer_people"'))
    expect(warnings.filter((warning) => warning.includes('does not expose deleted_at'))).toEqual([])
  })

  describe('single-record path', () => {
    const profileRow = { id: PROFILE_ID, entity_id: PARENT_ID, tenant_id: TENANT, organization_id: ORG, first_name: 'Ghost', last_name: 'Person' }
    const parentRow = (deletedAt: Date | null) => ({
      id: PARENT_ID,
      tenant_id: TENANT,
      organization_id: ORG,
      kind: 'person',
      display_name: 'Ghost Person',
      deleted_at: deletedAt,
    })
    const respondWith = (deletedAt: Date | null): Responder => (query) => {
      if (query.sql.includes('from "customer_people"')) return [profileRow]
      if (query.sql.includes('from "customer_entities"')) return [parentRow(deletedAt)]
      return undefined
    }
    const args = { entityType: PERSON_PROFILE, recordId: PROFILE_ID, tenantId: TENANT, organizationId: ORG }

    it('builds no document for a profile whose parent is soft-deleted', async () => {
      const { db } = createRecordingDb(respondWith(new Date('2026-11-01T00:00:00Z')))

      await expect(buildIndexDoc(createEm(db), args)).resolves.toBeNull()
    })

    it('still builds the document while the parent is active', async () => {
      const { db } = createRecordingDb(respondWith(null))

      const doc = await buildIndexDoc(createEm(db), args)

      expect(doc).toEqual(expect.objectContaining({ id: PROFILE_ID, display_name: 'Ghost Person', first_name: 'Ghost' }))
    })

    it('upsertIndexRow removes the projection and tokens instead of reviving them', async () => {
      const { db, statements } = createRecordingDb((query) => {
        if (query.sql.includes('from "entity_indexes"') && query.sql.startsWith('select')) return [{ id: 'index-row', deleted_at: null }]
        return respondWith(new Date('2026-11-01T00:00:00Z'))(query)
      })

      const result = await upsertIndexRow(createEm(db), args)

      expect(result.doc).toBeNull()
      const writes = statements.map((statement) => statement.sql).filter((statement) => !statement.startsWith('select'))
      expect(writes.some((statement) => statement.startsWith('delete from "entity_indexes"'))).toBe(true)
      expect(writes.some((statement) => statement.startsWith('delete from "search_tokens"'))).toBe(true)
      expect(writes.some((statement) => statement.startsWith('insert into "entity_indexes"'))).toBe(false)
    })

    it('query_index rebuild --record removes the projection of a profile whose parent is soft-deleted', async () => {
      const { db, statements } = createRecordingDb((query) => {
        if (query.sql.includes('from "customer_people"') && query.sql.includes('customer_entities')) return []
        if (query.sql.includes('from "entity_indexes"') && query.sql.startsWith('select')) return [{ id: 'index-row', deleted_at: null }]
        return respondWith(new Date('2026-11-01T00:00:00Z'))(query)
      })
      useContainer(db)

      await runCli('rebuild', ['--entity', PERSON_PROFILE, '--record', PROFILE_ID, '--tenant', TENANT, '--org', ORG])

      const writes = statements.map((statement) => statement.sql).filter((statement) => !statement.startsWith('select'))
      expect(writes.some((statement) => statement.startsWith('delete from "entity_indexes"'))).toBe(true)
      expect(writes.some((statement) => statement.startsWith('delete from "search_tokens"'))).toBe(true)
      expect(writes.some((statement) => statement.startsWith('insert into "entity_indexes"'))).toBe(false)
      expect(mockUpsertIndexBatch).not.toHaveBeenCalled()
    })
  })
})
