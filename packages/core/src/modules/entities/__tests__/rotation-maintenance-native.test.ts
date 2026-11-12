/** @jest-environment node */
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { verifyMaintenanceBatch, writeMaintenanceRow, type MaintenanceRow } from '../lib/rotation-maintenance'

const native = process.env.OM_ROTATION_TEST_DATABASE_URL ? describe : describe.skip
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: null }
native('committed PostgreSQL maintenance batch readback', () => {
  let client: Client
  let database: string
  beforeEach(async () => {
    database = 'rotation_readback_' + randomUUID().replaceAll('-', '')
    const administrator = new Client({ connectionString: process.env.OM_ROTATION_TEST_DATABASE_URL! })
    await administrator.connect()
    try { await administrator.query(`CREATE DATABASE "${database}"`) } finally { await administrator.end() }
    const url = new URL(process.env.OM_ROTATION_TEST_DATABASE_URL!); url.pathname = '/' + database
    client = new Client({ connectionString: url.toString() }); await client.connect()
    await client.query(`CREATE TABLE records(bucket text,id bigint,tenant_id uuid,organization_id uuid,
      secret text,bytes bytea,payload jsonb,flag boolean,PRIMARY KEY(bucket,id))`)
    for (const [bucket, id] of [['a', '9007199254740993'], ['a', '9007199254740994'], ['b', '9007199254740993']]) {
      await client.query('INSERT INTO records VALUES($1,$2,$3,NULL,$4,$5,$6,false)', [bucket, id, scope.tenantId, 'original', Buffer.from([0, 255]), { preserved: [null, true] }])
    }
  })
  afterEach(async () => {
    await client?.end()
    const administrator = new Client({ connectionString: process.env.OM_ROTATION_TEST_DATABASE_URL! }); await administrator.connect()
    try { await administrator.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`) } finally { await administrator.end() }
  })
  const connection = () => ({ execute: async (sql: string, parameters: unknown[]) => {
    let parameter = 0
    return (await client.query(sql.replace(/\?/g, () => '$' + (++parameter)), parameters)).rows
  } })
  async function row(bucket = 'a', id = '9007199254740993'): Promise<MaintenanceRow> {
    return (await client.query('SELECT * FROM records WHERE bucket=$1 AND id=$2', [bucket, id])).rows[0]
  }
  test('complete composite identities preserve native JSON, binary, boolean and NULL comparisons', async () => {
    const first = await row(), second = await row('a', '9007199254740994')
    const writes = [
      { row: first, updates: { secret: 'large-' + 'x'.repeat(65536), bytes: Buffer.from([0, 1, 255, 34]), payload: { next: ['日本語', null], nested: { ok: true } }, flag: true } },
      { row: second, updates: { secret: null, bytes: null, payload: null, flag: null } },
    ]
    for (const write of writes) await writeMaintenanceRow(connection(), '"public"."records"', ['bucket', 'id'], write.row, write.updates, scope)
    await expect(verifyMaintenanceBatch(connection(), '"public"."records"', ['bucket', 'id'], writes, scope)).resolves.toBeUndefined()
    // The repeated bigint in a different first-key group cannot stand in for a missing row.
    await client.query('DELETE FROM records WHERE bucket=$1 AND id=$2', ['a', '9007199254740994'])
    await expect(verifyMaintenanceBatch(connection(), '"public"."records"', ['bucket', 'id'], writes, scope)).rejects.toThrow('did not match')
  })
  test('an AFTER trigger can change a committed value after UPDATE RETURNING and must fail readback', async () => {
    await client.query(`CREATE FUNCTION change_after_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.secret='intended' THEN UPDATE records SET secret='trigger-corruption' WHERE bucket=NEW.bucket AND id=NEW.id; END IF; RETURN NULL; END $$;
      CREATE TRIGGER change_after_write AFTER UPDATE OF secret ON records FOR EACH ROW EXECUTE FUNCTION change_after_write()`)
    const original = await row(), updates = { secret: 'intended' }
    await expect(writeMaintenanceRow(connection(), '"public"."records"', ['bucket', 'id'], original, updates, scope)).resolves.toBeUndefined()
    expect((await row()).secret).toBe('trigger-corruption')
    await expect(verifyMaintenanceBatch(connection(), '"public"."records"', ['bucket', 'id'], [{ row: original, updates }], scope)).rejects.toThrow('did not match')
  })
  test('a matching value outside the requested tenant scope cannot certify the batch', async () => {
    const original = await row(), updates = { secret: 'original' }
    await client.query('UPDATE records SET tenant_id=$1 WHERE bucket=$2 AND id=$3', [randomUUID(), 'a', '9007199254740993'])
    await expect(verifyMaintenanceBatch(connection(), '"public"."records"', ['bucket', 'id'], [{ row: original, updates }], scope)).rejects.toThrow('did not match')
  })
})
