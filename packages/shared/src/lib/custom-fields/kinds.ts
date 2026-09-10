/**
 * Custom-field `kind` lookup for the `cf:`/`cf_` keys carried by a query-index document.
 *
 * `decryptCustomFieldValue` cannot recover a value's original JS type from the ciphertext
 * alone: the encrypt path stores a raw string unwrapped and JSON-stringifies everything
 * else, so the string `"123"` and the number `123` produce the same plaintext. The field's
 * `kind` is the only disambiguator, which is why every index-document read path has to
 * resolve it before decrypting (issue #5968).
 */
export type CustomFieldKindMap = Record<string, string | null>

export type CustomFieldKindRow = {
  key: unknown
  kind?: unknown
}

const CF_KEY_PREFIX = /^cf[:_]/

/**
 * Mirrors `HybridQueryEngine.sanitize()`, which aliases the doc key `cf:my-field` as the
 * SQL-safe column alias `cf_my_field`. The transform is lossy, so a map keyed only by the
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

/**
 * Builds a lookup keyed by both the authored field key and its sanitized alias. Authored
 * keys take precedence, so a literal `my_field` definition is never shadowed by the alias
 * a `my-field` definition also sanitizes to.
 */
export function buildCustomFieldKindMap(rows: Iterable<CustomFieldKindRow>): CustomFieldKindMap {
  const map: CustomFieldKindMap = {}
  const aliases: CustomFieldKindMap = {}
  for (const row of rows) {
    const key = normalizeKey(row.key)
    if (!key) continue
    const kind = typeof row.kind === 'string' && row.kind.length ? row.kind : null
    map[key] = kind
    const alias = sanitizeKey(key)
    if (alias !== key && !(alias in aliases)) aliases[alias] = kind
  }
  for (const [alias, kind] of Object.entries(aliases)) {
    if (!(alias in map)) map[alias] = kind
  }
  return map
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
