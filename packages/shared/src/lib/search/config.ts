import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'

export type SearchConfig = {
  enabled: boolean
  minTokenLength: number
  enablePartials: boolean
  hashAlgorithm: 'sha256' | 'sha1' | 'md5'
  storeRawTokens: boolean
  blocklistedFields: string[]
  entityBlocklistedFields?: Record<string, string[]>
}

export const DEFAULT_SEARCH_MIN_TOKEN_LENGTH = 3

const DEFAULT_BLOCKLIST = ['password', 'token', 'secret', 'hash']

const ENTITY_BLOCKLIST_SEPARATOR = '@'

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  return parseBooleanWithDefault(raw, fallback)
}

function parseNumber(raw: string | undefined, fallback: number, min = 1): number {
  return parseNumberWithDefault(raw, fallback, { integer: true, min })
}

function parseHashAlgorithm(raw: string | undefined): 'sha256' | 'sha1' | 'md5' {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'sha1') return 'sha1'
  if (value === 'md5') return 'md5'
  return 'sha256'
}

/**
 * Parses `OM_SEARCH_FIELD_BLOCKLIST` into a global list plus per-entity-type lists.
 *
 * Why: a deployment often needs to keep one large free-text column out of the token
 * index (e-mail bodies on `customers:customer_interaction`) while still indexing the
 * same-named column elsewhere. A flat global list cannot express that.
 *
 * How to apply: entries are comma-separated; an entry may carry an optional
 * `entityType@` prefix — `body` blocks the field everywhere, while
 * `customers:customer_interaction@body` blocks it only for that entity type. Entries
 * whose field part is empty are ignored so malformed env input cannot break indexing.
 */
function parseFieldBlocklist(raw: string | undefined): {
  global: string[]
  byEntity: Record<string, string[]>
} {
  const global: string[] = []
  const byEntity = new Map<string, string[]>()

  for (const rawEntry of parseCommaSeparatedList(raw)) {
    const entry = rawEntry.toLowerCase()
    const separatorIndex = entry.indexOf(ENTITY_BLOCKLIST_SEPARATOR)
    const entityType = separatorIndex >= 0 ? entry.slice(0, separatorIndex).trim() : ''
    const field = separatorIndex >= 0 ? entry.slice(separatorIndex + 1).trim() : entry
    if (!field.length) continue

    if (!entityType.length) {
      if (!global.includes(field)) global.push(field)
      continue
    }

    const scoped = byEntity.get(entityType) ?? []
    if (!scoped.includes(field)) scoped.push(field)
    byEntity.set(entityType, scoped)
  }

  for (const fallback of DEFAULT_BLOCKLIST) {
    if (!global.includes(fallback)) global.push(fallback)
  }

  const scopedBlocklist = Object.create(null) as Record<string, string[]>
  for (const [entityType, fields] of byEntity) scopedBlocklist[entityType] = fields

  return { global, byEntity: scopedBlocklist }
}

export function resolveSearchConfig(): SearchConfig {
  const blocklist = parseFieldBlocklist(process.env.OM_SEARCH_FIELD_BLOCKLIST)
  return {
    enabled: parseBoolean(process.env.OM_SEARCH_ENABLED, true),
    minTokenLength: resolveSearchMinTokenLength(),
    enablePartials: parseBoolean(process.env.OM_SEARCH_ENABLE_PARTIAL, true),
    hashAlgorithm: parseHashAlgorithm(process.env.OM_SEARCH_HASH_ALGO),
    storeRawTokens: parseBoolean(process.env.OM_SEARCH_STORE_RAW_TOKENS, false),
    blocklistedFields: blocklist.global,
    entityBlocklistedFields: blocklist.byEntity,
  }
}

/**
 * Single matcher for "should this field be kept out of the search index?".
 *
 * Why: the per-field token path and the `search_text` aggregate previously each
 * decided this on their own, and the aggregate simply never consulted the config —
 * so a blocklisted column's text came back into the index under the aggregate's
 * field name (#4624). Both paths now share this function so they cannot drift.
 *
 * How to apply: pass the document's field name and the entity type being indexed;
 * `entityType` may be omitted when unknown, in which case only global entries apply.
 * Matching keeps the historical substring semantics (`fieldName.includes(pattern)`).
 */
export function isSearchFieldBlocklisted(
  field: string,
  entityType: string | null | undefined,
  config: SearchConfig,
): boolean {
  const lower = field.toLowerCase()
  if (config.blocklistedFields.some((blocked) => lower.includes(blocked))) return true
  if (!entityType) return false
  const scoped = config.entityBlocklistedFields?.[entityType.trim().toLowerCase()]
  if (!Array.isArray(scoped) || !scoped.length) return false
  return scoped.some((blocked) => lower.includes(blocked))
}

/**
 * Browser-safe accessor for the minimum search token length.
 *
 * Why: client components (e.g. global search dialog) must mirror the server-side
 * tokenizer's `minTokenLength` so the UI gates the request before hitting an
 * empty result set. Pulling the value through this single helper keeps the env
 * contract (`OM_SEARCH_MIN_LEN`) authoritative on both sides.
 *
 * How to apply: call from anywhere — server, client (when the host app exposes
 * `OM_SEARCH_MIN_LEN` through `next.config.ts`'s `env` block), or tests.
 */
export function resolveSearchMinTokenLength(): number {
  return parseNumber(process.env.OM_SEARCH_MIN_LEN, DEFAULT_SEARCH_MIN_TOKEN_LENGTH, 1)
}
