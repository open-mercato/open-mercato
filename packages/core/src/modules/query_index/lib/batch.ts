import type { Knex } from 'knex'
import { buildIndexDocument, type IndexCustomFieldValue } from './document'
import { replaceSearchTokensForBatch, isSearchDebugEnabled } from './search-tokens'

export type AnyRow = Record<string, any> & { id: string | number }

export type ScopeOverrides = {
  orgId?: string
  tenantId?: string
}

type CustomFieldRow = {
  record_id: string
  field_key: string
  value_text: string | null
  value_multiline: string | null
  value_int: number | null
  value_float: number | null
  value_bool: boolean | null
  organization_id: string | null
  tenant_id: string | null
}

export type IndexBatchOptions = {
  deriveOrganizationId?: (row: AnyRow) => string | null | undefined
  decryptDoc?: (
    entityType: string,
    doc: Record<string, unknown>,
    scope: { organizationId: string | null; tenantId: string | null },
  ) => Promise<Record<string, unknown> | null | undefined>
}

function normalizeId(value: unknown): string {
  return String(value)
}

function normalizeScopedValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return String(value)
}

export async function upsertIndexBatch(
  knex: Knex,
  entityType: string,
  rows: AnyRow[],
  scope: ScopeOverrides,
  options: IndexBatchOptions = {},
): Promise<void> {
  if (!rows.length) return
  const recordIds = rows.map((row) => normalizeId(row.id))

  const shouldMergeCustomerEntity =
    entityType === 'customers:customer_person_profile' || entityType === 'customers:customer_company_profile'

  let customerEntitiesById: Map<string, AnyRow> | null = null
  if (shouldMergeCustomerEntity) {
    const entityIds = Array.from(
      new Set(
        rows
          .map((row) => (row as AnyRow).entity_id || (row as AnyRow).entityId)
          .filter((value): value is string | number => value !== undefined && value !== null && `${value}` !== '')
          .map((value) => normalizeId(value)),
      ),
    )
    if (entityIds.length) {
      const entityRows = await knex<AnyRow>('customer_entities').whereIn('id', entityIds)
      customerEntitiesById = new Map(entityRows.map((row) => [normalizeId(row.id), row]))
    }
  }

  const customFieldRows = await knex<CustomFieldRow>('custom_field_values')
    .select([
      'record_id',
      'field_key',
      'value_text',
      'value_multiline',
      'value_int',
      'value_float',
      'value_bool',
      'organization_id',
      'tenant_id',
    ])
    .where('entity_id', entityType)
    .whereIn('record_id', recordIds)

  const customFieldMap = new Map<string, CustomFieldRow[]>()
  for (const fieldRow of customFieldRows) {
    const key = normalizeId(fieldRow.record_id)
    const bucket = customFieldMap.get(key)
    if (bucket) bucket.push(fieldRow)
    else customFieldMap.set(key, [fieldRow])
  }

  const basePayloads: Array<{
    entity_type: string
    entity_id: string
    organization_id: string | null
    tenant_id: string | null
    doc: Record<string, unknown>
    index_version: number
  }> = []

  const debugEnabled = isSearchDebugEnabled()

  for (const row of rows) {
    const recordId = normalizeId(row.id)
    const baseOrg = normalizeScopedValue((row as AnyRow).organization_id)
    const baseTenant = normalizeScopedValue((row as AnyRow).tenant_id)
    const derivedOrg = options?.deriveOrganizationId
      ? normalizeScopedValue(options.deriveOrganizationId(row))
      : undefined
    const scopeOrg =
      scope.orgId !== undefined
        ? scope.orgId
        : derivedOrg !== undefined
          ? derivedOrg
          : baseOrg
    const scopeTenant = scope.tenantId !== undefined ? scope.tenantId : baseTenant
    const inputRows = customFieldMap.get(recordId) ?? []
    const values: IndexCustomFieldValue[] = inputRows.map((fieldRow) => ({
      key: fieldRow.field_key,
      value:
        fieldRow.value_bool ??
        fieldRow.value_int ??
        fieldRow.value_float ??
        fieldRow.value_text ??
        fieldRow.value_multiline ??
        null,
      organizationId: normalizeScopedValue(fieldRow.organization_id),
      tenantId: normalizeScopedValue(fieldRow.tenant_id),
    }))
    const mergedRow = (() => {
      if (!shouldMergeCustomerEntity || !customerEntitiesById) return row
      const entityId = (row as AnyRow).entity_id || (row as AnyRow).entityId
      if (!entityId) return row
      const entityRow = customerEntitiesById.get(normalizeId(entityId))
      if (!entityRow) return row
      return { ...entityRow, ...row }
    })()
    let doc = buildIndexDocument(mergedRow, values, {
      organizationId: scopeOrg ?? null,
      tenantId: scopeTenant ?? null,
    })
    if (typeof options.decryptDoc === 'function') {
      try {
        const decrypted = await options.decryptDoc(entityType, doc, {
          organizationId: scopeOrg ?? null,
          tenantId: scopeTenant ?? null,
        })
        if (decrypted && typeof decrypted === 'object') {
          doc = decrypted
        }
      } catch {
        // best-effort; ignore decrypt errors during indexing
      }
    }
    basePayloads.push({
      entity_type: entityType,
      entity_id: recordId,
      organization_id: scopeOrg ?? null,
      tenant_id: scopeTenant ?? null,
      doc,
      index_version: 1,
    })
    if (debugEnabled) {
      const sample = {
        display_name: (doc as any).display_name,
        first_name: (doc as any).first_name,
        last_name: (doc as any).last_name,
        brand_name: (doc as any).brand_name,
        legal_name: (doc as any).legal_name,
      }
      console.info('[reindex:batch:doc]', {
        entityType,
        recordId,
        organizationId: scopeOrg ?? null,
        tenantId: scopeTenant ?? null,
        sample,
      })
    }
  }

  const insertRows = basePayloads.map((payload) => ({
    ...payload,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
    deleted_at: null,
  }))

  const tokenPayloads = basePayloads.map((payload) => ({
    entityType: payload.entity_type,
    recordId: payload.entity_id,
    organizationId: payload.organization_id,
    tenantId: payload.tenant_id,
    doc: payload.doc,
  }))

  try {
    await knex('entity_indexes')
      .insert(insertRows)
      .onConflict(['entity_type', 'entity_id', 'organization_id_coalesced'])
      .merge({
        doc: knex.raw('excluded.doc'),
        index_version: knex.raw('excluded.index_version'),
        organization_id: knex.raw('excluded.organization_id'),
        tenant_id: knex.raw('excluded.tenant_id'),
        deleted_at: knex.raw('excluded.deleted_at'),
        updated_at: knex.fn.now(),
      })
    try {
      await replaceSearchTokensForBatch(knex, tokenPayloads)
    } catch {}
    if (debugEnabled) {
      console.info('[reindex:batch:tokens]', {
        entityType,
        records: basePayloads.length,
        scopeOrg: scope.orgId ?? null,
        scopeTenant: scope.tenantId ?? null,
      })
    }
    return
  } catch {
    await knex.transaction(async (trx) => {
      const now = trx.fn.now()
      for (const payload of basePayloads) {
        const updated = await trx('entity_indexes')
          .where({
            entity_type: payload.entity_type,
            entity_id: payload.entity_id,
            organization_id: payload.organization_id ?? null,
          })
          .update({
            doc: payload.doc,
            index_version: payload.index_version,
            organization_id: payload.organization_id ?? null,
            tenant_id: payload.tenant_id ?? null,
            updated_at: now,
            deleted_at: null,
          })
        if (updated) continue
        try {
          await trx('entity_indexes').insert({
            ...payload,
            created_at: now,
            updated_at: now,
            deleted_at: null,
          })
        } catch {
          // ignore duplicate insert race; another concurrent worker updated the row
        }
      }
    })
  }
  try {
    await replaceSearchTokensForBatch(knex, tokenPayloads)
  } catch {}
}
