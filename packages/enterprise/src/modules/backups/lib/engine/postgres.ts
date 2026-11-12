import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { chmod, lstat, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { PassThrough, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Client, Query, type ClientConfig } from 'pg'
import type { BackupSource, ByteStream, DatabaseIdentity, Entity, NativeOptions, RestoreTarget, Snapshot, SourceChunk } from './types'

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
const relation = (entity: Pick<Entity, 'schema' | 'table'>) => `${identifier(entity.schema)}.${identifier(entity.table)}`
const failure = (code: string) => new Error(`[internal] ${code}`)
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const limits = { highWaterMark: 1024 * 1024 }

type Wire = {
  stream: NodeJS.ReadWriteStream & { pause(): void; resume(): void; writableLength: number }
  sendCopyFromChunk(chunk: Buffer): void
  endCopyFrom(): void
  sendCopyFail(message: string): void
}

class ExportQuery extends Query<Record<string, unknown>> {
  readonly output = new PassThrough(limits)
  handleCopyData(message: { chunk: Buffer }, connection: Wire) {
    if (!this.output.write(message.chunk)) {
      connection.stream.pause()
      this.output.once('drain', () => connection.stream.resume())
    }
  }
}

class ImportQuery extends Query<Record<string, unknown>> {
  constructor(sql: string, private readonly input: ByteStream) { super(sql) }
  handleCopyInResponse(connection: Wire) {
    void (async () => {
      try {
        for await (const bytes of this.input) {
          for (let offset = 0; offset < bytes.byteLength; offset += 65536) {
            connection.sendCopyFromChunk(Buffer.from(bytes.subarray(offset, offset + 65536)))
            if (connection.stream.writableLength >= limits.highWaterMark) await once(connection.stream, 'drain')
          }
        }
        connection.endCopyFrom()
      } catch { connection.sendCopyFail('Backup stream failed integrity or resource checks') }
    })()
  }
}

async function* exportCopy(client: Client, sql: string): ByteStream {
  const query = new ExportQuery(sql)
  query.on('error', () => query.output.destroy(failure('BACKUP_COPY_READ_FAILED')))
  query.on('end', () => query.output.end())
  client.query(query)
  try { for await (const bytes of query.output) yield Buffer.from(bytes as Uint8Array) }
  finally { if (!query.output.readableEnded) await client.end() }
}

async function importCopy(client: Client, sql: string, input: ByteStream) {
  const query = new ImportQuery(sql, input)
  const done = new Promise<void>((resolve, reject) => {
    query.on('end', () => resolve())
    query.on('error', () => reject(failure('BACKUP_COPY_WRITE_FAILED')))
  })
  client.query(query)
  await done
}

async function privateFile(path: string) {
  if (!isAbsolute(path)) throw failure('BACKUP_PRIVATE_FILE_PATH')
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw failure('BACKUP_PRIVATE_FILE_MODE')
}

export function parseService(text: string, service: string): Record<string, string> {
  if (!/^[A-Za-z0-9_.-]+$/.test(service)) throw failure('BACKUP_SERVICE_NAME')
  const result: Record<string, string> = {}
  let active = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    if (line.startsWith('[') && line.endsWith(']')) { active = line.slice(1, -1) === service; continue }
    if (!active) continue
    const split = line.indexOf('=')
    if (split < 1) throw failure('BACKUP_SERVICE_FORMAT')
    const key = line.slice(0, split).trim(); const value = line.slice(split + 1).trim()
    if (Object.hasOwn(result, key)) throw failure('BACKUP_SERVICE_DUPLICATE')
    result[key] = value
  }
  if (!result.host || !result.dbname || !result.user) throw failure('BACKUP_SERVICE_INCOMPLETE')
  const allowed = new Set(['host', 'port', 'dbname', 'user', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'connect_timeout', 'application_name'])
  if (Object.keys(result).some((key) => !allowed.has(key))) throw failure('BACKUP_SERVICE_OPTION_UNSUPPORTED')
  return result
}

export function parsePassword(text: string, fields: { host: string; port: string; dbname: string; user: string }): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    if (!raw || raw.startsWith('#')) continue
    const parts: string[] = []; let value = ''; let escaped = false
    for (const char of raw) {
      if (escaped) { value += char; escaped = false }
      else if (char === '\\') escaped = true
      else if (char === ':' && parts.length < 4) { parts.push(value); value = '' }
      else value += char
    }
    if (escaped) throw failure('BACKUP_PASSWORD_FORMAT')
    parts.push(value)
    if (parts.length !== 5) continue
    if ([fields.host, fields.port, fields.dbname, fields.user].every((item, index) => parts[index] === '*' || parts[index] === item)) return parts[4]
  }
  return undefined
}

async function connectionConfig(options: NativeOptions, service: string): Promise<ClientConfig> {
  await privateFile(options.serviceFile); await privateFile(options.passwordFile)
  const config = parseService(await readFile(options.serviceFile, 'utf8'), service)
  const port = config.port ?? '5432'
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw failure('BACKUP_SERVICE_PORT')
  const mode = config.sslmode ?? 'verify-full'
  if (!['disable', 'verify-full'].includes(mode)) throw failure('BACKUP_TLS_POLICY')
  if (mode === 'disable' && !['127.0.0.1', '::1', 'localhost'].includes(config.host) && !config.host.startsWith('/')) throw failure('BACKUP_REMOTE_TLS_REQUIRED')
  const password = parsePassword(await readFile(options.passwordFile, 'utf8'), { host: config.host, port, dbname: config.dbname, user: config.user })
  const ssl = mode === 'disable' ? false : {
    rejectUnauthorized: true,
    ...(config.sslrootcert ? { ca: await readFile(config.sslrootcert, 'utf8') } : {}),
    ...(config.sslcert ? { cert: await readFile(config.sslcert, 'utf8') } : {}),
    ...(config.sslkey ? { key: await readFile(config.sslkey, 'utf8') } : {}),
  }
  if (config.sslkey) await privateFile(config.sslkey)
  return { host: config.host, port: Number(port), database: config.dbname, user: config.user, password,
    ssl, connectionTimeoutMillis: 10000, application_name: 'mercato-backup',
    options: '-c lock_timeout=30000 -c statement_timeout=21600000' }
}

async function connect(options: NativeOptions, service: string) {
  options.signal?.throwIfAborted()
  const client = new Client(await connectionConfig(options, service))
  client.on('error', () => undefined)
  try { await client.connect() }
  catch { await client.end().catch(() => undefined); throw failure('BACKUP_CONNECTION_FAILED') }
  const abort = () => { void client.end() }
  options.signal?.addEventListener('abort', abort, { once: true })
  client.once('end', () => options.signal?.removeEventListener('abort', abort))
  return client
}

async function databaseIdentity(client: Client): Promise<DatabaseIdentity> {
  const result = await client.query<{ oid: string; major: string; encoding: string; collation: string; system_id: string; timeline: string; recovery: boolean }>(`
    SELECT d.oid::text, (current_setting('server_version_num')::int / 10000)::text AS major,
      pg_encoding_to_char(d.encoding) AS encoding, d.datcollate AS collation,
      c.system_identifier::text AS system_id, p.timeline_id::text AS timeline, pg_is_in_recovery() AS recovery
    FROM pg_database d CROSS JOIN pg_control_system() c CROSS JOIN pg_control_checkpoint() p
    WHERE d.datname = current_database()`)
  const row = result.rows[0]
  if (!row || !['16', '17', '18'].includes(row.major)) throw failure('BACKUP_POSTGRES_VERSION_OR_IDENTITY')
  return { clusterIncarnation: `${row.system_id}:${row.timeline}:${row.recovery ? 'recovery' : 'primary'}`, databaseOid: row.oid,
    serverMajor: Number(row.major), encoding: row.encoding, collation: row.collation }
}

async function binary(options: NativeOptions, name: string) {
  if (!isAbsolute(options.binariesDir)) throw failure('BACKUP_BINARIES_DIRECTORY')
  const directory = await realpath(options.binariesDir)
  const directoryStat = await stat(directory)
  if ((directoryStat.mode & 0o022) !== 0) throw failure('BACKUP_BINARIES_WRITABLE')
  const path = await realpath(join(directory, name))
  const info = await stat(path)
  if (!info.isFile() || (info.mode & 0o022) !== 0) throw failure('BACKUP_BINARY_UNSAFE')
  return path
}

function environment(options: NativeOptions): NodeJS.ProcessEnv {
  return { PATH: options.binariesDir, PGSERVICEFILE: options.serviceFile, PGPASSFILE: options.passwordFile,
    PGCONNECT_TIMEOUT: '10', LC_ALL: 'C', TZ: 'UTC', PGOPTIONS: '-c lock_timeout=30000' }
}

async function* native(options: NativeOptions, name: string, args: string[], input?: ByteStream): ByteStream {
  const child = spawn(await binary(options, name), args, { env: environment(options), stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal })
  child.stderr.on('data', () => undefined)
  let error: Error | undefined
  const completed = new Promise<void>((resolve) => {
    child.once('error', () => { error = failure('BACKUP_NATIVE_FAILED'); resolve() })
    child.once('close', (code) => { if (code !== 0) error = failure('BACKUP_NATIVE_FAILED'); resolve() })
  })
  const feed = input ? pipeline(input, child.stdin).catch(() => { child.kill('SIGTERM'); error = failure('BACKUP_NATIVE_INPUT_FAILED') }) : Promise.resolve(child.stdin.end())
  try {
    for await (const data of child.stdout) yield Buffer.from(data as Uint8Array)
    await completed; await feed
    if (error) throw error
  } finally { if (child.exitCode === null) child.kill('SIGTERM') }
}

async function nativeText(options: NativeOptions, name: string, args: string[], maximum = 1024 * 1024) {
  const buffers: Buffer[] = []; let length = 0
  for await (const bytes of native(options, name, args)) {
    length += bytes.byteLength
    if (length > maximum) throw failure('BACKUP_NATIVE_METADATA_LIMIT')
    buffers.push(Buffer.from(bytes))
  }
  return Buffer.concat(buffers).toString('utf8')
}

async function verifyTools(options: NativeOptions, major: number) {
  for (const name of ['pg_dump', 'pg_restore', 'psql']) {
    const version = await nativeText(options, name, ['--version'])
    if (Number(version.match(/PostgreSQL\) (\d+)/)?.[1]) !== major) throw failure('BACKUP_CLIENT_MAJOR_MISMATCH')
  }
}

export function createPostgresSource(options: NativeOptions): BackupSource {
  let control: Client | undefined
  const workers = new Set<Client>()
  const close = async () => { await Promise.allSettled([...workers].map((client) => client.end())); workers.clear(); await control?.end(); control = undefined }
  return {
    async open(): Promise<Snapshot> {
      if (!options.sourceService) throw failure('BACKUP_SOURCE_SERVICE_REQUIRED')
      const service = options.sourceService
      control = await connect(options, service)
      const identity = await databaseIdentity(control)
      await verifyTools(options, identity.serverMajor)
      const connections = await control.query<{ capacity: number; used: number }>("SELECT current_setting('max_connections')::int AS capacity, (SELECT count(*)::int FROM pg_stat_activity) AS used")
      if (connections.rows[0].capacity - connections.rows[0].used < (options.jobs ?? 2) + 7) throw failure('BACKUP_CONNECTION_BUDGET')
      await control.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const snapshotRow = (await control.query<{ snapshot: string; evidence: string }>('SELECT pg_export_snapshot() AS snapshot, pg_current_snapshot()::text AS evidence')).rows[0]
      if (!/^[0-9A-Fa-f-]+$/.test(snapshotRow.snapshot)) throw failure('BACKUP_SNAPSHOT_INVALID')
      const [, xmax, active] = snapshotRow.evidence.split(':')
      const tables = await control.query<{ schema: string; table: string; rows: string; bytes: string; columns: string[]; keys: string[] }>(`
        SELECT n.nspname AS schema, c.relname AS table, greatest(c.reltuples,0)::bigint::text AS rows,
          pg_relation_size(c.oid)::text AS bytes,
          ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' ORDER BY a.attnum) AS columns,
          ARRAY(SELECT a.attname::text FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(num,ord)
            JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num WHERE i.indrelid=c.oid AND i.indisprimary ORDER BY k.ord) AS keys
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema','om_backup_restore')
          AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
        ORDER BY n.nspname,c.relname LIMIT 10001`)
      if (tables.rows.length > 10000) throw failure('BACKUP_ENTITY_LIMIT')
      await control.query('SET LOCAL row_security = off')
      for (const row of tables.rows) await control.query(`SELECT 1 FROM ONLY ${identifier(row.schema)}.${identifier(row.table)} LIMIT 1`)
      const entities: Entity[] = tables.rows.map((row, ordinal) => ({ key: `e${String(ordinal + 1).padStart(4, '0')}`, schema: row.schema, table: row.table,
        columns: row.columns, primaryKeys: row.keys, label: `${row.schema}.${row.table}`, estimatedRows: row.rows, estimatedBytes: row.bytes }))
      const largeObjects = (await control.query<{ oid: string; bytes: string }>(`
        SELECT m.oid::text AS oid, COALESCE(max(l.pageno::bigint * 2048 + octet_length(l.data)),0)::text AS bytes
        FROM pg_largeobject_metadata m LEFT JOIN pg_largeobject l ON l.loid=m.oid GROUP BY m.oid ORDER BY m.oid LIMIT 10001`)).rows
      if (largeObjects.length + entities.length > 10000) throw failure('BACKUP_ENTITY_LIMIT')
      for (const object of largeObjects) entities.push({ key: `e${String(entities.length + 1).padStart(4, '0')}`,
        kind: 'large-object', largeObjectOid: object.oid, schema: 'pg_catalog', table: 'pg_largeobject',
        columns: [], primaryKeys: [], label: `large-object ${object.oid}`, estimatedRows: '1', estimatedBytes: object.bytes })
      const foreignKeys = (await control.query<{ schema: string; table: string; name: string; definition: string }>(`
        SELECT n.nspname AS schema,c.relname AS table,k.conname AS name,pg_get_constraintdef(k.oid) AS definition
        FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE k.contype='f' AND n.nspname NOT IN ('pg_catalog','information_schema','om_backup_restore') ORDER BY k.oid`)).rows
      const catalog = (await control.query<{ entry: string }>(`SELECT concat_ws(':',n.nspname,c.relname,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attgenerated) AS entry
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
        WHERE c.relkind IN ('r','p','S') AND a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT IN ('pg_catalog','information_schema','om_backup_restore')
        ORDER BY n.nspname,c.relname,a.attnum`)).rows
      const catalogDigest = digest(JSON.stringify({ entities: entities.map(({ key, schema, table, columns, primaryKeys, kind, largeObjectOid }) => ({ key, schema, table, columns, primaryKeys, kind, largeObjectOid })), foreignKeys, catalog }))
      return {
        identity, evidence: { xmax, xipList: active ? active.split(',') : [] }, catalogDigest, entities, foreignKeys,
        async boundary() {
          const fresh = await connect(options, service)
          try {
            await fresh.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
            const currentIdentity = await databaseIdentity(fresh)
            const descriptor = (await fresh.query<{ snapshot: string }>('SELECT pg_current_snapshot()::text AS snapshot')).rows[0].snapshot
            const [, horizon, inFlight] = descriptor.split(':')
            return { identity: currentIdentity, evidence: { xmax: horizon, xipList: inFlight ? inFlight.split(',') : [] } }
          } finally { await fresh.end() }
        },
        schema(section) { return native(options, 'pg_dump', ['--dbname', `service=${service}`, '--format=custom', `--section=${section}`, `--snapshot=${snapshotRow.snapshot}`, '--no-owner', '--no-acl', '--no-tablespaces', '--exclude-schema=om_backup_restore']) },
        async *chunks(entity, request): AsyncIterable<SourceChunk> {
          const client = await connect(options, service); workers.add(client)
          try {
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
            await client.query(`SET TRANSACTION SNAPSHOT ${literal(snapshotRow.snapshot)}`)
            await client.query('SET LOCAL row_security = off')
            if (entity.kind === 'large-object') {
              if (!entity.largeObjectOid || request.after) throw failure('BACKUP_LARGE_OBJECT_BINDING')
              const size = BigInt(entity.estimatedBytes)
              const chunkBytes = Math.max(65536, Math.min(request.chunkSizeBytes, 64 * 1024 * 1024))
              for (let offset = 0n, sequence = 0; offset < size || sequence === 0; offset += BigInt(chunkBytes), sequence++) {
                const end = offset + BigInt(chunkBytes) < size ? offset + BigInt(chunkBytes) : size
                const begin = offset
                const stream = (async function* () {
                  const header = Buffer.alloc(8); header.writeBigUInt64BE(begin); yield header
                  for (let position = begin; position < end; position += 65536n) {
                    const length = Number(end - position < 65536n ? end - position : 65536n)
                    const result = await client.query<{ data: Buffer }>('SELECT lo_get($1::oid,$2::bigint,$3::int) AS data', [entity.largeObjectOid, position.toString(), length])
                    if (result.rows[0]?.data?.byteLength !== length) throw failure('BACKUP_LARGE_OBJECT_TRUNCATED')
                    yield result.rows[0].data
                  }
                })()
                yield { sequence, rows: sequence === 0 ? '1' : '0', stream }
                if (size === 0n) break
              }
              await client.query('COMMIT')
              return
            }
            const keys = entity.primaryKeys ?? []
            const columnSql = entity.columns.map(identifier).join(',')
            if (!columnSql) throw failure('BACKUP_TABLE_COLUMNS_EMPTY')
            if (keys.length) {
              let after = request.after
              let sequence = 0
              const average = Number(entity.estimatedBytes) / Math.max(1, Number(entity.estimatedRows))
              let batch = Math.max(1, Math.min(1000000, Math.floor(request.chunkSizeBytes / Math.max(average, 64))))
              for (;;) {
                const where = after ? `WHERE (${keys.map(identifier).join(',')}) > (${after.map(literal).join(',')})` : ''
                const selection = `SELECT ${columnSql} FROM ONLY ${relation(entity)} ${where} ORDER BY ${keys.map(identifier).join(',')} LIMIT ${batch}`
                const bounds = await client.query<{ count: string; tail: string[] }>(`WITH chosen AS (${selection}) SELECT count(*)::text AS count,
                  (SELECT ARRAY[${keys.map((key) => `${identifier(key)}::text`).join(',')}] FROM chosen ORDER BY ${keys.map((key) => `${identifier(key)} DESC`).join(',')} LIMIT 1) AS tail FROM chosen`)
                const row = bounds.rows[0]
                if (!row || row.count === '0') break
                const from = after; let bytes = 0
                const stream = (async function* () { for await (const part of exportCopy(client, `COPY (${selection}) TO STDOUT (FORMAT binary)`)) { bytes += part.byteLength; yield part } })()
                yield { sequence: sequence++, rows: row.count, keyFrom: from, keyTo: row.tail, stream }
                after = row.tail
                if (bytes) batch = Math.max(1, Math.min(1000000, Math.floor(batch * request.chunkSizeBytes / bytes)))
              }
            } else {
              if (request.after) throw failure('BACKUP_CTID_RESUME_REQUIRES_RESTART')
              const blocks = Number((await client.query<{ blocks: string }>(`SELECT ceil(pg_relation_size(${literal(relation(entity))}::regclass)::numeric/current_setting('block_size')::int)::text AS blocks`)).rows[0].blocks)
              const blockSize = Number((await client.query<{ size: string }>("SELECT current_setting('block_size') AS size")).rows[0].size)
              const pages = Math.max(1, Math.floor(request.chunkSizeBytes / blockSize))
              for (let start = 0, sequence = 0; start < blocks; start += pages, sequence++) {
                const end = Math.min(blocks, start + pages)
                const select = `SELECT ${columnSql} FROM ONLY ${relation(entity)} WHERE ctid >= ${literal(`(${start},0)`)}::tid AND ctid < ${literal(`(${end},0)`)}::tid`
                const count = (await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM (${select}) chosen`)).rows[0].count
                yield { sequence, rows: count, stream: exportCopy(client, `COPY (${select}) TO STDOUT (FORMAT binary)`) }
              }
            }
            await client.query('COMMIT')
          } finally { workers.delete(client); await client.end() }
        },
        async sequences() {
          if (!control) throw failure('BACKUP_SNAPSHOT_CLOSED')
          const list = (await control.query<{ schema: string; name: string; table_schema: string | null; table_name: string | null; column_name: string | null }>(`
            SELECT n.nspname AS schema,c.relname AS name,tn.nspname AS table_schema,t.relname AS table_name,a.attname AS column_name
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_depend d ON d.objid=c.oid AND d.deptype IN ('a','i')
            LEFT JOIN pg_class t ON t.oid=d.refobjid LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace
            LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
            WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema','om_backup_restore') ORDER BY n.nspname,c.relname`)).rows
          const states = []
          for (const row of list) {
            const value = (await control.query<{ value: string; called: boolean }>(`SELECT last_value::text AS value,is_called AS called FROM ${identifier(row.schema)}.${identifier(row.name)}`)).rows[0]
            const maximum = row.table_schema && row.table_name && row.column_name ? (await control.query<{ maximum: string | null }>(`SELECT max(${identifier(row.column_name)})::text AS maximum FROM ${identifier(row.table_schema)}.${identifier(row.table_name)}`)).rows[0].maximum : null
            states.push({ schema: row.schema, name: row.name, value: value.value, isCalled: value.called, ...(maximum ? { maxValue: maximum } : {}) })
          }
          return states
        }, close,
      }
    }, close,
  }
}

export function createPostgresTarget(options: NativeOptions): RestoreTarget {
  let client: Client | undefined
  let runId: string | undefined
  let lockId: string | undefined
  let expected: { challenge: string; digest: string; expires: number } | undefined
  const current = async () => { if (!client) { if (!options.targetService) throw failure('BACKUP_TARGET_SERVICE_REQUIRED'); client = await connect(options, options.targetService) } return client }
  const transaction = async (operation: (connection: Client) => Promise<void>) => {
    const connection = await current(); await connection.query('BEGIN')
    try { await operation(connection); await connection.query('COMMIT') }
    catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error }
  }
  const step = async (id: string, kind: string, operation: (connection: Client) => Promise<void>) => {
    await transaction(async (connection) => {
      if ((await connection.query('SELECT 1 FROM om_backup_restore.restore_steps WHERE step_key=$1', [id])).rowCount) return
      await operation(connection)
      await connection.query("INSERT INTO om_backup_restore.restore_steps(step_key,kind,status) VALUES($1,$2,'done')", [id, kind])
    })
  }
  return {
    async countRows(entity) { return entity.kind === 'large-object'
      ? (await (await current()).query<{ count: string }>('SELECT count(*)::text AS count FROM pg_largeobject_metadata WHERE oid=$1::oid', [entity.largeObjectOid])).rows[0].count
      : (await (await current()).query<{ count: string }>(`SELECT count(*)::text AS count FROM ONLY ${relation(entity)}`)).rows[0].count },
    async identity() { const connection = await current(); const identity = await databaseIdentity(connection); await verifyTools(options, identity.serverMajor); return identity },
    async challenge(binding) {
      const identity = await databaseIdentity(await current())
      if (identity.clusterIncarnation === binding.sourceIdentity.clusterIncarnation && identity.databaseOid === binding.sourceIdentity.databaseOid) throw failure('BACKUP_TARGET_IS_SOURCE')
      if (identity.serverMajor !== binding.sourceIdentity.serverMajor || identity.encoding !== binding.sourceIdentity.encoding || identity.collation !== binding.sourceIdentity.collation) throw failure('BACKUP_TARGET_INCOMPATIBLE')
      const challenge = `RESTORE-${digest(JSON.stringify({ binding, identity, timeWindow: Math.floor(Date.now() / 600000) })).slice(0, 20)}`
      expected = { challenge, digest: digest(JSON.stringify(identity)), expires: Date.now() + 600000 }
      return challenge
    },
    async initialize(run) {
      const connection = await current()
      const identity = await databaseIdentity(connection)
      if (!expected || expected.challenge !== run.confirmation || expected.expires < Date.now() || expected.digest !== digest(JSON.stringify(identity))) throw failure('BACKUP_TARGET_CONFIRMATION')
      const locked = (await connection.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('om_backup_restore',0)) AS locked")).rows[0].locked
      if (!locked) throw failure('BACKUP_TARGET_LOCKED')
      lockId = 'om_backup_restore'
      await transaction(async (session) => {
        const exists = (await session.query("SELECT 1 FROM pg_namespace WHERE nspname='om_backup_restore'")).rowCount
        if (exists) {
          const record = (await session.query<{ run: string; backup: string; digest: string }>('SELECT restore_run_id AS run,backup_id AS backup,manifest_sha256 AS digest FROM om_backup_restore.restore_run')).rows
          if (record.length !== 1 || record[0].run !== run.runId || record[0].backup !== run.backupId || record[0].digest !== run.manifestSha256) throw failure('BACKUP_RESTORE_BINDING')
        } else {
          const objects = await session.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' LIMIT 1")
          const extra = await session.query(`SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'
            UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')
            UNION ALL SELECT 1 FROM pg_largeobject_metadata LIMIT 1`)
          if (objects.rowCount || extra.rowCount) throw failure('BACKUP_TARGET_NOT_EMPTY')
          await session.query(`CREATE SCHEMA om_backup_restore;
            CREATE TABLE om_backup_restore.restore_run(restore_run_id text PRIMARY KEY,backup_id text NOT NULL,manifest_sha256 text NOT NULL,target_challenge_digest text NOT NULL,phase text NOT NULL DEFAULT 'initialized',heartbeat_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz NOT NULL DEFAULT now());
            CREATE TABLE om_backup_restore.restore_chunks(entity_key text NOT NULL,seq int NOT NULL,sha256 text NOT NULL,rows bigint NOT NULL,restored_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(entity_key,seq));
            CREATE TABLE om_backup_restore.restore_steps(step_key text PRIMARY KEY,kind text NOT NULL,status text NOT NULL,detail text,finished_at timestamptz NOT NULL DEFAULT now())`)
          await session.query('INSERT INTO om_backup_restore.restore_run(restore_run_id,backup_id,manifest_sha256,target_challenge_digest) VALUES($1,$2,$3,$4)', [run.runId, run.backupId, run.manifestSha256, digest(run.confirmation)])
        }
      })
      runId = run.runId
    },
    async hasStep(stepId) { return Boolean((await (await current()).query('SELECT 1 FROM om_backup_restore.restore_steps WHERE step_key=$1', [stepId])).rowCount) },
    async schema(section, stream, stepId) {
      if (!runId) throw failure('BACKUP_RESTORE_NOT_INITIALIZED')
      const directory = await mkdtemp(join(tmpdir(), 'om-backup-schema-')); await chmod(directory, 0o700)
      try {
        const archive = join(directory, 'schema.dump')
        const maximum = options.maxStagingBytes ?? 1024 * 1024 * 1024
        let stagedBytes = 0
        const cap = new Transform({ transform(chunk: Buffer, _encoding, callback) {
          stagedBytes += chunk.byteLength
          callback(stagedBytes > maximum ? failure('BACKUP_SCHEMA_STAGING_LIMIT') : null, chunk)
        } })
        await pipeline(stream, cap, createWriteStream(archive, { mode: 0o600, flags: 'wx' }))
        const list = await nativeText(options, 'pg_restore', ['--list', archive], 16 * 1024 * 1024)
        const entries = list.split('\n').filter((line) => /^\d+;/.test(line) && !line.includes(' FK CONSTRAINT '))
        const width = section === 'pre-data' ? 500 : 1
        for (let offset = 0; offset < entries.length; offset += width) {
          const id = `${stepId}:${offset}`
          if (await this.hasStep(id)) continue
          const selection = join(directory, 'selection.list'); await writeFile(selection, entries.slice(offset, offset + width).join('\n') + '\n', { mode: 0o600 })
          const rendered = native(options, 'pg_restore', ['--no-owner', '--no-acl', '--no-tablespaces', '--use-list', selection, '--file=-', archive])
          const script = (async function* () {
            yield Buffer.from('SET lock_timeout=30000;\n')
            let renderedBytes = 0
            for await (const bytes of rendered) {
              renderedBytes += bytes.byteLength
              if (renderedBytes > maximum) throw failure('BACKUP_SCHEMA_RENDER_LIMIT')
              yield bytes
            }
            yield Buffer.from(`\nINSERT INTO om_backup_restore.restore_steps(step_key,kind,status) VALUES(${literal(id)},${literal(section)},'done');\n`)
          })()
          for await (const ignored of native(options, 'psql', ['--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '--single-transaction', '--dbname', `service=${options.targetService}`, '--file=-'], script)) { void ignored }
        }
        await step(stepId, section, async () => undefined)
      } finally { await rm(directory, { recursive: true, force: true }) }
    },
    async chunk(entity, stream, record) {
      if (record.runId !== runId) throw failure('BACKUP_RESTORE_RUN_MISMATCH')
      await transaction(async (connection) => {
        const prior = (await connection.query<{ sha256: string }>('SELECT sha256 FROM om_backup_restore.restore_chunks WHERE entity_key=$1 AND seq=$2', [entity.key, record.sequence])).rows[0]
        if (prior) { if (prior.sha256 !== record.sha256) throw failure('BACKUP_RESTORE_CHUNK_MISMATCH'); return }
        if (entity.kind === 'large-object') {
          if (!entity.largeObjectOid) throw failure('BACKUP_LARGE_OBJECT_BINDING')
          const exists = (await connection.query('SELECT 1 FROM pg_largeobject_metadata WHERE oid=$1::oid', [entity.largeObjectOid])).rowCount
          if (!exists) {
            if (record.sequence !== 0) throw failure('BACKUP_LARGE_OBJECT_MISSING')
            await connection.query('SELECT lo_create($1::oid)', [entity.largeObjectOid])
          }
          let header = Buffer.alloc(0)
          let offset: bigint | undefined
          for await (const part of stream) {
            let data = Buffer.from(part)
            if (offset === undefined) {
              const needed = 8 - header.length
              header = Buffer.concat([header, data.subarray(0, needed)])
              data = data.subarray(needed)
              if (header.length < 8) continue
              offset = header.readBigUInt64BE()
              if (offset > 4n * 1024n * 1024n * 1024n * 1024n) throw failure('BACKUP_LARGE_OBJECT_OFFSET')
            }
            for (let start = 0; start < data.byteLength; start += 65536) {
              const slice = data.subarray(start, start + 65536)
              await connection.query('SELECT lo_put($1::oid,$2::bigint,$3::bytea)', [entity.largeObjectOid, offset.toString(), slice])
              offset += BigInt(slice.byteLength)
            }
          }
          if (offset === undefined) throw failure('BACKUP_LARGE_OBJECT_HEADER')
        } else {
          await importCopy(connection, `COPY ${relation(entity)} (${entity.columns.map(identifier).join(',')}) FROM STDIN (FORMAT binary)`, stream)
        }
        await connection.query('INSERT INTO om_backup_restore.restore_chunks(entity_key,seq,sha256,rows) VALUES($1,$2,$3,$4)', [entity.key, record.sequence, record.sha256, record.rows])
        await connection.query('UPDATE om_backup_restore.restore_run SET heartbeat_at=now(),phase=$1', ['data'])
      })
    },
    async sequences(states) {
      await step('sequences', 'sequences', async (connection) => {
        for (const state of states) {
          const value = state.maxValue && BigInt(state.maxValue) > BigInt(state.value) ? state.maxValue : state.value
          await connection.query('SELECT setval($1::regclass,$2::bigint,$3)', [`${identifier(state.schema)}.${identifier(state.name)}`, value, state.isCalled || Boolean(state.maxValue)])
        }
      })
    },
    async foreignKeys(keys) {
      const failures: string[] = []
      for (const key of keys) {
        const id = digest(JSON.stringify([key.schema, key.table, key.name]))
        await step(`fk-create:${id}`, 'fk-create', async (connection) => {
          if (!key.definition.startsWith('FOREIGN KEY ')) throw failure('BACKUP_FOREIGN_KEY_DEFINITION')
          await connection.query(`ALTER TABLE ${relation(key)} ADD CONSTRAINT ${identifier(key.name)} ${key.definition.replace(/\s+NOT VALID$/, '')} NOT VALID`)
        })
        try { await step(`fk-validate:${id}`, 'fk-validate', async (connection) => { await connection.query(`ALTER TABLE ${relation(key)} VALIDATE CONSTRAINT ${identifier(key.name)}`) }) }
        catch { failures.push(id) }
      }
      if (failures.length) throw failure('BACKUP_FOREIGN_KEY_VALIDATION_FAILED')
    },
    async finish(reportPath) {
      const info = await stat(reportPath)
      if (!info.isFile() || !info.size) throw failure('BACKUP_REPORT_NOT_DURABLE')
      await (await current()).query('ANALYZE')
      await transaction(async (connection) => { await connection.query('DROP SCHEMA om_backup_restore CASCADE') })
    },
    async close() {
      if (lockId && client) await client.query("SELECT pg_advisory_unlock(hashtextextended('om_backup_restore',0))").catch(() => undefined)
      await client?.end(); client = undefined; lockId = undefined
    },
  }
}
