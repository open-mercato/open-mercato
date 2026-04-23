import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { decryptIndexDocForSearch, encryptIndexDocForStorage } from '@open-mercato/shared/lib/encryption/indexDoc'
import { sql } from 'kysely'
import { replaceSearchTokensForRecord, deleteSearchTokensForRecord } from './search-tokens'
import { attachAggregateSearchField } from './document'

type BuildDocParams = {
  entityType: string // '<module>:<entity>'
  recordId: string
  organizationId?: string | null
  tenantId?: string | null
}

export async function buildIndexDoc(em: EntityManager, params: BuildDocParams): Promise<Record<string, any> | null> {
  const db = (em as any).getKysely()
  const baseTable = resolveEntityTableName(em, params.entityType)

  // Fetch base row
  const baseRow = await db
    .selectFrom(baseTable as any)
    .selectAll()
    .where('id' as any, '=', params.recordId)
    .executeTakeFirst() as Record<string, any> | undefined
  if (!baseRow) return null
  const docSources: Array<Record<string, any>> = []

  // Attach the core customer entity when indexing customer profiles so search tokens see the combined row
  let parentEntityRow: Record<string, any> | null = null
  if (params.entityType === 'customers:customer_person_profile' || params.entityType === 'customers:customer_company_profile') {
    const entityId = (baseRow as any).entity_id ?? (baseRow as any).entityId
    if (entityId) {
      const entityRow = await db
        .selectFrom('customer_entities' as any)
        .selectAll()
        .where('id' as any, '=', entityId)
        .executeTakeFirst() as Record<string, any> | undefined
      if (entityRow) {
        docSources.push(entityRow)
        parentEntityRow = entityRow
      }
    }
  }
  void parentEntityRow

  // Build base document (snake_case keys as in DB)
  let doc: Record<string, any> = {}
  docSources.push(baseRow)
  for (const source of docSources) {
    for (const [k, v] of Object.entries(source)) doc[k] = v
  }

  // Attach custom fields under flat keys 'cf:<key>'
  let cfQuery = db
    .selectFrom('custom_field_values' as any)
    .select([
      'field_key' as any,
      'value_text' as any,
      'value_multiline' as any,
      'value_int' as any,
      'value_float' as any,
      'value_bool' as any,
    ])
    .where('entity_id' as any, '=', params.entityType)
    .where('record_id' as any, '=', String(params.recordId))

  if (params.organizationId != null) {
    cfQuery = cfQuery.where((eb: any) => eb.or([
      eb('organization_id' as any, '=', params.organizationId),
      eb('organization_id' as any, 'is', null),
    ]))
  } else {
    cfQuery = cfQuery.where('organization_id' as any, 'is', null)
  }

  if (params.tenantId != null) {
    cfQuery = cfQuery.where((eb: any) => eb.or([
      eb('tenant_id' as any, '=', params.tenantId),
      eb('tenant_id' as any, 'is', null),
    ]))
  } else {
    cfQuery = cfQuery.where('tenant_id' as any, 'is', null)
  }

  const cfRows = await cfQuery.execute() as Array<Record<string, any>>

  const cfMap: Record<string, any[]> = {}
  for (const r of cfRows) {
    const key = String(r.field_key)
    const cfKey = `cf:${key}`
    const val = r.value_bool ?? r.value_int ?? r.value_float ?? r.value_text ?? r.value_multiline ?? null
    if (!cfMap[cfKey]) cfMap[cfKey] = []
    cfMap[cfKey].push(val)
  }
  for (const [key, arr] of Object.entries(cfMap)) {
    // Store singletons as simple value; multis as array
    doc[key] = arr.length <= 1 ? arr[0] : arr
  }

  // Attach translations under flat keys 'l10n:{locale}:{field}'
  try {
    const translationRow = await db
      .selectFrom('entity_translations' as any)
      .select(['translations' as any])
      .where('entity_type' as any, '=', params.entityType)
      .where('entity_id' as any, '=', String(params.recordId))
      .where(sql`tenant_id is not distinct from ${params.tenantId ?? null}`)
      .where(sql`organization_id is not distinct from ${params.organizationId ?? null}`)
      .executeTakeFirst() as { translations: Record<string, Record<string, unknown>> | null } | undefined

    if (translationRow?.translations && typeof translationRow.translations === 'object') {
      for (const [locale, fields] of Object.entries(translationRow.translations)) {
        if (!fields || typeof fields !== 'object') continue
        for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
          if (typeof value === 'string' && value.length > 0) {
            doc[`l10n:${locale}:${field}`] = value
          }
        }
      }
    }
  } catch {}

  try {
    doc = attachAggregateSearchField(doc)
    const encryption = resolveTenantEncryptionService(em as any)
    doc = await encryptIndexDocForStorage(
      params.entityType,
      doc,
      { tenantId: params.tenantId ?? null, organizationId: params.organizationId ?? null },
      encryption,
    )
  } catch {}

  return doc
}

export type UpsertIndexResult = {
  doc: Record<string, any> | null
  existed: boolean
  wasDeleted: boolean
  created: boolean
  revived: boolean
}

function scopeEntityIndexes<QB extends { where: (...args: any[]) => QB }>(
  q: QB,
  args: { entityType: string; recordId: string; organizationId?: string | null; tenantId?: string | null },
): QB {
  let chain = q.where('entity_type' as any, '=', args.entityType)
  chain = chain.where('entity_id' as any, '=', String(args.recordId))
  chain = args.organizationId == null
    ? chain.where('organization_id' as any, 'is', null as any)
    : chain.where('organization_id' as any, '=', args.organizationId)
  chain = chain.where(sql`tenant_id is not distinct from ${args.tenantId ?? null}`)
  return chain
}

export async function upsertIndexRow(
  em: EntityManager,
  args: { entityType: string; recordId: string; organizationId?: string | null; tenantId?: string | null }
): Promise<UpsertIndexResult> {
  const db = (em as any).getKysely()

  const existing = await scopeEntityIndexes(
    db.selectFrom('entity_indexes' as any).select(['id' as any, 'deleted_at' as any]),
    args,
  ).executeTakeFirst() as { id: string; deleted_at: Date | null } | undefined

  const existed = !!existing
  const wasDeleted = !!existing && existing.deleted_at != null

  const doc = await buildIndexDoc(em, args)
  if (!doc) {
    try {
      await deleteSearchTokensForRecord(db, {
        entityType: args.entityType,
        recordId: args.recordId,
        organizationId: args.organizationId ?? null,
        tenantId: args.tenantId ?? null,
      })
    } catch {}
    if (existed) {
      await scopeEntityIndexes(
        db.deleteFrom('entity_indexes' as any) as any,
        args,
      ).execute()
    }
    return { doc: null, existed, wasDeleted, created: false, revived: false }
  }

  const payload = {
    entity_type: args.entityType,
    entity_id: String(args.recordId),
    organization_id: args.organizationId ?? null,
    tenant_id: args.tenantId ?? null,
    doc: sql`${JSON.stringify(doc)}::jsonb`,
    index_version: 1,
    updated_at: sql`now()`,
    deleted_at: null,
  }

  // Prefer modern upsert keyed by coalesced org id when available; fallback to update-then-insert
  try {
    await db
      .insertInto('entity_indexes' as any)
      .values({ ...payload, created_at: sql`now()` } as any)
      .onConflict((oc: any) => oc
        .columns(['entity_type', 'entity_id', 'organization_id_coalesced'])
        .doUpdateSet({
          tenant_id: args.tenantId ?? null,
          doc: sql`${JSON.stringify(doc)}::jsonb`,
          index_version: 1,
          updated_at: sql`now()`,
          deleted_at: null,
        } as any))
      .execute()
  } catch {
    // Fallback for schemas without organization_id_coalesced column/index
    const updated = await scopeEntityIndexes(
      db.updateTable('entity_indexes' as any).set(payload as any) as any,
      args,
    ).executeTakeFirst() as { numUpdatedRows?: bigint | number } | undefined
    if (!updated || Number(updated.numUpdatedRows ?? 0) === 0) {
      try {
        await db
          .insertInto('entity_indexes' as any)
          .values({ ...payload, created_at: sql`now()` } as any)
          .execute()
      } catch {}
    }
  }

  const created = !existed
  const revived = existed && wasDeleted
  try {
    const encryption = resolveTenantEncryptionService(em as any)
    const dekKeyCache = new Map<string | null, string | null>()
    const tokenDoc = await decryptIndexDocForSearch(
      args.entityType,
      doc,
      { tenantId: args.tenantId ?? null, organizationId: args.organizationId ?? null },
      encryption,
      dekKeyCache,
    )
    await replaceSearchTokensForRecord(db, {
      entityType: args.entityType,
      recordId: args.recordId,
      organizationId: args.organizationId ?? null,
      tenantId: args.tenantId ?? null,
      doc: tokenDoc,
    })
  } catch {}
  return { doc, existed, wasDeleted, created, revived }
}

export async function markDeleted(
  em: EntityManager,
  args: { entityType: string; recordId: string; organizationId?: string | null; tenantId?: string | null }
): Promise<{ wasActive: boolean }> {
  const db = (em as any).getKysely()
  const existing = await scopeEntityIndexes(
    db.selectFrom('entity_indexes' as any).select(['deleted_at' as any]),
    args,
  ).executeTakeFirst() as { deleted_at: Date | null } | undefined

  const wasActive = !!existing && existing.deleted_at == null

  if (existing) {
    try {
      await deleteSearchTokensForRecord(db, {
        entityType: args.entityType,
        recordId: args.recordId,
        organizationId: args.organizationId ?? null,
        tenantId: args.tenantId ?? null,
      })
    } catch {}
    await scopeEntityIndexes(
      db.deleteFrom('entity_indexes' as any) as any,
      args,
    ).execute()
  }

  return { wasActive }
}
