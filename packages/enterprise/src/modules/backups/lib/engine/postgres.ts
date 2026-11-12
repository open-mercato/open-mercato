import { createHash } from 'node:crypto'
import { z } from 'zod'
import { privateDirectory, readBoundedFile } from './artifacts'
import { BackupError } from './errors'
import { samePhysicalDatabase } from './snapshot'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { chmod, lstat, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { PassThrough, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Client, Query, type ClientConfig } from 'pg'
import type { BackupSource, ByteStream, DatabaseIdentity, Entity, NativeOptions, RestoreTarget, RestoreRun, Snapshot, SourceChunk } from './types'

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
const relation = (entity: Pick<Entity, 'schema' | 'table'>) => `${identifier(entity.schema)}.${identifier(entity.table)}`
const failure = (code: string): BackupError => {
  const invalid = new Set(['BACKUP_SERVICE_NAME', 'BACKUP_SERVICE_FORMAT', 'BACKUP_SERVICE_DUPLICATE', 'BACKUP_SERVICE_INCOMPLETE', 'BACKUP_SERVICE_OPTION_UNSUPPORTED', 'BACKUP_SERVICE_PORT', 'BACKUP_POSTGRES_VERSION_OR_IDENTITY', 'BACKUP_CLIENT_MAJOR_MISMATCH', 'BACKUP_ENTITY_LIMIT', 'BACKUP_RELATION_KIND_UNSUPPORTED', 'BACKUP_NESTED_REGCLASS_UNSUPPORTED', 'BACKUP_LATE_REGCLASS_UNSUPPORTED', 'BACKUP_NATIVE_METADATA_LIMIT', 'BACKUP_TABLE_COLUMNS_EMPTY'])
  const integrity = new Set(['BACKUP_RESTORE_CHUNK_MISMATCH', 'BACKUP_LARGE_OBJECT_HEADER', 'BACKUP_LARGE_OBJECT_OFFSET', 'BACKUP_LARGE_OBJECT_TRUNCATED', 'BACKUP_SOURCE_COVERAGE_MISMATCH'])
  const runtime = new Set(['BACKUP_NATIVE_FAILED', 'BACKUP_NATIVE_INPUT_FAILED', 'BACKUP_COPY_READ_FAILED', 'BACKUP_COPY_WRITE_FAILED', 'BACKUP_CONNECTION_FAILED', 'BACKUP_SNAPSHOT_CLOSED'])
  if (code === 'BACKUP_FOREIGN_KEY_VALIDATION_FAILED') return new BackupError(code, 6)
  if (integrity.has(code)) return new BackupError(code, 4)
  if (runtime.has(code)) return new BackupError(code, 5, true)
  return new BackupError(code, invalid.has(code) ? 2 : 3)
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const limits = { highWaterMark: 256 * 1024 }

type Wire = {
  stream: NodeJS.ReadWriteStream & { pause(): void; resume(): void; writableLength: number }
  sendCopyFromChunk(chunk: Buffer): void
  endCopyFrom(): void
  sendCopyFail(message: string): void
}

class ExportQuery extends Query<Record<string, unknown>> {
  readonly output = new PassThrough(limits)
  private paused = false
  private wire?: Wire
  resumeSocket() { this.paused = false; this.wire?.stream.resume() }
  handleCopyData(message: { chunk: Buffer }, connection: Wire) {
    this.wire = connection
    if (!this.output.write(Buffer.from(message.chunk)) && !this.paused) {
      this.paused = true
      connection.stream.pause()
      this.output.once('drain', () => { this.paused = false; connection.stream.resume() })
    }
  }
}

class ImportQuery extends Query<Record<string, unknown>> {
  inputFailure?: BackupError
  private stopped=false
  private readonly abort=new AbortController()
  private pump?:Promise<void>
  constructor(sql: string, private readonly input: ByteStream) { super(sql) }
  cancel(){this.stopped=true;this.abort.abort()}
  async stop(){this.cancel();await this.pump}
  handleCopyInResponse(connection: Wire) {
    if(this.stopped)return
    const iterator=this.input[Symbol.asyncIterator]()
    const closed=()=>this.cancel()
    connection.stream.once('close',closed)
    this.pump=(async()=>{
      try{
        while(!this.stopped){
          const item=await iterator.next()
          if(item.done||this.stopped)break
          const bytes=item.value
          for(let offset=0;offset<bytes.byteLength&&!this.stopped;offset+=65536){
            connection.sendCopyFromChunk(Buffer.from(bytes.subarray(offset,offset+65536)))
            if(connection.stream.writableLength>=limits.highWaterMark)await once(connection.stream,'drain',{signal:this.abort.signal})
          }
        }
        if(!this.stopped)connection.endCopyFrom()
      }catch(error){
        if(!this.stopped){
          if(error instanceof BackupError)this.inputFailure=error
          try{connection.sendCopyFail('Backup stream failed integrity or resource checks')}catch{this.cancel()}
        }
      }finally{
        connection.stream.removeListener('close',closed)
        try{await iterator.return?.()}catch{ /* The original COPY/input failure remains authoritative. */ }
      }
    })()
  }
}

async function* exportCopy(client: Client, sql: string): ByteStream {
  const query = new ExportQuery(sql)
  query.on('error', () => { query.resumeSocket(); query.output.destroy(failure('BACKUP_COPY_READ_FAILED')) })
  query.on('end', () => { query.resumeSocket(); query.output.end() })
  client.query(query)
  try { for await (const bytes of query.output) yield bytes as Uint8Array }
  finally { query.resumeSocket(); if (!query.output.readableEnded) await client.end() }
}

async function importCopy(client: Client, sql: string, input: ByteStream) {
  const query = new ImportQuery(sql, input)
  const done = new Promise<void>((resolve, reject) => {
    query.on('end', () => resolve())
    query.on('error', () => {query.cancel();reject(query.inputFailure ?? failure('BACKUP_COPY_WRITE_FAILED'))})
  })
  client.query(query)
  try{await done}finally{await query.stop()}
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
    options: '-c lock_timeout=30000 -c statement_timeout=21600000 -c timezone=UTC -c standard_conforming_strings=on -c datestyle=ISO -c intervalstyle=postgres -c extra_float_digits=3 -c search_path=pg_catalog,public' }
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
  const result = await client.query<{ oid: string; major: string; encoding: string; collation: string; system_id: string; timeline: string; recovery: boolean;postmaster_start_us:string }>(`
    SELECT d.oid::text, (current_setting('server_version_num')::int / 10000)::text AS major,
      pg_encoding_to_char(d.encoding) AS encoding, d.datcollate AS collation,
      c.system_identifier::text AS system_id, p.timeline_id::text AS timeline, pg_is_in_recovery() AS recovery,
      (extract(epoch from pg_postmaster_start_time())*1000000)::bigint::text AS postmaster_start_us
    FROM pg_database d CROSS JOIN pg_control_system() c CROSS JOIN pg_control_checkpoint() p
    WHERE d.datname = current_database()`)
  const row = result.rows[0]
  if (!row || !['16', '17', '18'].includes(row.major)) throw failure('BACKUP_POSTGRES_VERSION_OR_IDENTITY')
  return { clusterIncarnation: `${row.system_id}:${row.timeline}:${row.recovery ? 'recovery' : 'primary'}:${row.postmaster_start_us}`, databaseOid: row.oid,
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

async function databaseMigrationFingerprint(client: Client): Promise<string> {
  const exists = (await client.query<{ present: string | null }>("SELECT to_regclass('public.mikro_orm_migrations')::text AS present")).rows[0].present
  if (!exists) return digest('[]')
  const hash = createHash('sha256'); hash.update('[')
  let count = 0; let size = 0; let invalid: BackupError | undefined
  const query = new Query<{ row: string | null }>(`SELECT CASE WHEN octet_length(to_jsonb(m)::text)<=65536 THEN to_jsonb(m)::text ELSE NULL END AS row FROM public.mikro_orm_migrations m ORDER BY to_jsonb(m)::text`)
  const done = new Promise<string>((resolve, reject) => {
    query.on('row', (entry: { row: string | null }) => {
      if (invalid) return
      count++; size += entry.row?.length ?? 0
      if (entry.row === null || count > 100000 || size > 64 * 1024 * 1024) { invalid = failure('BACKUP_NATIVE_METADATA_LIMIT'); return }
      if (count > 1) hash.update(',')
      hash.update(entry.row)
    })
    query.on('error', () => reject(failure('BACKUP_MIGRATION_FINGERPRINT_FAILED')))
    query.on('end', () => { if (invalid) reject(invalid); else { hash.update(']'); resolve(hash.digest('hex')) } })
  })
  client.query(query)
  return done
}

async function completeSchemaFingerprint(client: Client): Promise<string> {
  const sql = `WITH namespaces AS (
    SELECT oid FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','om_backup_restore')
      AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'
  ), metadata(kind,key,definition) AS (
    SELECT 'default',adrelid::text||':'||adnum,pg_get_expr(adbin,adrelid) FROM pg_attrdef d JOIN pg_class c ON c.oid=d.adrelid WHERE c.relnamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'constraint',c.oid::text,pg_get_constraintdef(c.oid)||':'||c.convalidated::text FROM pg_constraint c WHERE c.connamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'index',i.indexrelid::text,pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relnamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'trigger',t.oid::text,pg_get_triggerdef(t.oid)||':'||t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'function',p.oid::text,pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.prokind <> 'a' AND p.pronamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'aggregate',p.oid::text,to_jsonb(a)::text FROM pg_aggregate a JOIN pg_proc p ON p.oid=a.aggfnoid WHERE p.pronamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'type',t.oid::text,to_jsonb(t)::text FROM pg_type t WHERE t.typnamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'enum',e.enumtypid::text||':'||e.enumsortorder::text,e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typnamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'range',r.rngtypid::text,to_jsonb(r)::text FROM pg_range r JOIN pg_type t ON t.oid=r.rngtypid WHERE t.typnamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'extension',e.oid::text,to_jsonb(e)::text FROM pg_extension e
    UNION ALL SELECT 'collation',c.oid::text,to_jsonb(c)::text FROM pg_collation c WHERE c.collnamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'view',c.oid::text,pg_get_viewdef(c.oid) FROM pg_class c WHERE c.relkind IN ('v','m') AND c.relnamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'relation',c.oid::text,jsonb_build_array(c.relkind,c.relpersistence,c.relreplident,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,pg_get_expr(c.relpartbound,c.oid),CASE WHEN c.relkind='p' THEN pg_get_partkeydef(c.oid) ELSE NULL END)::text FROM pg_class c WHERE c.relnamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'inheritance',i.inhrelid::text||':'||i.inhseqno::text,i.inhparent::text FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid WHERE c.relnamespace IN (SELECT oid FROM namespaces)
    UNION ALL SELECT 'policy',p.oid::text,jsonb_build_array(p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))::text FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace IN (SELECT oid FROM namespaces)
  ) SELECT kind,key,CASE WHEN octet_length(definition)<=1048576 THEN definition ELSE NULL END AS definition FROM metadata ORDER BY kind,key`
  const hash = createHash('sha256')
  let count = 0; let size = 0; let invalid: BackupError | undefined
  const query = new Query<{ kind: string; key: string; definition: string | null }>(sql)
  const done = new Promise<string>((resolve, reject) => {
    query.on('row', (row: { kind: string; key: string; definition: string | null }) => {
      if (invalid) return
      const frame = JSON.stringify([row.kind, row.key, row.definition])
      count++; size += Buffer.byteLength(frame)
      if (row.definition === null || count > 100000 || size > 64 * 1024 * 1024) { invalid = failure('BACKUP_NATIVE_METADATA_LIMIT'); return }
      hash.update(String(Buffer.byteLength(frame)) + ':'); hash.update(frame)
    })
    query.on('error', () => reject(failure('BACKUP_SCHEMA_FINGERPRINT_FAILED')))
    query.on('end', () => invalid ? reject(invalid) : resolve(hash.digest('hex')))
  })
  client.query(query)
  return done
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
      const unsupported = await control.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('f','m') AND n.nspname NOT IN ('pg_catalog','information_schema','om_backup_restore')
          AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' LIMIT 1`)
      if (unsupported.rowCount) throw failure('BACKUP_RELATION_KIND_UNSUPPORTED')
      const metadataSize = (await control.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_attribute a
        JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p','S') AND a.attnum>0 AND NOT a.attisdropped
          AND n.nspname NOT IN ('pg_catalog','information_schema','om_backup_restore')
          AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'`)).rows[0].count
      if (BigInt(metadataSize)>100000n) throw failure('BACKUP_NATIVE_METADATA_LIMIT')
      const tables = await control.query<{ schema: string; table: string; rows: string; bytes: string; columns: string[]; keys: string[]; key_types: string[]; text_copy: boolean; regclass_columns: string[]; regclass_arrays: string[]; nested_regclass: boolean }>(`
        SELECT n.nspname AS schema, c.relname AS table, greatest(c.reltuples,0)::bigint::text AS rows,
          pg_relation_size(c.oid)::text AS bytes,
          ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' ORDER BY a.attnum) AS columns,
          ARRAY(SELECT a.attname::text FROM unnest(cursor_index.indkey) WITH ORDINALITY k(num,ord)
            JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num WHERE k.ord<=cursor_index.indnkeyatts ORDER BY k.ord) AS keys,
          ARRAY(SELECT format_type(a.atttypid,a.atttypmod) FROM unnest(cursor_index.indkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num WHERE k.ord<=cursor_index.indnkeyatts ORDER BY k.ord) AS key_types,
          EXISTS (WITH RECURSIVE dependencies(oid) AS (
            SELECT a.atttypid FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''
            UNION SELECT next.oid FROM dependencies d JOIN pg_type t ON t.oid=d.oid CROSS JOIN LATERAL (
              SELECT t.typelem AS oid WHERE t.typelem<>0 UNION SELECT t.typbasetype WHERE t.typbasetype<>0
              UNION SELECT a.atttypid FROM pg_attribute a WHERE a.attrelid=t.typrelid AND a.attnum>0 AND NOT a.attisdropped
            ) next
          ) SELECT 1 FROM dependencies d JOIN pg_type t ON t.oid=d.oid WHERE t.oid>=16384 OR t.typname LIKE 'reg%') AS text_copy,
          ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND a.atttypid='regclass'::regtype ORDER BY a.attnum) AS regclass_columns,
          ARRAY(SELECT a.attname::text FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND t.typelem='regclass'::regtype ORDER BY a.attnum) AS regclass_arrays,
          EXISTS (WITH RECURSIVE nested(oid) AS (
            SELECT a.atttypid FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND a.atttypid<>'regclass'::regtype AND t.typelem<>'regclass'::regtype
            UNION SELECT next.oid FROM nested d JOIN pg_type t ON t.oid=d.oid CROSS JOIN LATERAL (
              SELECT t.typelem AS oid WHERE t.typelem<>0 UNION SELECT t.typbasetype WHERE t.typbasetype<>0
              UNION SELECT a.atttypid FROM pg_attribute a WHERE a.attrelid=t.typrelid AND a.attnum>0 AND NOT a.attisdropped
            ) next
          ) SELECT 1 FROM nested WHERE oid='regclass'::regtype) AS nested_regclass
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN LATERAL (
          SELECT i.indkey,i.indnkeyatts FROM pg_index i
          WHERE i.indrelid=c.oid AND i.indisunique AND i.indisvalid AND i.indisready
            AND i.indpred IS NULL AND i.indexprs IS NULL
            AND NOT EXISTS(SELECT 1 FROM unnest(i.indkey) WITH ORDINALITY key(attnum,ordinal)
              LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=key.attnum
              WHERE key.ordinal<=i.indnkeyatts AND (a.attnum IS NULL OR NOT a.attnotnull))
          ORDER BY i.indisprimary DESC,i.indexrelid LIMIT 1
        ) cursor_index ON true
        WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema','om_backup_restore')
          AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
        ORDER BY n.nspname,c.relname LIMIT 10001`)
      if (tables.rows.length > 10000) throw failure('BACKUP_ENTITY_LIMIT')
      await control.query('SET LOCAL row_security = off')
      for (const row of tables.rows) await control.query(`SELECT 1 FROM ONLY ${identifier(row.schema)}.${identifier(row.table)} LIMIT 1`)
      for (const row of tables.rows) {
        if (row.nested_regclass) throw failure('BACKUP_NESTED_REGCLASS_UNSUPPORTED')
        for (const [columns, array] of [[row.regclass_columns, false], [row.regclass_arrays, true]] as const) {
          for (const column of columns) {
            const value = `r.${identifier(column)}`
            const references = array ? `unnest(${value})` : `unnest(ARRAY[${value}]::regclass[])`
            const unavailable = await control.query(`SELECT 1 FROM ONLY ${identifier(row.schema)}.${identifier(row.table)} r
              CROSS JOIN LATERAL ${references} refs(value)
              LEFT JOIN pg_class c ON c.oid=refs.value::oid LEFT JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE refs.value IS NOT NULL AND (c.oid IS NULL OR c.relkind NOT IN ('r','p','S','v','c') OR n.nspname='om_backup_restore' OR n.nspname LIKE 'pg_temp%') LIMIT 1`)
            if (unavailable.rowCount) throw failure('BACKUP_LATE_REGCLASS_UNSUPPORTED')
          }
        }
      }
      const entities: Entity[] = tables.rows.map((row, ordinal) => ({ key: `e${String(ordinal + 1).padStart(4, '0')}`, schema: row.schema, table: row.table,
        columns: row.columns, primaryKeys: row.keys, ...(row.text_copy ? { copyFormat: 'text' as const } : {}), label: `${row.schema}.${row.table}`, estimatedRows: row.rows, estimatedBytes: row.bytes }))
      const primaryKeyTypes = new Map(entities.map((entity, ordinal) => [entity.key, tables.rows[ordinal].key_types]))
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
        WHERE k.contype='f' AND k.conparentid=0 AND n.nspname NOT IN ('pg_catalog','information_schema','om_backup_restore') ORDER BY k.oid`)).rows
      const catalog = (await control.query<{ entry: string }>(`SELECT concat_ws(':',n.nspname,c.relname,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attgenerated) AS entry
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
        WHERE c.relkind IN ('r','p','S') AND a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT IN ('pg_catalog','information_schema','om_backup_restore')
        ORDER BY n.nspname,c.relname,a.attnum LIMIT 100001`)).rows
      if (catalog.length>100000) throw failure('BACKUP_NATIVE_METADATA_LIMIT')
      const schemaFingerprint = await completeSchemaFingerprint(control)
      const migrationFingerprint = await databaseMigrationFingerprint(control)
      const catalogDigest = digest(JSON.stringify({ schemaFingerprint, entities: entities.map(({ key, schema, table, columns, primaryKeys, kind, largeObjectOid, copyFormat }) => ({ key, schema, table, columns, primaryKeys, kind, largeObjectOid, copyFormat })), foreignKeys, catalog }))
      return {
        identity, evidence: { xmax, xipList: active ? active.split(',') : [] }, catalogDigest, migrationFingerprint, entities, foreignKeys,
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
            const copyFormat = entity.copyFormat ?? 'binary'
            const declaredKeys = entity.primaryKeys ?? []
            const keys = declaredKeys.every((key) => entity.columns.includes(key)) ? declaredKeys : []
            const columnSql = entity.columns.map(identifier).join(',')
            if (!columnSql) throw failure('BACKUP_TABLE_COLUMNS_EMPTY')
            if (request.after && request.after.length !== keys.length) throw failure('BACKUP_SOURCE_CURSOR_BINDING')
            const types = keys.length ? primaryKeyTypes.get(entity.key) ?? [] : []
            if (types.length !== keys.length) throw failure('BACKUP_SOURCE_CURSOR_BINDING')
            const cursor = keys.map((_, index) => `((current_setting('om_backup.cursor')::jsonb->>${index})::${types[index]})`).join(',')
            const bindCursor = async (values: string[]) => { await client.query("SELECT set_config('om_backup.cursor',$1,true)", [JSON.stringify(values)]) }
            if (request.after) await bindCursor(request.after)
            const initialPredicate = request.after ? ` WHERE (${keys.map(identifier).join(',')}) > (${cursor})` : ''
            const expectedRows = BigInt((await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ONLY ${relation(entity)}${initialPredicate}`)).rows[0].count)
            if(request.retainedRows!==undefined){
              if(!request.after||!/^(0|[1-9][0-9]*)$/.test(request.retainedRows))throw failure('BACKUP_SOURCE_CURSOR_BINDING')
              const fullRows=BigInt((await client.query<{count:string}>(`SELECT count(*)::text AS count FROM ONLY ${relation(entity)}`)).rows[0].count)
              if(fullRows!==BigInt(request.retainedRows)+expectedRows)throw failure('BACKUP_SOURCE_COVERAGE_MISMATCH')
            }
            let copiedRows = 0n
            const sampleSelection = `SELECT ${columnSql} FROM ONLY ${relation(entity)}${initialPredicate} ${keys.length ? `ORDER BY ${keys.map(identifier).join(',')}` : 'ORDER BY ctid'} LIMIT 128`
            const sampleRows = Number((await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM (${sampleSelection}) sample`)).rows[0].count)
            let sampleBytes = 0
            if (sampleRows) for await (const bytes of exportCopy(client, `COPY (${sampleSelection}) TO STDOUT (FORMAT ${copyFormat})`)) sampleBytes += bytes.byteLength
            const average = sampleRows ? Math.max(1, (sampleBytes - (copyFormat === 'binary' ? 21 : 0)) / sampleRows) : 64
            const initialBatch = Math.max(1, Math.min(1000000, Math.floor(request.chunkSizeBytes / average)))
            if (keys.length) {
              let after = request.after
              let sequence = 0
              let batch = initialBatch
              for (;;) {
                if (after) await bindCursor(after)
                const where = after ? `WHERE (${keys.map(identifier).join(',')}) > (${cursor})` : ''
                const selection = `SELECT ${columnSql} FROM ONLY ${relation(entity)} ${where} ORDER BY ${keys.map(identifier).join(',')} LIMIT ${batch}`
                const bounds = await client.query<{ count: string; tail: string[] }>(`WITH chosen AS (${selection}) SELECT count(*)::text AS count,
                  (SELECT ARRAY[${keys.map((key) => `${identifier(key)}::text`).join(',')}] FROM chosen ORDER BY ${keys.map((key) => `${identifier(key)} DESC`).join(',')} LIMIT 1) AS tail FROM chosen`)
                const row = bounds.rows[0]
                if (!row || row.count === '0') break
                const from = after; let bytes = 0
                const stream = (async function* () { for await (const part of exportCopy(client, `COPY (${selection}) TO STDOUT (FORMAT ${copyFormat})`)) { bytes += part.byteLength; yield part } })()
                yield { sequence: sequence++, rows: row.count, keyFrom: from, keyTo: row.tail, stream }
                copiedRows += BigInt(row.count)
                after = row.tail
                if (bytes) batch = Math.max(1, Math.min(1000000, Math.floor(batch * request.chunkSizeBytes / bytes)))
              }
            } else {
              if (request.after) throw failure('BACKUP_CTID_RESUME_REQUIRES_RESTART')
              const blocks = Number((await client.query<{ blocks: string }>(`SELECT ceil(pg_relation_size(${literal(relation(entity))}::regclass)::numeric/current_setting('block_size')::int)::text AS blocks`)).rows[0].blocks)
              const blockSize = Number((await client.query<{ size: string }>("SELECT current_setting('block_size') AS size")).rows[0].size)
              const pages = Math.max(1, Math.floor(request.chunkSizeBytes / blockSize))
              let sequence = 0
              let batch = initialBatch
              for (let start = 0; start < blocks; start += pages) {
                const end = Math.min(blocks, start + pages)
                let after: string | undefined
                for (;;) {
                  const predicate = `ctid >= ${literal(`(${start},0)`)}::tid AND ctid < ${literal(`(${end},0)`)}::tid${after ? ` AND ctid > ${literal(after)}::tid` : ''}`
                  const positionSelection = `SELECT ctid AS position FROM ONLY ${relation(entity)} WHERE ${predicate} ORDER BY ctid LIMIT ${batch}`
                  const bound = (await client.query<{ count: string; tail: string | null }>(`WITH chosen AS (${positionSelection}) SELECT count(*)::text AS count,(SELECT position::text FROM chosen ORDER BY chosen.position DESC LIMIT 1) AS tail FROM chosen`)).rows[0]
                  if (!bound || bound.count === '0' || !bound.tail) break
                  const select = `SELECT ${columnSql} FROM ONLY ${relation(entity)} WHERE ${predicate} ORDER BY ctid LIMIT ${batch}`
                  let size = 0
                  const stream = (async function* () { for await (const part of exportCopy(client, `COPY (${select}) TO STDOUT (FORMAT ${copyFormat})`)) { size += part.byteLength; yield part } })()
                  yield { sequence: sequence++, rows: bound.count, stream }
                  copiedRows += BigInt(bound.count)
                  after = bound.tail
                  if (size) batch = Math.max(1, Math.min(1000000, Math.floor(Number(bound.count) * request.chunkSizeBytes / size)))
                }
              }
            }
            if (copiedRows !== expectedRows) throw failure('BACKUP_SOURCE_COVERAGE_MISMATCH')
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

export function createPostgresTarget(options: NativeOptions): RestoreTarget { return postgresTarget(options) }
function postgresTarget(options: NativeOptions, bound?: { client: Client; runId: string }): RestoreTarget {
  let client: Client | undefined = bound?.client
  let runId: string | undefined = bound?.runId
  let activeRun: RestoreRun | undefined
  let lookupQueue:Promise<void>=Promise.resolve()
  let lockId: string | undefined
  let expected: { challenge: string; digest: string; baseline: string; expires: number } | undefined
  const current = async () => { if (!client) { if (!options.targetService) throw failure('BACKUP_TARGET_SERVICE_REQUIRED'); client = await connect(options, options.targetService) } return client }
  const acquireLock = async (connection: Client) => {
    if (lockId) return
    const locked = (await connection.query<{locked:boolean}>("SELECT pg_try_advisory_lock(hashtextextended('om_backup_restore',0)) AS locked")).rows[0].locked
    if(!locked)throw failure('BACKUP_TARGET_LOCKED')
    lockId='om_backup_restore'
  }
  const baseline = async (connection: Client):Promise<string> => {
    const catalog=await completeSchemaFingerprint(connection)
    if(!(await connection.query("SELECT 1 FROM pg_namespace WHERE nspname='om_backup_restore'")).rowCount)return digest(JSON.stringify({catalog,journal:null}))
    const run=(await connection.query('SELECT * FROM om_backup_restore.restore_run')).rows
    const chunks=(await connection.query("SELECT count(*)::text AS count,max(restored_at)::text AS newest FROM om_backup_restore.restore_chunks")).rows[0]
    const steps=(await connection.query("SELECT status,count(*)::text AS count,max(finished_at)::text AS newest FROM om_backup_restore.restore_steps GROUP BY status ORDER BY status")).rows
    return digest(JSON.stringify({catalog,run,chunks,steps}))
  }
  const capacity=async(count:number,resumable=false)=>{
    if(!Number.isInteger(count)||count<1||count>8)throw failure('BACKUP_INVALID_RESOURCE_OPTION')
    const record=(await (await current()).query<{capacity:number;used:number}>("SELECT current_setting('max_connections')::int AS capacity,(SELECT count(*)::int FROM pg_stat_activity) AS used")).rows[0]
    if(record.capacity-record.used<count+7)throw new BackupError('BACKUP_CONNECTION_BUDGET',resumable?5:3,resumable)
  }
  const validateChallenge=async(connection:Client,run:RestoreRun)=>{
    const identityDigest=digest(JSON.stringify(await databaseIdentity(connection)))
    if(!expected||expected.challenge!==run.confirmation||expected.expires<Date.now()||expected.digest!==identityDigest||expected.baseline!==await baseline(connection))throw failure('BACKUP_TARGET_CONFIRMATION')
  }
  const validateRun=async(connection:Client,run:RestoreRun)=>{
    const records=(await connection.query<{run:string;backup:string;digest:string}>('SELECT restore_run_id AS run,backup_id AS backup,manifest_sha256 AS digest FROM om_backup_restore.restore_run')).rows
    if(records.length!==1||records[0].run!==run.runId||records[0].backup!==run.backupId||records[0].digest!==run.manifestSha256)throw failure('BACKUP_RESTORE_BINDING')
  }
  const transaction = async (operation: (connection: Client) => Promise<void>) => {
    const connection = await current(); await connection.query('BEGIN')
    try { await operation(connection); await connection.query('COMMIT') }
    catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error }
  }
  const step = async (id: string, kind: string, operation: (connection: Client) => Promise<void>) => {
    await transaction(async (connection) => {
      if ((await connection.query('SELECT 1 FROM om_backup_restore.restore_steps WHERE step_key=$1 AND status=\'done\'', [id])).rowCount) return
      await operation(connection)
      await connection.query("INSERT INTO om_backup_restore.restore_steps(step_key,kind,status) VALUES($1,$2,'done') ON CONFLICT(step_key) DO UPDATE SET kind=EXCLUDED.kind,status='done',detail=NULL,finished_at=now()", [id, kind])
    })
  }
  return {
    async preflightWorkers(count) { await capacity(count) },
    async chunkWorkers(count) {
      if (!activeRun || !expected || !lockId || !Number.isInteger(count) || count < 1 || count > 8) throw failure('BACKUP_RESTORE_WORKER_BINDING')
      await capacity(count,true)
      const workers: RestoreTarget[] = []
      try {
        for (let index=0;index<count;index++) {
          if(!options.targetService)throw failure('BACKUP_TARGET_SERVICE_REQUIRED')
          const connection=await connect(options,options.targetService)
          try {
            if(digest(JSON.stringify(await databaseIdentity(connection)))!==expected.digest)throw failure('BACKUP_RESTORE_WORKER_BINDING')
            await validateRun(connection,activeRun)
            workers.push(postgresTarget(options,{client:connection,runId:activeRun.runId}))
          }catch(error){await connection.end().catch(()=>undefined);throw error}
        }
        return workers.map(worker=>({chunk:worker.chunk.bind(worker),close:worker.close.bind(worker)}))
      }catch(error){await Promise.allSettled(workers.map(worker=>worker.close()));throw error}
    },
    async inspectResume(run) {
      const connection=await current();await acquireLock(connection);await validateChallenge(connection,run)
      if(!(await connection.query("SELECT 1 FROM pg_namespace WHERE nspname='om_backup_restore'")).rowCount)return false
      await validateRun(connection,run);return true
    },
    async reportState() {
      const record=(await (await current()).query<{started:string;resumes:number;timestamps:string[]}>('SELECT started_at::text AS started,resume_count AS resumes,to_json(resume_timestamps) AS timestamps FROM om_backup_restore.restore_run WHERE restore_run_id=$1',[runId])).rows[0]
      if(!record)throw failure('BACKUP_RESTORE_BINDING')
      return {startedAt:new Date(record.started).toISOString(),resumeCount:record.resumes,resumeTimestamps:record.timestamps.map((at)=>new Date(at).toISOString())}
    },
    async analyze() { await (await current()).query('ANALYZE') },
    async migrationFingerprint() { return databaseMigrationFingerprint(await current()) },
    async readCanary(entity, check) {
      const keys = entity.primaryKeys ?? []
      if (entity.kind === 'large-object' || !entity.columns.includes(check.field) || !keys.length || keys.length > 64
        || Object.keys(check.key).length !== keys.length || keys.some((key) => !Object.hasOwn(check.key, key) || typeof check.key[key] !== 'string')) throw failure('BACKUP_CANARY_SCOPE')
      const where = keys.map((key, index) => `${identifier(key)}=$${index + 1}`).join(' AND ')
      const result = await (await current()).query<{ envelope: unknown }>(`SELECT ${identifier(check.field)} AS envelope FROM ONLY ${relation(entity)} WHERE ${where} LIMIT 2`, keys.map((key) => check.key[key]))
      if (result.rows.length !== 1 || typeof result.rows[0].envelope !== 'string') throw failure('BACKUP_CANARY_NOT_FOUND_OR_INVALID')
      return result.rows[0].envelope
    },
    async completeFromReport(run) {
      const receipt = z.object({ schemaVersion: z.literal(1), backupId: z.string(), restoreRunId: z.string(),
        trustedManifestSha256: z.string(), targetIdentityDigest: z.string(), status: z.literal('completed'), quarantined: z.literal(true),
      }).parse(JSON.parse((await readBoundedFile(run.reportPath, 64 * 1024 * 1024)).toString()))
      const connection = await current()
      const identityDigest = digest(JSON.stringify(await databaseIdentity(connection)))
      if (receipt.restoreRunId !== run.runId || receipt.backupId !== run.backupId || receipt.trustedManifestSha256 !== run.manifestSha256
        || receipt.targetIdentityDigest !== run.targetIdentityDigest || identityDigest !== run.targetIdentityDigest
        || !expected || expected.challenge !== run.confirmation || expected.expires < Date.now() || expected.digest !== identityDigest) throw failure('BACKUP_COMPLETION_RECEIPT_BINDING')
      await acquireLock(connection)
      await validateChallenge(connection,run)
      const exists = (await connection.query("SELECT 1 FROM pg_namespace WHERE nspname='om_backup_restore'")).rowCount
      if (exists) {
        await (await current()).query('ANALYZE')
        await transaction(async (session) => {
          const rows = (await session.query<{ run: string; backup: string; digest: string }>('SELECT restore_run_id AS run,backup_id AS backup,manifest_sha256 AS digest FROM om_backup_restore.restore_run')).rows
          if (rows.length !== 1 || rows[0].run !== run.runId || rows[0].backup !== run.backupId || rows[0].digest !== run.manifestSha256) throw failure('BACKUP_COMPLETION_RECEIPT_BINDING')
          await session.query('DROP SCHEMA om_backup_restore CASCADE')
        })
      }
      return true
    },
    async countRows(entity) { return entity.kind === 'large-object'
      ? (await (await current()).query<{ count: string }>('SELECT count(*)::text AS count FROM pg_largeobject_metadata WHERE oid=$1::oid', [entity.largeObjectOid])).rows[0].count
      : (await (await current()).query<{ count: string }>(`SELECT count(*)::text AS count FROM ONLY ${relation(entity)}`)).rows[0].count },
    async identity() { const connection = await current(); const identity = await databaseIdentity(connection); await verifyTools(options, identity.serverMajor); return identity },
    async challenge(binding) {
      const identity = await databaseIdentity(await current())
      if (samePhysicalDatabase(identity,binding.sourceIdentity)) throw failure('BACKUP_TARGET_IS_SOURCE')
      if (identity.serverMajor !== binding.sourceIdentity.serverMajor || identity.encoding !== binding.sourceIdentity.encoding || identity.collation !== binding.sourceIdentity.collation) throw failure('BACKUP_TARGET_INCOMPATIBLE')
      const currentBaseline=await baseline(await current())
      const challenge = `RESTORE-${digest(JSON.stringify({ binding, identity, baseline:currentBaseline, timeWindow: Math.floor(Date.now() / 600000) })).slice(0, 20)}`
      expected = { challenge, digest: digest(JSON.stringify(identity)), baseline:currentBaseline, expires: Date.now() + 600000 }
      return challenge
    },
    async initialize(run) {
      const connection = await current()
      const identity = await databaseIdentity(connection)
      if (!expected || expected.challenge !== run.confirmation || expected.expires < Date.now() || expected.digest !== digest(JSON.stringify(identity))) throw failure('BACKUP_TARGET_CONFIRMATION')
      await acquireLock(connection)
      await validateChallenge(connection,run)
      await transaction(async (session) => {
        const exists = (await session.query("SELECT 1 FROM pg_namespace WHERE nspname='om_backup_restore'")).rowCount
        if (exists) {
          const record = (await session.query<{ run: string; backup: string; digest: string }>('SELECT restore_run_id AS run,backup_id AS backup,manifest_sha256 AS digest FROM om_backup_restore.restore_run')).rows
          if (record.length !== 1 || record[0].run !== run.runId || record[0].backup !== run.backupId || record[0].digest !== run.manifestSha256) throw failure('BACKUP_RESTORE_BINDING')
          await session.query('UPDATE om_backup_restore.restore_run SET resume_count=resume_count+1,resume_timestamps=array_append(resume_timestamps,now()),heartbeat_at=now() WHERE restore_run_id=$1',[run.runId])
        } else {
          const objects = await session.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' LIMIT 1")
          const extra = await session.query(`SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'
            UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')
            UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
            UNION ALL SELECT 1 FROM pg_largeobject_metadata LIMIT 1`)
          if (objects.rowCount || extra.rowCount) throw failure('BACKUP_TARGET_NOT_EMPTY')
          await session.query(`CREATE SCHEMA om_backup_restore;
            CREATE TABLE om_backup_restore.restore_run(restore_run_id text PRIMARY KEY,backup_id text NOT NULL,manifest_sha256 text NOT NULL,target_challenge_digest text NOT NULL,phase text NOT NULL DEFAULT 'initialized',resume_count integer NOT NULL DEFAULT 0,resume_timestamps timestamptz[] NOT NULL DEFAULT '{}',heartbeat_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz NOT NULL DEFAULT now());
            CREATE TABLE om_backup_restore.restore_chunks(entity_key text NOT NULL,seq int NOT NULL,sha256 text NOT NULL,rows bigint NOT NULL,restored_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(entity_key,seq));
            CREATE TABLE om_backup_restore.restore_steps(step_key text PRIMARY KEY,kind text NOT NULL,status text NOT NULL,detail text,finished_at timestamptz NOT NULL DEFAULT now())`)
          await session.query('INSERT INTO om_backup_restore.restore_run(restore_run_id,backup_id,manifest_sha256,target_challenge_digest) VALUES($1,$2,$3,$4)', [run.runId, run.backupId, run.manifestSha256, digest(run.confirmation)])
        }
      })
      runId = run.runId
      activeRun = run
    },
    async hasStep(stepId) {
      const lookup=lookupQueue.then(async()=>{
        const chunk=/^chunk:(e[0-9]+):([0-9]+)$/.exec(stepId)
        if(chunk)return Boolean((await (await current()).query('SELECT 1 FROM om_backup_restore.restore_chunks WHERE entity_key=$1 AND seq=$2',[chunk[1],Number(chunk[2])])).rowCount)
        return Boolean((await (await current()).query("SELECT 1 FROM om_backup_restore.restore_steps WHERE step_key=$1 AND status='done'",[stepId])).rowCount)
      })
      lookupQueue=lookup.then(()=>undefined,()=>undefined)
      return lookup
    },
    async schema(section, stream, stepId, workspace) {
      if (!runId) throw failure('BACKUP_RESTORE_NOT_INITIALIZED')
      const scratch = workspace ?? options.workspace
      if (!scratch) throw failure('BACKUP_WORKSPACE_REQUIRED')
      await privateDirectory(scratch)
      const directory = await mkdtemp(join(scratch, 'om-backup-schema-')); await chmod(directory, 0o700)
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
            yield Buffer.from(`\nINSERT INTO om_backup_restore.restore_steps(step_key,kind,status) VALUES(${literal(id)},${literal(section)},'done') ON CONFLICT(step_key) DO UPDATE SET status='done',detail=NULL,finished_at=now();\n`)
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
          await importCopy(connection, `COPY ${relation(entity)} (${entity.columns.map(identifier).join(',')}) FROM STDIN (FORMAT ${entity.copyFormat ?? 'binary'})`, stream)
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
      const failures: Array<{schema:string;table:string;name:string}> = []
      for (const key of keys) {
        if (!key.definition.startsWith('FOREIGN KEY ')) throw failure('BACKUP_FOREIGN_KEY_DEFINITION')
        const id = digest(JSON.stringify([key.schema, key.table, key.name]))
        let phase = 'create'
        try {
          await step(`fk-create:${id}`, 'fk-create', async (connection) => {
            const type = (await connection.query<{relkind:string}>('SELECT relkind FROM pg_class WHERE oid=$1::regclass',[relation(key)])).rows[0]?.relkind
            const definition=key.definition.replace(/\s+NOT VALID$/, '')
            await connection.query(`ALTER TABLE ${relation(key)} ADD CONSTRAINT ${identifier(key.name)} ${definition}${type==='p'?'':' NOT VALID'}`)
          })
          phase='validate'
          await step(`fk-validate:${id}`, 'fk-validate', async (connection) => { await connection.query(`ALTER TABLE ${relation(key)} VALIDATE CONSTRAINT ${identifier(key.name)}`) })
        } catch {
          failures.push({schema:key.schema,table:key.table,name:key.name})
          await transaction(async(connection)=> {
            await connection.query(`INSERT INTO om_backup_restore.restore_steps(step_key,kind,status,detail) VALUES($1,'fk-validate','failed',$2)
              ON CONFLICT(step_key) DO UPDATE SET status='failed',detail=EXCLUDED.detail,finished_at=now()`,[`fk-validate:${id}`,phase==='create'?'BACKUP_FOREIGN_KEY_CREATE_FAILED':'BACKUP_FOREIGN_KEY_VALIDATION_FAILED'])
          })
        }
      }
      if (failures.length) throw Object.assign(failure('BACKUP_FOREIGN_KEY_VALIDATION_FAILED'),{details:{foreignKeyFailures:failures}})
    },
    async finish(reportPath) {
      const info = await stat(reportPath)
      if (!info.isFile() || !info.size) throw failure('BACKUP_REPORT_NOT_DURABLE')
      await transaction(async (connection) => { await connection.query('DROP SCHEMA om_backup_restore CASCADE') })
    },
    async close() {
      if (lockId && client) await client.query("SELECT pg_advisory_unlock(hashtextextended('om_backup_restore',0))").catch(() => undefined)
      await client?.end(); client = undefined; lockId = undefined
    },
  }
}
