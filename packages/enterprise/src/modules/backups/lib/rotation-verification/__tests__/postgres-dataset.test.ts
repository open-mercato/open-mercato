import { Client } from 'pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { mkdtemp, rm, mkdir, writeFile, appendFile, readdir, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDerivedKeyKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { rotateCustomEntityDocuments } from '@open-mercato/core/modules/entities/lib/rotate-custom-entity-documents'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createConfiguredRotationProtection } from '../runtime'
import { generateX25519Identity, identityToRecipient } from '../../engine/crypto'
import { encryptWithAesGcm, decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import * as moduleRegistry from '@open-mercato/shared/modules/registry'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { canonicalRotationTimestamp, createPostgresRotationDataset } from '../postgres-dataset'
import { prepareRotationVerification, verifyRotationData } from '../verifier'
import { RotationArtifactStore } from '../store'
import { createPostgresTarget, restoreBackup, verifyBackup, identitiesFromFile } from '../../engine'

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
    await administrator.query(`CREATE DATABASE "${database}" CONNECTION LIMIT 0`)
    await administrator.end()
    base.pathname = `/${database}`
    client = new Client({ connectionString: base.toString(), statement_timeout: 900000, lock_timeout: 30000 }); await client.connect()
    await client.query(`CREATE TABLE fixture_records(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,organization_id uuid,secret text,exact numeric,other jsonb,deleted_at timestamptz);
      CREATE TABLE encryption_maps(id uuid PRIMARY KEY,entity_id text,tenant_id uuid,organization_id uuid,fields_json jsonb,is_active boolean,deleted_at timestamptz);
      CREATE TABLE custom_field_defs(id uuid PRIMARY KEY,entity_id text,tenant_id uuid,organization_id uuid,key text,kind text DEFAULT 'text',config_json jsonb,is_active boolean DEFAULT true,updated_at timestamptz DEFAULT now(),deleted_at timestamptz);`)
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
  test('installed ORM cancels an in-flight statement and releases its connection within fifteen seconds', async () => {
    const orm = await MikroORM.init({ clientUrl: base.toString(), entities: [], discovery: { warnWhenNoEntities: false }, pool: { min: 0, max: 2 } })
    const controller = new AbortController(); const started = Date.now()
    const timer = setTimeout(() => controller.abort(), 250)
    try {
      await expect(orm.em.fork().execute('SELECT pg_sleep(30)', [], { signal: controller.signal, inflightQueryAbortStrategy: 'cancel query' })).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(15000)
      await expect(orm.em.fork().execute('SELECT 1 AS ready')).resolves.toEqual([{ ready: 1 }])
    } finally { clearTimeout(timer); await orm.close(true) }
  }, 20000)
  async function inputContext(connection = client) {
    const maps = (await client.query('SELECT * FROM encryption_maps')).rows.map((row) => ({ id: row.id, entityId: row.entity_id, tenantId: row.tenant_id, organizationId: row.organization_id, fieldsJson: row.fields_json, isActive: row.is_active, deletedAt: row.deleted_at }))
    const entityManager = {
      execute: async (query: string, parameters: unknown[]) => {
        let parameter = 0
        return (await connection.query(query.replace(/\?/g, () => `$${++parameter}`), parameters)).rows
      },
      find: async (entity: { name: string }) => entity.name === 'EncryptionMap' ? maps : (await connection.query('SELECT id,entity_id AS "entityId",tenant_id AS "tenantId",organization_id AS "organizationId",key,kind,config_json AS "configJson",is_active AS "isActive",updated_at AS "updatedAt",deleted_at AS "deletedAt" FROM custom_field_defs ORDER BY id')).rows,
      getMetadata: () => ({ getAll: () => [{ className: 'FixtureRecord', tableName: 'fixture_records', schema: 'public', primaryKeys: ['id'], properties: { id: { name: 'id', fieldNames: ['id'] }, secret: { name: 'secret', fieldNames: ['secret'] } } }] }),
      getConnection: () => ({ close: async () => { await connection.end() }, execute: async (query: string, parameters: unknown[]) => {
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
    await writeFile(join(bin, 'pg_restore'), `#!/bin/sh\nif [ "$1" = "--list" ]; then\n  exec '${docker}' exec -i '${container}' pg_restore --list < "$2"\nfi\nfor file in "$@"; do\n  if [ -f "$file" ]; then\n    '${docker}' exec '${container}' mkdir -p "$(/usr/bin/dirname "$file")"\n    '${docker}' cp "$file" '${container}':"$file"\n  fi\ndone\nexec '${docker}' exec -i -e PGSERVICEFILE='${containerFile}' -e PGPASSFILE='${passwordFile}' '${container}' pg_restore "$@"\n`, { mode: 0o700 })
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
  async function customFixture(plaintext = false) {
    await client.query('CREATE TABLE custom_entities_storage(id uuid PRIMARY KEY,entity_type text,tenant_id uuid,organization_id uuid,doc jsonb,updated_at timestamptz NOT NULL)')
    const id = randomUUID()
    await client.query('INSERT INTO custom_entities_storage VALUES($1,$2,$3,NULL,$4,$5)', [id, 'test:dynamic', tenantId, JSON.stringify({ secret: plaintext ? 'legacy-plaintext' : encryptWithAesGcm('dynamic-secret', source).value, untouched: { nested: [null, '日本語'] } }), '2026-01-02 03:04:05.123456+00'])
    await client.query('INSERT INTO custom_field_defs(id,entity_id,tenant_id,key,config_json) VALUES($1,$2,$3,$4,$5)', [randomUUID(), 'test:dynamic', tenantId, 'secret', JSON.stringify({ encrypted: true })])
  }
  test('custom rotation bounds its PK frontier before definition filtering and advances empty eligible pages', async () => {
    await customFixture(false)
    await client.query('DELETE FROM custom_entities_storage')
    for (let index = 1; index <= 9; index++) await client.query(
      'INSERT INTO custom_entities_storage VALUES($1,$2,$3,NULL,$4,now())',
      [`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, index === 9 ? 'test:dynamic' : 'test:no-definition', tenantId,
        JSON.stringify({ secret: encryptWithAesGcm('dynamic-secret', source).value })],
    )
    const context = await inputContext(); const connection = context.entityManager.getConnection()
    const queries: Array<{ sql: string; parameters: unknown[] }> = []
    context.entityManager.getConnection = () => ({ execute: async (sql: string, parameters: unknown[]) => {
      queries.push({ sql, parameters }); return connection.execute(sql, parameters)
    } }) as ReturnType<EntityManager['getConnection']>
    const checkpoints: Array<{cursor: string[];readRows:number;writtenRows:number}> = []
    const updated = await rotateCustomEntityDocuments(context.entityManager, {
      tenantId, organizationId: null, dryRun: false, oldKms: createDerivedKeyKmsService(sourceSecret),
      encryptionService: new TenantDataEncryptionService(context.entityManager, { kms: createDerivedKeyKmsService(targetSecret) }),
      checkpointBatch: async checkpoint => { checkpoints.push(checkpoint) },
    })
    expect(updated).toBe(1)
    expect(checkpoints[0]).toMatchObject({ cursor: ['00000000-0000-4000-8000-000000000008'], readRows: 8, writtenRows: 0 })
    const rows = (await client.query('SELECT id,doc FROM custom_entities_storage ORDER BY id')).rows
    expect(decryptWithAesGcm(rows[0].doc.secret, source)).toBe('dynamic-secret')
    expect(decryptWithAesGcm(rows[8].doc.secret, target)).toBe('dynamic-secret')
    const query = queries.find(entry => entry.sql.startsWith('select id'))!
    let parameter = 0
    const plan = (await client.query('EXPLAIN (ANALYZE,FORMAT JSON) '+query.sql.replace(/\?/g, () => `$${++parameter}`), query.parameters)).rows[0]['QUERY PLAN'][0].Plan
    type Plan = { 'Subplan Name'?: string; Plans?: Plan[]; [key: string]: unknown }
    const descendants = (node: Plan): Plan[] => [node, ...(node.Plans ?? []).flatMap(descendants)]
    const frontier = descendants(plan).find(node => node['Subplan Name'] === 'CTE frontier')!
    expect(frontier['Node Type']).toBe('Limit')
    expect(frontier['Actual Rows']).toBe(8)
  })
  test('production protection covers custom JSON and exact authenticated timestamp batches through the real Core helper', async () => {
    await customFixture()
    const environment = await runtimeEnvironment(); const context = await inputContext()
    await createConfiguredRotationProtection(environment).protect(context, async (providers) => {
      if (!providers) throw new Error('Expected pinned protection')
      await rotate()
      await rotateCustomEntityDocuments(context.entityManager, { tenantId, organizationId: null, dryRun: false, oldKms: providers.previousKms, encryptionService: new TenantDataEncryptionService(context.entityManager, { kms: providers.kms }), batchSize: providers.batchSize, timestampForBatchWrite: providers.timestampForBatchWrite, timestampForWrite: providers.timestampForWrite, resumeCursor: providers.resumeCursor, checkpointBatch: providers.checkpointBatch })
    })
    const row = (await client.query('SELECT doc,updated_at::text FROM custom_entities_storage')).rows[0]
    expect(decryptWithAesGcm(row.doc.secret, target)).toBe('dynamic-secret')
    expect(row.doc.untouched).toEqual({ nested: [null, '日本語'] })
  }, 60000)
  test('failed persisted verification retains a recoverable encrypted preimage and the prior-DEK canary', async () => {
    const environment = await runtimeEnvironment()
    const sourceRow = (await client.query('SELECT id,secret FROM fixture_records ORDER BY id LIMIT 1')).rows[0]
    const expected = decryptWithAesGcm(sourceRow.secret, source)
    await expect(createConfiguredRotationProtection(environment).protect(await inputContext(), async () => {
      await rotate()
      await client.query('UPDATE fixture_records SET secret=$1 WHERE id=$2', [encryptWithAesGcm('wrong-but-valid', target).value, sourceRow.id])
    })).rejects.toThrow('ROTATION_DATA_MISMATCH')
    const reports = await readdir(environment.OM_ROTATION_TRUST_ROOT!)
    const failure = JSON.parse(await readFile(join(environment.OM_ROTATION_TRUST_ROOT!, reports.find(name => name.includes('.failure.'))!), 'utf8'))
    expect(failure).toMatchObject({ status: 'failed', errorCode: 'ROTATION_DATA_MISMATCH' })
    expect(reports.some(name => name.endsWith('.report.json'))).toBe(false)
    const targetDatabase = `rotation_drill_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE DATABASE "${targetDatabase}" TEMPLATE template0`)
    try {
      const service = (port: string) => `\n[target]\nhost=127.0.0.1\nport=${port}\ndbname=${targetDatabase}\nuser=postgres\nsslmode=disable\n`
      await appendFile(environment.PGSERVICEFILE!, service(base.port))
      const containerFile = join(directory, 'container.conf'); await appendFile(containerFile, service('5432'))
      execFileSync('docker', ['cp', containerFile, `${process.env.OM_ROTATION_TEST_CONTAINER ?? 'om-pg-9334-fixture'}:${containerFile}`])
      const identities = await identitiesFromFile(environment.OM_ROTATION_IDENTITIES_FILE!)
      const workspace = join(directory, 'restore-workspace'); await mkdir(workspace, { mode: 0o700 })
      const common = { artifact: failure.recoveryArtifact, trustedManifestSha256: failure.recoveryDigest, identities, binariesDir: environment.OM_BACKUP_BINARIES_DIR!, workspace }
      const verified = await verifyBackup(common)
      const restoreTarget = createPostgresTarget({ binariesDir: environment.OM_BACKUP_BINARIES_DIR!, serviceFile: environment.PGSERVICEFILE!, passwordFile: environment.PGPASSFILE!, targetService: 'target' })
      const confirmation = await restoreTarget.challenge({ backupId: verified.manifest.backupId, manifestSha256: failure.recoveryDigest, sourceIdentity: verified.index.identity })
      const restored = await restoreBackup({ ...common, target: restoreTarget, confirmation, afterDataVerified: async () => {
        const url = new URL(base); url.pathname = `/${targetDatabase}`
        const recovered = new Client({ connectionString: url.toString() }); await recovered.connect()
        try {
          const row = (await recovered.query('SELECT secret FROM fixture_records WHERE id=$1', [sourceRow.id])).rows[0]
          expect(decryptWithAesGcm(row.secret, source)).toBe(expected)
          expect(decryptWithAesGcm(row.secret, target)).toBeNull()
        } finally { await recovered.end() }
        return { keyRecovery: { status: 'passed', testedCanaries: 1 }, checks: [{ type: 'prior-dek-canary', status: 'passed' }] }
      } })
      expect(restored).toMatchObject({ status: 'completed', quarantined: true, promotionReady: false })
    } finally { await client.query(`DROP DATABASE "${targetDatabase}" WITH (FORCE)`) }
  }, 90000)
  test('detects precision loss in a valid re-encrypted JSON numeric value', async () => {
    const id = (await client.query('SELECT id FROM fixture_records ORDER BY id LIMIT 1')).rows[0].id
    await client.query('UPDATE fixture_records SET secret=$1 WHERE id=$2', [encryptWithAesGcm('{"n":1.0000000000000000001}', source).value, id])
    const data = await dataset(); const artifacts = store(); const prepared = await prepareRotationVerification(data, artifacts)
    await rotate()
    await client.query('UPDATE fixture_records SET secret=$1 WHERE id=$2', [encryptWithAesGcm('{"n":1}', target).value, id])
    await expect(verifyRotationData(prepared, data, artifacts)).rejects.toThrow('DATA_MISMATCH')
  })
  test('protected custom rotation preserves untouched high precision JSON numbers', async () => {
    await customFixture(false)
    await client.query(`UPDATE custom_entities_storage SET doc=jsonb_set(doc,'{untouched,exact}','1.0000000000000000001'::jsonb)`)
    const environment = await runtimeEnvironment(); const context = await inputContext()
    await createConfiguredRotationProtection(environment).protect(context, async providers => {
      await rotate()
      await rotateCustomEntityDocuments(context.entityManager, { tenantId, organizationId: null, dryRun: false, oldKms: providers!.previousKms, encryptionService: new TenantDataEncryptionService(context.entityManager, { kms: providers!.kms }), batchSize: providers!.batchSize, timestampForBatchWrite: providers!.timestampForBatchWrite, resumeCursor: providers!.resumeCursor, checkpointBatch: providers!.checkpointBatch })
    })
    expect((await client.query("SELECT (doc->'untouched'->'exact')::text AS exact FROM custom_entities_storage")).rows[0].exact).toBe('1.0000000000000000001')
  }, 60000)
  test.each(['float', 'json'])('preserves exact encrypted custom %s payloads without domain conversion', async kind => {
    await customFixture(false)
    const payload = kind === 'float' ? '1.0000000000000000001' : '{"n":1.0000000000000000001}'
    await client.query('UPDATE custom_field_defs SET kind=$1', [kind])
    await client.query("UPDATE custom_entities_storage SET doc=jsonb_set(doc,'{secret}',to_jsonb($1::text))", [encryptWithAesGcm(payload, source).value])
    const environment = await runtimeEnvironment(); const context = await inputContext()
    await createConfiguredRotationProtection(environment).protect(context, async providers => {
      await rotate()
      await rotateCustomEntityDocuments(context.entityManager, { tenantId, organizationId: null, dryRun: false, oldKms: providers!.previousKms, encryptionService: new TenantDataEncryptionService(context.entityManager, { kms: providers!.kms }), batchSize: providers!.batchSize, timestampForBatchWrite: providers!.timestampForBatchWrite, resumeCursor: providers!.resumeCursor, checkpointBatch: providers!.checkpointBatch })
    })
    const ciphertext = (await client.query("SELECT doc->>'secret' AS secret FROM custom_entities_storage")).rows[0].secret
    expect(decryptWithAesGcm(ciphertext, target)).toBe(payload)
  }, 60000)
  test('includes prototype-named custom document properties in the logical checksum', async () => {
    await customFixture(false)
    await client.query(`UPDATE custom_entities_storage SET doc=doc || '{"__proto__":"before"}'::jsonb`)
    const data = await dataset(); const artifacts = store(); const prepared = await prepareRotationVerification(data, artifacts)
    await rotate()
    await client.query(`UPDATE custom_entities_storage SET doc=jsonb_set(jsonb_set(doc,'{secret}',to_jsonb($1::text)),'{__proto__}','"after"'::jsonb)`, [encryptWithAesGcm('dynamic-secret', target).value])
    await expect(verifyRotationData(prepared, data, artifacts)).rejects.toThrow('DATA_MISMATCH')
  })
  test('an explicit empty CLI exclusion list is authoritative over an unrelated API registry', async () => {
    const defaults = jest.spyOn(moduleRegistry, 'getDefaultEncryptionMaps').mockReturnValue([{ entityId: 'test:record', keyScope: 'system', fields: [{ field: 'secret' }] }])
    try {
      const context = { ...await inputContext(), systemScopedEntityIds: [] }
      const data = await createPostgresRotationDataset({ context, providers: { previousKms: createDerivedKeyKmsService(sourceSecret), kms: createDerivedKeyKmsService(targetSecret) }, backupDigest: 'a'.repeat(64), provider: 'explicit' })
      const artifacts = store(); await prepareRotationVerification(data, artifacts)
      expect(JSON.parse((await artifacts.read('header')).toString()).rows).toBe(19)
      expect(defaults).not.toHaveBeenCalled()
    } finally { defaults.mockRestore() }
  })
  test('preserves empty and NULL mapped values across rotation and verifies the empty target envelope', async () => {
    const ids = (await client.query('SELECT id FROM fixture_records ORDER BY id LIMIT 2')).rows.map(row => row.id)
    await client.query('UPDATE fixture_records SET secret=$1 WHERE id=$2', [encryptWithAesGcm('', source).value, ids[0]])
    await client.query('UPDATE fixture_records SET secret=NULL WHERE id=$1', [ids[1]])
    const data = await dataset(); const artifacts = store(); const prepared = await prepareRotationVerification(data, artifacts)
    for (const row of (await client.query('SELECT id,secret FROM fixture_records')).rows) if (row.secret !== null) await client.query('UPDATE fixture_records SET secret=$1 WHERE id=$2', [encryptWithAesGcm(decryptWithAesGcm(row.secret, source)!, target).value, row.id])
    await expect(verifyRotationData(prepared, data, artifacts)).resolves.toMatchObject({ status: 'passed', comparedRows: '19' })
    expect(decryptWithAesGcm((await client.query('SELECT secret FROM fixture_records WHERE id=$1', [ids[0]])).rows[0].secret, target)).toBe('')
    expect((await client.query('SELECT secret FROM fixture_records WHERE id=$1', [ids[1]])).rows[0].secret).toBeNull()
  })
  test('plaintext in a custom field requiring encryption refuses before mutation', async () => {
    await customFixture(true)
    const data = await dataset(); const operation = jest.fn()
    await expect(prepareRotationVerification(data, store()).then(operation)).rejects.toThrow('ROTATION_CUSTOM_PLAINTEXT_UNSUPPORTED')
    expect(operation).not.toHaveBeenCalled()
  })
  test.each(['inactive', 'deleted'])('historical %s encrypted custom definitions reject plaintext before mutation', async history => {
    await customFixture(true)
    await client.query(history === 'inactive' ? 'UPDATE custom_field_defs SET is_active=false' : 'UPDATE custom_field_defs SET deleted_at=now()')
    const data = await dataset(); const operation = jest.fn()
    await expect(prepareRotationVerification(data, store()).then(operation)).rejects.toThrow('ROTATION_CUSTOM_PLAINTEXT_UNSUPPORTED')
    expect(operation).not.toHaveBeenCalled()
  })
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
  test('an encryption or lookup rule targeting identity/scope keys refuses before any mutation', async () => {
    await client.query('UPDATE encryption_maps SET fields_json=$1::jsonb', [JSON.stringify([{ field: 'secret', hashField: 'id' }])])
    const operation = jest.fn()
    await expect(dataset().then(operation)).rejects.toThrow('ROTATION_COVERAGE_UNSUPPORTED')
    expect(operation).not.toHaveBeenCalled()
    expect(decryptWithAesGcm((await client.query('SELECT secret FROM fixture_records LIMIT 1')).rows[0].secret, source)).not.toBeNull()
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
  test('refreshes a cached map before deriving encrypted-field coverage', async () => {
    await client.query('ALTER TABLE encryption_maps ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now(); ALTER TABLE fixture_records ADD COLUMN second_secret text')
    await client.query('UPDATE fixture_records SET second_secret=$1', [encryptWithAesGcm('second-private', source).value])
    const orm = await MikroORM.init({ clientUrl: base.toString(), entities: [EncryptionMap], pool: { min: 0, max: 2 } })
    const em = orm.em.fork()
    try {
      const cached = await em.findOneOrFail(EncryptionMap, { entityId: 'test:record' })
      expect(cached.fieldsJson).toEqual([{ field: 'secret' }])
      await client.query('UPDATE encryption_maps SET fields_json=$1', [JSON.stringify([{ field: 'secret' }, { field: 'secondSecret' }])])
      await orm.close(true) // retain identity-map objects while releasing the discovery-only session
      const context = await inputContext()
      context.entityManager.find = (async (...args: Parameters<typeof em.find>) => { const result = await em.find(...args); await orm.close(true); return result }) as typeof context.entityManager.find
      context.entityManager.getMetadata = (() => ({ getAll: () => [{ className: 'FixtureRecord', tableName: 'fixture_records', schema: 'public', primaryKeys: ['id'], properties: { id: { name: 'id', fieldNames: ['id'] }, secret: { name: 'secret', fieldNames: ['secret'] }, secondSecret: { name: 'secondSecret', fieldNames: ['second_secret'] } } }] })) as unknown as typeof context.entityManager.getMetadata
      const data = await createPostgresRotationDataset({ context, providers: { previousKms: createDerivedKeyKmsService(sourceSecret), kms: createDerivedKeyKmsService(targetSecret) }, backupDigest: 'a'.repeat(64), provider: 'explicit' })
      await orm.close(true) // return the discovery-only pool before enforcing the single maintenance session
      const artifacts = store(); const prepared = await prepareRotationVerification(data, artifacts)
      expect(cached.fieldsJson).toHaveLength(2)
      await rotate() // deliberately leave the newly mapped second field under the source key
      await expect(verifyRotationData(prepared, data, artifacts)).rejects.toThrow('DATA_MISMATCH')
    } finally { await orm.close(true) }
  })
  test('streams a near-limit large encrypted row and rejects an oversized row before mutation', async () => {
    const id = (await client.query('SELECT id FROM fixture_records ORDER BY id LIMIT 1')).rows[0].id
    await client.query('UPDATE fixture_records SET secret=$1 WHERE id=$2', [encryptWithAesGcm('x'.repeat(600 * 1024), source).value, id])
    const data = await dataset(); expect(data.maintenanceBatchRows).toBeLessThanOrEqual(8)
    const artifacts = store(); const prepared = await prepareRotationVerification(data, artifacts)
    await rotate()
    await expect(verifyRotationData(prepared, data, artifacts)).resolves.toMatchObject({ status: 'passed', comparedRows: '19' })
    await client.query('UPDATE fixture_records SET secret=$1 WHERE id=$2', [encryptWithAesGcm('x'.repeat(1024 * 1024), target).value, id])
    const mutate = jest.fn()
    await expect(dataset().then(mutate)).rejects.toThrow('COVERAGE_UNSUPPORTED')
    expect(mutate).not.toHaveBeenCalled()
  })
  test('refuses an oversized policy binding before loading policy payloads or mutating', async () => {
    await client.query(`CREATE POLICY oversized_binding ON fixture_records USING (secret='${'a'.repeat(4 * 1024 * 1024 + 4096)}')`)
    const mutate = jest.fn()
    await expect(dataset().then(mutate)).rejects.toThrow('COVERAGE_UNSUPPORTED')
    expect(mutate).not.toHaveBeenCalled()
  })
  test('refuses inherited rows with unprojected child columns before mutation', async () => {
    await client.query('CREATE TABLE child_records(child_secret text) INHERITS(fixture_records)')
    const mutate = jest.fn()
    await expect(dataset().then(mutate)).rejects.toThrow('RELATION_UNSUPPORTED')
    expect(mutate).not.toHaveBeenCalled()
  })
  test('refuses partitioned mappings with a child-only writer before mutation', async () => {
    const role = `partition_writer_${randomUUID().replaceAll('-', '')}`
    await client.query('DROP TABLE fixture_records; CREATE TABLE fixture_records(id uuid,tenant_id uuid NOT NULL,organization_id uuid,secret text,exact numeric,other jsonb,deleted_at timestamptz,PRIMARY KEY(id)) PARTITION BY HASH(id); CREATE TABLE fixture_partition PARTITION OF fixture_records FOR VALUES WITH (MODULUS 1,REMAINDER 0)')
    await client.query(`CREATE ROLE "${role}" LOGIN; GRANT UPDATE ON fixture_partition TO "${role}"`)
    try { await expect(dataset()).rejects.toThrow('RELATION_UNSUPPORTED') }
    finally { await client.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`) }
  })
  test('rejects a schema owner without table privileges before mutation', async () => {
    const role = `schema_owner_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE ROLE "${role}" LOGIN; ALTER SCHEMA public OWNER TO "${role}"`)
    try { await expect(dataset()).rejects.toThrow('DDL_PRIVILEGES_PRESENT') }
    finally { await client.query(`ALTER SCHEMA public OWNER TO postgres; DROP ROLE "${role}"`) }
  })
  test('global runtime admission is enforced before inventory or application configuration queries', async () => {
    const environment = await runtimeEnvironment(); const context = { ...await inputContext(), tenantId: null }
    await client.query(`ALTER DATABASE "${database}" CONNECTION LIMIT -1`)
    const execute = jest.spyOn(context.entityManager, 'execute'); const mutate = jest.fn()
    await expect(createConfiguredRotationProtection(environment).protect(context, mutate)).rejects.toThrow('ADMISSION_FENCE_REQUIRED')
    const queries = execute.mock.calls.map(call => String(call[0]))
    expect(queries[0]).toContain('FROM pg_roles')
    expect(queries.some(query => /encryption_maps|custom_entities_storage|custom_field_defs/.test(query))).toBe(false)
    expect(mutate).not.toHaveBeenCalled()
  })
  test('refuses an enabled logical-replication subscription before probing or mutating rows', async () => {
    const name = `rotation_subscription_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SUBSCRIPTION "${name}" CONNECTION 'host=127.0.0.1 port=9 dbname=isolated_unreachable user=isolated connect_timeout=1' PUBLICATION isolated_publication WITH (connect=false,enabled=false,create_slot=false,slot_name='${name}')`)
    try { await client.query(`ALTER SUBSCRIPTION "${name}" ENABLE`); await expect(dataset()).rejects.toThrow('LOGICAL_SUBSCRIPTIONS_ACTIVE') }
    finally { await client.query(`ALTER SUBSCRIPTION "${name}" DISABLE; ALTER SUBSCRIPTION "${name}" SET (slot_name=NONE); DROP SUBSCRIPTION "${name}"`) }
  })
  test.each(['view', 'security-definer'])('admission blocks an application user with indirect %s writes', async capability => {
    const role = `view_writer_${randomUUID().replaceAll('-', '')}`; const password = randomBytes(24).toString('hex')
    await client.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'; ALTER DATABASE "${database}" CONNECTION LIMIT -1`)
    if (capability === 'view') await client.query(`CREATE VIEW indirect_writer AS SELECT id,secret FROM fixture_records; GRANT UPDATE(secret),SELECT(id) ON indirect_writer TO "${role}"`)
    else await client.query(`CREATE FUNCTION indirect_writer() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$ UPDATE public.fixture_records SET secret='indirect-write' WHERE id=(SELECT id FROM public.fixture_records LIMIT 1) $body$; GRANT EXECUTE ON FUNCTION indirect_writer() TO "${role}"`)
    try {
      expect((await client.query("SELECT has_table_privilege($1,'fixture_records','UPDATE') AS direct", [role])).rows[0].direct).toBe(false)
      const url = new URL(base); url.username = role; url.password = password
      const application = new Client({ connectionString: url.toString() }); await application.connect()
      try { await application.query(capability === 'view' ? "UPDATE indirect_writer SET secret='indirect-write' WHERE id=(SELECT id FROM indirect_writer LIMIT 1)" : 'SELECT indirect_writer()') } finally { await application.end() }
      await expect(dataset()).rejects.toThrow('ADMISSION_FENCE_REQUIRED')
      await client.query(`ALTER DATABASE "${database}" CONNECTION LIMIT 0`)
      const denied = new Client({ connectionString: url.toString() })
      await expect(denied.connect()).rejects.toThrow('too many connections')
      await denied.end()
    } finally { await client.query(capability === 'view' ? 'DROP VIEW indirect_writer' : 'DROP FUNCTION indirect_writer()'); await client.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`) }
  })
  test('an idle ordinary connection established before admission closes prevents plan discovery', async () => {
    const role = `idle_reader_${randomUUID().replaceAll('-', '')}`; const password = randomBytes(24).toString('hex')
    await client.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'; ALTER DATABASE "${database}" CONNECTION LIMIT -1`)
    const url = new URL(base); url.username = role; url.password = password
    const idle = new Client({ connectionString: url.toString() }); await idle.connect()
    try {
      await client.query(`ALTER DATABASE "${database}" CONNECTION LIMIT 0`)
      await expect(dataset()).rejects.toThrow('WRITERS_ACTIVE')
    } finally { await idle.end(); await client.query(`DROP ROLE "${role}"`) }
  })
  test('rejects a column-only independent UPDATE grant before probing or mutating rows', async () => {
    const role = `column_writer_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE ROLE "${role}" LOGIN; GRANT UPDATE(secret) ON fixture_records TO "${role}"`)
    const mutate = jest.fn()
    try { await expect(dataset().then(mutate)).rejects.toThrow('WRITER_PRIVILEGES_PRESENT'); expect(mutate).not.toHaveBeenCalled() }
    finally { await client.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`) }
  })
  test('rejects a still-authorized independent writer role before mutation', async () => {
    const role = `writer_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE ROLE "${role}" LOGIN; GRANT UPDATE ON fixture_records TO "${role}"`)
    try { await expect(dataset()).rejects.toThrow('ROTATION_WRITER_PRIVILEGES_PRESENT') }
    finally { await client.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`) }
  })
  test('RLS and FORCE RLS hidden rows cannot certify an identical empty subset', async () => {
    const role = `reader_${randomUUID().replaceAll('-', '')}`
    const password = randomBytes(24).toString('hex')
    await client.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}"; ALTER TABLE fixture_records ENABLE ROW LEVEL SECURITY; ALTER TABLE fixture_records FORCE ROW LEVEL SECURITY; CREATE POLICY invisible ON fixture_records USING(false)`)
    const restrictedUrl = new URL(base); restrictedUrl.username = role; restrictedUrl.password = password
    await client.query(`ALTER DATABASE "${database}" CONNECTION LIMIT -1`)
    const restricted = new Client({ connectionString: restrictedUrl.toString() }); await restricted.connect()
    await client.query(`ALTER DATABASE "${database}" CONNECTION LIMIT 0`)
    try {
      await expect(dataset(restricted)).rejects.toThrow('ROTATION_RLS_VISIBILITY_UNPROVEN')
    } finally { await restricted.end(); await client.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`) }
  })
})

test('timestamp canonicalization preserves microseconds and timezone equivalence', () => {
  expect(canonicalRotationTimestamp('2026-01-02 03:04:05.123456+01')).toBe('2026-01-02T02:04:05.123456Z')
  expect(canonicalRotationTimestamp(new Date('2026-01-02T03:04:05.123Z'))).toBe('2026-01-02T03:04:05.123000Z')
})
