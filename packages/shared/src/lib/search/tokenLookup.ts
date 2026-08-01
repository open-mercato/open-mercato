import { type Kysely, sql } from 'kysely'
import { resolveSearchConfig, type SearchConfig } from './config'
import { tokenizeText } from './tokenize'

export type SearchTokenDatabase = {
  search_tokens: {
    entity_id: string
    entity_type: string
    field: string
    token_hash: string
    tenant_id: string | null
    organization_id: string | null
  }
}

/**
 * Tenant/organization scoping for a `search_tokens` lookup.
 *
 * `undefined` and `null` are NOT interchangeable:
 * - `undefined` omits the predicate entirely (the caller owns visibility).
 * - `null` emits a null-safe predicate that matches only globally scoped rows.
 */
export type SearchTokenScope = {
  tenantId?: string | null
  organizationId?: string | null
  organizationIds?: readonly string[] | null
}

/**
 * Why a lookup could not produce an id set. Callers MUST NOT read these as
 * "nothing matched" — the token index was never consulted, so the caller's own
 * predicate (usually an `ilike`) is still the authoritative one.
 */
export type SearchTokenLookupSkipReason = 'empty-query' | 'search-disabled' | 'no-tokens'

export type SearchTokenLookupResult =
  | { matched: true; ids: string[] }
  | { matched: false; reason: SearchTokenLookupSkipReason }

export type FindEntityIdsBySearchTokensInput = {
  db: Kysely<SearchTokenDatabase>
  entityType: string
  query: string
  fields?: readonly string[] | null
  scope?: SearchTokenScope
  config?: SearchConfig
}

/**
 * Resolve the record ids whose indexed `search_tokens` cover every token in
 * `query`.
 *
 * This is the encryption-safe replacement for `ilike` filtering on columns an
 * encryption map covers: the stored column holds ciphertext, so
 * `ilike '%term%'` silently matches nothing, while the token index stores
 * hashes of the plaintext and keeps matching. See issue #2990.
 *
 * Matching requires ALL query tokens to be present on the record. The token
 * search strategy in `@open-mercato/search` uses a looser match ratio; list
 * endpoints want the stricter behavior so a two-word query narrows rather than
 * widens the result set.
 */
export async function findEntityIdsBySearchTokens({
  db,
  entityType,
  query,
  fields,
  scope,
  config,
}: FindEntityIdsBySearchTokensInput): Promise<SearchTokenLookupResult> {
  const trimmed = query.trim()
  if (!trimmed) return { matched: false, reason: 'empty-query' }

  const searchConfig = config ?? resolveSearchConfig()
  if (!searchConfig.enabled) return { matched: false, reason: 'search-disabled' }

  const { hashes } = tokenizeText(trimmed, searchConfig)
  if (!hashes.length) return { matched: false, reason: 'no-tokens' }

  let builder = db
    .selectFrom('search_tokens')
    .select('entity_id')
    .where('entity_type', '=', entityType)
    .where('token_hash', 'in', hashes)

  const scopedFields = (fields ?? []).filter((field) => typeof field === 'string' && field.length > 0)
  if (scopedFields.length === 1) {
    builder = builder.where('field', '=', scopedFields[0])
  } else if (scopedFields.length > 1) {
    builder = builder.where('field', 'in', Array.from(scopedFields))
  }

  if (scope?.tenantId !== undefined) {
    builder = builder.where(sql<boolean>`tenant_id is not distinct from ${scope.tenantId}`)
  }

  if (scope?.organizationId !== undefined) {
    builder = scope.organizationId === null
      ? builder.where(sql<boolean>`organization_id is not distinct from ${null}`)
      : builder.where('organization_id', '=', scope.organizationId)
  } else if (scope?.organizationIds?.length) {
    builder = builder.where('organization_id', 'in', Array.from(scope.organizationIds))
  }

  const rows = (await builder
    .groupBy('entity_id')
    .having(sql<boolean>`count(distinct token_hash) >= ${hashes.length}`)
    .execute()) as Array<{ entity_id?: unknown }>

  const ids = rows
    .map((row) => (typeof row.entity_id === 'string' ? row.entity_id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  return { matched: true, ids }
}

/**
 * Legacy-shaped adapter for call sites that predate
 * {@link SearchTokenLookupResult}: `null` for a blank query, `[]` for every
 * other non-answer, otherwise the matched ids.
 *
 * Prefer {@link findEntityIdsBySearchTokens} in new code — the discriminated
 * result distinguishes "the index says nothing matched" from "the index was
 * never consulted", and that distinction is exactly what a `null`/`[]` pair
 * loses.
 */
export async function findEntityIdsBySearchTokensCompat(
  input: FindEntityIdsBySearchTokensInput,
): Promise<string[] | null> {
  const result = await findEntityIdsBySearchTokens(input)
  if (result.matched) return result.ids
  return result.reason === 'empty-query' ? null : []
}
