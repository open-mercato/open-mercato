import { type Kysely, sql } from 'kysely'
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
  encryptDoc?: (
    entityType: string,
    doc: Record<string, unknown>,
    scope: { organizationId: string | null; tenantId: string | null },
  ) => Promise<Record<string, unknown> | null | undefined>
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
  db: Kysely<any>,
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
      const entityRows = await db
        .selectFrom('customer_entities' as any)
        .selectAll()
        .where('id' as any, 'in', entityIds)
        .execute() as AnyRow[]
      customerEntitiesById = new Map(entityRows.map((row) => [normalizeId(row.id), row]))
    }
  }

  const customFieldRows = await db
    .selectFrom('custom_field_values' as any)
    .select([
      'record_id' as any,
      'field_key' as any,
      'value_text' as any,
      'value_multiline' as any,
      'value_int' as any,
      'value_float' as any,
      'value_bool' as any,
      'organization_id' as any,
      'tenant_id' as any,
    ])
    .where('entity_id' as any, '=', entityType)
    .where('record_id' as any, 'in', recordIds)
    .execute() as CustomFieldRow[]

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
    tokenDoc: Record<string, unknown>
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
    let tokenDoc: Record<string, unknown> = doc
    if (typeof options.encryptDoc === 'function') {
      try {
        const encrypted = await options.encryptDoc(entityType, doc, {
          organizationId: scopeOrg ?? null,
          tenantId: scopeTenant ?? null,
        })
        if (encrypted && typeof encrypted === 'object') {
          doc = encrypted
          tokenDoc = encrypted
        }
      } catch {
        // best-effort; ignore encrypt errors during indexing
      }
    }
    if (typeof options.decryptDoc === 'function') {
      try {
        const decrypted = await options.decryptDoc(entityType, doc, {
          organizationId: scopeOrg ?? null,
          tenantId: scopeTenant ?? null,
        })
        if (decrypted && typeof decrypted === 'object') {
          tokenDoc = decrypted
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
      tokenDoc,
      index_version: 1,
    })
    if (debugEnabled) {
      const sample = {
        display_name: (tokenDoc as any).display_name,
        first_name: (tokenDoc as any).first_name,
        last_name: (tokenDoc as any).last_name,
        brand_name: (tokenDoc as any).brand_name,
        legal_name: (tokenDoc as any).legal_name,
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
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    organization_id: payload.organization_id,
    tenant_id: payload.tenant_id,
    doc: sql`${JSON.stringify(payload.doc)}::jsonb`,
    index_version: payload.index_version,
    created_at: sql`now()`,
    updated_at: sql`now()`,
    deleted_at: null,
  }))

  const tokenPayloads = basePayloads.map((payload) => ({
    entityType: payload.entity_type,
    recordId: payload.entity_id,
    organizationId: payload.organization_id,
    tenantId: payload.tenant_id,
    doc: payload.tokenDoc,
  }))

  try {
    await db
      .insertInto('entity_indexes' as any)
      .values(insertRows as any)
      .onConflict((oc: any) => oc
        .columns(['entity_type', 'entity_id', 'organization_id_coalesced'])
        .doUpdateSet({
          doc: sql`excluded.doc`,
          index_version: sql`excluded.index_version`,
          organization_id: sql`excluded.organization_id`,
          tenant_id: sql`excluded.tenant_id`,
          deleted_at: sql`excluded.deleted_at`,
          updated_at: sql`now()`,
        } as any))
      .execute()
    try {
      await replaceSearchTokensForBatch(db, tokenPayloads)
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
    await db.transaction().execute(async (trx) => {
      for (const payload of basePayloads) {
        let updateQuery = trx
          .updateTable('entity_indexes' as any)
          .set({
            doc: sql`${JSON.stringify(payload.doc)}::jsonb`,
            index_version: payload.index_version,
            organization_id: payload.organization_id ?? null,
            tenant_id: payload.tenant_id ?? null,
            updated_at: sql`now()`,
            deleted_at: null,
          } as any)
          .where('entity_type' as any, '=', payload.entity_type)
          .where('entity_id' as any, '=', payload.entity_id)
        updateQuery = payload.organization_id == null
          ? updateQuery.where('organization_id' as any, 'is', null as any)
          : updateQuery.where('organization_id' as any, '=', payload.organization_id)
        const result = await updateQuery.executeTakeFirst() as { numUpdatedRows?: bigint | number } | undefined
        if (result && Number(result.numUpdatedRows ?? 0) > 0) continue
        try {
          await trx
            .insertInto('entity_indexes' as any)
            .values({
              entity_type: payload.entity_type,
              entity_id: payload.entity_id,
              organization_id: payload.organization_id,
              tenant_id: payload.tenant_id,
              doc: sql`${JSON.stringify(payload.doc)}::jsonb`,
              index_version: payload.index_version,
              created_at: sql`now()`,
              updated_at: sql`now()`,
              deleted_at: null,
            } as any)
            .execute()
        } catch {
          // ignore duplicate insert race; another concurrent worker updated the row
        }
      }
    })
  }
  try {
    await replaceSearchTokensForBatch(db, tokenPayloads)
  } catch {}
}
