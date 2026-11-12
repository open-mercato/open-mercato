import { Client } from 'pg'
import { randomBytes, randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encryptWithAesGcm, decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { canonicalRotationTimestamp, createPostgresRotationDataset } from '../postgres-dataset'
import { prepareRotationVerification, verifyRotationData } from '../verifier'
import { RotationArtifactStore } from '../store'

const native = process.env.OM_ROTATION_TEST_DATABASE_URL ? describe : describe.skip
const tenantId = '11111111-1111-4111-8111-111111111111'
const source = randomBytes(32).toString('base64')
const target = randomBytes(32).toString('base64')
const encryption = randomBytes(32).toString('base64')

native('native PostgreSQL persisted verification', () => {
  let client: Client
  let database: string
  let directory: string
  let base: URL
  beforeEach(async () => {
    base = new URL(process.env.OM_ROTATION_TEST_DATABASE_URL!)
    const administrator = new Client({ connectionString: base.toString() })
    await administrator.connect()
    database = `rotation_${randomUUID().replaceAll('-', '')}`
    await administrator.query(`CREATE DATABASE "${database}"`)
    await administrator.end()
    base.pathname = `/${database}`
    client = new Client({ connectionString: base.toString() }); await client.connect()
    await client.query(`CREATE TABLE fixture_records(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,organization_id uuid,secret text,exact numeric,other jsonb,deleted_at timestamptz);
      CREATE TABLE encryption_maps(id uuid PRIMARY KEY,entity_id text,tenant_id uuid,organization_id uuid,fields_json jsonb,is_active boolean,deleted_at timestamptz);
      CREATE TABLE custom_field_defs(id uuid PRIMARY KEY,entity_id text,tenant_id uuid,organization_id uuid,key text,config_json jsonb);`)
    for (let index = 0; index < 19; index++) {
      await client.query('INSERT INTO fixture_records VALUES($1,$2,NULL,$3,$4,$5,$6)', [randomUUID(), tenantId, encryptWithAesGcm(`private-${index}`, source).value, '9007199254740993.1234', JSON.stringify({ unicode: '日本語', nested: [null, true] }), index === 18 ? new Date() : null])
    }
    await client.query('INSERT INTO encryption_maps VALUES($1,$2,$3,NULL,$4,true,NULL)', [randomUUID(), 'test:record', tenantId, JSON.stringify([{ field: 'secret' }])])
    directory = await mkdtemp(join(tmpdir(), 'native-rotation-'))
    registerEntityIds({ fixture: { FixtureRecord: 'test:record' } })
  })
  afterEach(async () => {
    await client?.end()
    const administrator = new Client({ connectionString: process.env.OM_ROTATION_TEST_DATABASE_URL! }); await administrator.connect()
    await administrator.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await administrator.end()
    await rm(directory, { recursive: true, force: true })
  })
  async function dataset(connection = client) {
    const maps = (await client.query('SELECT * FROM encryption_maps')).rows.map((row) => ({ id: row.id, entityId: row.entity_id, tenantId: row.tenant_id, organizationId: row.organization_id, fieldsJson: row.fields_json, isActive: row.is_active, deletedAt: row.deleted_at }))
    const entityManager = {
      find: async () => maps,
      getMetadata: () => ({ getAll: () => [{ className: 'FixtureRecord', tableName: 'fixture_records', schema: 'public', primaryKeys: ['id'], properties: { id: { name: 'id', fieldNames: ['id'] }, secret: { name: 'secret', fieldNames: ['secret'] } } }] }),
      getConnection: () => ({ execute: async (query: string, parameters: unknown[]) => {
        let parameter = 0
        return (await connection.query(query.replace(/\?/g, () => `$${++parameter}`), parameters)).rows
      } }),
    } as unknown as EntityManager
    return createPostgresRotationDataset({
      context: { tenantId, organizationId: null, dryRun: false, entityManager, previousKey: 'test-source' },
      providers: {
        previousKms: { isHealthy: () => true, getTenantDek: async () => ({ tenantId, key: source, fetchedAt: 0 }), createTenantDek: async () => null },
        kms: { isHealthy: () => true, getTenantDek: async () => ({ tenantId, key: target, fetchedAt: 0 }), createTenantDek: async () => null },
      }, backupDigest: 'a'.repeat(64), provider: 'test-pinned',
    })
  }
  const store = () => new RotationArtifactStore(join(directory, 'baseline'), {
    seal: async (bytes) => Buffer.from(encryptWithAesGcm(Buffer.from(bytes).toString('base64'), encryption).raw),
    open: async (bytes) => Buffer.from(decryptWithAesGcm(Buffer.from(bytes).toString(), encryption)!, 'base64'),
  })
  async function rotate() {
    for (const row of (await client.query('SELECT id,secret FROM fixture_records ORDER BY id')).rows) {
      await client.query('UPDATE fixture_records SET secret=$1 WHERE id=$2', [encryptWithAesGcm(decryptWithAesGcm(row.secret, source)!, target).value, row.id])
    }
  }
  test('compares committed data across three batches including high precision, JSON, NULL and soft deletes', async () => {
    const data = await dataset(); const artifacts = store()
    const prepared = await prepareRotationVerification(data, artifacts)
    await rotate()
    await expect(verifyRotationData(prepared, data, artifacts)).resolves.toMatchObject({ status: 'passed', comparedRows: '19' })
  })
  test('rejects a valid target ciphertext containing the wrong plaintext in final primary-key row', async () => {
    const data = await dataset(); const artifacts = store(); const prepared = await prepareRotationVerification(data, artifacts)
    await rotate()
    await client.query('UPDATE fixture_records SET secret=$1 WHERE id=(SELECT id FROM fixture_records ORDER BY id DESC LIMIT 1)', [encryptWithAesGcm('wrong', target).value])
    await expect(verifyRotationData(prepared, data, artifacts)).rejects.toThrow('ROTATION_DATA_MISMATCH')
  })
  test('rejects ciphertext left under the previous key', async () => {
    const data = await dataset(); const artifacts = store(); const prepared = await prepareRotationVerification(data, artifacts)
    await expect(verifyRotationData(prepared, data, artifacts)).rejects.toThrow('ROTATION_DATA_MISMATCH')
  })
  test('rejects a still-authorized independent writer role before mutation', async () => {
    const role = `writer_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE ROLE "${role}" LOGIN; GRANT UPDATE ON fixture_records TO "${role}"`)
    try { await expect((await dataset()).assertFence()).rejects.toThrow('ROTATION_WRITER_PRIVILEGES_PRESENT') }
    finally { await client.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`) }
  })
  test('RLS and FORCE RLS hidden rows cannot certify an identical empty subset', async () => {
    const role = `reader_${randomUUID().replaceAll('-', '')}`
    const password = randomBytes(24).toString('hex')
    await client.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}"; ALTER TABLE fixture_records ENABLE ROW LEVEL SECURITY; ALTER TABLE fixture_records FORCE ROW LEVEL SECURITY; CREATE POLICY invisible ON fixture_records USING(false)`)
    const restrictedUrl = new URL(base); restrictedUrl.username = role; restrictedUrl.password = password
    const restricted = new Client({ connectionString: restrictedUrl.toString() }); await restricted.connect()
    try {
      const data = await dataset(restricted)
      await expect(prepareRotationVerification(data, store())).rejects.toThrow('ROTATION_RLS_VISIBILITY_UNPROVEN')
    } finally { await restricted.end(); await client.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`) }
  })
})

test('timestamp canonicalization preserves microseconds and timezone equivalence', () => {
  expect(canonicalRotationTimestamp('2026-01-02 03:04:05.123456+01')).toBe('2026-01-02T02:04:05.123456Z')
  expect(canonicalRotationTimestamp(new Date('2026-01-02T03:04:05.123Z'))).toBe('2026-01-02T03:04:05.123000Z')
})
