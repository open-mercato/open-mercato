import { type Kysely, sql } from 'kysely'
import { resolveSearchConfig, type SearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('query_index').child({ component: 'search-tokens' })

const INSERT_BATCH_SIZE = 500

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export type SearchTokenRow = {
  entity_type: string
  entity_id: string
  organization_id: string | null
  tenant_id: string | null
  field: string
  token_hash: string
  token?: string | null
}

type BuildTokenOptions = {
  entityType: string
  recordId: string
  organizationId?: string | null
  tenantId?: string | null
  doc?: Record<string, unknown> | null
  config?: SearchConfig
}

const DEFAULT_SCOPE = { organizationId: null, tenantId: null }
type EntityFieldPair = [string, string]

export const isSearchDebugEnabled = (): boolean => {
  return parseBooleanToken(process.env.OM_SEARCH_DEBUG ?? '') === true
}

const debug = (event: string, payload: Record<string, unknown>) => {
  if (!isSearchDebugEnabled()) return
  try {
    logger.debug('Search token event', { event, payload })
  } catch {
    // ignore
  }
}

function collectTextValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    const out: string[] = []
    for (const entry of value) {
      if (typeof entry === 'string') out.push(entry)
    }
    return out
  }
  return []
}

function shouldIndexField(field: string, value: unknown, config: SearchConfig): boolean {
  if (typeof value !== 'string' && !Array.isArray(value)) return false
  const lower = field.toLowerCase()
  if (lower === 'id' || lower.endsWith('_id') || lower.endsWith('.id')) return false
  if (lower.endsWith('_at')) return false
  if (['created_at', 'updated_at', 'deleted_at', 'tenant_id', 'organization_id'].includes(lower)) return false
  if (config.blocklistedFields.some((blocked) => lower.includes(blocked))) return false
  const values = collectTextValues(value)
  if (!values.length) return false
  return values.some((text) => tokenizeText(text, config).tokens.length > 0)
}

export function buildSearchTokenRows(params: BuildTokenOptions): SearchTokenRow[] {
  const config = params.config ?? resolveSearchConfig()
  if (!config.enabled) return []
  if (!params.doc) return []
  const tokens: SearchTokenRow[] = []
  const capturePairs = isSearchDebugEnabled() && params.entityType === 'customers:customer_deal'
  const debugPairs: Array<{ field: string; hash: string }> = []
  const scope = {
    organizationId: params.organizationId ?? DEFAULT_SCOPE.organizationId,
    tenantId: params.tenantId ?? DEFAULT_SCOPE.tenantId,
  }

  for (const [field, rawValue] of Object.entries(params.doc)) {
    if (!shouldIndexField(field, rawValue, config)) continue
    const values = collectTextValues(rawValue)
    const seen = new Set<string>()
    for (const text of values) {
      const { tokens: textTokens, hashes } = tokenizeText(text, config)
      for (let i = 0; i < textTokens.length; i += 1) {
        const token = textTokens[i]
        const hash = hashes[i]
        const dedupeKey = `${field}|${hash}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        debug('token.generated', { entityType: params.entityType, recordId: params.recordId, field, hash })
        tokens.push({
          entity_type: params.entityType,
          entity_id: String(params.recordId),
          organization_id: scope.organizationId,
          tenant_id: scope.tenantId,
          field,
          token_hash: hash,
          token: config.storeRawTokens ? token : null,
        })
        if (capturePairs) {
          debugPairs.push({ field, hash })
        }
      }
    }
  }
  if (capturePairs) {
    debug('deal.tokens', {
      entityType: params.entityType,
      recordId: params.recordId,
      tokenCount: debugPairs.length,
      tokens: debugPairs,
    })
  }
  debug('doc.completed', { entityType: params.entityType, recordId: params.recordId, tokenCount: tokens.length })

  return tokens
}

function buildFieldPairs(recordId: string, doc?: Record<string, unknown> | null): EntityFieldPair[] {
  if (!doc) return []
  const pairs: EntityFieldPair[] = []
  const dedupe = new Set<string>()
  for (const field of Object.keys(doc)) {
    const key = `${recordId}|${field}`
    if (dedupe.has(key)) continue
    dedupe.add(key)
    pairs.push([recordId, field])
  }
  return pairs
}

export async function replaceSearchTokensForRecord(
  db: Kysely<any>,
  params: BuildTokenOptions
): Promise<void> {
  const rows = buildSearchTokenRows(params)
  const config = params.config ?? resolveSearchConfig()
  if (!config.enabled) return
  const organizationId = params.organizationId ?? null
  const tenantId = params.tenantId ?? null
  const fieldPairs = buildFieldPairs(String(params.recordId), params.doc)

  await db.transaction().execute(async (trx) => {
    let deleteQuery = trx
      .deleteFrom('search_tokens' as any)
      .where('entity_type' as any, '=', params.entityType)
      .where(sql<boolean>`organization_id is not distinct from ${organizationId}`)
      .where(sql<boolean>`tenant_id is not distinct from ${tenantId}`)
    if (fieldPairs.length) {
      deleteQuery = deleteQuery.where((eb: any) => eb.or(
        fieldPairs.map(([rid, field]) => eb.and([
          eb('entity_id' as any, '=', rid),
          eb('field' as any, '=', field),
        ])),
      ))
    } else {
      deleteQuery = deleteQuery.where('entity_id' as any, '=', String(params.recordId))
    }
    await deleteQuery.execute()
    if (!rows.length) return
    const payloads = rows.map((row) => ({ ...row, created_at: sql`now()` }))
    for (const batch of chunk(payloads, INSERT_BATCH_SIZE)) {
      await trx.insertInto('search_tokens' as any).values(batch as any).execute()
    }
  })
}

export async function deleteSearchTokensForRecord(
  db: Kysely<any>,
  params: { entityType: string; recordId: string; organizationId?: string | null; tenantId?: string | null }
): Promise<void> {
  const organizationId = params.organizationId ?? null
  const tenantId = params.tenantId ?? null
  await db
    .deleteFrom('search_tokens' as any)
    .where('entity_type' as any, '=', params.entityType)
    .where('entity_id' as any, '=', String(params.recordId))
    .where(sql<boolean>`organization_id is not distinct from ${organizationId}`)
    .where(sql<boolean>`tenant_id is not distinct from ${tenantId}`)
    .execute()
}

export async function replaceSearchTokensForBatch(
  db: Kysely<any>,
  payloads: Array<BuildTokenOptions & { doc: Record<string, unknown> }>
): Promise<void> {
  if (!payloads.length) return
  const config = resolveSearchConfig()
  if (!config.enabled) return

  const rows = payloads.flatMap((payload) => buildSearchTokenRows({ ...payload, config }))
  if (!rows.length) {
    const entityType = payloads[0]?.entityType
    if (!entityType) return
    const ids = payloads.map((p) => String(p.recordId))
    await db
      .deleteFrom('search_tokens' as any)
      .where('entity_type' as any, '=', entityType)
      .where('entity_id' as any, 'in', ids)
      .execute()
    return
  }

  const scopeKey = (org: string | null, tenant: string | null) => `${org ?? '__null__'}|${tenant ?? '__null__'}`
  const scopeBuckets = new Map<string, { organizationId: string | null; tenantId: string | null; ids: Set<string> }>()

  for (const payload of payloads) {
    const org = payload.organizationId ?? null
    const tenant = payload.tenantId ?? null
    const key = scopeKey(org, tenant)
    const bucket = scopeBuckets.get(key) ?? { organizationId: org, tenantId: tenant, ids: new Set<string>() }
    bucket.ids.add(String(payload.recordId))
    scopeBuckets.set(key, bucket)
  }

  await db.transaction().execute(async (trx) => {
    for (const [, bucket] of scopeBuckets.entries()) {
      // Delete by entity_id: a batch replaces all of a record's tokens, and a per-field OR over the
      // whole batch overflows the query compiler's call stack on large batches.
      const deleteQuery = trx
        .deleteFrom('search_tokens' as any)
        .where('entity_type' as any, '=', payloads[0].entityType)
        .where(sql<boolean>`organization_id is not distinct from ${bucket.organizationId}`)
        .where(sql<boolean>`tenant_id is not distinct from ${bucket.tenantId}`)
        .where('entity_id' as any, 'in', Array.from(bucket.ids))
      await deleteQuery.execute()
    }
    const payloadWithTimestamps = rows.map((row) => ({ ...row, created_at: sql`now()` }))
    for (const batch of chunk(payloadWithTimestamps, INSERT_BATCH_SIZE)) {
      await trx.insertInto('search_tokens' as any).values(batch as any).execute()
    }
  })
}
