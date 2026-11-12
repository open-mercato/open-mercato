import { Client } from 'pg'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { encryptWithAesGcm, decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { createDerivedKeyKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { EncryptionMap, CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { rotateCustomEntityDocuments } from '@open-mercato/core/modules/entities/lib/rotate-custom-entity-documents'
import { readMaintenanceBatches, writeMaintenanceRow, verifyMaintenanceBatch } from '@open-mercato/core/modules/entities/lib/rotation-maintenance'
import { createBackup, verifyBackup, createPostgresSource, type ProgressEvent } from '../../engine'
import type { RotationBatchCheckpoint } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { progressRenderer } from '../../engine/progress'
import { generateX25519Identity, identityToRecipient } from '../../engine/crypto'
import { createEnterpriseRotationProtection } from '../coordinator'
import { createPostgresRotationDataset } from '../postgres-dataset'
import { createRotationArtifactCipher } from '../age'
import { pinRotationProviders } from '../keys'

async function main() {
  if (process.env.OM_ROTATION_ISOLATED_BENCHMARK !== 'yes') throw new Error('Requires an explicitly isolated benchmark container')
  const gib = Number(process.argv[2] ?? 1)
  if (![1, 20].includes(gib)) throw new Error('Only 1GiB/20GiB acceptance fixtures supported')
  const root = process.argv[3] ?? `/bench/run-${gib}g-${randomUUID().slice(0, 8)}`
  if (!root.startsWith('/bench/run-')) throw new Error('Benchmark root must be an isolated generated run directory')
  const existing = process.argv[3] ? JSON.parse(await readFile(`${root}/input.json`, 'utf8')) as { database: string; sourceSecret: string; targetSecret: string } : undefined
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700)
  const config = { host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.POSTGRES_PASSWORD }
  const admin = new Client({ ...config, database: 'postgres' }); await admin.connect()
  const database = existing?.database ?? `rotation_benchmark_${gib}g_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  if (!/^rotation_benchmark_(1|20)g_[a-f0-9]{12}$/.test(database)) throw new Error('Invalid isolated benchmark database')
  if (!existing) await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0 CONNECTION LIMIT 0`); await admin.end()
  const client = new Client({ ...config, database, statement_timeout: 900000, lock_timeout: 30000 }); await client.connect()
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const sourceSecret = existing?.sourceSecret ?? randomBytes(48).toString('base64'); const targetSecret = existing?.targetSecret ?? randomBytes(48).toString('base64')
  const sourceKms = createDerivedKeyKmsService(sourceSecret); const targetKms = createDerivedKeyKmsService(targetSecret)
  const sourceKey = (await sourceKms.getTenantDek(tenantId))!.key; const targetKey = (await targetKms.getTenantDek(tenantId))!.key
  if (!existing) {
  await client.query(`CREATE TABLE bench_records(id bigint PRIMARY KEY,tenant_id uuid NOT NULL,organization_id uuid,secret text,other jsonb,deleted_at timestamptz);
    ALTER TABLE bench_records ALTER COLUMN secret SET STORAGE EXTERNAL;
    CREATE TABLE custom_entities_storage(id uuid PRIMARY KEY,entity_type text,tenant_id uuid,organization_id uuid,doc jsonb,updated_at timestamptz NOT NULL);
    ALTER TABLE custom_entities_storage ALTER COLUMN doc SET STORAGE EXTERNAL;
    CREATE TABLE encryption_maps(id uuid PRIMARY KEY,entity_id text,tenant_id uuid,organization_id uuid,fields_json jsonb,is_active boolean,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz);
    CREATE TABLE custom_field_defs(id uuid PRIMARY KEY,entity_id text,tenant_id uuid,organization_id uuid,key text,kind text,config_json jsonb,is_active boolean,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz);`)
  await client.query('INSERT INTO encryption_maps VALUES($1,$2,$3,NULL,$4,true,now(),now(),NULL)', [randomUUID(), 'benchmark:record', tenantId, JSON.stringify([{ field: 'secret' }])])
  await client.query('INSERT INTO custom_field_defs VALUES($1,$2,$3,NULL,$4,$5,$6,true,now(),now(),NULL)', [randomUUID(), 'benchmark:document', tenantId, 'secret', 'text', JSON.stringify({ encrypted: true })])
  }
  const perKindRows = gib * 8192
  const payload = randomBytes(48 * 1024).toString('base64')
  let peak = process.memoryUsage().rss
  const sampling = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 25); sampling.unref()
  const seedStarted = performance.now()
  if (!existing) {
  for (let index = 0; index < perKindRows; index += 8) {
    const scalar: unknown[] = []; const custom: unknown[] = []
    const scalarRows: string[] = []; const customRows: string[] = []
    for (let slot = 0; slot < 8; slot++) {
      const value = encryptWithAesGcm(payload, sourceKey).value
      const offset = scalar.length; scalar.push(String(index + slot + 1), tenantId, value)
      scalarRows.push(`($${offset + 1},$${offset + 2},NULL,$${offset + 3},'{"fixture":true}',NULL)`)
      const docOffset = custom.length; custom.push(randomUUID(), tenantId, JSON.stringify({ secret: encryptWithAesGcm(payload, sourceKey).value, untouched: { array: [null, true, '日本語'] } }))
      customRows.push(`($${docOffset + 1},'benchmark:document',$${docOffset + 2},NULL,$${docOffset + 3},'2026-01-02 03:04:05.123456+00')`)
    }
    await client.query(`INSERT INTO bench_records VALUES ${scalarRows.join(',')}`, scalar)
    await client.query(`INSERT INTO custom_entities_storage VALUES ${customRows.join(',')}`, custom)
    if (index % 8192 === 0) console.log(JSON.stringify({ phase: 'seeding', gib, rows: index * 2, rssMiB: Math.round(peak / 1024 / 1024) }))
  }
  await client.query('ANALYZE bench_records; ANALYZE custom_entities_storage')
  console.log(JSON.stringify({ phase: 'seeded', gib, logicalBytes: String(BigInt(perKindRows * 2) * BigInt(payload.length)), elapsedMs: Math.round(performance.now() - seedStarted) }))
  await writeFile(`${root}/input.json`, JSON.stringify({ database, sourceSecret, targetSecret }), { mode: 0o600 })
  console.log(JSON.stringify({ phase: 'fixture-ready', root, gib }))
  clearInterval(sampling); await client.end(); return
  }
  const properties = { id: { name: 'id', fieldNames: ['id'] }, secret: { name: 'secret', fieldNames: ['secret'] } }
  let earlyReadbackMs = 0
  const connection = { execute: async (sql: string, parameters: unknown[]) => {
    let number = 0; const started = performance.now()
    const result = await client.query(sql.replace(/\?/g, () => `$${++number}`), parameters)
    if (/^SELECT count\(\*\)::text AS verified/.test(sql) || /^select count\(\*\)::text as verified/.test(sql)) earlyReadbackMs += performance.now() - started
    return result.rows
  } }
  const em = {
    getConnection: () => connection,
    getMetadata: () => ({ getAll: () => [{ className: 'BenchRecord', tableName: 'bench_records', schema: 'public', primaryKeys: ['id'], properties }] }),
    find: async (entity: { name: string }) => entity.name === 'EncryptionMap'
      ? (await client.query('SELECT id,entity_id AS "entityId",tenant_id AS "tenantId",organization_id AS "organizationId",fields_json AS "fieldsJson",is_active AS "isActive",deleted_at AS "deletedAt" FROM encryption_maps ORDER BY id')).rows
      : (await client.query('SELECT id,entity_id AS "entityId",tenant_id AS "tenantId",organization_id AS "organizationId",key,kind,config_json AS "configJson",is_active AS "isActive",updated_at AS "updatedAt",deleted_at AS "deletedAt" FROM custom_field_defs ORDER BY id')).rows,
  } as unknown as EntityManager
  registerEntityIds({ benchmark: { BenchRecord: 'benchmark:record' } })
  const context = { entityManager: em, tenantId, organizationId: null, dryRun: false, previousKey: sourceSecret }
  const pinned = await pinRotationProviders([tenantId], { identity: 'benchmark-source-derived', service: sourceKms }, { identity: 'benchmark-target-derived', service: targetKms })
  const identity = await readFile(`${root}/synthetic-escrow.identity`, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return generateX25519Identity() }); const recipients = [await identityToRecipient(identity)]
  await writeFile(`${root}/synthetic-escrow.identity`, identity, { mode: 0o600 })
  const native = { sourceService: 'source', binariesDir: '/usr/lib/postgresql/16/bin', serviceFile: `${root}/service.conf`, passwordFile: `${root}/password` }
  await writeFile(native.serviceFile, `[source]\nhost=127.0.0.1\nport=5432\ndbname=${database}\nuser=postgres\nsslmode=disable\n`, { mode: 0o600 })
  await writeFile(native.passwordFile, `*:*:*:postgres:${process.env.POSTGRES_PASSWORD}\n`, { mode: 0o600 })
  let scanAfterOwnMs = 0; let scanBeforeOwnMs = 0; let loadIntentMs = 0
  let progressCpuMicros = 0
  const renderer = progressRenderer('plain')
  const progress = (event: ProgressEvent) => { const cpu = process.cpuUsage(); renderer(event); const spent = process.cpuUsage(cpu); progressCpuMicros += spent.user + spent.system }
  let checkpointMs = 0
  let intentMs = 0
  let backupMs = 0; let verifyBackupMs = 0; let rotationMs = 0; let baselineMs = 0; let finalMs = 0
  let baseDataset: Awaited<ReturnType<typeof createPostgresRotationDataset>> | undefined
  const protection = createEnterpriseRotationProtection({
    resumeId: process.env.OM_ROTATION_BENCHMARK_RESUME_ID,
    artifactRoot: `${root}/rotation-artifacts`, trustRoot: `${root}/rotation-trust`, assertEntitlement: async () => {}, providers: async () => pinned,
    async dataset(input, providers, backupDigest, intents) {
      baseDataset ??= await createPostgresRotationDataset({ context: input, providers, provider: pinned.provider, backupDigest, progress, intents: { prefetch: intents.prefetch?.bind(intents), load: async identity => { const started = performance.now(); try { return await intents.load(identity) } finally { loadIntentMs += performance.now() - started } } } })
      const dataset = baseDataset
      return { ...dataset, async binding() { return { ...await dataset.binding(), backupDigest } }, async *rows(phase, signal) { const started = performance.now(); try { const iterator = dataset.rows(phase, signal)[Symbol.asyncIterator](); for (;;) { const began = performance.now(); const next = await iterator.next(); const elapsed = performance.now() - began; if (phase === 'before') scanBeforeOwnMs += elapsed; else scanAfterOwnMs += elapsed; if (next.done) break; yield next.value } } finally { if (phase === 'before') baselineMs += performance.now() - started; else finalMs += performance.now() - started } } }
    },
    recovery: {
      async create(_input, databaseBinding) {
        const started = performance.now()
        const result = await createBackup({ source: createPostgresSource(native), output: `${root}/backups`, workspace: `${root}/workspace`, recipients, requireEncryption: true, quiesced: true, reserveBytes: 0n, progress })
        backupMs = performance.now() - started
        console.log(JSON.stringify({ phase: 'backup-created', gib, elapsedMs: Math.round(backupMs), rssMiB: Math.round(peak / 1024 / 1024) }))
        if (result.sourceIdentityDigest !== databaseBinding || result.consistency !== 'quiesced') throw new Error('Backup identity/consistency mismatch')
        return { artifactPath: result.artifactPath, digest: result.manifestSha256, databaseBinding, consistency: 'quiesced', encrypted: true }
      },
      async verify(artifact) {
        const started = performance.now()
        const result = await verifyBackup({ artifact: artifact.artifactPath, trustedManifestSha256: artifact.digest, identities: [identity], binariesDir: native.binariesDir, workspace: `${root}/workspace` })
        if (createHash('sha256').update(JSON.stringify(result.index.identity)).digest('hex') !== artifact.databaseBinding) throw new Error('Wrong database backup')
        verifyBackupMs += performance.now() - started
      },
    },
    cipher: async () => createRotationArtifactCipher(recipients, [identity]),
    async report(result) { if (result.comparedRows !== String(perKindRows * 2)) throw new Error('Incomplete final coverage') },
  })
  const started = performance.now(); const cpuStarted = process.cpuUsage()
  await protection.protect(context, async (providers) => {
    if (!providers) throw new Error('No pinned providers')
    const checkpointBatch = providers.checkpointBatch ? async (checkpoint: RotationBatchCheckpoint) => { const started = performance.now(); try { await providers.checkpointBatch!(checkpoint) } finally { checkpointMs += performance.now() - started } } : undefined
    const start = performance.now()
    const mapId = (await client.query('SELECT id::text FROM encryption_maps LIMIT 1')).rows[0].id
    const operationId = JSON.stringify(['mapped-v1', mapId, 'public', 'bench_records', tenantId, null])
    const resumed = await providers.resumeCursor?.(operationId)
    for await (const rows of readMaintenanceBatches(connection, '"public"."bench_records"', ['secret'], ['id'], { tenantId, organizationId: null }, providers.batchSize, resumed)) {
      const writes: Array<{ row: Record<string, unknown>; updates: Record<string, unknown> }> = []
      for (const row of rows) {
        const plaintext = decryptWithAesGcm(String(row.secret), sourceKey)
        if (plaintext === null) throw new Error('Unreadable baseline')
        const updates = { secret: encryptWithAesGcm(plaintext, targetKey).value }
        await writeMaintenanceRow(connection, '"public"."bench_records"', ['id'], row, updates, { tenantId, organizationId: null })
        writes.push({ row, updates })
      }
      await verifyMaintenanceBatch(connection, '"public"."bench_records"', ['id'], writes, { tenantId, organizationId: null })
      await checkpointBatch?.({ operationId, cursor: [String(rows[rows.length - 1]!.id)], readRows: rows.length, writtenRows: writes.length })
    }
    await rotateCustomEntityDocuments(em, { encryptionService: new TenantDataEncryptionService(em, { kms: providers.kms }), oldKms: providers.previousKms, tenantId, organizationId: null, dryRun: false, batchSize: providers.batchSize, timestampForBatchWrite: providers.timestampForBatchWrite ? async (intents) => { const started = performance.now(); try { return await providers.timestampForBatchWrite!(intents) } finally { intentMs += performance.now() - started } } : undefined, timestampForWrite: providers.timestampForWrite, resumeCursor: providers.resumeCursor, checkpointBatch })
    rotationMs = performance.now() - start
    console.log(JSON.stringify({ phase: 'rotated', gib, elapsedMs: Math.round(rotationMs), rssMiB: Math.round(peak / 1024 / 1024) }))
  })
  const totalMs = performance.now() - started
  const totalCpu = process.cpuUsage(cpuStarted); const totalCpuMicros = totalCpu.user + totalCpu.system
  const coordinatorPeak = peak
  clearInterval(sampling)
  const standalone = baseDataset!
  const standaloneStarted = performance.now(); let scanned = 0
  for await (const row of standalone.rows('before')) { scanned++; if (!row.columns.length) throw new Error('Unexamined row') }
  const standaloneMs = performance.now() - standaloneStarted
  if (scanned !== perKindRows * 2) throw new Error('Fixture coverage mismatch')
  console.log(JSON.stringify({ phase: 'matched-target-scan', gib, rows: scanned, elapsedMs: Math.round(standaloneMs) }))
  const baselineCost = backupMs + verifyBackupMs + rotationMs - earlyReadbackMs - intentMs
  const overheadMs = totalMs - baselineCost
  const postgresVersion = (await client.query("SELECT current_setting('server_version') AS version")).rows[0].version
  const result = { root, checkpointMs, supplementaryTotalProtectionOverheadMs: totalMs - rotationMs + earlyReadbackMs + intentMs + checkpointMs, comparisonPolicy: 'Checkpointing remains in the matched safe rotation baseline; supplementary protection overhead includes backup creation, offline verification, all safety hooks and control work.', nodeVersion: process.version, postgresVersion, progressRendererCpuMicros: progressCpuMicros, totalCpuMicros, progressRendererCpuPass: progressCpuMicros <= totalCpuMicros * 0.02, nodeMemoryFlags: process.execArgv, gib, logicalBytes: String(BigInt(perKindRows * 2) * BigInt(payload.length)), rows: scanned, scalarRows: perKindRows, customRows: perKindRows, totalMs, backupMs, verifyBackupMs, rotationMs, baselineMs, earlyReadbackMs, intentMs, finalMs, scanAfterOwnMs, scanBeforeOwnMs, loadIntentMs, standaloneMs, overheadMs, overheadPass: overheadMs <= baselineCost * 0.3 + 30000, finalThroughputPass: finalMs <= standaloneMs / 0.7, coordinatorPeakRssMiB: coordinatorPeak / 1024 / 1024, coordinatorRssPass: coordinatorPeak <= 256 * 1024 * 1024, runner: 'Node24/PostgreSQL16/Docker4CPU8GiB', cacheProtocol: process.env.OM_BENCH_CACHE_PROTOCOL ?? 'warm source after isolated seed/ANALYZE; reference scan runs after verification without timestamp-intent lookup', fixture: '64KiB generated synthetic random-base64 plaintext with fresh AES-GCM per scalar/custom JSON row, EXTERNAL storage', completePersistedCoverage: true }
  await writeFile(`${root}/rotation-${gib}g-report.json`, JSON.stringify(result, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(result)); clearInterval(sampling); await client.end()
  if (!result.overheadPass || !result.finalThroughputPass || !result.coordinatorRssPass || !result.progressRendererCpuPass) process.exitCode = 1
}
main().catch((error) => { console.error(error); process.exit(1) })
