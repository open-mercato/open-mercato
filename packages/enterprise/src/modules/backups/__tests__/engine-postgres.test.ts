/** @jest-environment node */
import { createGzip, createGunzip } from 'node:zlib'
import { encryptStream, decryptStream, generateX25519Identity, identityToRecipient } from '../lib/engine/crypto'
import { transform } from '../lib/engine/streams'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client, type ClientConfig } from 'pg'
import { createBackup } from '../lib/engine/create'
import { restoreBackup } from '../lib/engine/restore'
import { BackupError } from '../lib/engine/errors'
import { verifyBackup } from '../lib/engine/verify'
import { createPostgresSource, createPostgresTarget, parsePassword, parseService } from '../lib/engine/postgres'
import type { ByteStream, NativeOptions, Snapshot } from '../lib/engine/types'

const fixtureRoot = process.env.OM_BACKUP_PG_FIXTURE
const integration = fixtureRoot ? describe : describe.skip
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
async function collect(stream: ByteStream) {
  const buffers: Buffer[] = []
  for await (const bytes of stream) buffers.push(Buffer.from(bytes))
  return Buffer.concat(buffers)
}
async function* data(bytes: Buffer): ByteStream { yield bytes }

integration('native PostgreSQL backup transport (isolated fixture only)', () => {
  let admin: Client
  let sourceDb: Client
  let targetDb: Client
  let configuration: ClientConfig
  let directory: string
  let sourceName: string
  let targetName: string
  let options: NativeOptions
  const loContent = Buffer.alloc(180000, 83)
  let largeObjectOid: string
  let emptyObjectOid: string
  let limitedRole: string | undefined

  beforeEach(async () => {
    const service = parseService(await readFile(join(fixtureRoot!, 'service.conf'), 'utf8'), 'source')
    const passwordFile = join(fixtureRoot!, 'password')
    configuration = { host: service.host, port: Number(service.port), user: service.user, database: service.dbname, ssl: false,
      password: parsePassword(await readFile(passwordFile, 'utf8'), { host: service.host, port: service.port, user: service.user, dbname: service.dbname }) }
    admin = new Client({ ...configuration, statement_timeout: 10000 }); await admin.connect()
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16)
    sourceName = `acceptance_${suffix}_source`; targetName = `acceptance_${suffix}_target`
    await admin.query(`CREATE DATABASE "${sourceName}" TEMPLATE template0`)
    await admin.query(`CREATE DATABASE "${targetName}" TEMPLATE template0`)
    sourceDb = new Client({ ...configuration, database: sourceName }); await sourceDb.connect()
    targetDb = new Client({ ...configuration, database: targetName }); await targetDb.connect()
    directory = await mkdtemp(join(fixtureRoot!, 'native-acceptance-')); await chmod(directory, 0o700)
    const bin = join(directory, 'bin'); await mkdir(bin, { mode: 0o700 })
    const container = process.env.OM_BACKUP_PG_CONTAINER ?? 'om-pg-9333-fixture'
    if (!/^[A-Za-z0-9_.-]+$/.test(container)) throw new Error('Invalid isolated fixture container')
    const docker = execFileSync('which', ['docker'], { encoding: 'utf8' }).trim()
    const serviceFile = join(directory, 'service.conf')
    const containerFile = join(directory, 'container.conf')
    const services = (port: string) => `[source]\nhost=127.0.0.1\nport=${port}\ndbname=${sourceName}\nuser=${service.user}\nsslmode=disable\n[target]\nhost=127.0.0.1\nport=${port}\ndbname=${targetName}\nuser=${service.user}\nsslmode=disable\n`
    await writeFile(serviceFile, services(service.port), { mode: 0o600 })
    await writeFile(containerFile, services('5432'), { mode: 0o600 })
    for (const name of ['pg_dump', 'pg_restore', 'psql']) {
      await writeFile(join(bin, name), `#!/bin/sh\nexec '${docker}' exec -i -e PGSERVICEFILE='${containerFile}' -e PGPASSFILE='${passwordFile}' '${container}' ${name} "$@"\n`, { mode: 0o700 })
    }
    options = { workspace: directory, sourceService: 'source', targetService: 'target', serviceFile, passwordFile, binariesDir: bin }
    await sourceDb.query(`CREATE SCHEMA app;
      CREATE TABLE app.parents(a int,b text,body jsonb,secret bytea,label text GENERATED ALWAYS AS (body->>'label') STORED,PRIMARY KEY(a,b));
      CREATE TABLE app.children(id serial PRIMARY KEY,a int,b text,FOREIGN KEY(a,b) REFERENCES app.parents(a,b));
      CREATE TABLE app.heap(body text)`)
    await sourceDb.query('INSERT INTO app.parents(a,b,body,secret) VALUES($1,$2,$3,$4)', [1, 'Ω', { label: '日本語', nested: [null, 'x'] }, Buffer.from([0, 255, 1, 8])])
    await sourceDb.query("INSERT INTO app.children(a,b) VALUES(1,'Ω'); INSERT INTO app.heap VALUES('Unicode: žółć')")
    largeObjectOid = (await sourceDb.query<{ oid: string }>('SELECT lo_from_bytea(0,$1)::text AS oid', [loContent])).rows[0].oid
    emptyObjectOid = (await sourceDb.query<{ oid: string }>("SELECT lo_from_bytea(0,''::bytea)::text AS oid")).rows[0].oid
  }, 30000)

  afterEach(async () => {
    await sourceDb?.end(); await targetDb?.end()
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${sourceName}" WITH (FORCE)`)
      await admin.query(`DROP DATABASE IF EXISTS "${targetName}" WITH (FORCE)`)
      if (limitedRole) await admin.query(`DROP ROLE IF EXISTS "${limitedRole}"`)
      limitedRole = undefined
      await admin.end()
    }
    if (directory) await rm(directory, { recursive: true, force: true })
  }, 30000)

  async function initialize(snapshot: Snapshot, target: ReturnType<typeof createPostgresTarget>) {
    const confirmation = await target.challenge({ backupId: 'fixture', manifestSha256: 'a'.repeat(64), sourceIdentity: snapshot.identity })
    await target.initialize({ runId: 'run', backupId: 'fixture', manifestSha256: 'a'.repeat(64), confirmation })
    await target.schema('pre-data', snapshot.schema('pre-data'), 'pre-data')
    return confirmation
  }

  test('binary COPY, generated columns, composite FK, heap and split/empty large objects round trip exactly', async () => {
    const source = createPostgresSource(options); const target = createPostgresTarget(options)
    try {
      const snapshot = await source.open()
      expect(snapshot.entities.every((entity) => /^e\d{4,8}$/.test(entity.key))).toBe(true)
      await initialize(snapshot, target)
      for (const entity of snapshot.entities) for await (const chunk of snapshot.chunks(entity, { chunkSizeBytes: 65536 })) {
        const contents = await collect(chunk.stream)
        await target.chunk(entity, data(contents), { runId: 'run', sequence: chunk.sequence, sha256: digest(contents), rows: chunk.rows })
      }
      await target.sequences(await snapshot.sequences())
      await target.schema('post-data', snapshot.schema('post-data'), 'post-data')
      await target.foreignKeys(snapshot.foreignKeys)
      expect((await targetDb.query('SELECT * FROM app.parents')).rows).toEqual((await sourceDb.query('SELECT * FROM app.parents')).rows)
      expect((await targetDb.query('SELECT * FROM app.heap')).rows).toEqual((await sourceDb.query('SELECT * FROM app.heap')).rows)
      expect((await targetDb.query<{ data: Buffer }>('SELECT lo_get($1::oid) AS data', [largeObjectOid])).rows[0].data).toEqual(loContent)
      expect((await targetDb.query<{ data: Buffer }>('SELECT lo_get($1::oid) AS data', [emptyObjectOid])).rows[0].data).toEqual(Buffer.alloc(0))
      expect((await targetDb.query("INSERT INTO app.children(a,b) VALUES(1,'Ω') RETURNING id")).rows[0].id).toBe(2)
      await expect(targetDb.query("INSERT INTO app.children(a,b) VALUES(9,'absent')")).rejects.toThrow()
    } finally { await source.close(); await target.close() }
  }, 60000)

  test('a corrupt stream rolls back data and journal; retry and repeated application stay exactly once', async () => {
    const source = createPostgresSource(options); const target = createPostgresTarget(options)
    try {
      const snapshot = await source.open(); await initialize(snapshot, target)
      const entity = snapshot.entities.find((entry) => entry.table === 'parents')!
      const iterator = snapshot.chunks(entity, { chunkSizeBytes: 65536 })[Symbol.asyncIterator]()
      const first = await iterator.next(); if (first.done) throw new Error('Missing fixture chunk')
      const contents = await collect(first.value.stream)
      await iterator.return?.()
      const record = { runId: 'run', sequence: 0, sha256: digest(contents), rows: '1' }
      await expect(target.chunk(entity, data(contents.subarray(0, contents.length - 7)), record)).rejects.toThrow('BACKUP_COPY_WRITE_FAILED')
      expect(await target.countRows(entity)).toBe('0')
      expect((await targetDb.query('SELECT count(*) FROM om_backup_restore.restore_chunks')).rows[0].count).toBe('0')
      await target.chunk(entity, data(contents), record)
      await target.chunk(entity, data(contents), record)
      expect(await target.countRows(entity)).toBe('1')
      expect((await targetDb.query('SELECT count(*) FROM om_backup_restore.restore_chunks')).rows[0].count).toBe('1')
      await expect(target.chunk(entity, data(contents), { ...record, sha256: 'f'.repeat(64) })).rejects.toThrow('BACKUP_RESTORE_CHUNK_MISMATCH')
    } finally { await source.close(); await target.close() }
  }, 60000)

  test('restore resume checks the original backup binding before allowing more writes', async () => {
    const source = createPostgresSource(options); const first = createPostgresTarget(options)
    let resumed: ReturnType<typeof createPostgresTarget> | undefined
    try {
      const snapshot = await source.open(); await initialize(snapshot, first); await first.close()
      resumed = createPostgresTarget(options)
      const confirmation = await resumed.challenge({ backupId: 'other', manifestSha256: 'b'.repeat(64), sourceIdentity: snapshot.identity })
      await expect(resumed.initialize({ runId: 'run', backupId: 'other', manifestSha256: 'b'.repeat(64), confirmation })).rejects.toThrow('BACKUP_RESTORE_BINDING')
      expect((await targetDb.query('SELECT backup_id FROM om_backup_restore.restore_run')).rows[0].backup_id).toBe('fixture')
    } finally { await source.close(); await first.close(); await resumed?.close() }
  }, 60000)

  test('readonly resume inspection binds the journal before writes and rejects changed challenge state',async()=>{
    const source=createPostgresSource(options);const target=createPostgresTarget(options)
    try{
      const snapshot=await source.open();await initialize(snapshot,target)
      const binding={backupId:'fixture',manifestSha256:'a'.repeat(64),sourceIdentity:snapshot.identity}
      const confirmation=await target.challenge(binding)
      expect(await target.inspectResume!({runId:'run',backupId:'fixture',manifestSha256:'a'.repeat(64),confirmation})).toBe(true)
      expect(await target.reportState!()).toMatchObject({resumeCount:0})
      await targetDb.query("UPDATE om_backup_restore.restore_run SET heartbeat_at=now()")
      await expect(target.initialize({runId:'run',backupId:'fixture',manifestSha256:'a'.repeat(64),confirmation})).rejects.toThrow('BACKUP_TARGET_CONFIRMATION')
      const fresh=await target.challenge(binding)
      await target.initialize({runId:'run',backupId:'fixture',manifestSha256:'a'.repeat(64),confirmation:fresh})
      expect(await target.reportState!()).toMatchObject({resumeCount:1})
    }finally{await source.close();await target.close()}
  })

  test('real encrypted restore resumes without rereading its committed artifact chunk',async()=>{
    const privateKey=await generateX25519Identity()
    const backup=await createBackup({source:createPostgresSource(options),output:join(directory,'out'),workspace:join(directory,'create'),recipients:[await identityToRecipient(privateKey)],reserveBytes:0n})
    const shared={artifact:backup.artifactPath,trustedManifestSha256:backup.manifestSha256,identities:[privateKey],workspace:directory,binariesDir:options.binariesDir}
    const artifact=await verifyBackup(shared)
    const binding={backupId:backup.backupId,manifestSha256:backup.manifestSha256,sourceIdentity:artifact.index.identity}
    const initial=createPostgresTarget(options)
    const confirmation=await initial.challenge(binding)
    const factory=initial.chunkWorkers!.bind(initial);let interrupted=false;let resume:string|undefined;let committedKey:string|undefined
    initial.chunkWorkers=async(count)=>(await factory(count)).map(worker=>({...worker,async chunk(...args){await worker.chunk(...args);if(!interrupted){interrupted=true;committedKey=args[0].key;throw new Error('simulated postcommit interruption')}}}))
    try{await restoreBackup({...shared,target:initial,confirmation})}catch(error){expect(error).toBeInstanceOf(BackupError);resume=(error as BackupError).context.restoreRunId}
    expect(resume).toBeDefined()
    const committed=artifact.index.chunks.find((entry)=>entry.entityKey===committedKey)!
    await rm(join(backup.artifactPath,committed.path))
    const target=createPostgresTarget(options)
    const fresh=await target.challenge(binding)
    const restored=await restoreBackup({...shared,target,confirmation:fresh,resume})
    const report=JSON.parse(await readFile(restored.reportPath,'utf8'))
    expect(report).toMatchObject({status:'completed',resumeCount:1,promotionReady:false,keyRecovery:{status:'not-tested'}})
    expect(report.resumeTimestamps).toHaveLength(1)
    expect(report.foreignKeys.results).toEqual(expect.arrayContaining([expect.objectContaining({status:'passed',constraintKey:'f1'})]))
    expect(report.entities.some((entry:{resumedChunks:number})=>entry.resumedChunks>0)).toBe(true)
    expect((await targetDb.query('SELECT * FROM app.parents ORDER BY a,b')).rows).toEqual((await sourceDb.query('SELECT * FROM app.parents ORDER BY a,b')).rows)
    expect((await targetDb.query("SELECT count(*)::text AS count FROM pg_namespace WHERE nspname='om_backup_restore'")).rows[0].count).toBe('0')
  },30000)

  test('cancellation during active COPY closes snapshot and worker connections within fifteen seconds',async()=>{
    await sourceDb.query("CREATE TABLE app.cancel_rows(id int PRIMARY KEY,body text); INSERT INTO app.cancel_rows SELECT g,repeat('x',65536) FROM generate_series(1,1000) g")
    const controller=new AbortController(),nativeSource=createPostgresSource({...options,signal:controller.signal})
    const open=nativeSource.open.bind(nativeSource)
    nativeSource.open=async()=>{const snapshot=await open();const chunks=snapshot.chunks.bind(snapshot);snapshot.chunks=async function*(entity,settings){for await(const chunk of chunks(entity,settings)){const stream=chunk.stream;yield {...chunk,stream:(async function*(){for await(const block of stream){if(entity.table==='cancel_rows')controller.abort('SIGINT');yield block}})()}}};return snapshot}
    const key=await generateX25519Identity(),started=performance.now()
    await expect(createBackup({source:nativeSource,signal:controller.signal,output:join(directory,'cancel-out'),workspace:join(directory,'cancel-workspace'),recipients:[await identityToRecipient(key)],reserveBytes:0n,jobs:1})).rejects.toThrow()
    expect(controller.signal.aborted).toBe(true)
    expect(performance.now()-started).toBeLessThan(15000)
    const connections=(await admin.query<{count:string}>("SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname=$1 AND pid<>$2",[sourceName,sourceDb.processID])).rows[0].count
    expect(connections).toBe('0')
  },20000)

  test('eight native restore workers load independent entities and close before post-data validation',async()=>{
    for(let table=1;table<=8;table++)await sourceDb.query(`CREATE TABLE app.concurrent_${table}(id int PRIMARY KEY,body text);INSERT INTO app.concurrent_${table} SELECT g,repeat(md5(g::text),256) FROM generate_series(1,32) g`)
    const key=await generateX25519Identity()
    const backup=await createBackup({source:createPostgresSource(options),output:join(directory,'parallel-out'),workspace:join(directory,'parallel-create'),recipients:[await identityToRecipient(key)],jobs:8,reserveBytes:0n})
    const shared={artifact:backup.artifactPath,trustedManifestSha256:backup.manifestSha256,identities:[key],workspace:directory,binariesDir:options.binariesDir}
    const metadata=await verifyBackup(shared),target=createPostgresTarget(options)
    await expect(target.chunkWorkers!(8)).rejects.toThrow('BACKUP_RESTORE_WORKER_BINDING')
    const confirmation=await target.challenge({backupId:backup.backupId,manifestSha256:backup.manifestSha256,sourceIdentity:metadata.index.identity})
    const factory=target.chunkWorkers!.bind(target),foreignKeys=target.foreignKeys.bind(target)
    let active=0,peak=0,closed=0
    target.chunkWorkers=async(count)=>(await factory(count)).map(worker=>({async chunk(...args){active++;peak=Math.max(peak,active);try{await worker.chunk(...args)}finally{active--}},async close(){await worker.close();closed++}}))
    target.foreignKeys=async(keys)=>{expect(closed).toBe(8);expect(active).toBe(0);await foreignKeys(keys)}
    await restoreBackup({...shared,target,confirmation,jobs:8})
    expect(peak).toBe(8);expect(closed).toBe(8)
    for(let table=1;table<=8;table++)expect((await targetDb.query(`SELECT * FROM app.concurrent_${table} ORDER BY id`)).rows).toEqual((await sourceDb.query(`SELECT * FROM app.concurrent_${table} ORDER BY id`)).rows)
  },30000)

  test('schema staging stops at its explicit byte budget before invoking restore SQL', async () => {
    const source = createPostgresSource(options); const target = createPostgresTarget({ ...options, maxStagingBytes: 16 })
    try {
      const snapshot = await source.open()
      const confirmation = await target.challenge({ backupId: 'fixture', manifestSha256: 'a'.repeat(64), sourceIdentity: snapshot.identity })
      await target.initialize({ runId: 'run', backupId: 'fixture', manifestSha256: 'a'.repeat(64), confirmation })
      await expect(target.schema('pre-data', data(Buffer.alloc(17)), 'pre-data')).rejects.toThrow('BACKUP_SCHEMA_STAGING_LIMIT')
      expect((await readdir(directory)).some((name) => name.startsWith('om-backup-schema-'))).toBe(false)
      expect((await targetDb.query("SELECT to_regclass('app.parents') AS present")).rows[0].present).toBeNull()
    } finally { await source.close(); await target.close() }
  }, 60000)
  test('FORCE RLS cannot turn an invisible row subset into a successful backup', async () => {
    limitedRole = `reader_${randomUUID().replaceAll('-', '').slice(0, 16)}`
    const password = String(configuration.password).replaceAll("'", "''")
    await admin.query(`CREATE ROLE "${limitedRole}" LOGIN PASSWORD '${password}'`)
    await sourceDb.query(`GRANT USAGE ON SCHEMA app TO "${limitedRole}";
      GRANT SELECT ON ALL TABLES IN SCHEMA app TO "${limitedRole}";
      GRANT EXECUTE ON FUNCTION pg_control_system() TO "${limitedRole}";
      GRANT EXECUTE ON FUNCTION pg_control_checkpoint() TO "${limitedRole}";
      ALTER TABLE app.parents ENABLE ROW LEVEL SECURITY;
      ALTER TABLE app.parents FORCE ROW LEVEL SECURITY;
      CREATE POLICY hide_rows ON app.parents TO "${limitedRole}" USING (false)`)
    for (const file of [options.serviceFile, join(directory, 'container.conf')]) {
      const contents = await readFile(file, 'utf8')
      await writeFile(file, contents.replace(`user=${configuration.user}`, `user=${limitedRole}`), { mode: 0o600 })
    }
    const privatePassword = join(directory, 'reader.password')
    const escapedPassword = String(configuration.password).replaceAll('\\', '\\\\').replaceAll(':', '\\:')
    await writeFile(privatePassword, `*:*:*:${limitedRole}:${escapedPassword}\n`, { mode: 0o600 })
    const source = createPostgresSource({ ...options, passwordFile: privatePassword })
    try { await expect(source.open()).rejects.toThrow(/row-level security/) }
    finally { await source.close() }
  }, 60000)

  test('large-object stream integrity failure rolls back both LO and journal creation', async () => {
    const source = createPostgresSource(options); const target = createPostgresTarget(options)
    try {
      const snapshot = await source.open(); await initialize(snapshot, target)
      const entity = snapshot.entities.find((entry) => entry.largeObjectOid === largeObjectOid)!
      const header = Buffer.alloc(8)
      const corrupted = (async function* () { yield header; yield Buffer.from('partial'); throw new Error('integrity failure') })()
      await expect(target.chunk(entity, corrupted, { runId: 'run', sequence: 0, sha256: 'b'.repeat(64), rows: '1' })).rejects.toThrow('integrity failure')
      expect(await target.countRows(entity)).toBe('1')
      expect((await targetDb.query<{ data: Buffer }>('SELECT lo_get($1::oid) AS data', [largeObjectOid])).rows[0].data).toEqual(Buffer.alloc(0))
      expect((await targetDb.query('SELECT count(*) FROM om_backup_restore.restore_chunks')).rows[0].count).toBe('0')
    } finally { await source.close(); await target.close() }
  }, 60000)

  test('a durable bound terminal receipt safely completes before and after journal deletion', async () => {
    const source = createPostgresSource(options); const target = createPostgresTarget(options)
    let resumed: ReturnType<typeof createPostgresTarget> | undefined
    try {
      const snapshot = await source.open(); await initialize(snapshot, target)
      const identity = await target.identity()
      const targetIdentityDigest = digest(Buffer.from(JSON.stringify(identity)))
      const reportPath = join(directory, 'completion.json')
      await writeFile(reportPath, JSON.stringify({ schemaVersion: 1, backupId: 'fixture', restoreRunId: 'run', trustedManifestSha256: 'a'.repeat(64), targetIdentityDigest, status: 'completed', quarantined: true }), { mode: 0o600 })
      await target.close()
      for (let attempt = 0; attempt < 2; attempt++) {
        resumed = createPostgresTarget(options)
        const confirmation = await resumed.challenge({ backupId: 'fixture', manifestSha256: 'a'.repeat(64), sourceIdentity: snapshot.identity })
        await expect(resumed.completeFromReport!({ runId: 'run', backupId: 'fixture', manifestSha256: 'a'.repeat(64), reportPath, targetIdentityDigest, confirmation })).resolves.toBe(true)
        expect((await targetDb.query("SELECT to_regnamespace('om_backup_restore') AS journal")).rows[0].journal).toBeNull()
        expect((await targetDb.query("SELECT to_regclass('app.parents') AS restored")).rows[0].restored).toBe('app.parents')
        await resumed.close()
      }
    } finally { await source.close(); await target.close(); await resumed?.close() }
  }, 60000)

  test('10000 binary COPY rows survive a slow gzip/age consumer without reused parser buffers', async () => {
    await sourceDb.query("CREATE TABLE app.bulk(id int PRIMARY KEY,body text); INSERT INTO app.bulk SELECT n,repeat('x',256)||n::text FROM generate_series(1,10000) n")
    const source = createPostgresSource(options); const target = createPostgresTarget(options)
    try {
      const snapshot = await source.open(); await initialize(snapshot, target)
      const identity = await generateX25519Identity(); const recipient = await identityToRecipient(identity)
      const entity = snapshot.entities.find((entry) => entry.table === 'bulk')!
      for await (const chunk of snapshot.chunks(entity, { chunkSizeBytes: 8 * 1024 * 1024 })) {
        const encoded = await encryptStream(transform(chunk.stream, createGzip()), [recipient])
        const slow = (async function* () { for await (const part of encoded) { await new Promise<void>((resolve) => setImmediate(resolve)); yield part } })()
        const encrypted = await collect(slow)
        const decoded = transform(await decryptStream(data(encrypted), [identity]), createGunzip())
        await target.chunk(entity, decoded, { runId: 'run', sequence: chunk.sequence, sha256: digest(encrypted), rows: chunk.rows })
      }
      const sql = "SELECT count(*)::text AS rows,count(DISTINCT id)::text AS unique_rows,md5(string_agg(id::text||body,'|' ORDER BY id)) AS digest FROM app.bulk"
      expect((await targetDb.query(sql)).rows).toEqual((await sourceDb.query(sql)).rows)
    } finally { await source.close(); await target.close() }
  }, 60000)

  test('enum labels, defaults and CHECK definitions change the complete resume schema fingerprint', async () => {
    await sourceDb.query("CREATE TYPE app.state AS ENUM ('first'); CREATE TABLE app.states(id int PRIMARY KEY,state app.state DEFAULT 'first',CHECK(id>0))")
    const baseline = createPostgresSource(options)
    let original: string
    try { original = (await baseline.open()).catalogDigest } finally { await baseline.close() }
    await sourceDb.query("ALTER TYPE app.state ADD VALUE 'second'")
    await sourceDb.query("ALTER TABLE app.states ALTER COLUMN state SET DEFAULT 'second'")
    const changed = createPostgresSource(options)
    try { expect((await changed.open()).catalogDigest).not.toBe(original!) } finally { await changed.close() }
  }, 60000)

  test('unsupported materialized data cannot be silently omitted from a whole-database backup', async () => {
    await sourceDb.query('CREATE MATERIALIZED VIEW app.materialized AS SELECT 42 AS value')
    const source = createPostgresSource(options)
    try { await expect(source.open()).rejects.toThrow('BACKUP_RELATION_KIND_UNSUPPORTED') }
    finally { await source.close() }
  }, 60000)

  test('migration history fingerprint and exact composite-key canary reads survive persisted restore', async () => {
    await sourceDb.query("CREATE TABLE public.mikro_orm_migrations(id serial PRIMARY KEY,name text NOT NULL,executed_at timestamptz NOT NULL); INSERT INTO public.mikro_orm_migrations(name,executed_at) VALUES('fixture_migration','2026-11-12T12:34:56.123456Z')")

    const source = createPostgresSource(options); const target = createPostgresTarget(options)
    try {
      const snapshot = await source.open(); await initialize(snapshot, target)
      for (const entity of snapshot.entities) for await (const chunk of snapshot.chunks(entity, { chunkSizeBytes: 65536 })) {
        const contents = await collect(chunk.stream)
        await target.chunk(entity, data(contents), { runId: 'run', sequence: chunk.sequence, sha256: digest(contents), rows: chunk.rows })
      }
      expect(await target.migrationFingerprint!()).toBe(snapshot.migrationFingerprint)
      const entity = snapshot.entities.find((entry) => entry.table === 'parents')!
      await expect(target.readCanary!(entity, { field: 'b', key: { a: '1', b: 'Ω' } })).resolves.toBe('Ω')
      await expect(target.readCanary!(entity, { field: 'b', key: { a: '1' } })).rejects.toThrow('BACKUP_CANARY_SCOPE')
      await expect(target.readCanary!(entity, { field: 'b', key: { a: '1', b: 'other-scope' } })).rejects.toThrow('BACKUP_CANARY_NOT_FOUND_OR_INVALID')
      await targetDb.query("UPDATE public.mikro_orm_migrations SET name='changed-history'")
      expect(await target.migrationFingerprint!()).not.toBe(snapshot.migrationFingerprint)
    } finally { await source.close(); await target.close() }
  }, 60000)

  test('TOASTed rows size initial PK and heap chunks by real binary width, not heap pointers', async () => {
    await sourceDb.query(`CREATE TABLE app.toast_pk(id int PRIMARY KEY,body text); ALTER TABLE app.toast_pk ALTER COLUMN body SET STORAGE EXTERNAL;
      CREATE TABLE app.toast_heap(id int,body text); ALTER TABLE app.toast_heap ALTER COLUMN body SET STORAGE EXTERNAL;
      INSERT INTO app.toast_pk SELECT n,repeat('x',65536) FROM generate_series(1,256) n;
      INSERT INTO app.toast_heap SELECT * FROM app.toast_pk; ANALYZE app.toast_pk; ANALYZE app.toast_heap`)
    const source = createPostgresSource(options)
    try {
      const snapshot = await source.open()
      for (const name of ['toast_pk', 'toast_heap']) {
        const entity = snapshot.entities.find((entry) => entry.table === name)!
        let chunks = 0; let rows = 0n
        for await (const chunk of snapshot.chunks(entity, { chunkSizeBytes: 1024 * 1024 })) {
          const bytes = await collect(chunk.stream)
          expect(bytes.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024)
          chunks++; rows += BigInt(chunk.rows)
        }
        expect(chunks).toBeGreaterThan(8)
        expect(rows).toBe(256n)
      }
    } finally { await source.close() }
  }, 60000)

  test('metadata cardinality preflight refuses huge schemas before materializing all columns', async () => {
    await sourceDb.query(`DO $$ DECLARE fields text; n int; BEGIN
      SELECT string_agg(format('col_%s int',g),',') INTO fields FROM generate_series(1,1000) g;
      FOR n IN 1..101 LOOP EXECUTE format('CREATE TABLE app.metadata_cap_%s(%s)',n,fields); END LOOP;
    END $$`)
    const source = createPostgresSource(options)
    try { await expect(source.open()).rejects.toThrow('BACKUP_NATIVE_METADATA_LIMIT') }
    finally { await source.close() }
  }, 60000)

  test('an independent snapshot row-count disagreement refuses completion', async () => {
    const source = createPostgresSource(options)
    let spy: jest.SpyInstance | undefined
    try {
      const snapshot = await source.open()
      const entity = snapshot.entities.find((entry) => entry.table === 'parents')!
      const original = Client.prototype.query
      spy = jest.spyOn(Client.prototype,'query').mockImplementation(function(this: Client,...args: unknown[]): never {
        if (typeof args[0] === 'string' && args[0].startsWith('SELECT count(*)::text AS count FROM ONLY')) return Promise.resolve({ rows: [{ count: '999' }] }) as never
        return Reflect.apply(original,this,args) as never
      })
      await expect((async () => { for await (const chunk of snapshot.chunks(entity,{chunkSizeBytes:65536})) await collect(chunk.stream) })()).rejects.toThrow('BACKUP_SOURCE_COVERAGE_MISMATCH')
    } finally { spy?.mockRestore(); await source.close() }
  }, 60000)

  test('multiple64MiB COPY chunks with a slow consumer cannot leave the next query socket paused', async () => {
    await sourceDb.query(`CREATE TABLE app.slow_chunks(id int PRIMARY KEY,body text); ALTER TABLE app.slow_chunks ALTER COLUMN body SET STORAGE EXTERNAL;
      INSERT INTO app.slow_chunks SELECT n,repeat('z',65536) FROM generate_series(1,2304) n; ANALYZE app.slow_chunks`)
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort('acceptance timeout'),30000)
    const source = createPostgresSource({ ...options,signal: abort.signal })
    try {
      const snapshot = await source.open()
      const entity = snapshot.entities.find((entry) => entry.table === 'slow_chunks')!
      let chunks=0;let rows=0n;let size=0
      for await (const chunk of snapshot.chunks(entity,{chunkSizeBytes:64*1024*1024})) {
        for await (const bytes of chunk.stream) { size+=bytes.byteLength; await new Promise<void>((resolve)=>setTimeout(resolve,1)) }
        chunks++;rows+=BigInt(chunk.rows)
      }
      expect(rows).toBe(2304n)
      expect(chunks).toBeGreaterThanOrEqual(3)
      expect(size).toBeGreaterThan(128*1024*1024)
      expect(abort.signal.aborted).toBe(false)
    } finally { clearTimeout(timeout);await source.close() }
  },60000)

  test('user enum arrays preserve values when restored type OIDs differ from source history', async () => {
    await sourceDb.query(`DO $$ BEGIN FOR n IN 1..20 LOOP EXECUTE format('CREATE TYPE app.discarded_%s AS ENUM (%L)',n,'discarded'); EXECUTE format('DROP TYPE app.discarded_%s',n); END LOOP; END $$;
      CREATE TYPE app.history_state AS ENUM ('on','off'); CREATE TYPE app.history_record AS (state app.history_state,label text); CREATE TABLE app.enum_arrays(id int PRIMARY KEY,states app.history_state[],records app.history_record[]);
      INSERT INTO app.enum_arrays VALUES(1,ARRAY['on','off',NULL]::app.history_state[],ARRAY[ROW('on','Unicode Ω')::app.history_record]),(2,ARRAY[]::app.history_state[],ARRAY[]::app.history_record[])`)
    const source=createPostgresSource(options);const target=createPostgresTarget(options)
    try {
      const snapshot=await source.open();await initialize(snapshot,target)
      const sourceOid=(await sourceDb.query("SELECT 'app.history_state'::regtype::oid AS oid")).rows[0].oid
      const targetOid=(await targetDb.query("SELECT 'app.history_state'::regtype::oid AS oid")).rows[0].oid
      expect(sourceOid).not.toBe(targetOid)
      const entity=snapshot.entities.find((entry)=>entry.table==='enum_arrays')!
      for await(const chunk of snapshot.chunks(entity,{chunkSizeBytes:65536})) {
        const contents=await collect(chunk.stream)
        await target.chunk(entity,data(contents),{runId:'run',sequence:chunk.sequence,sha256:digest(contents),rows:chunk.rows})
      }
      const sql='SELECT id,states::text AS states,records::text AS records FROM app.enum_arrays ORDER BY id'
      expect((await targetDb.query(sql)).rows).toEqual((await sourceDb.query(sql)).rows)
    } finally {await source.close();await target.close()}
  },60000)

  test('regclass values and arrays retain logical relation names across different restored OIDs', async () => {
    await sourceDb.query("CREATE TABLE app.oid_aliases(id int PRIMARY KEY,relation regclass,relations regclass[]); INSERT INTO app.oid_aliases VALUES(1,'app.parents'::regclass,ARRAY['app.parents'::regclass])")
    const source=createPostgresSource(options);const target=createPostgresTarget(options)
    try {
      const snapshot=await source.open();await initialize(snapshot,target)
      expect((await sourceDb.query("SELECT 'app.parents'::regclass::oid AS oid")).rows[0].oid).not.toBe((await targetDb.query("SELECT 'app.parents'::regclass::oid AS oid")).rows[0].oid)
      const entity=snapshot.entities.find((entry)=>entry.table==='oid_aliases')!
      for await(const chunk of snapshot.chunks(entity,{chunkSizeBytes:65536})) {
        const contents=await collect(chunk.stream)
        await target.chunk(entity,data(contents),{runId:'run',sequence:chunk.sequence,sha256:digest(contents),rows:chunk.rows})
      }
      const sql='SELECT id,relation::text AS relation,relations::text AS relations FROM app.oid_aliases ORDER BY id'
      expect((await targetDb.query(sql)).rows).toEqual((await sourceDb.query(sql)).rows)
    } finally {await source.close();await target.close()}
  },60000)

  test('late index OID aliases refuse before a falsely restorable artifact can be produced', async () => {
    await sourceDb.query("CREATE TABLE app.late_alias(value regclass); INSERT INTO app.late_alias VALUES('app.parents_pkey'::regclass)")
    const source=createPostgresSource(options)
    try {await expect(source.open()).rejects.toThrow('BACKUP_LATE_REGCLASS_UNSUPPORTED')}
    finally {await source.close()}
  },60000)

  test('unproven nested regclass paths refuse instead of preserving stale object OIDs', async () => {
    await sourceDb.query("CREATE TYPE app.nested_alias AS (value regclass); CREATE TABLE app.nested_aliases(value app.nested_alias[])")
    const source=createPostgresSource(options)
    try {await expect(source.open()).rejects.toThrow('BACKUP_NESTED_REGCLASS_UNSUPPORTED')}
    finally {await source.close()}
  },60000)

  test('one real worker-connection loss retries within the exported snapshot without duplicate chunks', async () => {
    await sourceDb.query(`CREATE TABLE app.retry_chunks(id int PRIMARY KEY,body text); ALTER TABLE app.retry_chunks ALTER COLUMN body SET STORAGE EXTERNAL;
      INSERT INTO app.retry_chunks SELECT n,repeat('r',65536) FROM generate_series(1,256) n; ANALYZE app.retry_chunks`)
    const native=createPostgresSource(options)
    let opened=0;let terminated=false
    const source={
      async open() {
        opened++
        const snapshot=await native.open()
        const chunks=snapshot.chunks.bind(snapshot)
        return {...snapshot,async *chunks(entity: Parameters<typeof snapshot.chunks>[0],request: Parameters<typeof snapshot.chunks>[1]) {
          for await(const chunk of chunks(entity,request)) {
            yield chunk
            if(entity.table==='retry_chunks'&&!terminated) {
              const workers=await sourceDb.query<{pid:number}>(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
                AND application_name='mercato-backup' AND state='idle in transaction' AND query LIKE 'COPY (%' AND query LIKE '%"retry_chunks"%'`)
              expect(workers.rows).toHaveLength(1)
              terminated=true
              await sourceDb.query('SELECT pg_terminate_backend($1)',[workers.rows[0].pid])
            }
          }
        }}
      },
      close:()=>native.close(),
    }
    const identity=await generateX25519Identity();const recipient=await identityToRecipient(identity)
    const result=await createBackup({source,output:join(directory,'backup'),workspace:join(directory,'workspace'),recipients:[recipient],chunkSizeBytes:8*1024*1024,reserveBytes:0n})
    expect(terminated).toBe(true);expect(opened).toBe(1)
    const verified=await verifyBackup({artifact:result.artifactPath,trustedManifestSha256:result.manifestSha256,identities:[identity],binariesDir:options.binariesDir,workspace:directory})
    expect(verified.index.epochs).toBe(1)
    expect(verified.index.consistency).toBe('single-snapshot')
    const entity=verified.index.entities.find((entry)=>entry.table==='retry_chunks')!
    const parts=verified.index.chunks.filter((chunk)=>chunk.entityKey===entity.key)
    expect(parts.reduce((sum,chunk)=>sum+BigInt(chunk.rows),0n)).toBe(256n)
    expect(new Set(parts.map((chunk)=>chunk.path)).size).toBe(parts.length)
  },60000)

  test('sensitive text primary-key cursors stay out of SQL statements', async () => {
    const marker='private-cursor@example.test'
    await sourceDb.query("CREATE TABLE app.private_keys(id text PRIMARY KEY,body text)")
    await sourceDb.query("INSERT INTO app.private_keys VALUES($1,repeat('x',65536)),($2,repeat('y',65536))",[marker,'z-last@example.test'])
    const source=createPostgresSource(options)
    let spy:jest.SpyInstance|undefined
    const statements:string[]=[]
    try {
      const snapshot=await source.open()
      const entity=snapshot.entities.find((entry)=>entry.table==='private_keys')!
      const original=Client.prototype.query
      spy=jest.spyOn(Client.prototype,'query').mockImplementation(function(this:Client,...args:unknown[]):never {
        const query=args[0]
        if(typeof query==='string') statements.push(query)
        else if(query&&typeof query==='object'&&'text' in query&&typeof query.text==='string') statements.push(query.text)
        return Reflect.apply(original,this,args) as never
      })
      let rows=0n
      for await(const chunk of snapshot.chunks(entity,{chunkSizeBytes:65536})) {await collect(chunk.stream);rows+=BigInt(chunk.rows)}
      expect(rows).toBe(2n)
      expect(statements.join('\n')).not.toContain(marker)
      expect(statements.some((sql)=>sql.includes("set_config('om_backup.cursor',$1,true)"))).toBe(true)
      expect(statements.some((sql)=>sql.startsWith('COPY ')&&sql.includes("current_setting('om_backup.cursor')"))).toBe(true)
    } finally {spy?.mockRestore();await source.close()}
  },60000)

  test('every invalid FK is durably recorded and repaired validations upgrade failed journal steps',async()=>{
    await sourceDb.query('CREATE TABLE app.other_child(id int PRIMARY KEY,a int,b text,FOREIGN KEY(a,b) REFERENCES app.parents(a,b))')
    const source=createPostgresSource(options);const target=createPostgresTarget(options)
    try{
      const snapshot=await source.open();await initialize(snapshot,target)
      await target.schema('post-data',snapshot.schema('post-data'),'post-data')
      await targetDb.query("INSERT INTO app.children(id,a,b) VALUES(1,999,'missing');INSERT INTO app.other_child VALUES(1,888,'missing')")
      await expect(target.foreignKeys(snapshot.foreignKeys)).rejects.toMatchObject({code:'BACKUP_FOREIGN_KEY_VALIDATION_FAILED',exitCode:6,details:{foreignKeyFailures:expect.any(Array)}})
      const failed=(await targetDb.query("SELECT status,detail FROM om_backup_restore.restore_steps WHERE kind='fk-validate' ORDER BY step_key")).rows
      expect(failed).toHaveLength(2)
      expect(failed.every((row)=>row.status==='failed'&&row.detail==='BACKUP_FOREIGN_KEY_VALIDATION_FAILED')).toBe(true)
      await targetDb.query('DELETE FROM app.children;DELETE FROM app.other_child')
      await target.foreignKeys(snapshot.foreignKeys)
      const repaired=(await targetDb.query("SELECT status,detail FROM om_backup_restore.restore_steps WHERE kind='fk-validate' ORDER BY step_key")).rows
      expect(repaired.every((row)=>row.status==='done'&&row.detail===null)).toBe(true)
    }finally{await source.close();await target.close()}
  },60000)

  test('partitioned FK parents are restored once without duplicate inherited constraints',async()=>{
    await sourceDb.query(`CREATE TABLE app.partitioned(id int,a int,b text,PRIMARY KEY(id,a),FOREIGN KEY(a,b) REFERENCES app.parents(a,b)) PARTITION BY RANGE(id);
      CREATE TABLE app.partitioned_low PARTITION OF app.partitioned FOR VALUES FROM(0) TO(100);
      INSERT INTO app.partitioned VALUES(1,1,'Ω')`)
    const source=createPostgresSource(options);const target=createPostgresTarget(options)
    try{
      const snapshot=await source.open();await initialize(snapshot,target)
      expect(snapshot.foreignKeys.filter((key)=>key.table==='partitioned_low')).toHaveLength(0)
      for(const entity of snapshot.entities)for await(const chunk of snapshot.chunks(entity,{chunkSizeBytes:65536})){
        const contents=await collect(chunk.stream)
        await target.chunk(entity,data(contents),{runId:'run',sequence:chunk.sequence,sha256:digest(contents),rows:chunk.rows})
      }
      await target.schema('post-data',snapshot.schema('post-data'),'post-data')
      await target.foreignKeys(snapshot.foreignKeys)
      expect((await targetDb.query('SELECT * FROM app.partitioned')).rows).toEqual((await sourceDb.query('SELECT * FROM app.partitioned')).rows)
      await expect(targetDb.query("INSERT INTO app.partitioned VALUES(2,999,'missing')")).rejects.toThrow()
    }finally{await source.close();await target.close()}
  },60000)

  test('stored generated primary keys use bounded CTID source chunks and are recomputed on restore',async()=>{
    await sourceDb.query("CREATE TABLE app.generated_key(base int,id int GENERATED ALWAYS AS(base+100) STORED PRIMARY KEY,body text);INSERT INTO app.generated_key(base,body) VALUES(1,'first'),(2,'second')")
    const source=createPostgresSource(options);const target=createPostgresTarget(options)
    try{
      const snapshot=await source.open();await initialize(snapshot,target)
      const entity=snapshot.entities.find((entry)=>entry.table==='generated_key')!
      for await(const chunk of snapshot.chunks(entity,{chunkSizeBytes:65536})){
        const contents=await collect(chunk.stream)
        await target.chunk(entity,data(contents),{runId:'run',sequence:chunk.sequence,sha256:digest(contents),rows:chunk.rows})
      }
      expect((await targetDb.query('SELECT * FROM app.generated_key ORDER BY id')).rows).toEqual((await sourceDb.query('SELECT * FROM app.generated_key ORDER BY id')).rows)
    }finally{await source.close();await target.close()}
  },60000)

  test('one non-null unique index supplies a resumable composite cursor without INCLUDE columns',async()=>{
    await sourceDb.query(`CREATE TABLE app.unique_cursor(a int NOT NULL,b text NOT NULL,body text);
      CREATE UNIQUE INDEX chosen_cursor ON app.unique_cursor(a,b) INCLUDE(body);
      CREATE UNIQUE INDEX other_cursor ON app.unique_cursor(b,a);
      CREATE TABLE app.nullable_cursor(id int UNIQUE,body text);
      INSERT INTO app.unique_cursor SELECT g,'key-'||g,repeat('x',65536) FROM generate_series(1,4) g;
      INSERT INTO app.nullable_cursor VALUES(NULL,'a'),(NULL,'b')`)
    const source=createPostgresSource(options);const target=createPostgresTarget(options)
    try{
      const snapshot=await source.open();await initialize(snapshot,target)
      const entity=snapshot.entities.find((entry)=>entry.table==='unique_cursor')!
      expect(entity.primaryKeys).toEqual(['a','b'])
      expect(snapshot.entities.find((entry)=>entry.table==='nullable_cursor')!.primaryKeys).toEqual([])
      let tail:string[]|undefined;let copied=0
      for await(const chunk of snapshot.chunks(entity,{chunkSizeBytes:65536})){
        const contents=await collect(chunk.stream)
        await target.chunk(entity,data(contents),{runId:'run',sequence:chunk.sequence,sha256:digest(contents),rows:chunk.rows})
        tail=chunk.keyTo;copied+=Number(chunk.rows);break
      }
      expect(tail).toBeDefined();expect(copied).toBe(1)
      await expect((async()=>{for await(const chunk of snapshot.chunks(entity,{chunkSizeBytes:65536,after:tail,retainedRows:'999'}))await collect(chunk.stream)})()).rejects.toThrow('BACKUP_SOURCE_COVERAGE_MISMATCH')
      for await(const chunk of snapshot.chunks(entity,{chunkSizeBytes:65536,after:tail,retainedRows:String(copied)})){
        const contents=await collect(chunk.stream)
        await target.chunk(entity,data(contents),{runId:'run',sequence:chunk.sequence+1,sha256:digest(contents),rows:chunk.rows})
      }
      expect((await targetDb.query('SELECT * FROM app.unique_cursor ORDER BY a,b')).rows).toEqual((await sourceDb.query('SELECT * FROM app.unique_cursor ORDER BY a,b')).rows)
    }finally{await source.close();await target.close()}
  },60000)

})
