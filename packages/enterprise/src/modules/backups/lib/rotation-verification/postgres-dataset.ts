import { createHash } from 'node:crypto'
import type { EntityMetadata } from '@mikro-orm/core'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { listEntityMetadata } from '@open-mercato/shared/lib/db/entityMetadata'
import { resolveEntityIdFromMetadata } from '@open-mercato/shared/lib/encryption/entityIds'
import { decryptWithAesGcm, hashForLookup, isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { isCustomEntityDocumentCiphertext } from '@open-mercato/shared/lib/encryption/customEntityDoc'
import type { RotationProtectionContext, RotationKeyProviders } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { canonicalValue, rowIdentity, type LogicalValue, type VerificationRow } from './canonical'
import type { RotationDataset } from './verifier'

type Intent = NonNullable<VerificationRow['metadataIntent']>
export type PostgresRotationOptions = {
  context: RotationProtectionContext
  providers: RotationKeyProviders
  backupDigest: string
  provider: string
  intents?: { load(identity: string): Promise<Intent | undefined> }
}
type Rule = { tenantId: string; organizationId: string | null; column: string; hashColumn: string | null; active: boolean }
type Column = { name: string; type: string }
type Table = { name: string; columns: Column[]; primaryKeys: string[]; rules: Rule[]; custom: boolean }
type SqlRow = Record<string, string | null>
const MAX_MAPS = 5000
const MAX_COLUMNS = 1000
const MAX_ROWS = 8
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

export async function createPostgresRotationDataset(options: PostgresRotationOptions): Promise<RotationDataset> {
  const { context, providers } = options
  const connection = context.entityManager.getConnection()
  const query = async <Row extends Record<string, unknown>>(sql: string, parameters: unknown[] = []): Promise<Row[]> => {
    const result: unknown = await connection.execute(sql, parameters)
    if (!Array.isArray(result)) throw new Error('[internal] ROTATION_DATABASE_INVALID')
    return result as Row[]
  }
  const mapSize = await query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count, coalesce(sum(octet_length(row_to_json(m)::text)),0)::text AS bytes FROM encryption_maps m ${context.tenantId ? 'WHERE tenant_id = ?' : ''}`, context.tenantId ? [context.tenantId] : [])
  if (Number(mapSize[0]?.count) > MAX_MAPS || Number(mapSize[0]?.bytes) > 4 * 1024 * 1024) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const maps = await context.entityManager.find(EncryptionMap, {
    ...(context.tenantId ? { tenantId: context.tenantId } : {}),
  }, { limit: MAX_MAPS + 1, orderBy: { id: 'asc' } })
  if (maps.length > MAX_MAPS) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const metas = new Map(listEntityMetadata(context.entityManager).map((meta) => [resolveEntityIdFromMetadata(meta), meta]))
  const tables = new Map<string, Table>()
  for (const map of maps) {
    if (!map.tenantId || !map.fieldsJson?.length) continue
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
      table.rules.push({ tenantId: map.tenantId, organizationId: map.organizationId ?? null, column: propertyColumn(meta, field.field), hashColumn: field.hashField ? propertyColumn(meta, field.hashField) : null, active: map.isActive && !map.deletedAt })
    }
  }
  const custom = await query<{ present: string | null }>('SELECT to_regclass(?)::text AS present', ['public.custom_entities_storage'])
  if (custom[0]?.present) tables.set('public.custom_entities_storage', { name: 'public.custom_entities_storage', columns: [], primaryKeys: ['id'], rules: [], custom: true })
  if (!tables.size || tables.size > 1000) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const scopeSql = `${context.tenantId ? 'tenant_id = ?' : 'tenant_id IS NOT NULL'}${context.organizationId ? ' AND organization_id = ?' : ''}`
  const scopeParameters = () => [...(context.tenantId ? [context.tenantId] : []), ...(context.organizationId ? [context.organizationId] : [])]
  const tableSql = (table: Table) => table.name.split('.').map(quote).join('.')
  for (const table of tables.values()) {
    table.columns = await query<Column>('SELECT attname AS name, format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = ?::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum', [table.name])
    if (table.columns.length > MAX_COLUMNS || !table.columns.some((entry) => entry.name === 'tenant_id') || !table.columns.some((entry) => entry.name === 'organization_id')) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const primary = await query<{ name: string }>('SELECT a.attname AS name FROM pg_index i JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, position) ON true JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum WHERE i.indrelid = ?::regclass AND i.indisprimary ORDER BY k.position', [table.name])
    if (JSON.stringify(primary.map((entry) => entry.name)) !== JSON.stringify(table.primaryKeys)) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const known = new Set(table.columns.map((entry) => entry.name))
    if (table.rules.some((rule) => !known.has(rule.column) || (rule.hashColumn && !known.has(rule.hashColumn)))) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const oversized = await query(`SELECT 1 FROM ${tableSql(table)} WHERE ${scopeSql} AND octet_length(convert_to(jsonb_build_array(${table.columns.map((entry) => `${quote(entry.name)}::text`).join(', ')})::text, 'UTF8')) > ? LIMIT 1`, [...scopeParameters(), MAX_ROW_BYTES])
    if (oversized.length) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  }
  const orderedTables = [...tables.values()].sort((left, right) => left.name < right.name ? -1 : 1)
  const tenants = await query<{ tenant_id: string }>(`SELECT DISTINCT tenant_id::text AS tenant_id FROM (${orderedTables.map((table) => `SELECT tenant_id FROM ${tableSql(table)} WHERE ${scopeSql}`).join(' UNION ALL ')}) selected ORDER BY tenant_id`, orderedTables.flatMap(() => scopeParameters()))
  if (tenants.length > 1000) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const selectedTenants = tenants.map((entry) => entry.tenant_id)
  const definitionCache = new Map<string, Set<string>>()
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
  const assertFence = async () => {
    const role = await query<{ visible: boolean }>('SELECT (rolsuper OR rolbypassrls) AS visible FROM pg_roles WHERE rolname = current_user')
    if (role[0]?.visible !== true) throw new Error('[internal] ROTATION_RLS_VISIBILITY_UNPROVEN')
    const prepared = await query('SELECT 1 FROM pg_prepared_xacts WHERE database = current_database() LIMIT 1')
    const active = await query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend' AND (usename = current_user OR state <> 'idle' OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = usename AND rolsuper)) LIMIT 1")
    if (prepared.length || active.length) throw new Error('[internal] ROTATION_WRITERS_ACTIVE')
    for (const name of [...orderedTables.map((table) => table.name), 'public.encryption_maps', 'public.custom_field_defs']) {
      const present = await query<{ name: string | null }>('SELECT to_regclass(?)::text AS name', [name])
      if (!present[0]?.name) continue
      const writers = await query("SELECT r.rolname FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname <> current_user AND (r.rolcanlogin OR EXISTS (SELECT 1 FROM pg_roles l WHERE l.rolcanlogin AND l.rolname <> current_user AND pg_has_role(l.oid, r.oid, 'MEMBER'))) AND (has_table_privilege(r.oid, ?::regclass, 'INSERT,UPDATE,DELETE,TRUNCATE') OR pg_has_role(r.oid, (SELECT relowner FROM pg_class WHERE oid = ?::regclass), 'MEMBER')) LIMIT 1", [name, name])
      if (writers.length) throw new Error('[internal] ROTATION_WRITER_PRIVILEGES_PRESENT')
    }
  }
  const binding = async () => {
    const identity = await query<{ clusterIncarnation: string; databaseOid: string; serverMajor: number; encoding: string; collation: string }>(`SELECT s.system_identifier::text || ':' || c.timeline_id::text || ':' || CASE WHEN pg_is_in_recovery() THEN 'recovery' ELSE 'primary' END AS "clusterIncarnation", d.oid::text AS "databaseOid", (current_setting('server_version_num')::int / 10000)::int AS "serverMajor", pg_encoding_to_char(d.encoding) AS encoding, d.datcollate AS collation FROM pg_control_system() s CROSS JOIN pg_control_checkpoint() c CROSS JOIN pg_database d WHERE d.datname = current_database()`)
    if (!identity[0]?.clusterIncarnation) throw new Error('[internal] ROTATION_DATABASE_INVALID')
    const metadata = await query<{ payload: string }>("SELECT jsonb_build_array(c.oid::text, n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, a.attname, a.atttypid::text, a.atttypmod, a.attnotnull, c.relowner::text, c.relacl::text, a.attgenerated, a.attcollation::text, (SELECT string_agg(pg_get_constraintdef(oid), ';' ORDER BY oid) FROM pg_constraint WHERE conrelid=c.oid), (SELECT string_agg(pg_get_indexdef(indexrelid), ';' ORDER BY indexrelid) FROM pg_index WHERE indrelid=c.oid))::text AS payload FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE c.oid = ANY(?::regclass[]) ORDER BY c.oid,a.attnum", [orderedTables.map((table) => table.name)])
    const controls = await query<{ payload: string }>(`SELECT row_to_json(m)::text AS payload FROM encryption_maps m ${context.tenantId ? 'WHERE tenant_id = ?' : ''} ORDER BY id LIMIT ${MAX_MAPS + 1}`, context.tenantId ? [context.tenantId] : [])
    const definitionSize = await query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count, coalesce(sum(octet_length(row_to_json(d)::text)),0)::text AS bytes FROM custom_field_defs d WHERE tenant_id IS NULL${context.tenantId ? ' OR tenant_id = ?' : ' OR tenant_id IS NOT NULL'}`, context.tenantId ? [context.tenantId] : [])
    if (Number(definitionSize[0]?.count) > 5000 || Number(definitionSize[0]?.bytes) > 4 * 1024 * 1024) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const definitions = await query<{ payload: string }>(`SELECT row_to_json(d)::text AS payload FROM custom_field_defs d WHERE tenant_id IS NULL${context.tenantId ? ' OR tenant_id = ?' : ' OR tenant_id IS NOT NULL'} ORDER BY id LIMIT 5001`, context.tenantId ? [context.tenantId] : [])
    const policies = await query<{ payload: string }>('SELECT row_to_json(p)::text AS payload FROM pg_policies p ORDER BY schemaname,tablename,policyname LIMIT 10001')
    if (policies.length > 10000 || controls.length > MAX_MAPS) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
    const schema = digest(JSON.stringify([metadata, policies]))
    return { database: digest(JSON.stringify(identity[0])), scope: JSON.stringify([context.tenantId, context.organizationId]), schema, coverage: digest(JSON.stringify([controls, definitions, orderedTables])), provider: options.provider, backupDigest: options.backupDigest }
  }
  const decode = async (value: string, tenantId: string, phase: 'before' | 'after'): Promise<string> => {
    const key = await providers.kms.getTenantDek(tenantId)
    if (!key) throw new Error('[internal] ROTATION_KEY_CHANGED')
    let plaintext = decryptWithAesGcm(value, key.key)
    if (plaintext === null && phase === 'before') {
      const old = await providers.previousKms?.getTenantDek(tenantId)
      plaintext = old ? decryptWithAesGcm(value, old.key) : null
    }
    if (plaintext === null) throw new Error('[internal] ROTATION_DATA_MISMATCH')
    return plaintext
  }
  async function* rows(phase: 'before' | 'after', signal?: AbortSignal): AsyncGenerator<VerificationRow> {
    for (const table of orderedTables) {
      let cursor: string[] | null = null
      const primary = table.primaryKeys.map(quote)
      for (;;) {
        signal?.throwIfAborted()
        const predicate: string = cursor ? ` AND (${primary.join(', ')}) > (${primary.map(() => '?').join(', ')})` : ''
        const result: SqlRow[] = await query<SqlRow>(`SELECT ${table.columns.map((entry) => `${quote(entry.name)}::text AS ${quote(entry.name)}`).join(', ')} FROM ${tableSql(table)} WHERE ${scopeSql}${predicate} ORDER BY ${primary.join(', ')} LIMIT ${MAX_ROWS}`, [...scopeParameters(), ...(cursor ?? [])])
        if (!result.length) break
        for (const raw of result) {
          const tenantId = raw.tenant_id
          if (!tenantId) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
          const organizationId = raw.organization_id ?? null
          const identity = table.primaryKeys.map((key) => {
            const value = raw[key]
            if (value == null) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
            return value
          })
          const values = new Map<string, LogicalValue>(table.columns.map((entry) => [entry.name, raw[entry.name] ?? null]))
          const rules = table.rules.filter((rule) => rule.tenantId === tenantId && (rule.organizationId === null || rule.organizationId === organizationId))
          for (const rule of rules) {
            const value = raw[rule.column]
            if (value == null) continue
            const columnType = table.columns.find((entry) => entry.name === rule.column)!.type
            const envelope = databaseEnvelope(value, columnType)
            if (!isEncryptedPayloadShape(envelope)) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
            if (!rule.active && !rules.some((entry) => entry.active && entry.column === rule.column)) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
            const plaintext = await decode(envelope, tenantId, phase)
            const parsed = logical(parseDecryptedFieldValue(plaintext))
            canonicalValue(parsed)
            values.set(rule.column, parsed)
            if (rule.hashColumn) {
              const serialized = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
              const expected = hashForLookup(serialized)
              if (phase === 'after' && raw[rule.hashColumn] !== expected) throw new Error('[internal] ROTATION_DATA_MISMATCH')
              values.set(rule.hashColumn, expected)
            }
          }
          if (table.custom && raw.doc) {
            const doc = logical(JSON.parse(raw.doc))
            if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
            const scopeKey = JSON.stringify([raw.entity_type, tenantId, organizationId])
            let known = definitionCache.get(scopeKey)
            if (!known) {
              const definitions = await query<{ key: string }>('SELECT key FROM custom_field_defs WHERE entity_id = ? AND (tenant_id = ? OR tenant_id IS NULL) AND (organization_id = ? OR organization_id IS NULL) ORDER BY id LIMIT 501', [raw.entity_type, tenantId, organizationId])
              if (definitions.length > 500) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
              known = new Set(definitions.map((entry) => entry.key))
              if (definitionCache.size >= 64) definitionCache.delete(definitionCache.keys().next().value!)
              definitionCache.set(scopeKey, known)
            }
            const transformed: Record<string, LogicalValue> = {}
            for (const [key, value] of Object.entries(doc)) {
              const isEnvelope = (entry: LogicalValue) => typeof entry === 'string' && isCustomEntityDocumentCiphertext(entry)
              const contains = Array.isArray(value) ? value.some(isEnvelope) : isEnvelope(value)
              if (!contains) { transformed[key] = value; continue }
              if (!known.has(key.replace(/^cf[:_]/, ''))) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
              const decrypt = async (entry: LogicalValue): Promise<LogicalValue> => isEnvelope(entry) ? decode(entry as string, tenantId, phase) : entry
              transformed[key] = Array.isArray(value) ? await Promise.all(value.map(decrypt)) : await decrypt(value)
            }
            values.set('doc', transformed)
          }
          const row: VerificationRow = { entity: table.name, tenantId, organizationId, identity, columns: table.columns.map((entry) => ({ name: entry.name, type: entry.type, value: values.get(entry.name) ?? null })) }
          if (table.custom && 'updated_at' in raw) {
            row.metadata = { updated_at: canonicalRotationTimestamp(raw.updated_at ?? null) }
            const timestamp = row.columns.find((entry) => entry.name === 'updated_at')
            if (timestamp) timestamp.value = '__rotation_timestamp_v1__'
            if (phase === 'after') row.metadataIntent = await options.intents?.load(rowIdentity(row))
          }
          yield row
        }
        cursor = table.primaryKeys.map((key: string): string => result[result.length - 1]![key]!)
        if (result.length < MAX_ROWS) break
      }
    }
  }
  return { assertFence, binding, keys: keyInventory, rows }
}
