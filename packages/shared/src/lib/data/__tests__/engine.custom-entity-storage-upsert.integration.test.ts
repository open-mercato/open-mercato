import { randomUUID } from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { DefaultDataEngine, clearDataEngineTableExistsCache } from '../engine'

type StorageRow = {
  entity_type: string
  entity_id: string
  organization_id: string | null
  tenant_id: string | null
  doc: Record<string, unknown>
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

const describePostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describePostgres('custom entity storage transactions with the nonunique production index', () => {
  let postgres: StartedTestContainer | undefined
  let db: Kysely<{ custom_entities_storage: StorageRow }> | undefined
  const backcompatToggle = process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'storage_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    db = new Kysely({ dialect: new PostgresDialect({ pool: new Pool({
      host: postgres.getHost(), port: postgres.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'storage_test',
    }) }) })
    await sql`create table custom_entities_storage (
      id uuid primary key default gen_random_uuid(),
      entity_type text not null, entity_id uuid not null, organization_id uuid, tenant_id uuid,
      doc jsonb not null, created_at timestamptz not null, updated_at timestamptz not null, deleted_at timestamptz
    )`.execute(db)
    await sql`create index custom_entities_storage_unique_idx
      on custom_entities_storage (entity_type, entity_id, organization_id)`.execute(db)
    process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = 'no'
  }, 120_000)

  afterAll(async () => {
    if (backcompatToggle === undefined) delete process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM
    else process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = backcompatToggle
    clearDataEngineTableExistsCache()
    try {
      await db?.destroy()
    } finally {
      await postgres?.stop()
    }
  })

  test.each(['scoped', 'global'] as const)('create, upsert, update and revival commit without aborting an outer transaction (%s)', async (scope) => {
    if (!db) throw new Error('[internal] PostgreSQL was not initialized')
    const storage = db
    const recordId = randomUUID()
    const entityId = `user:storage_${randomUUID().replaceAll('-', '')}`
    const organizationId = scope === 'global' ? null : randomUUID()
    const tenantId = scope === 'global' ? null : randomUUID()
    const otherOrganizationId = randomUUID()
    const otherTenantId = randomUUID()
    const original = { id: recordId, title: 'Original', count: 1, tags: ['one', 'two'], enabled: true }
    const replacement = { ...original, title: 'Replaced', count: 2 }
    const updated = { ...replacement, title: 'Updated', tags: ['three'] }
    const otherScope = { id: recordId, title: 'Other scope' }
    try {
      for (const neighbor of [
        { organization_id: otherOrganizationId, tenant_id: tenantId },
        { organization_id: organizationId, tenant_id: otherTenantId },
      ]) {
        await storage.insertInto('custom_entities_storage').values({
          entity_type: entityId, entity_id: recordId, ...neighbor, doc: otherScope,
          created_at: sql`now()`, updated_at: sql`now()`, deleted_at: null,
        }).execute()
      }
      for (const phase of ['create', 'upsert', 'update', 'revive'] as const) {
        await storage.transaction().execute(async (transaction) => {
          const em = {
            getKysely: () => transaction,
            getMetadata: () => ({ find: () => undefined, getAll: () => [] }),
            find: async () => [],
          }
          const engine = new DefaultDataEngine(em as never, {} as never)
          const target = { entityId, recordId, organizationId, tenantId }
          clearDataEngineTableExistsCache()
          if (phase === 'create') await engine.createCustomEntityRecord({ ...target, values: original })
          if (phase === 'upsert') await engine.createCustomEntityRecord({ ...target, values: replacement })
          if (phase === 'update') await engine.updateCustomEntityRecord({ ...target, values: { title: 'Updated', tags: ['three'] } })
          if (phase === 'revive') {
            await engine.deleteCustomEntityRecord(target)
            await engine.createCustomEntityRecord({ ...target, values: updated })
          }
          const probe = await sql<{ usable: number }>`select 1 as usable`.execute(transaction)
          expect(probe.rows).toEqual([{ usable: 1 }])
        })
        const rows = await storage.selectFrom('custom_entities_storage').selectAll()
          .where('entity_type', '=', entityId).execute()
        expect(rows).toHaveLength(3)
        const ownRow = rows.find((row) => row.organization_id === organizationId && row.tenant_id === tenantId)
        expect(ownRow).toMatchObject({
          doc: phase === 'create' ? original : phase === 'upsert' ? replacement : updated,
          deleted_at: null, organization_id: organizationId, tenant_id: tenantId,
        })
        expect(rows.filter((row) => row !== ownRow).map((row) => row.doc)).toEqual([otherScope, otherScope])
      }
    } finally {
      await storage.deleteFrom('custom_entities_storage').where('entity_type', '=', entityId).execute()
    }
  })
})
