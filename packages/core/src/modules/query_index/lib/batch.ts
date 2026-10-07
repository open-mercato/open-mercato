import { type Kysely, sql } from 'kysely'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { isUniqueViolation } from '@open-mercato/shared/lib/db/pg-errors'
import { buildIndexDocument, rebuildAggregateSearchField, type IndexCustomFieldValue } from './document'
import { replaceSearchTokensForBatch, isSearchDebugEnabled } from './search-tokens'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'

const logger = createLogger('query_index').child({ component: 'reindex-batch' })

/**
 * Cap on how many per-row failures a single batch persists to `indexer_error_logs`.
 * Under a systemic failure (pool exhausted, disk full, KMS down) every row fails, and
 * writing one error row per record would hammer the database that is already failing.
 * The count of suppressed failures still reaches the caller via `failedRecordIds`.
 */
const MAX_RECORDED_ROW_ERRORS_PER_BATCH = 50

export type AnyRow = Record<string, any> & { id: string | number }

export type ScopeOverrides = {
  orgId?: string
  tenantId?: string
}

/**
 * What a batch actually wrote, as opposed to what it was asked to write. Callers MUST
 * reconcile `written` against `attempted` — a batch that loses rows and reports success
 * is how records go permanently missing from the index (issue GSM-266).
 */
export type UpsertIndexBatchResult = {
  attempted: number
  written: number
  failedRecordIds: string[]
  searchTokenFailures: number
}

export class QueryIndexBatchWriteError extends Error {
  readonly entityType: string
  readonly attempted: number
  readonly written: number
  readonly failedRecordIds: string[]

  constructor(entityType: string, result: UpsertIndexBatchResult) {
    const preview = result.failedRecordIds.slice(0, 10)
    const suffix = result.failedRecordIds.length > preview.length ? ', ...' : ''
    super(
      `[internal] Query index write incomplete for ${entityType}: wrote ${result.written} of ${result.attempted} records` +
        (preview.length ? ` (failed: ${preview.join(', ')}${suffix})` : ''),
    )
    this.name = 'QueryIndexBatchWriteError'
    this.entityType = entityType
    this.attempted = result.attempted
    this.written = result.written
    this.failedRecordIds = result.failedRecordIds
  }
}

export function assertIndexBatchWritesLanded(entityType: string, result: UpsertIndexBatchResult): void {
  if (result.written >= result.attempted && result.failedRecordIds.length === 0) return
  throw new QueryIndexBatchWriteError(entityType, result)
}

export function createEmptyUpsertIndexBatchResult(): UpsertIndexBatchResult {
  return { attempted: 0, written: 0, failedRecordIds: [], searchTokenFailures: 0 }
}

export function mergeUpsertIndexBatchResults(
  target: UpsertIndexBatchResult,
  addition: UpsertIndexBatchResult,
): UpsertIndexBatchResult {
  target.attempted += addition.attempted
  target.written += addition.written
  target.searchTokenFailures += addition.searchTokenFailures
  target.failedRecordIds.push(...addition.failedRecordIds)
  return target
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

type IndexRowPayload = {
  entity_type: string
  entity_id: string
  organization_id: string | null
  tenant_id: string | null
  doc: Record<string, unknown>
  tokenDoc: Record<string, unknown>
  index_version: number
}

async function updateIndexRow(db: Kysely<any>, payload: IndexRowPayload): Promise<number> {
  let updateQuery = db
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
  return Number(result?.numUpdatedRows ?? 0)
}

export async function upsertIndexBatch(
  db: Kysely<any>,
  entityType: string,
  rows: AnyRow[],
  scope: ScopeOverrides,
  options: IndexBatchOptions = {},
): Promise<UpsertIndexBatchResult> {
  if (!rows.length) return createEmptyUpsertIndexBatchResult()
  const recordIds = rows.map((row) => normalizeId(row.id))

  const failedRecordIds: string[] = []
  let searchTokenFailures = 0
  let recordedRowErrors = 0

  const recordRowFailure = async (
    recordId: string,
    error: unknown,
    handler: string,
    rowScope: { organizationId: string | null; tenantId: string | null },
  ): Promise<void> => {
    failedRecordIds.push(recordId)
    if (recordedRowErrors >= MAX_RECORDED_ROW_ERRORS_PER_BATCH) return
    recordedRowErrors += 1
    await recordIndexerError(
      { db },
      {
        source: 'query_index',
        handler,
        error,
        entityType,
        recordId,
        tenantId: rowScope.tenantId,
        organizationId: rowScope.organizationId,
      },
    ).catch(() => undefined)
  }

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

  const basePayloads: IndexRowPayload[] = []

  const debugEnabled = isSearchDebugEnabled()
  const searchConfig = resolveSearchConfig()

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
    let doc = buildIndexDocument(
      mergedRow,
      values,
      {
        organizationId: scopeOrg ?? null,
        tenantId: scopeTenant ?? null,
      },
      { entityType, config: searchConfig },
    )
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
      } catch (encryptError) {
        // Falling through would write the plaintext document into entity_indexes,
        // which must stay encrypted at rest. Skip the row instead so the previously
        // encrypted row survives, and let the caller fail the run.
        await recordRowFailure(recordId, encryptError, 'query_index:reindex-batch:encrypt', {
          organizationId: scopeOrg ?? null,
          tenantId: scopeTenant ?? null,
        })
        continue
      }
    }
    if (typeof options.decryptDoc === 'function') {
      try {
        const decrypted = await options.decryptDoc(entityType, doc, {
          organizationId: scopeOrg ?? null,
          tenantId: scopeTenant ?? null,
        })
        if (decrypted && typeof decrypted === 'object') {
          // Rebuilt on the decrypted copy: `search_text` is on no encryption map, so the
          // aggregate composed at document-build time still concatenates the ciphertext
          // values the row carries at rest and tokenizes into rows nothing matches (#5625).
          // The copy keeps `doc` — the encrypted row written to `entity_indexes` — untouched.
          // A caller that passes no `decryptDoc` keeps the build-time aggregate by design:
          // without a decryption step there is no plaintext to recompose it from.
          tokenDoc = rebuildAggregateSearchField(decrypted, { entityType, config: searchConfig })
        }
      } catch (decryptError) {
        // Only affects the search tokens built below; the indexed document itself is
        // unharmed, so the row still counts as written.
        logger.warn('Failed to decrypt index document for search tokens', { entityType, recordId })
        await recordIndexerError(
          { db },
          {
            source: 'fulltext',
            handler: 'query_index:reindex-batch:decrypt',
            error: decryptError,
            entityType,
            recordId,
            tenantId: scopeTenant ?? null,
            organizationId: scopeOrg ?? null,
          },
        ).catch(() => undefined)
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
      logger.debug('Reindex batch document', {
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

  const writeSearchTokens = async (payloads = tokenPayloads): Promise<void> => {
    if (!payloads.length) return
    try {
      await replaceSearchTokensForBatch(db, payloads)
    } catch (searchTokenError) {
      // Record instead of swallowing: a failed token write leaves fulltext search stale.
      // Not counted as a write failure — replaceSearchTokensForBatch is transactional, so
      // tokens end up stale rather than missing, and the record's next write rebuilds them.
      searchTokenFailures += 1
      await recordIndexerError(
        { db },
        { source: 'fulltext', handler: 'query_index:reindex-batch', error: searchTokenError, entityType, tenantId: scope.tenantId ?? null, organizationId: scope.orgId ?? null },
      ).catch(() => undefined)
    }
  }

  const buildResult = (written: number): UpsertIndexBatchResult => ({
    attempted: rows.length,
    written,
    failedRecordIds,
    searchTokenFailures,
  })

  if (!basePayloads.length) return buildResult(0)

  let bulkWriteFailed = false
  try {
    // One statement, so it is atomic on its own. Note the arbiter is
    // (entity_type, entity_id, organization_id_coalesced): two payloads sharing a
    // conflict key in the same batch would raise 21000 for the whole statement and
    // fall through to the per-row path below.
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
  } catch (bulkError) {
    bulkWriteFailed = true
    logger.warn('Bulk index upsert failed; falling back to per-row writes', {
      entityType,
      records: basePayloads.length,
    })
    await recordIndexerError(
      { db },
      {
        source: 'query_index',
        handler: 'query_index:reindex-batch:bulk',
        error: bulkError,
        entityType,
        tenantId: scope.tenantId ?? null,
        organizationId: scope.orgId ?? null,
      },
    ).catch(() => undefined)
  }

  if (!bulkWriteFailed) {
    await writeSearchTokens()
    if (debugEnabled) {
      logger.debug('Reindex batch tokens', {
        entityType,
        records: basePayloads.length,
        scopeOrg: scope.orgId ?? null,
        scopeTenant: scope.tenantId ?? null,
      })
    }
    return buildResult(basePayloads.length)
  }

  // Deliberately NOT wrapped in a transaction. In Postgres a single failing statement
  // aborts the surrounding transaction, and COMMIT on an aborted transaction answers
  // with a ROLLBACK tag instead of raising — so one bad row used to discard the entire
  // batch while this function reported success (issue GSM-266). Each row here is an
  // independent, idempotent upsert; they share no invariant worth a transaction.
  let written = 0
  for (const payload of basePayloads) {
    try {
      if (await updateIndexRow(db, payload) > 0) {
        written += 1
        continue
      }
      try {
        await db
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
        written += 1
      } catch (insertError) {
        // A concurrent worker may have inserted the row between our UPDATE and INSERT.
        // Only a successful retry of the UPDATE proves the row is actually there.
        if (isUniqueViolation(insertError) && await updateIndexRow(db, payload) > 0) {
          written += 1
          continue
        }
        await recordRowFailure(payload.entity_id, insertError, 'query_index:reindex-batch:row', {
          organizationId: payload.organization_id,
          tenantId: payload.tenant_id,
        })
      }
    } catch (rowError) {
      await recordRowFailure(payload.entity_id, rowError, 'query_index:reindex-batch:row', {
        organizationId: payload.organization_id,
        tenantId: payload.tenant_id,
      })
    }
  }

  const failedRecordIdSet = new Set(failedRecordIds)
  await writeSearchTokens(tokenPayloads.filter((payload) => !failedRecordIdSet.has(payload.recordId)))
  return buildResult(written)
}
