import type { EntityManager } from '@mikro-orm/postgresql'

type BuildDocParams = {
  entityType: string // '<module>:<entity>'
  recordId: string
  organizationId?: string | null
  tenantId?: string | null
}

export async function buildIndexDoc(em: EntityManager, params: BuildDocParams): Promise<Record<string, any> | null> {
  const knex = (em as any).getConnection().getKnex()
  const [, entity] = params.entityType.split(':')
  const baseTable = entity.endsWith('s') ? entity : `${entity}s`

  // Fetch base row
  const baseRow = await knex(baseTable)
    .where('id', params.recordId)
    .first()
  if (!baseRow) return null

  // Build base document (snake_case keys as in DB)
  const doc: Record<string, any> = {}
  for (const [k, v] of Object.entries(baseRow)) doc[k] = v

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

  return doc
}

export async function upsertIndexRow(em: EntityManager, args: { entityType: string; recordId: string; organizationId?: string | null; tenantId?: string | null }): Promise<void> {
  const doc = await buildIndexDoc(em, args)
  const knex = (em as any).getConnection().getKnex()
  if (!doc) {
    // If base row missing, mark index row as deleted if present
    await knex('entity_indexes')
      .where({ entity_type: args.entityType, entity_id: String(args.recordId), organization_id: args.organizationId ?? null })
      .update({ deleted_at: knex.fn.now(), updated_at: knex.fn.now() })
    return
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
  // Upsert on unique (entity_type, entity_id, organization_id)
  const insertQ = knex('entity_indexes').insert({ ...payload, created_at: knex.fn.now() })
  // Use generated coalesced column to unify conflict target for both scoped and global rows
  await insertQ.onConflict(['entity_type', 'entity_id', 'organization_id_coalesced']).merge(payload)
}

export async function markDeleted(em: EntityManager, args: { entityType: string; recordId: string; organizationId?: string | null }): Promise<void> {
  const knex = (em as any).getConnection().getKnex()
  await knex('entity_indexes')
    .where({ entity_type: args.entityType, entity_id: String(args.recordId), organization_id: args.organizationId ?? null })
    .update({ deleted_at: knex.fn.now(), updated_at: knex.fn.now() })
}
