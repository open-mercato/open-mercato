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
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import handle from '../cleanup'

type RecordedQuery = { sql: string; parameters: readonly unknown[] }

type FakeEntityMetadata = {
  className: string
  tableName: string
  primaryKeys: string[]
  properties: Record<string, { fieldNames: string[] }>
}

const RESOURCE_ENTITY_TYPE = 'resources:resources_resource'
const RESOURCE_METADATA: FakeEntityMetadata = {
  className: 'ResourcesResource',
  tableName: 'resources_resources',
  primaryKeys: ['id'],
  properties: {
    id: { fieldNames: ['id'] },
    organizationId: { fieldNames: ['organization_id'] },
    tenantId: { fieldNames: ['tenant_id'] },
    deletedAt: { fieldNames: ['deleted_at'] },
  },
}
const CODED_ENTITY_TYPE = 'example:coded_record'
const CODED_METADATA: FakeEntityMetadata = {
  className: 'CodedRecord',
  tableName: 'example_coded_records',
  primaryKeys: ['code'],
  properties: {
    code: { fieldNames: ['record_code'] },
    deletedAt: { fieldNames: ['removed_at'] },
  },
}
const HARD_DELETE_ENTITY_TYPE = 'example:hard_record'
const HARD_DELETE_METADATA: FakeEntityMetadata = {
  className: 'HardRecord',
  tableName: 'example_hard_records',
  primaryKeys: ['id'],
  properties: {
    id: { fieldNames: ['id'] },
    organizationId: { fieldNames: ['organization_id'] },
    tenantId: { fieldNames: ['tenant_id'] },
  },
}

function createHarness(baseRows: Array<Record<string, unknown>> | Error) {
  const queries: RecordedQuery[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      queries.push({ sql: compiled.sql, parameters: compiled.parameters })
      if (/^select/i.test(compiled.sql)) {
        if (baseRows instanceof Error) throw baseRows
        return { rows: baseRows as R[] }
      }
      return { rows: [] }
    },
    async *streamQuery() {
      throw new Error('[internal] streaming is not supported by the fake driver')
    },
  }
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection
    },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  }
  const db = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  const allMetadata = [RESOURCE_METADATA, HARD_DELETE_METADATA, CODED_METADATA]
  const em = {
    getKysely: () => db,
    getMetadata: () => ({
      find: (className: string) => allMetadata.find((meta) => meta.className === className),
      getAll: () => new Map(allMetadata.map((meta) => [meta.className, meta])),
    }),
  }
  const ctx = { resolve: <T = unknown>() => em as T }
  const deletes = () => queries.filter((query) => /delete from "entity_translations"/i.test(query.sql))
  const selects = () => queries.filter((query) => /^select/i.test(query.sql))
  return { ctx, queries, deletes, selects }
}

function payloadFor(entityType: string, recordId: string) {
  return {
    entityType,
    recordId,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    crudAction: 'deleted',
  }
}

describe('translations cleanup subscriber', () => {
  beforeAll(() => {
    registerEntityIds({
      resources: { resources_resource: RESOURCE_ENTITY_TYPE },
      example: {
        hard_record: HARD_DELETE_ENTITY_TYPE,
        coded_record: CODED_ENTITY_TYPE,
        missing_entity: 'example:missing_entity',
      },
    })
  })

  it('keeps translations while the owning record is only soft-deleted', async () => {
    const harness = createHarness([{ deleted_at: new Date('2026-10-01T00:00:00Z') }])

    await handle(payloadFor(RESOURCE_ENTITY_TYPE, 'res-1'), harness.ctx)

    expect(harness.deletes()).toHaveLength(0)
    expect(harness.selects()).toHaveLength(1)
    expect(harness.selects()[0].sql).toContain('"resources_resources"')
    expect(harness.selects()[0].sql).toContain('"tenant_id" is not distinct from')
    expect(harness.selects()[0].sql).toContain('"organization_id" is not distinct from')
    expect(harness.selects()[0].parameters).toEqual(['res-1', 'tenant-1', 'org-1'])
  })

  it('probes the soft-delete and primary key columns declared in the entity metadata', async () => {
    const harness = createHarness([{ removed_at: new Date() }])

    await handle(payloadFor(CODED_ENTITY_TYPE, 'code-1'), harness.ctx)

    expect(harness.deletes()).toHaveLength(0)
    expect(harness.selects()[0].sql).toContain('select "removed_at" from "example_coded_records" where "record_code" = $1')
    expect(harness.selects()[0].parameters).toEqual(['code-1'])
  })

  it('keeps translations when the soft-delete check fails', async () => {
    const harness = createHarness(new Error('[internal] probe failed'))

    await handle(payloadFor(RESOURCE_ENTITY_TYPE, 'res-4'), harness.ctx)

    expect(harness.selects()).toHaveLength(1)
    expect(harness.deletes()).toHaveLength(0)
  })

  it('deletes translations when the owning row no longer exists', async () => {
    const harness = createHarness([])

    await handle(payloadFor(RESOURCE_ENTITY_TYPE, 'res-2'), harness.ctx)

    expect(harness.deletes()).toHaveLength(1)
    expect(harness.deletes()[0].parameters).toEqual(
      expect.arrayContaining([RESOURCE_ENTITY_TYPE, 'res-2', 'tenant-1', 'org-1']),
    )
  })

  it('deletes translations when the owning row is not marked deleted', async () => {
    const harness = createHarness([{ deleted_at: null }])

    await handle(payloadFor(RESOURCE_ENTITY_TYPE, 'res-3'), harness.ctx)

    expect(harness.deletes()).toHaveLength(1)
  })

  it('deletes translations without probing the row for entities that have no soft-delete column', async () => {
    const harness = createHarness([{ id: 'hard-1' }])

    await handle(payloadFor(HARD_DELETE_ENTITY_TYPE, 'hard-1'), harness.ctx)

    expect(harness.selects()).toHaveLength(0)
    expect(harness.deletes()).toHaveLength(1)
  })

  it('deletes translations for entity types without registered ORM metadata', async () => {
    const harness = createHarness([{ deleted_at: new Date() }])

    await handle(payloadFor('example:missing_entity', 'x-1'), harness.ctx)

    expect(harness.selects()).toHaveLength(0)
    expect(harness.deletes()).toHaveLength(1)
  })

  it('does not probe tables for entity types outside the entity id registry', async () => {
    const harness = createHarness([{ deleted_at: new Date() }])

    await handle(payloadFor('user:resources_resource', 'u-1'), harness.ctx)

    expect(harness.selects()).toHaveLength(0)
    expect(harness.deletes()).toHaveLength(1)
  })
})
