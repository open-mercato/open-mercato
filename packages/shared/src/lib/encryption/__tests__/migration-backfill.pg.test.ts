import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Pool, type PoolClient } from 'pg'
import { isEncryptedPayloadShape } from '../aes'
import { buildEncryptionMapBackfillSql } from '../migration-backfill'
import { TenantDataEncryptionService } from '../tenantDataEncryptionService'

const postgresUrl = process.env.OM_ENCRYPTION_BACKFILL_PG_URL
const describePostgres = postgresUrl ? describe : describe.skip
const entityId = 'customers:customer_address'
const contactRules = [{ field: 'recipient_name' }, { field: 'phone' }]
const backfillSql = buildEncryptionMapBackfillSql({ entityId, fields: contactRules })

type MapRow = {
  id: string
  tenant_id: string | null
  organization_id: string | null
  fields_json: { field: string; hashField?: string }[] | null
  is_active: boolean
  deleted_at: Date | null
}

describePostgres('encryption map backfill against PostgreSQL', () => {
  let pool: Pool
  let client: PoolClient
  let tenantId: string
  let organizationId: string
  const originalEncryptionFlag = process.env.TENANT_DATA_ENCRYPTION

  beforeAll(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'true'
    pool = new Pool({
      connectionString: postgresUrl,
      max: 1,
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
    })
  })

  beforeEach(async () => {
    tenantId = randomUUID()
    organizationId = randomUUID()
    client = await pool.connect()
    await client.query('BEGIN')
    const schema = `encryption_backfill_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET LOCAL search_path TO "${schema}"`)
    await client.query('SET LOCAL statement_timeout = 5000')
    await client.query(`CREATE TABLE encryption_maps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id text NOT NULL,
      tenant_id uuid,
      organization_id uuid,
      fields_json jsonb,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`)
    await client.query(`CREATE UNIQUE INDEX encryption_maps_scope_unique
      ON encryption_maps (entity_id, tenant_id, organization_id)
      NULLS NOT DISTINCT WHERE deleted_at IS NULL`)
    await client.query(`CREATE TABLE address_writes (
      recipient_name text, phone text, purpose text, unprotected text
    )`)
  })

  afterEach(async () => {
    if (client) {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  afterAll(async () => {
    await pool.end()
    if (originalEncryptionFlag === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalEncryptionFlag
  })

  async function addMap(options: {
    entity?: string
    tenant?: string | null
    organization?: string | null
    fields?: MapRow['fields_json']
    active?: boolean
    deleted?: boolean
  } = {}): Promise<string> {
    const result = await client.query<{ id: string }>(`INSERT INTO encryption_maps
      (entity_id, tenant_id, organization_id, fields_json, is_active, deleted_at)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id`, [
      options.entity ?? entityId,
      options.tenant === undefined ? tenantId : options.tenant,
      options.organization ?? null,
      JSON.stringify(options.fields === undefined ? [] : options.fields),
      options.active ?? true,
      options.deleted ? new Date() : null,
    ])
    return result.rows[0].id
  }

  async function maps(): Promise<MapRow[]> {
    return (await client.query<MapRow>(`SELECT id, tenant_id, organization_id,
      fields_json, is_active, deleted_at FROM encryption_maps WHERE entity_id = $1 ORDER BY id`, [entityId])).rows
  }

  async function backfill(): Promise<MapRow[]> {
    await client.query(backfillSql)
    const first = await maps()
    await client.query(backfillSql)
    expect(await maps()).toEqual(first)
    return first
  }

  function service(): TenantDataEncryptionService {
    const executor = {
      execute: async (statement: string, params: readonly unknown[] = []) => {
        let parameter = 0
        const sql = statement.replace(/\?/g, () => `$${++parameter}`)
        return (await client.query(sql, [...params])).rows
      },
    }
    return new TenantDataEncryptionService(executor as unknown as EntityManager, {
      kms: {
        isHealthy: () => true,
        getTenantDek: async (tenant) => ({ tenantId: tenant, key: Buffer.alloc(32, 1).toString('base64'), fetchedAt: Date.now() }),
        createTenantDek: async () => null,
      },
    })
  }

  const payload = {
    recipient_name: 'Synthetic Recipient',
    phone: '+1 555 0100',
    purpose: 'Synthetic parent policy probe',
    unprotected: 'Public value',
  }

  test.each(['tenant', 'global'] as const)(
    'new %s parent remains authoritative when all target scopes are initially missing',
    async (parentScope) => {
      if (parentScope === 'global') await addMap({ entity: 'other:entity', tenant: null })
      await addMap({ entity: 'other:entity' })
      await addMap({ entity: 'other:entity', organization: organizationId })
      expect(await service().encryptEntityPayload(entityId, payload, tenantId, organizationId)).toEqual(payload)

      await backfill()
      const before = await service().encryptEntityPayload(entityId, payload, tenantId, organizationId)
      expect(isEncryptedPayloadShape(before.recipient_name)).toBe(true)
      expect(isEncryptedPayloadShape(before.phone)).toBe(true)
      expect(before.purpose).toBe(payload.purpose)

      const parentTenant = parentScope === 'global' ? null : tenantId
      await client.query(`UPDATE encryption_maps SET fields_json = fields_json || '[{"field":"purpose"}]'::jsonb
        WHERE entity_id = $1 AND tenant_id IS NOT DISTINCT FROM $2::uuid AND organization_id IS NULL`, [entityId, parentTenant])

      const encryption = service()
      const encrypted = await encryption.encryptEntityPayload(entityId, payload, tenantId, organizationId)
      await client.query(`INSERT INTO address_writes (recipient_name, phone, purpose, unprotected) VALUES ($1, $2, $3, $4)`,
        [encrypted.recipient_name, encrypted.phone, encrypted.purpose, encrypted.unprotected])
      const stored = (await client.query('SELECT * FROM address_writes')).rows[0]
      for (const field of ['recipient_name', 'phone', 'purpose']) {
        expect(isEncryptedPayloadShape(stored[field])).toBe(true)
      }
      expect(stored.unprotected).toBe(payload.unprotected)
      expect(await encryption.decryptEntityPayload(entityId, stored, tenantId, organizationId)).toEqual(payload)
      expect(await maps()).toEqual([expect.objectContaining({
        tenant_id: parentTenant,
        organization_id: null,
        fields_json: [...contactRules, { field: 'purpose' }],
      })])
    },
  )

  test.each(['SQL null', 'JSON null', 'empty array'])(
    'repairs an effective empty %s parent without creating an organization override',
    async (emptyFields) => {
      const parentId = await addMap({ fields: emptyFields === 'empty array' ? [] : null })
      if (emptyFields === 'SQL null') await client.query('UPDATE encryption_maps SET fields_json = NULL WHERE id = $1', [parentId])
      await addMap({ entity: 'other:entity', organization: organizationId })

      expect(await backfill()).toEqual([expect.objectContaining({ id: parentId, fields_json: contactRules })])
      const encrypted = await service().encryptEntityPayload(entityId, payload, tenantId, organizationId)
      expect(isEncryptedPayloadShape(encrypted.recipient_name)).toBe(true)
      expect(isEncryptedPayloadShape(encrypted.phone)).toBe(true)
    },
  )

  test.each(['tenant', 'global'] as const)('inherits an existing active %s parent', async (scope) => {
    const parentId = await addMap({ tenant: scope === 'global' ? null : tenantId, fields: [{ field: 'purpose' }] })
    await addMap({ entity: 'other:entity', organization: organizationId })
    expect(await backfill()).toEqual([expect.objectContaining({ id: parentId, fields_json: [{ field: 'purpose' }, ...contactRules] })])
    expect(isEncryptedPayloadShape((await service().encryptEntityPayload(entityId, payload, tenantId, organizationId)).purpose)).toBe(true)
  })

  test('preserves explicit organization rules and custom hashes without copying parent rules', async () => {
    await addMap({ fields: [{ field: 'purpose' }] })
    const fields = [{ field: 'phone', hashField: 'custom_phone_hash' }, { field: 'unprotected' }]
    const exactId = await addMap({ organization: organizationId, fields })
    const rows = await backfill()
    expect(rows.find((row) => row.id === exactId)?.fields_json).toEqual([...fields, { field: 'recipient_name' }])
    const encrypted = await service().encryptEntityPayload(entityId, payload, tenantId, organizationId)
    expect(encrypted.purpose).toBe(payload.purpose)
    expect(isEncryptedPayloadShape(encrypted.phone)).toBe(true)
    expect(encrypted.custom_phone_hash).toEqual(expect.any(String))
    expect(encrypted.phone_hash).toBeUndefined()
  })

  test('keeps an inactive exact map inactive and does not replace it', async () => {
    await addMap({ fields: [{ field: 'purpose' }] })
    const exactId = await addMap({ organization: organizationId, active: false })
    await addMap({ entity: 'other:entity', organization: organizationId })
    const rows = await backfill()
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === exactId)).toMatchObject({ is_active: false, fields_json: contactRules })
    expect(isEncryptedPayloadShape((await service().encryptEntityPayload(entityId, payload, tenantId, organizationId)).purpose)).toBe(true)
  })

  test.each(['inactive', 'deleted'])('does not inherit a %s parent or change its activation/deletion state', async (state) => {
    const parentId = await addMap({ fields: [{ field: 'purpose' }], active: state !== 'inactive', deleted: state === 'deleted' })
    await addMap({ entity: 'other:entity', organization: organizationId })
    const rows = await backfill()
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.organization_id === organizationId)?.fields_json).toEqual(contactRules)
    const parent = rows.find((row) => row.id === parentId)
    expect(parent?.is_active).toBe(state !== 'inactive')
    expect(parent?.deleted_at !== null).toBe(state === 'deleted')
    if (state === 'deleted') expect(parent?.fields_json).toEqual([{ field: 'purpose' }])
    const encrypted = await service().encryptEntityPayload(entityId, payload, tenantId, organizationId)
    expect(encrypted.purpose).toBe(payload.purpose)
    expect(isEncryptedPayloadShape(encrypted.phone)).toBe(true)
  })

  test('isolates unrelated tenant and organization policies and skips disabled-only scopes', async () => {
    const otherTenant = randomUUID()
    const otherOrganization = randomUUID()
    await addMap({ tenant: otherTenant, fields: [{ field: 'purpose' }] })
    await addMap({ organization: otherOrganization, fields: [{ field: 'unprotected' }] })
    await addMap({ entity: 'other:entity', organization: organizationId })
    await addMap({ entity: 'other:entity', tenant: randomUUID(), active: false })
    await addMap({ entity: 'other:entity', tenant: randomUUID(), deleted: true })
    expect(await backfill()).toHaveLength(3)
    const encrypted = await service().encryptEntityPayload(entityId, payload, tenantId, organizationId)
    expect(encrypted.purpose).toBe(payload.purpose)
    expect(encrypted.unprotected).toBe(payload.unprotected)
    expect(isEncryptedPayloadShape(encrypted.phone)).toBe(true)
    expect(await service().encryptEntityPayload(entityId, payload, randomUUID(), randomUUID())).toEqual(payload)
  })

  test('replaces a deleted exact map without modifying the deleted policy', async () => {
    const deletedId = await addMap({ organization: organizationId, fields: [{ field: 'purpose' }], deleted: true })
    await addMap({ entity: 'other:entity', organization: organizationId })
    const rows = await backfill()
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === deletedId)?.fields_json).toEqual([{ field: 'purpose' }])
    expect(rows.find((row) => row.id !== deletedId)).toMatchObject({ deleted_at: null, fields_json: contactRules })
  })

  test('does nothing when the encryption table does not exist', async () => {
    await client.query('DROP TABLE encryption_maps')
    await client.query(backfillSql)
    expect((await client.query("SELECT to_regclass('encryption_maps') AS name")).rows).toEqual([{ name: null }])
  })
})
