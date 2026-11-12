import { Client } from 'pg'
import { randomBytes, randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDerivedKeyKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { createConfiguredRotationProtection } from '../runtime'
import { generateX25519Identity, identityToRecipient } from '../../engine/crypto'
import { encryptWithAesGcm, decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { canonicalRotationTimestamp, createPostgresRotationDataset } from '../postgres-dataset'
import { prepareRotationVerification, verifyRotationData } from '../verifier'
import { RotationArtifactStore } from '../store'

const native = process.env.OM_ROTATION_TEST_DATABASE_URL ? describe : describe.skip
const tenantId = '11111111-1111-4111-8111-111111111111'
const sourceSecret = 'isolated-old-root-rotation-9334'
const targetSecret = 'isolated-new-root-rotation-9334'
let source: string
let target: string
const encryption = randomBytes(32).toString('base64')

native('native PostgreSQL persisted verification', () => {
  let client: Client
  let database: string
  let directory: string
  let base: URL
  beforeEach(async () => {
    source = (await createDerivedKeyKmsService(sourceSecret).getTenantDek(tenantId))!.key
    target = (await createDerivedKeyKmsService(targetSecret).getTenantDek(tenantId))!.key
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
      CREATE TABLE custom_field_defs(id uuid PRIMARY KEY,entity_id text,tenant_id uuid,organization_id uuid,key text,config_json jsonb,is_active boolean DEFAULT true,updated_at timestamptz DEFAULT now(),deleted_at timestamptz);`)
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
  async function inputContext(connection = client) {
    const maps = (await client.query('SELECT * FROM encryption_maps')).rows.map((row) => ({ id: row.id, entityId: row.entity_id, tenantId: row.tenant_id, organizationId: row.organization_id, fieldsJson: row.fields_json, isActive: row.is_active, deletedAt: row.deleted_at }))
    const entityManager = {
      find: async () => maps,
      getMetadata: () => ({ getAll: () => [{ className: 'FixtureRecord', tableName: 'fixture_records', schema: 'public', primaryKeys: ['id'], properties: { id: { name: 'id', fieldNames: ['id'] }, secret: { name: 'secret', fieldNames: ['secret'] } } }] }),
      getConnection: () => ({ execute: async (query: string, parameters: unknown[]) => {
        let parameter = 0
        return (await connection.query(query.replace(/\?/g, () => `$${++parameter}`), parameters)).rows
      } }),
    } as unknown as EntityManager
    return { tenantId, organizationId: null, dryRun: false, entityManager, previousKey: sourceSecret }
  }
  async function dataset(connection = client) {
    return createPostgresRotationDataset({
      context: await inputContext(connection),
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
  async function runtimeEnvironment(): Promise<NodeJS.ProcessEnv> {
    const bin = join(directory, 'bin'); await mkdir(bin, { mode: 0o700 })
    const serviceFile = join(directory, 'service.conf'); const containerFile = join(directory, 'container.conf'); const passwordFile = join(directory, 'password')
    const service = (port: string) => `[source]\nhost=127.0.0.1\nport=${port}\ndbname=${database}\nuser=postgres\nsslmode=disable\n`
    await writeFile(serviceFile, service(base.port), { mode: 0o600 }); await writeFile(containerFile, service('5432'), { mode: 0o600 })
    await writeFile(passwordFile, `*:*:*:postgres:${base.password}\n`, { mode: 0o600 })
    const docker = execFileSync('which', ['docker'], { encoding: 'utf8' }).trim()
    const container = process.env.OM_ROTATION_TEST_CONTAINER ?? 'om-pg-9334-fixture'
    if (!/^[A-Za-z0-9_.-]+$/.test(container)) throw new Error('Invalid isolated container')
    execFileSync(docker, ['exec', container, 'mkdir', '-p', directory])
    execFileSync(docker, ['cp', containerFile, `${container}:${containerFile}`])
    execFileSync(docker, ['cp', passwordFile, `${container}:${passwordFile}`])
    for (const name of ['pg_dump', 'pg_restore', 'psql']) await writeFile(join(bin, name), `#!/bin/sh\nexec '${docker}' exec -i -e PGSERVICEFILE='${containerFile}' -e PGPASSFILE='${passwordFile}' '${container}' ${name} "$@"\n`, { mode: 0o700 })
    const identity = await generateX25519Identity(); const recipient = await identityToRecipient(identity)
    const recipientsFile = join(directory, 'recipients'); const identitiesFile = join(directory, 'identities')
    await writeFile(recipientsFile, recipient+'\n', { mode: 0o600 }); await writeFile(identitiesFile, identity+'\n', { mode: 0o600 })
    return {
      OM_ENABLE_ENTERPRISE_MODULES: 'true', OM_ENABLE_ENTERPRISE_MODULES_BACKUPS: 'true', OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED: 'true',
      OM_ROTATION_KMS_PROVIDER: 'derived', TENANT_DATA_ENCRYPTION_KEY: targetSecret,
      OM_ROTATION_RECIPIENTS_FILE: recipientsFile, OM_ROTATION_IDENTITIES_FILE: identitiesFile,
      OM_ROTATION_ARTIFACT_ROOT: join(directory, 'rotation-artifacts'), OM_ROTATION_TRUST_ROOT: join(directory, 'rotation-trust'),
      OM_ROTATION_BACKUP_OUTPUT: join(directory, 'backups'), OM_ROTATION_BACKUP_WORKSPACE: join(directory, 'workspace'),
      OM_ROTATION_BACKUP_SOURCE_SERVICE: 'source', OM_BACKUP_BINARIES_DIR: bin, PGSERVICEFILE: serviceFile, PGPASSFILE: passwordFile,
    }
  }
  test('production protection performs real encrypted backup, pinned rotation and final persisted verification', async () => {
    const environment = await runtimeEnvironment()
    const protection = createConfiguredRotationProtection(environment)
    await protection.protect(await inputContext(), async (providers) => {
      expect(await providers?.kms.getTenantDek(tenantId)).toMatchObject({ key: target })
      await rotate()
    })
    const trust = await readdir(environment.OM_ROTATION_TRUST_ROOT!)
    const report = JSON.parse(await readFile(join(environment.OM_ROTATION_TRUST_ROOT!, trust.find((name) => name.endsWith('.report.json'))!), 'utf8'))
    expect(report).toMatchObject({ status: 'passed', comparedRows: '19' })
    expect(trust).not.toContain('rotation.lock')
  }, 60000)
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
  test('native bigint composite-safe pagination covers every row and rejects corruption in formerly skipped id5', async () => {
    await client.query('ALTER TABLE fixture_records DROP CONSTRAINT fixture_records_pkey; ALTER TABLE fixture_records DROP COLUMN id; ALTER TABLE fixture_records ADD COLUMN id bigserial PRIMARY KEY')
    const data = await dataset(); const artifacts = store(); const prepared = await prepareRotationVerification(data, artifacts)
    const header = JSON.parse((await artifacts.read('header')).toString())
    expect(header.rows).toBe(19)
    await rotate()
    await client.query('UPDATE fixture_records SET secret=$1 WHERE id=5', [encryptWithAesGcm('wrong-at-five', target).value])
    await expect(verifyRotationData(prepared, data, artifacts)).rejects.toThrow('ROTATION_DATA_MISMATCH')
  })
  test('rejects ciphertext left under the previous key', async () => {
    const data = await dataset(); const artifacts = store(); const prepared = await prepareRotationVerification(data, artifacts)
    await expect(verifyRotationData(prepared, data, artifacts)).rejects.toThrow('ROTATION_DATA_MISMATCH')
  })
  test('global fallback without a matching tenant executor refuses before mutation rather than certifying only custom storage', async () => {
    await client.query('UPDATE encryption_maps SET tenant_id=NULL')
    const data = await dataset(); const operation = jest.fn()
    await expect(prepareRotationVerification(data, store()).then(operation)).rejects.toThrow('ROTATION_GLOBAL_FALLBACK_UNSUPPORTED')
    expect(operation).not.toHaveBeenCalled()
  })
  test('global fallback sharing an executable tenant field remains covered', async () => {
    await client.query('INSERT INTO encryption_maps SELECT $1,entity_id,NULL,NULL,fields_json,true,NULL FROM encryption_maps LIMIT 1', [randomUUID()])
    const data = await dataset(); const artifacts = store(); const prepared = await prepareRotationVerification(data, artifacts)
    await rotate()
    await expect(verifyRotationData(prepared, data, artifacts)).resolves.toMatchObject({ comparedRows: '19' })
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
