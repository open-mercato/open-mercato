/** @jest-environment node */
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client, type ClientConfig } from 'pg'
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
    options = { sourceService: 'source', targetService: 'target', serviceFile, passwordFile, binariesDir: bin }
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

  test('schema staging stops at its explicit byte budget before invoking restore SQL', async () => {
    const source = createPostgresSource(options); const target = createPostgresTarget({ ...options, maxStagingBytes: 16 })
    try {
      const snapshot = await source.open()
      const confirmation = await target.challenge({ backupId: 'fixture', manifestSha256: 'a'.repeat(64), sourceIdentity: snapshot.identity })
      await target.initialize({ runId: 'run', backupId: 'fixture', manifestSha256: 'a'.repeat(64), confirmation })
      await expect(target.schema('pre-data', data(Buffer.alloc(17)), 'pre-data')).rejects.toThrow('BACKUP_SCHEMA_STAGING_LIMIT')
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

})
