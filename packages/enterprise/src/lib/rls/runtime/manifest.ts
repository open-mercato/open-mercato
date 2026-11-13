import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { DatabaseTableMetadata } from '@open-mercato/shared/lib/db/runtime'
import { readCatalogRows } from './catalog'
import type { BoundaryClient } from './pool'
import { tenantTableInventory } from './tableInventory.generated'

const identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).max(63)
const schemaName = identifier.refine((value) => !value.startsWith('pg_') && value !== 'information_schema')
const entrySchema = z.object({
  schema: schemaName, table: identifier, owner: z.string().min(1),
  classification: z.enum(['enforced', 'identity', 'mixed', 'global', 'deferred', 'transport']),
  reason: z.string().min(1), tenantColumn: z.literal('tenant_id').nullable(),
  tenantType: z.literal('uuid').nullable(), tenantNullable: z.boolean().nullable(),
  policyVersion: z.literal(1).nullable(),
}).strict().superRefine((entry, context) => {
  if ((entry.tenantColumn === null) !== (entry.tenantType === null && entry.tenantNullable === null)) {
    context.addIssue({ code: 'custom', message: '[internal] Tenant inventory column/type/nullability are inconsistent' })
  }
  if (entry.classification === 'enforced') {
    if (entry.tenantColumn !== 'tenant_id' || entry.tenantType !== 'uuid' || entry.tenantNullable !== false || entry.policyVersion !== 1) {
      context.addIssue({ code: 'custom', message: '[internal] Enforced tenant tables require a non-null UUID and supported policy version' })
    }
  } else if (entry.policyVersion !== null) {
    context.addIssue({ code: 'custom', message: '[internal] Deferred tenant inventory entries cannot claim an installed policy version' })
  }
})

export type TenantTableEntry = Readonly<z.output<typeof entrySchema>>
export type TenantTableManifest = Readonly<{ version: 1; tables: readonly TenantTableEntry[] }>

export function parseTenantTableManifest(value: unknown): TenantTableManifest {
  const parsed = z.object({ version: z.literal(1), tables: z.array(entrySchema).min(1) }).strict().safeParse(value)
  if (!parsed.success) throw new Error('[internal] Invalid or unsupported tenant boundary table manifest')
  const identities = parsed.data.tables.map((table) => `${table.schema}.${table.table}`)
  if (new Set(identities).size !== identities.length || !parsed.data.tables.some((table) => table.classification === 'enforced')) {
    throw new Error('[internal] Tenant boundary manifest requires unique table identities and an explicit enforced canary')
  }
  return Object.freeze({ version: 1, tables: Object.freeze(parsed.data.tables.map((table) => Object.freeze(table))) })
}

export async function loadTenantTableManifest(options: { schema: string; manifestPath?: string }): Promise<TenantTableManifest> {
  if (options.manifestPath) {
    let value: unknown
    try { value = JSON.parse(await readFile(options.manifestPath, 'utf8')) } catch {
      throw new Error('[internal] Could not read the configured tenant boundary JSON manifest')
    }
    return parseTenantTableManifest(value)
  }
  return parseTenantTableManifest({
    ...tenantTableInventory,
    tables: tenantTableInventory.tables.map((table) => ({ ...table, schema: table.schema === 'public' ? options.schema : table.schema })),
  })
}

export function assertTenantOrmInventory(manifest: TenantTableManifest, metadata: readonly DatabaseTableMetadata[]): void {
  const entries = new Map(manifest.tables.map((entry) => [`${entry.schema}.${entry.table}`, entry]))
  const discovered = new Set(metadata.map((table) => `${table.schema}.${table.table}`))
  for (const table of metadata) {
    const entry = entries.get(`${table.schema}.${table.table}`)
    if (table.tenantColumn && !entry) throw new Error('[internal] Tenant boundary ORM discovered an unclassified tenant-bearing entity')
    if (entry && (entry.tenantColumn !== table.tenantColumn || entry.tenantType !== table.tenantType || entry.tenantNullable !== table.tenantNullable)) {
      throw new Error('[internal] Tenant boundary ORM entity differs from its reviewed manifest')
    }
  }
  if (manifest.tables.some((entry) => entry.classification === 'enforced' && !discovered.has(`${entry.schema}.${entry.table}`))) {
    throw new Error('[internal] Tenant boundary canary does not match the active ORM table and schema')
  }
}

const catalogTableSchema = z.object({
  schema: z.string(), table: z.string(), oid: z.coerce.number().int(), kind: z.string(),
  partitioned: z.boolean(), inherited: z.boolean(), row_security: z.boolean(), force_row_security: z.boolean(),
  tenant_type: z.string().nullable(), tenant_not_null: z.boolean().nullable(),
})

export type TenantCatalogTable = z.output<typeof catalogTableSchema>

export async function readTenantCatalog(client: Pick<BoundaryClient, 'query'>): Promise<TenantCatalogTable[]> {
  return readCatalogRows(client, `
    select namespace.nspname as schema, relation.relname as table, relation.oid,
      relation.relkind::text as kind, relation.relispartition as partitioned,
      exists(select 1 from pg_inherits where inhrelid = relation.oid or inhparent = relation.oid) as inherited,
      relation.relrowsecurity as row_security, relation.relforcerowsecurity as force_row_security,
      case when attribute.attname is null then null else format_type(attribute.atttypid, attribute.atttypmod) end as tenant_type,
      attribute.attnotnull as tenant_not_null
    from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
      left join pg_attribute attribute on attribute.attrelid = relation.oid and attribute.attname = 'tenant_id'
        and attribute.attnum > 0 and not attribute.attisdropped
    where relation.relkind in ('r','p','f') and namespace.nspname !~ '^pg_' and namespace.nspname <> 'information_schema'
    order by namespace.nspname, relation.relname
  `, [], catalogTableSchema)
}

export function assertTenantTableInventory(
  manifest: TenantTableManifest,
  catalog: readonly TenantCatalogTable[],
  phase: 'preflight' | 'runtime',
): void {
  const entries = new Map(manifest.tables.map((entry) => [`${entry.schema}.${entry.table}`, entry]))
  const installed = new Map(catalog.map((table) => [`${table.schema}.${table.table}`, table]))
  for (const table of catalog) {
    const entry = entries.get(`${table.schema}.${table.table}`)
    if (table.tenant_type && !entry) throw new Error('[internal] Tenant boundary found an unclassified tenant-bearing table')
    if (!entry) continue
    if (entry.tenantType !== table.tenant_type || (entry.tenantNullable !== null && entry.tenantNullable === table.tenant_not_null)) {
      throw new Error('[internal] Tenant boundary table metadata differs from its reviewed manifest')
    }
    if (entry.classification === 'enforced' && (table.kind !== 'r' || table.partitioned || table.inherited)) {
      throw new Error('[internal] Tenant boundary canary does not support partitions, inheritance or foreign tables')
    }
    if (entry.classification !== 'enforced' && (table.row_security || table.force_row_security)) {
      throw new Error('[internal] Tenant boundary found policy activation outside its explicit enforced manifest')
    }
  }
  if (phase === 'runtime' && manifest.tables.some((entry) => entry.classification === 'enforced' && !installed.has(`${entry.schema}.${entry.table}`))) {
    throw new Error('[internal] Tenant boundary canary table is missing; run privileged migrations before starting runtime traffic')
  }
}
