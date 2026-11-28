import { randomUUID } from 'node:crypto'
import type { Migration } from '@mikro-orm/migrations'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Kysely, PostgresDialect } from 'kysely'
import { Client, Pool } from 'pg'
import { encryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import { backfillPersonPhoneDigests } from '../backfillPersonPhoneDigests'
import { hashPersonPhoneDigits } from '../personPhoneLookup'
import { Migration20261122040000_customers } from '../../migrations/Migration20261122040000_customers'
import { Migration20261122040100_customers } from '../../migrations/Migration20261122040100_customers'

const databaseUrl = process.env.OM_CUSTOMERS_PHONE_PG_URL
const postgres = databaseUrl ? describe : describe.skip

type FixtureRow = {
  id: string
  tenant_id: string
  organization_id: string
  kind: 'person' | 'company'
  primary_phone: string | null
  primary_phone_digits_hash: string | null
}

postgres('CRM phone digest backfill on PostgreSQL', () => {
  const schema = `phone_backfill_${randomUUID().replace(/-/g, '')}`
  let poolDb: Kysely<{ customer_entities: FixtureRow }>
  let db: Kysely<{ customer_entities: FixtureRow }>
  const tenantId = randomUUID()
  const organizationId = randomUUID()

  async function migrate(direction: 'up' | 'down') {
    const migrations = [Migration20261122040000_customers, Migration20261122040100_customers]
    if (direction === 'down') migrations.reverse()
    const client = new Client({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
    await client.connect()
    try {
      for (const migrationClass of migrations) {
        const statements: string[] = []
        const migration = Object.create(migrationClass.prototype) as Migration
        Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
        await migration[direction]()
        if (migration.isTransactional()) await client.query('begin')
        for (const statement of statements) await client.query(statement)
        if (migration.isTransactional()) await client.query('commit')
      }
    } finally {
      await client.end()
    }
  }

  beforeAll(async () => {
    poolDb = new Kysely({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: databaseUrl }) }) })
    await poolDb.schema.createSchema(schema).execute()
    db = poolDb.withSchema(schema)
    await db.schema.createTable('customer_entities')
      .addColumn('id', 'uuid', (column) => column.primaryKey())
      .addColumn('tenant_id', 'uuid', (column) => column.notNull())
      .addColumn('organization_id', 'uuid', (column) => column.notNull())
      .addColumn('kind', 'text', (column) => column.notNull())
      .addColumn('primary_phone', 'text')
      .execute()
    await migrate('up')
  })

  afterAll(async () => {
    await poolDb.schema.dropSchema(schema).ifExists().cascade().execute()
    await poolDb.destroy()
  })

  beforeEach(() => {
    jest.replaceProperty(process, 'env', { ...process.env, LOOKUP_HASH_PEPPER: 'phone-backfill-test-pepper' })
  })

  afterEach(() => jest.restoreAllMocks())

  it('previews and repairs mixed storage without overwriting scoped concurrent changes', async () => {
    const readable = encryptWithAesGcm('+1 415 555 0101', generateDek()).raw
    const unreadable = encryptWithAesGcm('+1 415 555 0102', generateDek()).raw
    const racing = encryptWithAesGcm('+1 415 555 0103', generateDek()).raw
    const row = (phone: string, overrides: Partial<FixtureRow> = {}): FixtureRow => ({
      id: randomUUID(),
      tenant_id: tenantId,
      organization_id: organizationId,
      kind: 'person',
      primary_phone: phone,
      primary_phone_digits_hash: null,
      ...overrides,
    })
    const encrypted = row(readable)
    const legacy = row('+1 415 555 0104')
    const unreadableRow = row(unreadable)
    const concurrent = row(racing)
    const foreign = row(legacy.primary_phone!, { tenant_id: randomUUID() })
    const otherOrg = row(legacy.primary_phone!, { organization_id: randomUUID() })
    const company = row(legacy.primary_phone!, { kind: 'company' })
    await db.insertInto('customer_entities').values([encrypted, legacy, unreadableRow, concurrent, foreign, otherOrg, company]).execute()

    let updateConcurrently = false
    const encryption = {
      decryptEntityPayload: jest.fn(async (_entity, payload, _tenant, _organization) => {
        if (payload.primary_phone === readable) return { primary_phone: '+1 415 555 0101' }
        if (payload.primary_phone !== racing) return payload
        if (updateConcurrently) {
          await db.updateTable('customer_entities').set({ primary_phone: '+1 415 555 0199' })
            .where('id', '=', concurrent.id).execute()
        }
        return { primary_phone: '+1 415 555 0103' }
      }),
    }
    const em = { getKysely: () => db } as unknown as EntityManager
    const scope = { tenantId, organizationId }
    const read = (id: string) => db.selectFrom('customer_entities').selectAll()
      .where('id', '=', id).executeTakeFirstOrThrow()

    expect(await backfillPersonPhoneDigests(em, encryption, { ...scope, dryRun: true })).toEqual({
      scanned: 4, needsUpdate: 3, updated: 0, unreadable: 1, conflicted: 0,
    })
    expect((await read(legacy.id)).primary_phone_digits_hash).toBeNull()

    updateConcurrently = true
    expect(await backfillPersonPhoneDigests(em, encryption, { ...scope, dryRun: false })).toEqual({
      scanned: 4, needsUpdate: 3, updated: 2, unreadable: 1, conflicted: 1,
    })
    expect(encryption.decryptEntityPayload).toHaveBeenCalledWith(
      'customers:customer_entity', { primary_phone: readable }, tenantId, organizationId, { em },
    )
    expect(await read(encrypted.id)).toMatchObject({
      primary_phone: readable,
      primary_phone_digits_hash: hashPersonPhoneDigits('+1 415 555 0101', organizationId),
    })
    expect((await read(legacy.id)).primary_phone_digits_hash).toBe(hashPersonPhoneDigits(legacy.primary_phone, organizationId))
    for (const unchanged of [unreadableRow, concurrent, foreign, otherOrg, company]) {
      expect((await read(unchanged.id)).primary_phone_digits_hash).toBeNull()
    }

    expect(await backfillPersonPhoneDigests(em, encryption, { ...scope, dryRun: false })).toMatchObject({ updated: 1, conflicted: 0 })
    expect((await read(concurrent.id)).primary_phone_digits_hash).toBe(hashPersonPhoneDigits('+1 415 555 0199', organizationId))
    expect(await backfillPersonPhoneDigests(em, encryption, { ...scope, dryRun: false })).toMatchObject({
      needsUpdate: 0, updated: 0, unreadable: 1, conflicted: 0,
    })

    await migrate('down')
    expect(await read(encrypted.id)).toEqual({
      id: encrypted.id, tenant_id: tenantId, organization_id: organizationId, kind: 'person', primary_phone: readable,
    })
  })
})
