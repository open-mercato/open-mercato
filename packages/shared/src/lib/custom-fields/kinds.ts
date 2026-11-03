/**
 * Custom-field `kind` lookup for the `cf:`/`cf_` keys carried by a query-index document.
 *
 * `decryptCustomFieldValue` cannot recover a value's original JS type from the ciphertext
 * alone: the encrypt path stores a raw string unwrapped and JSON-stringifies everything
 * else, so the string `"123"` and the number `123` produce the same plaintext. The field's
 * `kind` is the only disambiguator, which is why every index-document read path has to
 * resolve it before decrypting (issue #5968).
 *
 * `custom_field_defs` has no unique constraint on `(entity_id, key)` — per-scope overrides
 * are a first-class feature, and an organization's override may declare a different `kind`
 * than the tenant-wide or global definition it shadows. A flat "last row wins" map would
 * therefore type a value from whichever definition the database happened to return last.
 * So the index keeps every candidate definition per key and resolves the winner against the
 * scope of the row being decrypted, through the same `selectDefinitionForRecord` precedence
 * the non-indexed loader in `crud/custom-fields.ts` already applies per record.
 */
import {
  selectDefinitionForRecord,
  sortDefinitionSummaries,
  summarizeDefinitionRow,
  type CustomFieldDefinitionSummary,
} from '../crud/custom-field-definition-index'

export type CustomFieldKindMap = Record<string, string | null>

export type CustomFieldKindRow = {
  key: unknown
  kind?: unknown
  organizationId?: unknown
  tenantId?: unknown
  configJson?: unknown
  updatedAt?: unknown
}

/**
 * Candidate definitions per document key. `keys` holds the authored keys; `aliases` holds
 * the SQL-safe aliases only, and is consulted solely when the document key matches no
 * authored key — so a literal `my_field` definition is never shadowed by the alias a
 * `my-field` definition also sanitizes to.
 */
export type CustomFieldKindIndex = {
  keys: Map<string, CustomFieldDefinitionSummary[]>
  aliases: Map<string, CustomFieldDefinitionSummary[]>
}

/** Resolves the kind map that applies to a row in the given scope. */
export type CustomFieldKindMapResolver = (
  organizationId: string | null | undefined,
  tenantId: string | null | undefined,
) => CustomFieldKindMap

const CF_KEY_PREFIX = /^cf[:_]/

/**
 * Mirrors `HybridQueryEngine.sanitize()`, which aliases the doc key `cf:my-field` as the
 * SQL-safe column alias `cf_my_field`. The transform is lossy, so an index keyed only by the
 * authored key would never match a sanitized alias.
 */
function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_]/g, '_')
}

function normalizeKey(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value == null) return ''
  return String(value).trim()
}

function normalizeScopeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeTimestamp(value: unknown): Date | string | number | null {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') return value
  return null
}

function pushCandidate(
  bucket: Map<string, CustomFieldDefinitionSummary[]>,
  key: string,
  summary: CustomFieldDefinitionSummary,
): void {
  const existing = bucket.get(key)
  if (existing) existing.push(summary)
  else bucket.set(key, [summary])
}

export function buildCustomFieldKindIndex(rows: Iterable<CustomFieldKindRow>): CustomFieldKindIndex {
  const keys = new Map<string, CustomFieldDefinitionSummary[]>()
  const aliases = new Map<string, CustomFieldDefinitionSummary[]>()
  for (const row of rows) {
    const key = normalizeKey(row.key)
    if (!key) continue
    const summary = summarizeDefinitionRow({
      key,
      entityId: '',
      kind: typeof row.kind === 'string' && row.kind.length ? row.kind : null,
      configJson: row.configJson ?? null,
      organizationId: normalizeScopeId(row.organizationId),
      tenantId: normalizeScopeId(row.tenantId),
      deletedAt: null,
      updatedAt: normalizeTimestamp(row.updatedAt),
    })
    if (!summary) continue
    pushCandidate(keys, key, summary)
    const alias = sanitizeKey(key)
    if (alias !== key) pushCandidate(aliases, alias, summary)
  }
  // One precedence rule everywhere: `selectDefinitionForRecord` picks the scope winner and
  // `sortDefinitionSummaries` breaks ties deterministically, for authored keys and aliases
  // alike, so no bucket depends on the order rows arrived in.
  for (const [key, candidates] of keys) keys.set(key, sortDefinitionSummaries(candidates))
  for (const [alias, candidates] of aliases) aliases.set(alias, sortDefinitionSummaries(candidates))
  return { keys, aliases }
}

export function emptyCustomFieldKindIndex(): CustomFieldKindIndex {
  return { keys: new Map(), aliases: new Map() }
}

/**
 * Merges per-source indexes into one, with earlier sources winning a key outright. Callers
 * pass their sources in the same priority order the value itself resolves in, so a key
 * defined by more than one source is typed by the source the value actually came from.
 */
export function mergeCustomFieldKindIndexes(
  indexes: Array<CustomFieldKindIndex | null | undefined>,
): CustomFieldKindIndex {
  const merged = emptyCustomFieldKindIndex()
  for (const index of indexes) {
    if (!index) continue
    for (const [key, candidates] of index.keys) {
      if (!merged.keys.has(key)) merged.keys.set(key, candidates)
    }
    for (const [alias, candidates] of index.aliases) {
      if (!merged.aliases.has(alias)) merged.aliases.set(alias, candidates)
    }
  }
  return merged
}

/**
 * Flattens the index to the kind map that applies to one scope. The winner per key is the
 * organization's own definition, then a tenant-scoped one, then a global one — the order
 * `selectDefinitionForRecord` encodes and the whole codebase resolves definitions by.
 */
export function selectCustomFieldKindMap(
  index: CustomFieldKindIndex | null | undefined,
  organizationId: string | null | undefined,
  tenantId: string | null | undefined,
): CustomFieldKindMap {
  const map: CustomFieldKindMap = {}
  if (!index) return map
  const orgId = organizationId ?? null
  const tenant = tenantId ?? null
  for (const [key, candidates] of index.keys) {
    map[key] = selectDefinitionForRecord(candidates, orgId, tenant)?.kind ?? null
  }
  for (const [alias, candidates] of index.aliases) {
    if (alias in map) continue
    map[alias] = selectDefinitionForRecord(candidates, orgId, tenant)?.kind ?? null
  }
  return map
}

/**
 * Memoizing wrapper for the common read shape: many rows, few distinct scopes. A list query
 * whose rows all share one organization resolves the map once; a global search spanning
 * organizations resolves one map per organization rather than one per row.
 */
export function createCustomFieldKindMapResolver(
  index: CustomFieldKindIndex | null | undefined,
): CustomFieldKindMapResolver {
  const cache = new Map<string, CustomFieldKindMap>()
  return (organizationId, tenantId) => {
    const scopeKey = `${organizationId ?? ''}::${tenantId ?? ''}`
    const cached = cache.get(scopeKey)
    if (cached) return cached
    const map = selectCustomFieldKindMap(index, organizationId, tenantId)
    cache.set(scopeKey, map)
    return map
  }
}

/**
 * Resolves the `kind` for a `cf:`/`cf_`-prefixed index-document key. Returns `null` when the
 * key has no active definition — callers then keep the historical no-`kind` behavior rather
 * than guessing, so an unresolved lookup degrades instead of corrupting the value.
 */
export function resolveCustomFieldKind(
  kinds: CustomFieldKindMap | null | undefined,
  docKey: string,
): string | null {
  if (!kinds) return null
  const bare = docKey.replace(CF_KEY_PREFIX, '')
  if (!bare) return null
  if (bare in kinds) return kinds[bare] ?? null
  const alias = sanitizeKey(bare)
  if (alias !== bare && alias in kinds) return kinds[alias] ?? null
  return null
}
