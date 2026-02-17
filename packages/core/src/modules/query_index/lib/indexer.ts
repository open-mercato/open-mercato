import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { decryptIndexDocForSearch, encryptIndexDocForStorage } from '@open-mercato/shared/lib/encryption/indexDoc'
import type { Knex } from 'knex'
import { replaceSearchTokensForRecord, deleteSearchTokensForRecord } from './search-tokens'

type BuildDocParams = {
  entityType: string // '<module>:<entity>'
  recordId: string
  organizationId?: string | null
  tenantId?: string | null
}

export async function buildIndexDoc(em: EntityManager, params: BuildDocParams): Promise<Record<string, any> | null> {
  const knex = (em as any).getConnection().getKnex() as Knex
  const baseTable = resolveEntityTableName(em, params.entityType)

  // Fetch base row
  const baseRow = await knex(baseTable)
    .where('id', params.recordId)
    .first()
  if (!baseRow) return null
  const docSources: Array<Record<string, any>> = []

  // Attach the core customer entity when indexing customer profiles so search tokens see the combined row
  let parentEntityRow: Record<string, any> | null = null
  if (params.entityType === 'customers:customer_person_profile' || params.entityType === 'customers:customer_company_profile') {
    const entityId = (baseRow as any).entity_id ?? (baseRow as any).entityId
    if (entityId) {
      const entityRow = await knex('customer_entities')
        .where('id', entityId)
        .first()
      if (entityRow) {
        docSources.push(entityRow)
        parentEntityRow = entityRow
      }
    }
  }

  // Build base document (snake_case keys as in DB)
  let doc: Record<string, any> = {}
  docSources.push(baseRow)
  for (const source of docSources) {
    for (const [k, v] of Object.entries(source)) doc[k] = v
  }

  // Attach custom fields under flat keys 'cf:<key>'
  const cfRows = await knex('custom_field_values')
    .select(['field_key', 'value_text', 'value_multiline', 'value_int', 'value_float', 'value_bool'])
    .where({ entity_id: params.entityType, record_id: String(params.recordId) })
    .modify((qb: any) => {
      if (params.organizationId != null) qb.andWhere((b: any) => b.where({ organization_id: params.organizationId }).orWhereNull('organization_id'))
      else qb.whereNull('organization_id')
      if (params.tenantId != null) qb.andWhere((b: any) => b.where({ tenant_id: params.tenantId }).orWhereNull('tenant_id'))
      else qb.whereNull('tenant_id')
    })

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
    const translationRow = await knex('entity_translations')
      .where({ entity_type: params.entityType, entity_id: String(params.recordId) })
      .andWhereRaw('tenant_id is not distinct from ?', [params.tenantId ?? null])
      .andWhereRaw('organization_id is not distinct from ?', [params.organizationId ?? null])
      .select(['translations'])
      .first()

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

export async function upsertIndexRow(
  em: EntityManager,
  args: { entityType: string; recordId: string; organizationId?: string | null; tenantId?: string | null }
): Promise<UpsertIndexResult> {
  const knex = (em as any).getConnection().getKnex() as Knex
  const baseScopeQuery = knex('entity_indexes')
    .select(['id', 'deleted_at'])
    .where({
      entity_type: args.entityType,
      entity_id: String(args.recordId),
      organization_id: args.organizationId ?? null,
    })
    .andWhereRaw('tenant_id is not distinct from ?', [args.tenantId ?? null])
    .first<{ id: string; deleted_at: Date | null } | undefined>()

  const existing = await baseScopeQuery
  const existed = !!existing
  const wasDeleted = !!existing && existing.deleted_at != null

  const doc = await buildIndexDoc(em, args)
  if (!doc) {
    try {
      await deleteSearchTokensForRecord(knex, {
        entityType: args.entityType,
        recordId: args.recordId,
        organizationId: args.organizationId ?? null,
        tenantId: args.tenantId ?? null,
      })
    } catch {}
    if (existed) {
      await knex('entity_indexes')
        .where({
          entity_type: args.entityType,
          entity_id: String(args.recordId),
          organization_id: args.organizationId ?? null,
        })
        .andWhereRaw('tenant_id is not distinct from ?', [args.tenantId ?? null])
        .del()
    }
    return { doc: null, existed, wasDeleted, created: false, revived: false }
  }

  const payload = {
    entity_type: args.entityType,
    entity_id: String(args.recordId),
    organization_id: args.organizationId ?? null,
    tenant_id: args.tenantId ?? null,
    doc,
    index_version: 1,
    updated_at: knex.fn.now(),
    deleted_at: null,
  }
  // Prefer modern upsert keyed by coalesced org id when available; fallback to update-then-insert
  try {
    const insertQ = knex('entity_indexes').insert({ ...payload, created_at: knex.fn.now() })
    await insertQ
      .onConflict(['entity_type', 'entity_id', 'organization_id_coalesced'])
      .merge(payload)
  } catch {
    // Fallback for schemas without organization_id_coalesced column/index
    const updated = await knex('entity_indexes')
      .where({
        entity_type: args.entityType,
        entity_id: String(args.recordId),
        organization_id: args.organizationId ?? null,
      })
      .andWhereRaw('tenant_id is not distinct from ?', [args.tenantId ?? null])
      .update(payload)
    if (!updated) {
      try { await knex('entity_indexes').insert({ ...payload, created_at: knex.fn.now() }) } catch {}
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
    await replaceSearchTokensForRecord(knex, {
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
  const knex = (em as any).getConnection().getKnex() as Knex
  const existing = await knex('entity_indexes')
    .select(['deleted_at'])
    .where({
      entity_type: args.entityType,
      entity_id: String(args.recordId),
      organization_id: args.organizationId ?? null,
    })
    .andWhereRaw('tenant_id is not distinct from ?', [args.tenantId ?? null])
    .first<{ deleted_at: Date | null } | undefined>()

  const wasActive = !!existing && existing.deleted_at == null

  if (existing) {
    try {
      await deleteSearchTokensForRecord(knex, {
        entityType: args.entityType,
        recordId: args.recordId,
        organizationId: args.organizationId ?? null,
        tenantId: args.tenantId ?? null,
      })
    } catch {}
    await knex('entity_indexes')
      .where({
        entity_type: args.entityType,
        entity_id: String(args.recordId),
        organization_id: args.organizationId ?? null,
      })
      .andWhereRaw('tenant_id is not distinct from ?', [args.tenantId ?? null])
      .del()
  }

  return { wasActive }
}
