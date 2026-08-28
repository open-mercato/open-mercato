import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { decryptIndexDocForSearch, encryptIndexDocForStorage } from '@open-mercato/shared/lib/encryption/indexDoc'
import { stripBlocklistedDocFields } from '@open-mercato/shared/lib/search/config'
import {
  buildCustomFieldDefinitionIndexFromRows,
  normalizeDefinitionKey,
  selectDefinitionForRecord,
  type CustomFieldDefinitionRow,
} from '@open-mercato/shared/lib/crud/custom-field-definition-index'
import { type Kysely, type Transaction, sql } from 'kysely'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { replaceSearchTokensForRecord, deleteSearchTokensForRecord } from './search-tokens'
import { attachAggregateSearchField } from './document'

const logger = createLogger('query_index').child({ component: 'indexer' })

type QueryIndexExecutor = Kysely<any> | Transaction<any>

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
  // The event path builds its document here rather than through
  // `buildIndexDocument`, so it needs its own call: stripping only the batch
  // path would give a reindex that removes the column and an ordinary write
  // that puts it straight back. Placed before the `cf:`/`l10n:` merges below,
  // and well before `encryptIndexDocForStorage()` — which re-injects each
  // encryption rule's `hashField`, so a ruled lookup hash survives the strip
  // and encrypted exact-match lookup keeps working.
  stripBlocklistedDocFields(doc)

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

  const multiKeys = new Set<string>()
  const fieldKeys = Object.keys(cfMap).map((key) => key.slice(3))
  if (fieldKeys.length > 0) {
    let defQuery = db
      .selectFrom('custom_field_defs' as any)
      .select([
        'key' as any,
        'kind' as any,
        'config_json' as any,
        'organization_id' as any,
        'tenant_id' as any,
        'deleted_at' as any,
        'updated_at' as any,
      ])
      .where('entity_id' as any, '=', params.entityType)
      .where('key' as any, 'in', fieldKeys)
      .where('is_active' as any, '=', true)
      .where('deleted_at' as any, 'is', null)

    if (params.organizationId != null) {
      defQuery = defQuery.where((eb: any) => eb.or([
        eb('organization_id' as any, '=', params.organizationId),
        eb('organization_id' as any, 'is', null),
      ]))
    } else {
      defQuery = defQuery.where('organization_id' as any, 'is', null)
    }

    if (params.tenantId != null) {
      defQuery = defQuery.where((eb: any) => eb.or([
        eb('tenant_id' as any, '=', params.tenantId),
        eb('tenant_id' as any, 'is', null),
      ]))
    } else {
      defQuery = defQuery.where('tenant_id' as any, 'is', null)
    }

    const defRows = await defQuery.execute() as Array<Record<string, any>>
    const definitionIndex = buildCustomFieldDefinitionIndexFromRows(
      defRows.map((row): CustomFieldDefinitionRow => ({
        key: String(row.key ?? ''),
        entityId: params.entityType,
        kind: typeof row.kind === 'string' ? row.kind : null,
        configJson: row.config_json,
        organizationId: row.organization_id ?? null,
        tenantId: row.tenant_id ?? null,
        deletedAt: row.deleted_at ?? null,
        updatedAt: row.updated_at ?? null,
      })),
      { organizationIds: params.organizationId ? [params.organizationId] : [] },
    )
    for (const key of fieldKeys) {
      const definitions = definitionIndex.get(normalizeDefinitionKey(key)) ?? []
      const definition = selectDefinitionForRecord(
        definitions,
        params.organizationId ?? null,
        params.tenantId ?? null,
      )
      if (definition?.multi) multiKeys.add(key)
    }
  }

  for (const [key, arr] of Object.entries(cfMap)) {
    // Cardinality belongs to the field definition, not the current row count:
    // a multi field containing one value must still hydrate as an array.
    const fieldKey = key.slice(3)
    doc[key] = multiKeys.has(fieldKey) || arr.length > 1 ? arr : arr[0]
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

  // Kept outside the guard below: a failure while building the aggregate search field is a
  // bug in the aggregation or its configuration, and must surface instead of being mistaken
  // for an encryption failure and silently skipping encryption.
  doc = attachAggregateSearchField(doc, { entityType: params.entityType })

  try {
    const encryption = resolveTenantEncryptionService(em as any)
    doc = await encryptIndexDocForStorage(
      params.entityType,
      doc,
      { tenantId: params.tenantId ?? null, organizationId: params.organizationId ?? null },
      encryption,
    )
  } catch (error) {
    // `encryptIndexDocForStorage` already returns the document untouched when encryption is
    // absent or disabled, so a throw here is always a genuine encryption failure. Returning
    // `doc` would hand the caller the plaintext document to write into `entity_indexes`,
    // which must stay encrypted at rest; returning `null` would mean "record gone" and make
    // `upsertIndexRow` delete a healthy index row. Fail loudly instead: the projection keeps
    // its previous, correctly encrypted contents and the `query_index.upsert_one` subscriber
    // persists the error via `recordIndexerError`.
    logger.error('Index document encryption failed; refusing to return an unencrypted document', {
      entityType: params.entityType,
      recordId: params.recordId,
      tenantId: params.tenantId ?? null,
      organizationId: params.organizationId ?? null,
      err: error,
    })
    throw error
  }

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
  args: { entityType: string; recordId: string; organizationId?: string | null; tenantId?: string | null; searchTokenDoc?: Record<string, unknown> | null; deferSearchTokens?: boolean; trx?: QueryIndexExecutor }
): Promise<UpsertIndexResult> {
  const db = (em as any).getKysely()
  const executor = args.trx ?? db

  const existing = await scopeEntityIndexes(
    executor.selectFrom('entity_indexes' as any).select(['id' as any, 'deleted_at' as any]),
    args,
  ).executeTakeFirst() as { id: string; deleted_at: Date | null } | undefined

  const existed = !!existing
  const wasDeleted = !!existing && existing.deleted_at != null

  const doc = await buildIndexDoc(em, args)
  if (!doc) {
    // When the caller defers token work it owns the matching token cleanup; the
    // projection-row removal below stays synchronous so list reads converge immediately.
    if (!args.deferSearchTokens) {
      try {
        await reindexSearchTokensForRecord(em, {
          entityType: args.entityType,
          recordId: args.recordId,
          organizationId: args.organizationId ?? null,
          tenantId: args.tenantId ?? null,
          doc: null,
          trx: args.trx,
        })
      } catch (error) {
        if (args.trx) throw error
      }
    }
    if (existed) {
      await scopeEntityIndexes(
        executor.deleteFrom('entity_indexes' as any) as any,
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
    await executor
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
      executor.updateTable('entity_indexes' as any).set(payload as any) as any,
      args,
    ).executeTakeFirst() as { numUpdatedRows?: bigint | number } | undefined
    if (!updated || Number(updated.numUpdatedRows ?? 0) === 0) {
      try {
        await executor
          .insertInto('entity_indexes' as any)
          .values({ ...payload, created_at: sql`now()` } as any)
          .execute()
      } catch (error) {
        if (args.trx) throw error
      }
    }
  }

  const created = !existed
  const revived = existed && wasDeleted
  // The search-token rebuild (DELETE + chunked INSERT) is the heavy tail of indexing.
  // Callers that defer it (the upsert subscriber) run `reindexSearchTokensForRecord`
  // asynchronously after this projection update so write latency stays bounded.
  if (!args.deferSearchTokens) {
    try {
      await reindexSearchTokensForRecord(em, {
        entityType: args.entityType,
        recordId: args.recordId,
        organizationId: args.organizationId ?? null,
        tenantId: args.tenantId ?? null,
        doc,
        searchTokenDoc: args.searchTokenDoc ?? null,
        trx: args.trx,
      })
    } catch (error) {
      if (args.trx) throw error
    }
  }
  return { doc, existed, wasDeleted, created, revived }
}

/**
 * Rebuilds (or clears, when `doc` is null) the search-token rows for a single record.
 * This is the asynchronous-friendly tail of `upsertIndexRow`: it does not touch the
 * `entity_indexes` projection that list endpoints read, so it can run out-of-band
 * without making query-index reads inconsistent.
 */
export async function reindexSearchTokensForRecord(
  em: EntityManager,
  args: {
    entityType: string
    recordId: string
    organizationId?: string | null
    tenantId?: string | null
    doc: Record<string, any> | null
    searchTokenDoc?: Record<string, unknown> | null
    trx?: QueryIndexExecutor
  },
): Promise<void> {
  const db = (em as any).getKysely()
  if (!args.doc) {
    await deleteSearchTokensForRecord(db, {
      entityType: args.entityType,
      recordId: args.recordId,
      organizationId: args.organizationId ?? null,
      tenantId: args.tenantId ?? null,
    }, { trx: args.trx })
    return
  }
  const tokenDoc = args.searchTokenDoc ?? (() => {
    const encryption = resolveTenantEncryptionService(em as any)
    const dekKeyCache = new Map<string | null, string | null>()
    return decryptIndexDocForSearch(
      args.entityType,
      args.doc,
      { tenantId: args.tenantId ?? null, organizationId: args.organizationId ?? null },
      encryption,
      dekKeyCache,
    )
  })()
  await replaceSearchTokensForRecord(db, {
    entityType: args.entityType,
    recordId: args.recordId,
    organizationId: args.organizationId ?? null,
    tenantId: args.tenantId ?? null,
    doc: await tokenDoc,
  }, { trx: args.trx })
}

export async function markDeleted(
  em: EntityManager,
  args: { entityType: string; recordId: string; organizationId?: string | null; tenantId?: string | null; trx?: QueryIndexExecutor }
): Promise<{ wasActive: boolean }> {
  const db = (em as any).getKysely()
  const executor = args.trx ?? db
  const existing = await scopeEntityIndexes(
    executor.selectFrom('entity_indexes' as any).select(['deleted_at' as any]),
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
      }, { trx: args.trx })
    } catch (error) {
      if (args.trx) throw error
    }
    await scopeEntityIndexes(
      executor.deleteFrom('entity_indexes' as any) as any,
      args,
    ).execute()
  }

  return { wasActive }
}
