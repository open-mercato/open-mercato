import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { cleanupAddressPolicyFixture, type AddressPolicyFixture } from '../addressPolicyCleanup'

const postgresUrl = process.env.OM_ENCRYPTION_BACKFILL_PG_URL
const describePostgres = postgresUrl ? describe : describe.skip

describePostgres('address policy fixture failure cleanup', () => {
  let client: Client
  let schema: string
  let fixture: AddressPolicyFixture
  let parentId: string
  let backupId: string
  let materializedId: string
  let otherId: string
  const deletedAt = new Date('2026-01-01T00:00:00.000Z')

  beforeEach(async () => {
    client = new Client({ connectionString: postgresUrl, connectionTimeoutMillis: 5_000, query_timeout: 5_000 })
    await client.connect()
    schema = `address_cleanup_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    await client.query('SET statement_timeout = 5000')
    await client.query(`CREATE TABLE encryption_maps (
      id uuid PRIMARY KEY, entity_id text NOT NULL, tenant_id uuid, organization_id uuid,
      fields_json jsonb, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
    )`)
    await client.query(`CREATE UNIQUE INDEX encryption_maps_scope_unique
      ON encryption_maps (entity_id, tenant_id, organization_id)
      NULLS NOT DISTINCT WHERE deleted_at IS NULL`)
    parentId = randomUUID()
    backupId = randomUUID()
    materializedId = randomUUID()
    otherId = randomUUID()
    fixture = {
      addressEntity: 'customers:customer_address', otherEntity: 'customers:customer_entity',
      tenantId: randomUUID(), organizationId: randomUUID(), startedAt: new Date('2026-01-01'),
      backupId, parentPolicies: [{ id: parentId, fields_json: [{ field: 'phone' }] }],
      createdOtherMap: false, restoredOtherMap: { id: otherId, deletedAt },
    }
    await client.query(`INSERT INTO encryption_maps (id, entity_id, tenant_id, organization_id, fields_json, deleted_at)
      VALUES ($1, $5, $7, NULL, '[{"field":"phone"},{"field":"purpose"}]', NULL),
             ($2, $5, $7, $8, '[]', $9), ($3, $5, $7, $8, '[]', NULL),
             ($4, $6, $7, $8, '[]', NULL)`,
    [parentId, backupId, materializedId, otherId, fixture.addressEntity, fixture.otherEntity,
      fixture.tenantId, fixture.organizationId, deletedAt])
  })

  afterEach(async () => {
    if (client) {
      try {
        await client.query('ROLLBACK')
        if (schema) await client.query(`DROP SCHEMA "${schema}" CASCADE`)
      } finally {
        await client.end()
      }
    }
  })

  test.each([false, true])('restores policies after a regression and company deletion failure (createdOther=%s)', async (createdOtherMap) => {
    fixture.createdOtherMap = createdOtherMap
    if (createdOtherMap) fixture.restoredOtherMap = null
    const failure = new Error('[internal] Deliberate company cleanup failure')
    await expect((async () => {
      try {
        expect(materializedId).toBeNull()
      } finally {
        await cleanupAddressPolicyFixture(client, fixture, async () => { throw failure })
      }
    })()).rejects.toBe(failure)
    const rows = (await client.query<{ id: string; fields_json: unknown; deleted_at: Date | null }>('SELECT * FROM encryption_maps')).rows
    expect(rows.find((row) => row.id === backupId)?.deleted_at).toBeNull()
    expect(rows.find((row) => row.id === materializedId)).toBeUndefined()
    expect(rows.find((row) => row.id === parentId)?.fields_json).toEqual([{ field: 'phone' }])
    if (createdOtherMap) expect(rows.find((row) => row.id === otherId)).toBeUndefined()
    else expect(rows.find((row) => row.id === otherId)?.deleted_at).toEqual(deletedAt)
  })

  test('rolls policy cleanup back atomically if restoration fails', async () => {
    await client.query(`ALTER TABLE encryption_maps ADD CONSTRAINT refuse_restore CHECK (id <> '${backupId}' OR deleted_at IS NOT NULL)`)
    const before = (await client.query('SELECT * FROM encryption_maps ORDER BY id')).rows
    await expect(cleanupAddressPolicyFixture(client, fixture, async () => {})).rejects.toMatchObject({ code: '23514' })
    expect((await client.query('SELECT * FROM encryption_maps ORDER BY id')).rows).toEqual(before)
  })
})
