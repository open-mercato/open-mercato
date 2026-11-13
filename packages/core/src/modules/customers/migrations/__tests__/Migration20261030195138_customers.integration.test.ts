import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { Migration20261030195138_customers } from '../Migration20261030195138_customers'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const COMPANY_PROFILE_ENTITY = 'customers:customer_company_profile'
const PERSON_PROFILE_ENTITY = 'customers:customer_person_profile'

type MapRow = {
  id: string
  entity_id: string
  tenant_id: string | null
  organization_id: string | null
  fields_json: Array<{ field: string; hashField?: string }> | null
  is_active: boolean
  deleted_at: Date | null
}

type CompanyRow = { id: string; legal_name: string | null; tax_id?: string | null }

/**
 * Upgrade/rollback boundary of the company VAT ID migration against a real
 * PostgreSQL, starting from the schema that existed before it:
 * - `up` adds the nullable column without touching existing company rows;
 * - `up` appends the `tax_id` encryption rule to every pre-existing company
 *   profile map exactly once, seeds the map for scopes that encrypt other
 *   entities but had no company profile map yet, and skips scopes with
 *   encryption disabled, soft-deleted maps and maps that already carry the rule;
 * - `down` drops the column, keeps the company rows and leaves the maps alone
 *   (the backfill is forward-only by design, see `buildEncryptionMapBackfillSql`).
 */
describeWithPostgres('Company VAT ID migration against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let client: Client | undefined
  let schema: string

  function database(): Client {
    if (!client) throw new Error('[internal] company VAT ID migration test database is not connected')
    return client
  }

  async function migrate(direction: 'up' | 'down'): Promise<void> {
    const migration = Object.create(Migration20261030195138_customers.prototype) as Migration20261030195138_customers
    const statements: string[] = []
    Object.defineProperty(migration, 'addSql', { value: (sql: string) => statements.push(sql) })
    await migration[direction]()
    await database().query('begin')
    try {
      for (const statement of statements) await database().query(statement)
      await database().query('commit')
    } catch (error) {
      await database().query('rollback')
      throw error
    }
  }

  async function insertMap(row: {
    entityId: string
    tenantId: string
    organizationId: string
    fields: Array<{ field: string; hashField?: string }>
    isActive?: boolean
    deletedAt?: string | null
  }): Promise<string> {
    const id = randomUUID()
    await database().query(
      `insert into encryption_maps (id, entity_id, tenant_id, organization_id, fields_json, is_active, created_at, updated_at, deleted_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, now(), now(), $7)`,
      [id, row.entityId, row.tenantId, row.organizationId, JSON.stringify(row.fields), row.isActive ?? true, row.deletedAt ?? null],
    )
    return id
  }

  async function companyProfileMaps(): Promise<MapRow[]> {
    const result = await database().query<MapRow>(
      `select id, entity_id, tenant_id, organization_id, fields_json, is_active, deleted_at
       from encryption_maps where entity_id = $1 order by tenant_id, organization_id, id`,
      [COMPANY_PROFILE_ENTITY],
    )
    return result.rows
  }

  async function taxIdColumn(): Promise<{ is_nullable: string; data_type: string } | undefined> {
    const result = await database().query<{ is_nullable: string; data_type: string }>(
      `select is_nullable, data_type from information_schema.columns
       where table_schema = $1 and table_name = 'customer_companies' and column_name = 'tax_id'`,
      [schema],
    )
    return result.rows[0]
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'tax_id_migration_test', POSTGRES_USER: 'tax_id_test', POSTGRES_PASSWORD: 'tax_id_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    client = new Client({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: 'tax_id_migration_test',
      user: 'tax_id_test',
      password: 'tax_id_test',
    })
    await client.connect()
  }, 120_000)

  beforeEach(async () => {
    schema = `tax_id_migration_${randomUUID().replaceAll('-', '')}`
    await database().query(`create schema "${schema}"`)
    await database().query(`set search_path to "${schema}"`)
    await database().query(`create table customer_companies (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      tenant_id uuid not null,
      legal_name text null,
      brand_name text null,
      domain text null,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      entity_id uuid not null
    )`)
    await database().query(`create table encryption_maps (
      id uuid primary key default gen_random_uuid(),
      entity_id text not null,
      tenant_id uuid null,
      organization_id uuid null,
      fields_json jsonb null,
      is_active boolean not null default true,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      deleted_at timestamptz null
    )`)
  })

  afterEach(async () => {
    await database().query('set search_path to public')
    await database().query(`drop schema if exists "${schema}" cascade`)
  })

  afterAll(async () => {
    try {
      await client?.end()
    } finally {
      await postgres?.stop()
    }
  }, 30_000)

  it('adds the column, backfills the encryption rule once per scope and rolls back without losing company data', async () => {
    const tenant = randomUUID()
    const encryptedOrg = randomUUID()
    const personOnlyOrg = randomUUID()
    const disabledOrg = randomUUID()
    const deletedMapOrg = randomUUID()
    const alreadyCoveredOrg = randomUUID()
    const companyId = randomUUID()

    await database().query(
      `insert into customer_companies (id, organization_id, tenant_id, legal_name, created_at, updated_at, entity_id)
       values ($1, $2, $3, 'Acme sp. z o.o.', now(), now(), $4)`,
      [companyId, encryptedOrg, tenant, randomUUID()],
    )

    const existingRules = [{ field: 'legal_name' }, { field: 'domain' }, { field: 'website_url' }]
    const existingMapId = await insertMap({ entityId: COMPANY_PROFILE_ENTITY, tenantId: tenant, organizationId: encryptedOrg, fields: existingRules })
    await insertMap({ entityId: PERSON_PROFILE_ENTITY, tenantId: tenant, organizationId: personOnlyOrg, fields: [{ field: 'first_name' }] })
    await insertMap({ entityId: PERSON_PROFILE_ENTITY, tenantId: tenant, organizationId: disabledOrg, fields: [{ field: 'first_name' }], isActive: false })
    const deletedMapId = await insertMap({
      entityId: COMPANY_PROFILE_ENTITY,
      tenantId: tenant,
      organizationId: deletedMapOrg,
      fields: existingRules,
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    const coveredRules = [...existingRules, { field: 'tax_id' }]
    const coveredMapId = await insertMap({ entityId: COMPANY_PROFILE_ENTITY, tenantId: tenant, organizationId: alreadyCoveredOrg, fields: coveredRules })

    expect(await taxIdColumn()).toBeUndefined()

    await migrate('up')

    expect(await taxIdColumn()).toEqual({ is_nullable: 'YES', data_type: 'text' })
    const companiesAfterUp = (await database().query<CompanyRow>('select id, legal_name, tax_id from customer_companies')).rows
    expect(companiesAfterUp).toEqual([{ id: companyId, legal_name: 'Acme sp. z o.o.', tax_id: null }])

    const mapsAfterUp = await companyProfileMaps()
    expect(mapsAfterUp).toHaveLength(4)

    const existingMap = mapsAfterUp.find((row) => row.id === existingMapId)
    expect(existingMap?.fields_json).toEqual([...existingRules, { field: 'tax_id' }])

    const seededMap = mapsAfterUp.find((row) => row.organization_id === personOnlyOrg)
    expect(seededMap).toMatchObject({ tenant_id: tenant, is_active: true, deleted_at: null, fields_json: [{ field: 'tax_id' }] })

    expect(mapsAfterUp.some((row) => row.organization_id === disabledOrg)).toBe(false)

    const deletedMap = mapsAfterUp.find((row) => row.id === deletedMapId)
    expect(deletedMap?.fields_json).toEqual(existingRules)
    expect(mapsAfterUp.filter((row) => row.organization_id === deletedMapOrg)).toHaveLength(1)

    const coveredMap = mapsAfterUp.find((row) => row.id === coveredMapId)
    expect(coveredMap?.fields_json).toEqual(coveredRules)
    expect(mapsAfterUp.filter((row) => row.organization_id === alreadyCoveredOrg)).toHaveLength(1)

    await database().query('update customer_companies set tax_id = $1 where id = $2', ['PL1234567890', companyId])

    await migrate('down')

    expect(await taxIdColumn()).toBeUndefined()
    const companiesAfterDown = (await database().query<CompanyRow>('select id, legal_name from customer_companies')).rows
    expect(companiesAfterDown).toEqual([{ id: companyId, legal_name: 'Acme sp. z o.o.' }])
    expect(await companyProfileMaps()).toEqual(mapsAfterUp)
  })
})
