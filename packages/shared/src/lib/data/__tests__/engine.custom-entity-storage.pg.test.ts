import { randomUUID } from 'node:crypto'
import { EntitySchema, MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import { Pool } from 'pg'
import { DefaultDataEngine, clearDataEngineTableExistsCache } from '../engine'

const databaseUrl = process.env.OM_CUSTOM_ENTITY_STORAGE_PG_URL
const describePostgres = databaseUrl ? describe : describe.skip
const entityId = 'user:storage_contention'
const Probe = new EntitySchema<{ id: string }>({
  name: 'StorageContentionProbe',
  properties: { id: { type: 'uuid', primary: true } },
})

describePostgres('custom entity storage writes against PostgreSQL', () => {
  let orm: MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>
  let admin: Pool
  let schema: string
  const previousEncryption = process.env.TENANT_DATA_ENCRYPTION
  const previousBackcompat = process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM

  beforeAll(async () => {
    schema = `storage_contention_${randomUUID().replaceAll('-', '')}`
    admin = new Pool({ connectionString: databaseUrl })
    await admin.query(`create schema "${schema}"`)
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      clientUrl: databaseUrl,
      entities: [Probe],
      driverOptions: { options: `-c search_path=${schema},public` },
      pool: { min: 0, max: 5 },
    })
    const em = orm.em.fork()
    await em.execute(`create table custom_entities_storage (
      id uuid primary key default gen_random_uuid(),
      entity_type text not null, entity_id uuid not null,
      organization_id uuid, tenant_id uuid, doc jsonb not null,
      created_at timestamptz not null, updated_at timestamptz not null, deleted_at timestamptz
    )`)
    await em.execute(`create function delay_storage_insert() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.15); return new; end $$`)
    await em.execute(`create trigger delay_storage_insert before insert on custom_entities_storage
      for each row execute function delay_storage_insert()`)
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = 'no'
  })

  afterAll(async () => {
    if (previousEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousEncryption
    if (previousBackcompat === undefined) delete process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM
    else process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = previousBackcompat
    await orm?.close(true)
    if (admin) {
      await admin.query(`drop schema if exists "${schema}" cascade`)
      await admin.end()
    }
  })

  function engine(): DefaultDataEngine {
    const em = orm.em.fork()
    jest.spyOn(em, 'find').mockResolvedValue([])
    return new DefaultDataEngine(em, {} as never)
  }

  beforeEach(() => clearDataEngineTableExistsCache())

  test.each([
    ['global', null, null],
    ['tenant-only', randomUUID(), null],
    ['organization', randomUUID(), randomUUID()],
  ] as const)('serializes upserts, missing-record updates and create-only contenders in %s scope', async (_label, tenantId, organizationId) => {
    for (const operation of ['upsert', 'update', 'mixed'] as const) {
      const recordId = randomUUID()
      const options = { entityId, recordId, tenantId, organizationId, values: {} }
      const first = engine()
      const second = engine()
      const outcomes = await Promise.allSettled([
        operation === 'mixed'
          ? first.createCustomEntityRecord({ ...options, createOnly: true })
          : operation === 'update' ? first.updateCustomEntityRecord(options) : first.createCustomEntityRecord(options),
        operation === 'update' ? second.updateCustomEntityRecord(options) : second.createCustomEntityRecord(options),
      ])
      const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
      if (operation === 'mixed') {
        for (const outcome of rejected) {
          if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ status: 409, body: { code: 'custom_entity_record_exists' } })
        }
      } else expect(rejected).toEqual([])
      await second.createCustomEntityRecord(options)
      const rows = await orm.em.fork().execute<Array<{ count: number }>>(
        'select count(*)::int as count from custom_entities_storage where entity_type = ? and entity_id = ?',
        [entityId, recordId],
      )
      expect(rows[0].count).toBe(1)
      await expect(first.createCustomEntityRecord({ ...options, createOnly: true })).rejects.toMatchObject({ status: 409 })
    }
  })

  test.each(['create', 'update'] as const)('%s remains atomic with an enclosing caller transaction', async (operation) => {
    const recordId = randomUUID()
    const options = { entityId, recordId, values: {} }
    await expect(orm.em.fork().transactional(async (txEm) => {
      const transactionalEngine = new DefaultDataEngine(txEm, {} as never)
      if (operation === 'create') await transactionalEngine.createCustomEntityRecord(options)
      else await transactionalEngine.updateCustomEntityRecord(options)
      throw new Error('[internal] Roll back the owning transaction')
    })).rejects.toThrow('[internal] Roll back the owning transaction')
    const rows = await orm.em.fork().execute<Array<{ count: number }>>(
      'select count(*)::int as count from custom_entities_storage where entity_type = ? and entity_id = ?',
      [entityId, recordId],
    )
    expect(rows[0].count).toBe(0)
    await engine().createCustomEntityRecord(options)
    const retried = await orm.em.fork().execute<Array<{ count: number }>>(
      'select count(*)::int as count from custom_entities_storage where entity_type = ? and entity_id = ?',
      [entityId, recordId],
    )
    expect(retried[0].count).toBe(1)
  })

  test('releases the lock after a failed insert so a retry writes exactly one row', async () => {
    const recordId = randomUUID()
    const em = orm.em.fork()
    await em.execute(`alter table custom_entities_storage add constraint reject_retry_record
      check (entity_id <> '${recordId}'::uuid)`)
    const options = { entityId, recordId, values: {} }
    try {
      await expect(engine().createCustomEntityRecord(options)).rejects.toMatchObject({ code: '23514' })
    } finally {
      await em.execute('alter table custom_entities_storage drop constraint reject_retry_record')
    }
    await Promise.all([engine().createCustomEntityRecord(options), engine().createCustomEntityRecord(options)])
    const rows = await em.execute<Array<{ count: number }>>(
      'select count(*)::int as count from custom_entities_storage where entity_type = ? and entity_id = ?',
      [entityId, recordId],
    )
    expect(rows[0].count).toBe(1)
  })

  test('an upsert in another tenant neither replaces nor merges the original record', async () => {
    const recordId = randomUUID()
    const organizationId = randomUUID()
    for (const tenantId of [randomUUID(), randomUUID()]) {
      await engine().createCustomEntityRecord({ entityId, recordId, organizationId, tenantId, values: {} })
    }
    const rows = await orm.em.fork().execute<Array<{ tenant_id: string }>>(
      'select tenant_id from custom_entities_storage where entity_type = ? and entity_id = ?', [entityId, recordId],
    )
    expect(new Set(rows.map((row) => row.tenant_id)).size).toBe(2)
  })
})
