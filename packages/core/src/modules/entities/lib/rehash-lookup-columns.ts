import type { EntityMetadata } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { decryptWithAesGcm, lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { listEntityMetadata } from '@open-mercato/shared/lib/db/entityMetadata'
import { resolveEntityIdFromMetadata } from '@open-mercato/shared/lib/encryption/entityIds'
import { resolveEncryptionKeyId, type TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { ModuleEncryptionFieldRule, ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'
import { EncryptionMap } from '../data/entities'

const BATCH_SIZE = 500

type LookupColumns = { source: string; hash: string }
type LookupSources = { hash: string; sources: Set<string> }
type EncryptionReader = Pick<TenantDataEncryptionService, 'getDek' | 'getLookupHashRules'>
type Row = Record<string, unknown>

function findColumn(meta: EntityMetadata, field: string): string | undefined {
  return meta.properties[field]?.fieldNames?.[0]
    ?? meta.props.find((property) => property.fieldNames?.includes(field))?.fieldNames?.[0]
}

function resolveLookupColumns(entityId: string, meta: EntityMetadata, fields: readonly ModuleEncryptionFieldRule[]): LookupColumns[] {
  return fields.flatMap(({ field, hashField }) => {
    if (!hashField) return []
    const source = findColumn(meta, field)
    const hash = findColumn(meta, hashField)
    if (!source || !hash || source === hash) {
      throw new Error(`[internal] Cannot resolve lookup columns for ${entityId}.${field} → ${hashField}. Check the encryption map and entity metadata.`)
    }
    return [{ source, hash }]
  })
}

function groupLookupSources(entityId: string, columns: LookupColumns[]): LookupSources[] {
  const byHash = new Map<string, Set<string>>()
  const sourceColumns = new Set(columns.map(({ source }) => source))
  for (const { hash, source } of columns) {
    if (sourceColumns.has(hash)) {
      throw new Error(`[internal] ${entityId}.${hash} is both a source and a hash column. Resolve the encryption map before retrying.`)
    }
    const sources = byHash.get(hash) ?? new Set<string>()
    sources.add(source)
    byHash.set(hash, sources)
  }
  return Array.from(byHash, ([hash, sources]) => ({ hash, sources }))
}

async function readLookupSource(
  stored: unknown,
  encryption: EncryptionReader,
  keyId: string | null,
  location: string,
): Promise<string | undefined> {
  if (typeof stored !== 'string') return JSON.stringify(stored)
  if (!stored.endsWith(':v1') || stored.split(':').length !== 4) return stored
  const dek = await encryption.getDek(keyId)
  if (!dek) throw new Error(`[internal] No data-encryption key is available for ${location}. Restore key access and retry.`)
  const plaintext = decryptWithAesGcm(stored, dek.key)
  if (plaintext === null) {
    throw new Error(`[internal] Cannot decrypt ${location} during lookup rehashing. Restore the correct data-encryption key and retry.`)
  }
  return decryptWithAesGcm(plaintext, dek.key) ?? plaintext
}

function toComparisonValue(value: unknown): unknown {
  return value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)
    ? JSON.stringify(value)
    : value
}

async function rehashEntity(
  em: EntityManager,
  encryption: EncryptionReader,
  entity: { entityId: string; meta: EntityMetadata; defaults?: ModuleEncryptionMap; fields: ModuleEncryptionFieldRule[] },
  scope: { tenantId: string | null; dryRun: boolean },
): Promise<{ scanned: number; changed: number }> {
  const { entityId, meta, defaults, fields } = entity
  const { tenantId, dryRun } = scope
  const tenant = findColumn(meta, 'tenant_id')
  const organization = findColumn(meta, 'organization_id')
  const updatedAt = findColumn(meta, 'updated_at')
  if (!tenant && defaults?.keyScope === 'system' && tenantId !== null) return { scanned: 0, changed: 0 }
  const primaryKey = meta.primaryKeys.length === 1 ? findColumn(meta, String(meta.primaryKeys[0])) : undefined
  if (!primaryKey || !meta.tableName || (!tenant && defaults?.keyScope !== 'system')) {
    throw new Error(`[internal] Cannot scan ${entityId} for lookup rehashing. A table, a single primary key and tenant scope are required.`)
  }

  const defaultColumns = resolveLookupColumns(entityId, meta, defaults?.fields ?? [])
  const columns = resolveLookupColumns(entityId, meta, fields)
  const selectedColumns = new Set([primaryKey, ...columns.flatMap(({ source, hash }) => [source, hash])])
  if (organization) selectedColumns.add(organization)
  const table = meta.schema ? `${meta.schema}.${meta.tableName}` : meta.tableName
  const database = em.getKysely<Record<string, Row>>()
  let select = database.selectFrom(table).select([...selectedColumns])
  if (tenant) {
    select = tenantId === null ? select.where(tenant, 'is', null) : select.where(tenant, '=', tenantId)
  }
  const keyId = resolveEncryptionKeyId(entityId, defaults?.keyScope, tenantId)
  const rulesByOrganization = new Map<string | null, LookupSources[]>()
  let lastId: unknown = null
  let scanned = 0
  let changed = 0

  while (true) {
    const page = lastId === null ? select : select.where(primaryKey, '>', lastId)
    const rows = await page.orderBy(primaryKey).limit(BATCH_SIZE).execute()
    if (rows.length === 0) break
    scanned += rows.length

    for (const row of rows) {
      const organizationId = organization ? row[organization] as string | null : null
      let rules = rulesByOrganization.get(organizationId)
      if (!rules) {
        const effective = await encryption.getLookupHashRules(entityId, tenantId, organizationId)
        rules = groupLookupSources(entityId, [...resolveLookupColumns(entityId, meta, effective), ...defaultColumns])
        rulesByOrganization.set(organizationId, rules)
      }
      const updates: Array<{ source: string; hash: string; value: string }> = []
      for (const { sources, hash } of rules) {
        const previous = row[hash]
        if (previous == null) continue
        let matched = false
        for (const source of sources) {
          if (row[source] == null) continue
          const plaintext = await readLookupSource(row[source], encryption, keyId, `${entityId}.${source}`)
          if (plaintext === undefined) continue
          const candidates = lookupHashCandidates(plaintext)
          if (typeof previous !== 'string' || !candidates.includes(previous)) continue
          matched = true
          if (previous !== candidates[0]) updates.push({ source, hash, value: candidates[0]! })
          break
        }
        if (!matched) {
          throw new Error(`[internal] Existing ${entityId}.${hash} lookup hash does not match its mapped sources. Check LOOKUP_HASH_OLD_PEPPER and the encryption map before retrying.`)
        }
      }
      if (!updates.length) continue

      if (!dryRun) {
        let update = database.updateTable(table)
          .set({
            ...Object.fromEntries(updates.map(({ hash, value }) => [hash, value])),
            ...(updatedAt ? { [updatedAt]: new Date() } : {}),
          })
          .where(primaryKey, '=', row[primaryKey])
        if (tenant) {
          update = tenantId === null ? update.where(tenant, 'is', null) : update.where(tenant, '=', tenantId)
        }
        if (organization) {
          update = organizationId === null ? update.where(organization, 'is', null) : update.where(organization, '=', organizationId)
        }
        const comparedColumns = [...new Set(updates.flatMap(({ source, hash }) => [source, hash]))]
        for (const column of comparedColumns) {
          update = update.where(column, '=', toComparisonValue(row[column]))
        }
        const updated = await update.returning(primaryKey).execute().catch(() => {
          throw new Error(`[internal] Lookup hash update failed for ${entityId}. Check database availability and lookup hash uniqueness before retrying.`)
        })
        if (updated.length !== 1) {
          throw new Error(`[internal] A row changed concurrently in ${entityId}. No stale hash was written. Retry lookup rehashing.`)
        }
      }
      changed += 1
    }

    if (rows.length < BATCH_SIZE) break
    lastId = rows.at(-1)?.[primaryKey]
  }
  return { scanned, changed }
}

export async function rehashLookupColumns(
  em: EntityManager,
  encryption: EncryptionReader,
  defaults: ModuleEncryptionMap[],
  scope: { tenantId: string | null; dryRun: boolean },
): Promise<{ scanned: number; changed: number }> {
  const liveMaps = await em.find(EncryptionMap, {
    isActive: true,
    deletedAt: null,
    $or: [{ tenantId: scope.tenantId }, { tenantId: null, organizationId: null }],
  })
  const defaultByEntity = new Map(defaults.map((map) => [map.entityId, map]))
  const fieldsByEntity = new Map<string, ModuleEncryptionFieldRule[]>()
  for (const { entityId, fields } of [...defaults, ...liveMaps.map((map) => ({ entityId: map.entityId, fields: map.fieldsJson ?? [] }))]) {
    const lookupFields = fields.filter((field) => field.hashField)
    if (lookupFields.length) fieldsByEntity.set(entityId, [...(fieldsByEntity.get(entityId) ?? []), ...lookupFields])
  }
  const metadata = new Map(listEntityMetadata(em).map((meta) => [resolveEntityIdFromMetadata(meta), meta]))
  const entities = [...fieldsByEntity].map(([entityId, fields]) => {
    const meta = metadata.get(entityId)
    if (!meta) throw new Error(`[internal] No entity metadata for ${entityId}. Enable the owning module before retrying lookup rehashing.`)
    return { entityId, meta, defaults: defaultByEntity.get(entityId), fields }
  })

  const totals = { scanned: 0, changed: 0 }
  for (const entity of entities) {
    const result = await rehashEntity(em, encryption, entity, scope)
    totals.scanned += result.scanned
    totals.changed += result.changed
  }
  return totals
}
