import { createHash } from 'node:crypto'
import type { EntityMetadata } from '@mikro-orm/core'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { getDefaultEncryptionMaps } from '@open-mercato/shared/modules/registry'
import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { listEntityMetadata } from '@open-mercato/shared/lib/db/entityMetadata'
import { resolveEntityIdFromMetadata } from '@open-mercato/shared/lib/encryption/entityIds'
import { decryptWithAesGcm, hashForLookup, isRotationCiphertextShape } from '@open-mercato/shared/lib/encryption/aes'
import { isCustomEntityDocumentCiphertext } from '@open-mercato/shared/lib/encryption/customEntityDoc'
import type { RotationProtectionContext, RotationKeyProviders } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { parseRotationJson, parseRotationFieldValue } from '@open-mercato/shared/lib/encryption/rotationJson'
import { rowIdentity, ExactJsonNumber, type LogicalValue, type VerificationRow } from './canonical'
import type { RotationDataset } from './verifier'
import type { ProgressSink } from '../engine/types'

type Intent = NonNullable<VerificationRow['metadataIntent']>
export type PostgresRotationOptions = {
  context: RotationProtectionContext
  providers: RotationKeyProviders
  backupDigest: string
  provider: string
  intents?: { load(identity: string): Promise<Intent | undefined>; prefetch?(identities: string[]): Promise<void> }
  progress?: ProgressSink
  runId?: string
}
type Rule = { tenantId: string | null; organizationId: string | null; column: string; hashColumn: string | null; active: boolean }
type Column = { name: string; type: string }
type Table = { name: string; columns: Column[]; primaryKeys: string[]; rules: Rule[]; custom: boolean }
type SqlRow = Record<string, string | null>
type PostgresRotationDataset = RotationDataset & {
  /** Read-only comparison iterator: target key only, without intent verification. */
  targetRows(signal?: AbortSignal): AsyncGenerator<VerificationRow>
}
const MAX_MAPS = 5000
const MAX_COLUMNS = 1000
const MAX_ROWS = 500
const CODEC_VERSION = 'typed-canonical-injective-postgres-v3'
// Fixed PostgreSQL built-in OIDs: arbitrary type output functions, domains,
// enums, composites and extension types are outside this codec's proof.
const SUPPORTED_SCALAR_OIDS = [16, 17, 20, 21, 23, 25, 26, 114, 700, 701, 1042, 1043, 1082, 1083, 1114, 1184, 1186, 1266, 1700, 2950, 3802]
const OUTPUT_SETTINGS_SQL = "SELECT current_setting('DateStyle') AS date_style,current_setting('TimeZone') AS time_zone,current_setting('IntervalStyle') AS interval_style,current_setting('extra_float_digits') AS extra_float_digits,current_setting('bytea_output') AS bytea_output,current_setting('array_nulls') AS array_nulls"
const MAX_ROW_BYTES = 1024 * 1024
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export function canonicalRotationTimestamp(value: string | Date | null): string | null {
  if (value === null) return null
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('[internal] ROTATION_TIMESTAMP_INVALID')
    return value.toISOString().replace(/\.(\d{3})Z$/, '.$1000Z')
  }
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(value)
  if (!match) throw new Error('[internal] ROTATION_TIMESTAMP_INVALID')
  const fraction = (match[3] ?? '').padEnd(6, '0')
  const zone = match[4] ?? 'Z'
  const offset = /^[+-]\d{2}$/.test(zone) ? `${zone}:00` : zone
  const date = new Date(`${match[1]}T${match[2]}.${fraction.slice(0, 3)}${offset}`)
  if (!Number.isFinite(date.getTime())) throw new Error('[internal] ROTATION_TIMESTAMP_INVALID')
  return date.toISOString().replace(/\.\d{3}Z$/, `.${fraction}Z`)
}

function logical(value: unknown): LogicalValue {
  if (value instanceof ExactJsonNumber) return value
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value
  if (Array.isArray(value)) return value.map(logical)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, logical(entry)]))
  }
  throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
}

function databaseEnvelope(value: string, type: string): string {
  if (type === 'jsonb' || type === 'json') {
    const decoded: unknown = JSON.parse(value)
    if (typeof decoded !== 'string') throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    return decoded
  }
  return value
}

function propertyColumn(meta: EntityMetadata, name: string): string {
  const property = Object.values(meta.properties).find((entry) => entry.name === name || entry.fieldNames?.includes(name))
  if (!property?.fieldNames || property.fieldNames.length !== 1) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  return property.fieldNames[0]!
}


export async function assertPostgresRotationAdmission(context: RotationProtectionContext, signal?: AbortSignal): Promise<void> {
  const connection = context.entityManager.getConnection()
  const query = async <Row extends Record<string, unknown>>(sql: string, parameters: unknown[] = []): Promise<Row[]> => {
    const result: unknown = signal
      ? await context.entityManager.execute(sql, parameters, { signal: signal, inflightQueryAbortStrategy: 'cancel query' })
      : await connection.execute(sql, parameters)
    if (!Array.isArray(result)) throw new Error('[internal] ROTATION_DATABASE_INVALID')
    return result as Row[]
  }
    const catalog = await query<{ first: boolean; utf8: boolean }>("SELECT (pg_catalog.current_schemas(true))[1] OPERATOR(pg_catalog.=) 'pg_catalog'::pg_catalog.name AS first, (pg_catalog.current_setting('server_encoding') OPERATOR(pg_catalog.=) 'UTF8'::pg_catalog.text) AND (pg_catalog.current_setting('client_encoding') OPERATOR(pg_catalog.=) 'UTF8'::pg_catalog.text) AS utf8")
    if (catalog[0]?.first !== true) throw new Error('[internal] ROTATION_CATALOG_RESOLUTION_UNSUPPORTED')
    if (catalog[0]?.utf8 !== true) throw new Error('[internal] ROTATION_ENCODING_UNSUPPORTED')
    const formats = await query<{ date_style: string; extra_float_digits: string }>(OUTPUT_SETTINGS_SQL)
    if (!formats[0]?.date_style.startsWith('ISO,') || Number(formats[0]?.extra_float_digits) < 1 || !Number.isFinite(Number(formats[0]?.extra_float_digits))) throw new Error('[internal] ROTATION_OUTPUT_FORMAT_UNSUPPORTED')
    const role = await query<{ visible: boolean; superuser: boolean }>('SELECT rolsuper AS superuser, (rolsuper OR rolbypassrls) AS visible FROM pg_roles WHERE rolname = current_user')
    if (role[0]?.visible !== true) throw new Error('[internal] ROTATION_RLS_VISIBILITY_UNPROVEN')
    if (role[0]?.superuser !== true) throw new Error('[internal] ROTATION_SUPERUSER_MAINTENANCE_REQUIRED')
    const shadowed = await query("SELECT 1 FROM (VALUES ('encryption_maps'),('custom_field_defs'),('custom_entities_storage')) relations(name) WHERE to_regclass(name) IS DISTINCT FROM to_regclass('public.' || name) LIMIT 1")
    if (shadowed.length) throw new Error('[internal] ROTATION_RELATION_RESOLUTION_UNSUPPORTED')
    const admission = await query<{ connection_limit: string }>("SELECT datconnlimit::text AS connection_limit FROM pg_database WHERE datname=current_database()")
    if (admission[0]?.connection_limit !== '0') throw new Error('[internal] ROTATION_DATABASE_ADMISSION_FENCE_REQUIRED')
    const subscriptions = await query("SELECT 1 FROM pg_subscription WHERE subdbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND subenabled LIMIT 1")
    if (subscriptions.length) throw new Error('[internal] ROTATION_LOGICAL_SUBSCRIPTIONS_ACTIVE')
    const limits = await query<{ statement_ms: string; lock_ms: string }>("SELECT (SELECT setting FROM pg_settings WHERE name='statement_timeout') AS statement_ms, (SELECT setting FROM pg_settings WHERE name='lock_timeout') AS lock_ms")
    const statement = Number(limits[0]?.statement_ms); const lock = Number(limits[0]?.lock_ms)
    if (!Number.isFinite(statement) || statement <= 0 || statement > 900000 || !Number.isFinite(lock) || lock <= 0 || lock > 30000) throw new Error('[internal] ROTATION_DATABASE_TIMEOUTS_REQUIRED')
    const prepared = await query('SELECT 1 FROM pg_prepared_xacts WHERE database = current_database() LIMIT 1')
    const active = await query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND ((backend_type = 'client backend' AND (usename = current_user OR state <> 'idle' OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = usename AND rolsuper))) OR backend_type NOT IN ('client backend','autovacuum worker')) LIMIT 1")
    if (prepared.length || active.length) throw new Error('[internal] ROTATION_WRITERS_ACTIVE')
}

export async function createPostgresRotationDataset(options: PostgresRotationOptions): Promise<PostgresRotationDataset> {
  const { context, providers } = options
  const connection = context.entityManager.getConnection()
  const query = async <Row extends Record<string, unknown>>(sql: string, parameters: unknown[] = [], querySignal = providers.signal): Promise<Row[]> => {
    const result: unknown = querySignal
      ? await context.entityManager.execute(sql, parameters, { signal: querySignal, inflightQueryAbortStrategy: 'cancel query' })
      : await connection.execute(sql, parameters)
    if (!Array.isArray(result)) throw new Error('[internal] ROTATION_DATABASE_INVALID')
    return result as Row[]
  }
  const boundedBinding = async (sql: string, parameters: unknown[] = []): Promise<Array<{ payload: string }>> => {
    const size = await query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count,coalesce(sum(octet_length(payload)),0)::text AS bytes FROM (${sql}) bounded_metadata`, parameters)
    if (BigInt(size[0]?.count ?? '10001') > 10000n || BigInt(size[0]?.bytes ?? '4194305') > 4n * 1024n * 1024n) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    return query<{ payload: string }>(`${sql} LIMIT 10001`, parameters)
  }
  const assertAdmission = () => assertPostgresRotationAdmission(context, providers.signal)
  await assertAdmission()
  const mapSize = await query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count, coalesce(sum(octet_length(row_to_json(m)::text)),0)::text AS bytes FROM encryption_maps m ${context.tenantId ? 'WHERE tenant_id = ? OR tenant_id IS NULL' : ''}`, context.tenantId ? [context.tenantId] : [])
  if (Number(mapSize[0]?.count) > MAX_MAPS || Number(mapSize[0]?.bytes) > 4 * 1024 * 1024) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const maps = await context.entityManager.find(EncryptionMap, {
    ...(context.tenantId ? { $or: [{ tenantId: context.tenantId }, { tenantId: null }] } : {}),
  }, { limit: MAX_MAPS + 1, orderBy: { id: 'asc' }, refresh: true, ...(providers.signal ? { signal: providers.signal, inflightQueryAbortStrategy: 'cancel query' as const } : {}) })
  if (maps.length > MAX_MAPS) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const metas = new Map(listEntityMetadata(context.entityManager).map((meta) => [resolveEntityIdFromMetadata(meta), meta]))
  const tables = new Map<string, Table>()
  const systemEntities = new Set(context.systemScopedEntityIds ?? getDefaultEncryptionMaps(tryGetModules() ?? []).filter((entry) => entry.keyScope === 'system').map((entry) => entry.entityId))
  const emptyMaps: string[] = []
  for (const map of maps) {
    if (systemEntities.has(map.entityId)) continue
    if (!map.fieldsJson?.length) { emptyMaps.push(map.entityId); continue }
    if (context.organizationId && map.organizationId && map.organizationId !== context.organizationId) continue
    const meta = metas.get(map.entityId)
    if (!meta?.tableName || !meta.primaryKeys.length) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const name = `${meta.schema ?? 'public'}.${meta.tableName}`
    let table = tables.get(name)
    if (!table) {
      table = { name, columns: [], primaryKeys: meta.primaryKeys.map((name) => propertyColumn(meta, name)), rules: [], custom: false }
      tables.set(name, table)
    }
    for (const field of map.fieldsJson) {
      table.rules.push({ tenantId: map.tenantId ?? null, organizationId: map.organizationId ?? null, column: propertyColumn(meta, field.field), hashColumn: field.hashField ? propertyColumn(meta, field.hashField) : null, active: map.isActive && !map.deletedAt })
    }
  }
  const custom = await query<{ present: string | null }>('SELECT to_regclass(?)::text AS present', ['public.custom_entities_storage'])
  if (custom[0]?.present) {
    const existing = tables.get('public.custom_entities_storage')
    if (existing) existing.custom = true
    else tables.set('public.custom_entities_storage', { name: 'public.custom_entities_storage', columns: [], primaryKeys: ['id'], rules: [], custom: true })
  }
  if (!tables.size || tables.size > 1000) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const scopeSql = `${context.tenantId ? 'tenant_id = ?' : 'tenant_id IS NOT NULL'}${context.organizationId ? ' AND organization_id = ?' : ''}`
  const scopeParameters = () => [...(context.tenantId ? [context.tenantId] : []), ...(context.organizationId ? [context.organizationId] : [])]
  const tableSql = (table: Table) => table.name.split('.').map(quote).join('.')
  await assertFence()
  // DataRow framing: message/type/field-count plus a length for every field,
  // including NULL. UTF8 server/client admission makes text octet lengths exact.
  const columnHeadroom = (table: Table) => Math.max(4096, table.columns.reduce((total, column) => total + 128 + Buffer.byteLength(column.name) + Buffer.byteLength(column.type), 0))
  const measureWire = async (table: Table): Promise<number> => {
    const expression = [`${7 + 4 * table.columns.length}::bigint`, ...table.columns.map(column => `coalesce(octet_length(${quote(column.name)}::text)::bigint,0)`)].join(' + ')
    const sizes = await query<{ maximum: string | null }>(`SELECT max(${expression})::text AS maximum FROM ${tableSql(table)} WHERE ${scopeSql}`, scopeParameters())
    const maximum = BigInt(sizes[0]?.maximum ?? '0')
    if (maximum < 0n || maximum > BigInt(MAX_ROW_BYTES)) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    return Number(maximum)
  }
  const rowsForBudget = (bytes: number) => Math.min(MAX_ROWS, Math.max(1, Math.floor((8 * 1024 * 1024) / (bytes * 4))))
  const hashBytes = Buffer.byteLength(hashForLookup('rotation-verification-lookup-configuration-v1'))
  let maximumSourceBudget = 4096
  let maximumProjectedBudget = 4096
  for (const table of tables.values()) {
    const shape = await query<{ supported: boolean }>("SELECT relkind='r' AND NOT relispartition AND NOT EXISTS(SELECT 1 FROM pg_inherits WHERE inhparent=c.oid OR inhrelid=c.oid) AS supported FROM pg_class c WHERE c.oid=?::regclass", [table.name])
    if (shape[0]?.supported !== true) throw new Error('[internal] ROTATION_RELATION_UNSUPPORTED')
    // Admit OIDs before format_type, which can itself call custom typmod output.
    const unsupported = await query(`SELECT 1 FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid WHERE a.attrelid=?::regclass AND a.attnum>0 AND NOT a.attisdropped AND NOT (t.typnamespace='pg_catalog'::regnamespace AND t.typtype='b' AND (t.oid IN (${SUPPORTED_SCALAR_OIDS.join(',')}) OR (t.typcategory='A' AND t.typelem IN (${SUPPORTED_SCALAR_OIDS.join(',')}) AND EXISTS(SELECT 1 FROM pg_type element WHERE element.oid=t.typelem AND element.typarray=t.oid AND element.typnamespace='pg_catalog'::regnamespace AND element.typtype='b')))) LIMIT 1`, [table.name])
    if (unsupported.length) throw new Error('[internal] ROTATION_TYPE_UNSUPPORTED')
    table.columns = await query<Column>('SELECT attname AS name, format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = ?::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum', [table.name])
    if (table.columns.length > MAX_COLUMNS || !table.columns.some((entry) => entry.name === 'tenant_id') || !table.columns.some((entry) => entry.name === 'organization_id')) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const primary = await query<{ name: string }>('SELECT a.attname AS name FROM pg_index i JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, position) ON true JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum WHERE i.indrelid = ?::regclass AND i.indisprimary ORDER BY k.position', [table.name])
    if (JSON.stringify(primary.map((entry) => entry.name)) !== JSON.stringify(table.primaryKeys)) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const forbidden = new Set([...table.primaryKeys, 'tenant_id', 'organization_id'])
    if (table.rules.some((rule) => forbidden.has(rule.column) || (rule.hashColumn && forbidden.has(rule.hashColumn)))) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const known = new Set(table.columns.map((entry) => entry.name))
    if (table.rules.some((rule) => !known.has(rule.column) || (rule.hashColumn && !known.has(rule.hashColumn)))) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const maximum = await measureWire(table)
    const hashColumns = new Set(table.rules.flatMap(rule => rule.hashColumn ? [rule.hashColumn] : []))
    const hashGrowth = [...hashColumns].reduce((total, name) => {
      const type = table.columns.find(column => column.name === name)!.type
      return total + (type === 'bytea' ? hashBytes * 2 + 2 : type === 'json' || type === 'jsonb' ? hashBytes + 2 : hashBytes)
    }, 0)
    // Canonical v1 output can add at most four Base64 padding bytes. Protected
    // old-key rotation never encrypts an unprotected plaintext custom value.
    const cipherGrowth = table.custom ? 4 * Math.ceil(maximum / 43) : 4 * new Set(table.rules.map(rule => rule.column)).size
    const projected = maximum + hashGrowth + cipherGrowth + (table.custom ? 64 : 0)
    if (projected > MAX_ROW_BYTES) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    maximumSourceBudget = Math.max(maximumSourceBudget, maximum + columnHeadroom(table))
    maximumProjectedBudget = Math.max(maximumProjectedBudget, projected + columnHeadroom(table))

  }
  // Budget current + prefetched wire pages and conservative text-decoding headroom.
  const verificationBatchRows = rowsForBudget(Math.max(maximumSourceBudget, maximumProjectedBudget) + 128)
  const orderedTables = [...tables.values()].sort((left, right) => left.name < right.name ? -1 : 1)
  const canonicalColumns = new Map(orderedTables.map(table => [table, [...table.columns].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)] as const))
  const tenants = await query<{ tenant_id: string }>(`SELECT DISTINCT tenant_id::text AS tenant_id FROM (${orderedTables.map((table) => `SELECT tenant_id FROM ${tableSql(table)} WHERE ${scopeSql}`).join(' UNION ALL ')}) selected ORDER BY tenant_id LIMIT 1001`, orderedTables.flatMap(() => scopeParameters()))
  if (tenants.length > 1000) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const selectedTenants = tenants.map((entry) => entry.tenant_id)
  const definitionCache = new Map<string, { known: Set<string>; required: Set<string> }>()
  const keyInventory = async () => {
    const source: string[][] = []
    const target: string[][] = []
    for (const tenantId of selectedTenants) {
      const oldKey = await providers.previousKms?.getTenantDek(tenantId)
      const nextKey = await providers.kms.getTenantDek(tenantId)
      if (!oldKey || !nextKey || Buffer.from(oldKey.key, 'base64').length !== 32 || Buffer.from(nextKey.key, 'base64').length !== 32 || oldKey.key === nextKey.key) throw new Error('[internal] ROTATION_KEY_CHANGED')
      source.push([tenantId, oldKey.key]); target.push([tenantId, nextKey.key])
    }
    if (!selectedTenants.length) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    return { source: createHash('sha256').update(JSON.stringify(source)).digest('base64'), target: createHash('sha256').update(JSON.stringify(target)).digest('base64'), provider: options.provider }
  }

  async function assertFence() {
    await assertAdmission()
    const tableNames = [...tables.values()].map(table => table.name)
    const schemas = [...new Set([...tableNames.map(name => name.split('.')[0]!), 'public'])]
    const ddl = await query("SELECT r.rolname FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname <> current_user AND (r.rolcanlogin OR EXISTS (SELECT 1 FROM pg_roles l WHERE l.rolcanlogin AND NOT l.rolsuper AND l.rolname <> current_user AND pg_has_role(l.oid,r.oid,'MEMBER'))) AND (has_database_privilege(r.oid,current_database(),'CREATE') OR pg_has_role(r.oid,(SELECT datdba FROM pg_database WHERE datname=current_database()),'MEMBER') OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname IN (SELECT jsonb_array_elements_text(?::jsonb)) AND (has_schema_privilege(r.oid,n.oid,'CREATE') OR pg_has_role(r.oid,n.nspowner,'MEMBER')))) LIMIT 1", [JSON.stringify(schemas)])
    if (ddl.length) throw new Error('[internal] ROTATION_DDL_PRIVILEGES_PRESENT')
    for (const name of [...tableNames, 'public.encryption_maps', 'public.custom_field_defs']) {
      const present = await query<{ name: string | null }>('SELECT to_regclass(?)::text AS name', [name])
      if (!present[0]?.name) continue
      const writers = await query("SELECT r.rolname FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname <> current_user AND (r.rolcanlogin OR EXISTS (SELECT 1 FROM pg_roles l WHERE l.rolcanlogin AND l.rolname <> current_user AND pg_has_role(l.oid, r.oid, 'MEMBER'))) AND (has_table_privilege(r.oid, ?::regclass, 'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(r.oid, ?::regclass, 'INSERT,UPDATE') OR pg_has_role(r.oid, (SELECT relowner FROM pg_class WHERE oid = ?::regclass), 'MEMBER')) LIMIT 1", [name, name, name])
      if (writers.length) throw new Error('[internal] ROTATION_WRITER_PRIVILEGES_PRESENT')
    }
  }
  const binding = async () => {
    await assertAdmission()
    const outputSettings = await query(OUTPUT_SETTINGS_SQL)
    const identity = await query<{ clusterIncarnation: string; databaseOid: string; serverMajor: number; encoding: string; collation: string }>(`SELECT s.system_identifier::text || ':' || c.timeline_id::text || ':' || CASE WHEN pg_is_in_recovery() THEN 'recovery' ELSE 'primary' END || ':' || (extract(epoch from pg_postmaster_start_time())*1000000)::bigint::text AS "clusterIncarnation", d.oid::text AS "databaseOid", (current_setting('server_version_num')::int / 10000)::int AS "serverMajor", pg_encoding_to_char(d.encoding) AS encoding, d.datcollate AS collation FROM pg_control_system() s CROSS JOIN pg_control_checkpoint() c CROSS JOIN pg_database d WHERE d.datname = current_database()`)
    if (!identity[0]?.clusterIncarnation) throw new Error('[internal] ROTATION_DATABASE_INVALID')
    const metadata = await boundedBinding("SELECT jsonb_build_array(c.oid::text, n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, a.attname, a.atttypid::text, a.atttypmod, a.attnotnull, c.relowner::text, c.relacl::text, a.attacl::text, a.attgenerated, a.attcollation::text, (SELECT string_agg(pg_get_constraintdef(oid), ';' ORDER BY oid) FROM pg_constraint WHERE conrelid=c.oid), (SELECT string_agg(pg_get_indexdef(indexrelid), ';' ORDER BY indexrelid) FROM pg_index WHERE indrelid=c.oid))::text AS payload FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE c.oid IN (SELECT name::regclass FROM jsonb_array_elements_text(?::jsonb) AS selected(name)) ORDER BY c.oid,a.attnum", [JSON.stringify(orderedTables.map((table) => table.name))])
    const controls = await query<{ payload: string }>(`SELECT row_to_json(m)::text AS payload FROM encryption_maps m ${context.tenantId ? 'WHERE tenant_id = ? OR tenant_id IS NULL' : ''} ORDER BY id LIMIT ${MAX_MAPS + 1}`, context.tenantId ? [context.tenantId] : [])
    const definitionSize = await query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count, coalesce(sum(octet_length(row_to_json(d)::text)),0)::text AS bytes FROM custom_field_defs d WHERE tenant_id IS NULL${context.tenantId ? ' OR tenant_id = ?' : ' OR tenant_id IS NOT NULL'}`, context.tenantId ? [context.tenantId] : [])
    if (Number(definitionSize[0]?.count) > 5000 || Number(definitionSize[0]?.bytes) > 4 * 1024 * 1024) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const definitions = await query<{ payload: string }>(`SELECT row_to_json(d)::text AS payload FROM custom_field_defs d WHERE tenant_id IS NULL${context.tenantId ? ' OR tenant_id = ?' : ' OR tenant_id IS NOT NULL'} ORDER BY id LIMIT 5001`, context.tenantId ? [context.tenantId] : [])
    const policies = await boundedBinding('SELECT row_to_json(p)::text AS payload FROM pg_policies p ORDER BY schemaname,tablename,policyname')
    if (policies.length > 10000 || controls.length > MAX_MAPS) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const ownership = await boundedBinding("SELECT jsonb_build_array(n.oid::text,n.nspname,n.nspowner::text,n.nspacl::text,d.datdba::text,d.datacl::text,d.datconnlimit,d.datallowconn)::text AS payload FROM pg_namespace n CROSS JOIN pg_database d WHERE d.datname=current_database() AND n.nspname IN (SELECT jsonb_array_elements_text(?::jsonb)) ORDER BY n.nspname", [JSON.stringify([...new Set([...orderedTables.map(table => table.name.split('.')[0]!), 'public'])])])
    const roles = await query<{ payload: string }>("SELECT jsonb_build_array(oid::text,rolname,rolsuper,rolcanlogin,rolbypassrls,rolinherit,rolcreaterole)::text AS payload FROM pg_roles ORDER BY oid LIMIT 10001")
    const memberships = await query<{ payload: string }>("SELECT jsonb_build_array(roleid::text,member::text,admin_option)::text AS payload FROM pg_auth_members ORDER BY roleid,member LIMIT 10001")
    if (roles.length > 10000 || memberships.length > 10000) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const schema = digest(JSON.stringify([metadata, policies, ownership, roles, memberships, outputSettings]))
    return { database: digest(JSON.stringify(identity[0])), scope: JSON.stringify({ tenantId: context.tenantId, organizationId: context.organizationId, excludedSystemEntities: [...systemEntities].sort((left, right) => left < right ? -1 : left > right ? 1 : 0), emptyMaps: emptyMaps.sort((left, right) => left < right ? -1 : left > right ? 1 : 0) }), schema, coverage: digest(JSON.stringify([CODEC_VERSION, controls, definitions, orderedTables, hashForLookup('rotation-verification-lookup-configuration-v1')])), provider: options.provider, backupDigest: options.backupDigest }
  }
  const decode = async (value: string, tenantId: string, phase: 'before' | 'after'): Promise<string> => {
    if (phase === 'before') {
      const old = await providers.previousKms?.getTenantDek(tenantId)
      const original = old ? decryptWithAesGcm(value, old.key, { requireValidUtf8: true }) : null
      if (original !== null) return original
    }
    const key = await providers.kms.getTenantDek(tenantId)
    if (!key) throw new Error('[internal] ROTATION_KEY_CHANGED')
    const plaintext = decryptWithAesGcm(value, key.key, { requireValidUtf8: true })
    if (plaintext === null) throw new Error('[internal] ROTATION_DATA_MISMATCH')
    return plaintext
  }
  async function* scanRows(phase: 'before' | 'after', signal: AbortSignal | undefined, includeIntents: boolean): AsyncGenerator<VerificationRow> {
    signal?.throwIfAborted()
    const querySignal = signal && providers.signal ? AbortSignal.any([signal, providers.signal]) : signal ?? providers.signal
    const scanQuery = <Row extends Record<string, unknown>>(sql: string, parameters: unknown[] = []) => query<Row>(sql, parameters, querySignal)
    await checkedBinding()
    if (phase === 'after') await assertFence()
    for (const table of orderedTables) {
      const expectedCount = await scanQuery<{ count: string }>(`SELECT count(*)::text AS count FROM ${tableSql(table)} WHERE ${scopeSql}`, scopeParameters())
      const expectedRows = BigInt(expectedCount[0]?.count ?? '-1')
      if (expectedRows < 0n || expectedRows > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
      let yieldedRows = 0n; let bytesDone = 0n; let chunksDone = 0
      const progress = (type: 'entity.progress' | 'entity.done') => options.progress?.({ schemaVersion: 1, type, runId: options.runId ?? 'rotation', entity: table.name, phase: phase === 'before' ? 'baseline' : 'verification', rowsDone: String(yieldedRows), rowsTotal: String(expectedRows), rowsTotalExact: true, bytesDone: String(bytesDone), chunksDone, at: new Date().toISOString() })
      progress('entity.progress')
      const primary = table.primaryKeys.map((key) => `verification_rows.${quote(key)}`)
      const used = new Set(table.columns.map(column => column.name))
      const internalName = (prefix: string): string => {
        let name = prefix
        let suffix = 0
        while (used.has(name)) name = `${prefix}_${++suffix}`
        used.add(name)
        return name
      }
      const marker = internalName('__rotation_guard')
      const ordinal = internalName('__rotation_ordinal')
      const rowValid = internalName('__rotation_row_valid')
      const rowBytes = internalName('__rotation_row_bytes')
      const protocolHeadroom = 7 + 4 * (table.columns.length + 1) + 32
      const fetchBatch = async (cursor: string[] | null): Promise<SqlRow[]> => {
        const predicate = cursor ? ` AND (${primary.join(', ')}) > (${primary.map(() => '?').join(', ')})` : ''
        const columnNames = table.columns.map(column => quote(column.name))
        const wireBytes = [`${protocolHeadroom}::bigint`, ...columnNames.map(name => `coalesce(octet_length(persisted.${name})::bigint,0)`)].join(' + ')
        const perRowLimit = Math.min(MAX_ROW_BYTES, Math.floor((8 * 1024 * 1024 / 4) / verificationBatchRows) - columnHeadroom(table) - 32)
        // First limit native keys, then project exactly those rows once. The
        // materialized aggregate withholds the ENTIRE page on either row or
        // page overflow; only one NULL-payload sentinel crosses the wire.
        const selected = await scanQuery<SqlRow>(`WITH frontier AS MATERIALIZED (
          SELECT limited.*,row_number() OVER (ORDER BY ${table.primaryKeys.map(key => `limited.${quote(key)}`).join(',')}) AS ${quote(ordinal)}
          FROM (SELECT ${primary.join(',')} FROM ${tableSql(table)} AS verification_rows WHERE ${scopeSql}${predicate} ORDER BY ${primary.join(',')} LIMIT ${verificationBatchRows}) limited
        ), projected AS MATERIALIZED (
          SELECT ${columnNames.map(name => `CASE WHEN wire.bytes<=${perRowLimit} THEN persisted.${name} ELSE NULL::text END AS ${name}`).join(',')},frontier.${quote(ordinal)},wire.bytes<=${perRowLimit} AS ${quote(rowValid)},wire.bytes AS ${quote(rowBytes)}
          FROM frontier CROSS JOIN LATERAL (SELECT ${table.columns.map(column => `persisted_row.${quote(column.name)}::text AS ${quote(column.name)}`).join(',')} FROM ${tableSql(table)} AS persisted_row WHERE ${table.primaryKeys.map(key => `persisted_row.${quote(key)}=frontier.${quote(key)}`).join(' AND ')} OFFSET 0) persisted
          CROSS JOIN LATERAL (SELECT ${wireBytes} AS bytes OFFSET 0) wire
        ), budget AS MATERIALIZED (
          SELECT coalesce(bool_and(${quote(rowValid)}),true)
            AND coalesce(sum(${quote(rowBytes)} + ${columnHeadroom(table) + 32}),0) <= ${8 * 1024 * 1024 / 4} AS ok FROM projected
        ) SELECT ${quote(marker)},${columnNames.join(',')},${quote(rowBytes)} FROM (
          SELECT 'ok'::text AS ${quote(marker)},${columnNames.map(name => `projected.${name}`).join(',')},projected.${quote(rowBytes)}::text AS ${quote(rowBytes)},projected.${quote(ordinal)} FROM projected CROSS JOIN budget WHERE budget.ok
          UNION ALL SELECT 'oversized'::text,${columnNames.map(() => 'NULL::text').join(',')},NULL::text,0::bigint FROM budget WHERE NOT budget.ok
        ) guarded_page ORDER BY ${quote(ordinal)}`, [...scopeParameters(), ...(cursor ?? [])])
        if (selected.some(row => row[marker] !== 'ok')) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
        for (const row of selected) delete row[marker]
        if (includeIntents && phase === 'after' && table.custom && options.intents?.prefetch) await options.intents.prefetch(selected.map(raw => JSON.stringify([table.name, raw.tenant_id, raw.organization_id ?? null, table.primaryKeys.map(key => raw[key])])) )
        return selected
      }
      let pending = fetchBatch(null)
      try { for (;;) {
        signal?.throwIfAborted()
        const result = await pending
        if (!result.length) break
        const cursor = table.primaryKeys.map((key): string => result[result.length - 1]![key]!)
        // One bounded page may be read while the caller authenticates the current page.
        pending = result.length < verificationBatchRows ? Promise.resolve([]) : fetchBatch(cursor)
        void pending.catch(() => undefined)
        for (const raw of result) {
          const wireSize = raw[rowBytes]
          delete raw[rowBytes]
          const tenantId = raw.tenant_id
          if (!tenantId) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
          const organizationId = raw.organization_id ?? null
          const identity = table.primaryKeys.map((key) => {
            const value = raw[key]
            if (value == null) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
            return value
          })
          const values = new Map<string, LogicalValue>(table.columns.map((entry) => [entry.name, raw[entry.name] ?? null]))
          const rules = table.rules.filter((rule) => (rule.tenantId === null || rule.tenantId === tenantId) && (rule.organizationId === null || rule.organizationId === organizationId))
          for (const rule of rules) {
            const value = raw[rule.column]
            if (value == null) continue
            if (rule.tenantId === null && !rules.some((entry) => entry.active && entry.tenantId === tenantId && entry.column === rule.column && (!rule.hashColumn || entry.hashColumn === rule.hashColumn))) throw new Error('[internal] ROTATION_GLOBAL_FALLBACK_UNSUPPORTED')
            const columnType = table.columns.find((entry) => entry.name === rule.column)!.type
            const envelope = databaseEnvelope(value, columnType)
            if (!isRotationCiphertextShape(envelope)) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
            if (!rule.active && !rules.some((entry) => entry.active && entry.column === rule.column)) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
            const plaintext = await decode(envelope, tenantId, phase)
            const parsed = logical(parseRotationFieldValue(plaintext, source => new ExactJsonNumber(source)))
            values.set(rule.column, parsed)
            if (rule.hashColumn) {
              const lookupValue = parseDecryptedFieldValue(plaintext)
              const serialized = typeof lookupValue === 'string' ? lookupValue : JSON.stringify(lookupValue)
              const expected = hashForLookup(serialized)
              if (phase === 'after' && raw[rule.hashColumn] !== expected) throw new Error('[internal] ROTATION_DATA_MISMATCH')
              values.set(rule.hashColumn, expected)
            }
          }
          if (table.custom && raw.doc) {
            const doc = logical(parseRotationJson(raw.doc, source => new ExactJsonNumber(source)))
            if (!doc || doc instanceof ExactJsonNumber || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
            const scopeKey = JSON.stringify([raw.entity_type, tenantId, organizationId])
            let policy = definitionCache.get(scopeKey)
            if (!policy) {
              const definitions = await scanQuery<{ key: string; required: boolean; tenant_id: string | null; organization_id: string | null; is_active: boolean; deleted_at: string | null; updated_at: string }>("SELECT key, coalesce(config_json->>'encrypted' = 'true',false) AS required, tenant_id::text, organization_id::text, is_active, deleted_at::text, updated_at::text FROM custom_field_defs WHERE entity_id = ? AND (tenant_id = ? OR tenant_id IS NULL) AND (organization_id = ? OR organization_id IS NULL) ORDER BY id LIMIT 501", [raw.entity_type, tenantId, organizationId])
              if (definitions.length > 500) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
              const winning = new Map<string, typeof definitions[number]>()
              const historical = new Map<string, typeof definitions[number]>()
              const score = (entry: typeof definitions[number]) => (entry.tenant_id ? 2 : 0) + (entry.organization_id ? 1 : 0)
              for (const definition of definitions) {
                const prior = historical.get(definition.key)
                if (!prior || score(definition) > score(prior) || (score(definition) === score(prior) && new Date(definition.updated_at).getTime() >= new Date(prior.updated_at).getTime())) historical.set(definition.key, definition)
                if (!definition.is_active || definition.deleted_at) continue
                const previous = winning.get(definition.key)
                if (!previous || score(definition) > score(previous) || (score(definition) === score(previous) && new Date(definition.updated_at).getTime() >= new Date(previous.updated_at).getTime())) winning.set(definition.key, definition)
              }
              policy = { known: new Set(definitions.map((entry) => entry.key)), required: new Set([...historical.keys()].filter(key => (winning.get(key) ?? historical.get(key))!.required)) }
              if (definitionCache.size >= 64) definitionCache.delete(definitionCache.keys().next().value!)
              definitionCache.set(scopeKey, policy)
            }
            const transformed: Record<string, LogicalValue> = Object.create(null)
            for (const [key, value] of Object.entries(doc)) {
              const isEnvelope = (entry: LogicalValue) => typeof entry === 'string' && isCustomEntityDocumentCiphertext(entry)
              const contains = Array.isArray(value) ? value.some(isEnvelope) : isEnvelope(value)
              if (!contains) {
                if (value !== null && policy.required.has(key.replace(/^cf[:_]/, ''))) throw new Error('[internal] ROTATION_CUSTOM_PLAINTEXT_UNSUPPORTED')
                transformed[key] = value; continue
              }
              if (!policy.known.has(key.replace(/^cf[:_]/, ''))) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
              const decrypt = async (entry: LogicalValue): Promise<LogicalValue> => {
                if (entry !== null && policy.required.has(key.replace(/^cf[:_]/, '')) && !isEnvelope(entry)) throw new Error('[internal] ROTATION_CUSTOM_PLAINTEXT_UNSUPPORTED')
                return isEnvelope(entry) ? decode(entry as string, tenantId, phase) : entry
              }
              transformed[key] = Array.isArray(value) ? await Promise.all(value.map(decrypt)) : await decrypt(value)
            }
            values.set('doc', transformed)
          }
          const row: VerificationRow = { entity: table.name, tenantId, organizationId, identity, columns: canonicalColumns.get(table)!.map((entry) => ({ name: entry.name, type: entry.type, value: values.get(entry.name) ?? null })) }
          if (table.custom && 'updated_at' in raw) {
            row.metadata = { updated_at: canonicalRotationTimestamp(raw.updated_at ?? null) }
            const timestamp = row.columns.find((entry) => entry.name === 'updated_at')
            if (timestamp) timestamp.value = '__rotation_timestamp_v1__'
            if (includeIntents && phase === 'after') row.metadataIntent = await options.intents?.load(rowIdentity(row))
          }
          yieldedRows++
          if (options.progress) {
            if (typeof wireSize !== 'string' || !/^\d+$/.test(wireSize)) throw new Error('[internal] ROTATION_DATABASE_INVALID')
            const payloadBytes = BigInt(wireSize) - BigInt(protocolHeadroom)
            if (payloadBytes < 0n || payloadBytes > BigInt(MAX_ROW_BYTES)) throw new Error('[internal] ROTATION_DATABASE_INVALID')
            bytesDone += payloadBytes
          }
          yield row
        }
        chunksDone++; progress('entity.progress')
        if (result.length < verificationBatchRows) break
      } } finally { await pending.catch(() => undefined) }
      if (yieldedRows !== expectedRows) throw new Error('[internal] ROTATION_COVERAGE_INCOMPLETE')
      progress('entity.done')
    }
  }
  const frozen = await binding()
  const checkedBinding = async () => {
    const observed = await binding()
    if (JSON.stringify(observed) !== JSON.stringify(frozen)) throw new Error('[internal] ROTATION_BINDING_CHANGED')
    return observed
  }
  const parameterRows = Math.min(...orderedTables.map((table) => Math.floor(60000 / (table.primaryKeys.length + new Set(table.rules.flatMap((rule) => [rule.column, ...(rule.hashColumn ? [rule.hashColumn] : [])])).size * 2 + 4))))
  return { maintenanceBatchRows: Math.min(500, Math.max(1, parameterRows), Math.max(1, Math.floor((8 * 1024 * 1024) / (maximumProjectedBudget * 2)))), assertFence, binding: checkedBinding, keys: keyInventory,
    rows: (phase, signal) => scanRows(phase, signal, true),
    targetRows: signal => scanRows('after', signal, false),
  }
}
