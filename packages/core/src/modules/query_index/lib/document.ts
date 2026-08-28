import {
  isSearchFieldBlocklisted,
  resolveSearchConfig,
  type SearchConfig,
} from '@open-mercato/shared/lib/search/config'

export type IndexDocumentScope = {
  organizationId?: string | null
  tenantId?: string | null
}

export type IndexCustomFieldValue = {
  key: string
  value: unknown
  organizationId?: string | null
  tenantId?: string | null
}

export const AGGREGATE_SEARCH_FIELD = 'search_text'

/**
 * Controls which fields may contribute text to the `search_text` aggregate.
 *
 * Both properties are optional so existing callers keep working unchanged: an
 * omitted `config` is resolved from the environment, and an omitted `entityType`
 * means only the global blocklist entries apply.
 */
export type AggregateSearchOptions = {
  entityType?: string | null
  config?: SearchConfig
}

function normalizeScopeValue(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null
  return value
}

function isScopedValueVisible(
  scopeValue: string | null,
  fieldValue: string | null,
): boolean {
  if (scopeValue === null) return fieldValue === null
  return fieldValue === null || fieldValue === scopeValue
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null
  return value
}

function collectAggregateSearchValues(
  field: string,
  value: unknown,
  entityType: string | null,
  config: SearchConfig,
): string[] {
  const lower = field.toLowerCase()
  if (
    lower === AGGREGATE_SEARCH_FIELD
    || lower === 'id'
    || lower.endsWith('_id')
    || lower.endsWith('.id')
    || lower.endsWith('_at')
    || ['created_at', 'updated_at', 'deleted_at', 'tenant_id', 'organization_id'].includes(lower)
  ) {
    return []
  }

  if (isSearchFieldBlocklisted(field, entityType, config)) return []

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? [trimmed] : []
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }

  return []
}

/**
 * Composes the aggregate search field on `doc`, in place, and returns it.
 *
 * When no field survives the blocklist the aggregate key is **removed** rather than left
 * alone, so a document that already carries one cannot keep a stale value. No entity in
 * this repository has a `search_text` column, so a freshly built document never reaches
 * the call with the key already set; the removal only matters on the recomputation path
 * (`rebuildAggregateSearchField`), where the incoming value was composed from ciphertext.
 */
export function attachAggregateSearchField(
  doc: Record<string, unknown>,
  options: AggregateSearchOptions = {},
): Record<string, unknown> {
  const config = options.config ?? resolveSearchConfig()
  const entityType = options.entityType ?? null
  const parts: string[] = []
  const seen = new Set<string>()

  for (const [field, value] of Object.entries(doc)) {
    const values = collectAggregateSearchValues(field, value, entityType, config)
    for (const entry of values) {
      const key = entry.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      parts.push(entry)
    }
  }

  if (parts.length > 0) {
    doc[AGGREGATE_SEARCH_FIELD] = parts.join('\n')
  } else {
    // Recomputing must never leave an earlier aggregate behind: when this runs on a
    // decrypted copy of a stored document, the value already sitting under the key was
    // built from the encrypted-at-rest one and would otherwise survive as ciphertext.
    delete doc[AGGREGATE_SEARCH_FIELD]
  }

  return doc
}

/**
 * Recomputes the aggregate on a shallow copy of `doc`.
 *
 * Search tokens are built from the *decrypted* index document, while the document
 * persisted in `entity_indexes` stays encrypted at rest. The aggregate composed during
 * document build therefore concatenates ciphertext for every field an encryption map
 * covers, and `decryptIndexDocForSearch` cannot repair it because `search_text` is on no
 * map (#5625). Token writers call this on the decrypted document so the aggregate is
 * tokenized from the same plaintext a user actually searches for; the copy keeps the
 * caller's stored document untouched.
 */
export function rebuildAggregateSearchField(
  doc: Record<string, unknown>,
  options: AggregateSearchOptions = {},
): Record<string, unknown> {
  return attachAggregateSearchField({ ...doc }, options)
}

export function buildIndexDocument(
  baseRow: Record<string, unknown>,
  customFieldValues: Iterable<IndexCustomFieldValue> = [],
  scope: IndexDocumentScope = {},
  options: AggregateSearchOptions = {},
): Record<string, unknown> {
  const doc: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(baseRow)) {
    doc[key] = value
  }

  const scopeOrg = normalizeScopeValue(scope.organizationId ?? null)
  const scopeTenant = normalizeScopeValue(scope.tenantId ?? null)

  const grouped = new Map<string, unknown[]>()
  for (const field of customFieldValues) {
    const org = normalizeScopeValue(field.organizationId ?? null)
    const tenant = normalizeScopeValue(field.tenantId ?? null)

    if (!isScopedValueVisible(scopeOrg, org)) continue
    if (!isScopedValueVisible(scopeTenant, tenant)) continue

    const bucketKey = `cf:${field.key}`
    let bucket = grouped.get(bucketKey)
    if (!bucket) {
      bucket = []
      grouped.set(bucketKey, bucket)
    }

    const { value } = field
    if (Array.isArray(value)) {
      for (const entry of value) bucket.push(normalizeValue(entry))
    } else {
      bucket.push(normalizeValue(value))
    }
  }

  for (const [key, values] of grouped.entries()) {
    if (values.length === 1) {
      doc[key] = values[0]
    } else if (values.length > 1) {
      doc[key] = values
    }
  }

  return attachAggregateSearchField(doc, options)
}
