import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'

export type SearchConfig = {
  enabled: boolean
  minTokenLength: number
  enablePartials: boolean
  hashAlgorithm: 'sha256' | 'sha1' | 'md5'
  storeRawTokens: boolean
  /**
   * When true, a like/ilike on a PLAINTEXT base column runs as exact SQL ILIKE instead of being
   * rewritten into an approximate search-token match; encrypted columns always keep the token
   * path (ILIKE against ciphertext cannot match). Off by default: token matching can be faster
   * than an unanchored ILIKE, which may need a full scan without a trigram index — but it is
   * approximate (fragments under minTokenLength vanish, so `ZK 1/2026` degrades to its year and
   * an all-short term drops the predicate). Flip it on when list search must be exact.
   */
  useIlikeForNonEncryptedFields?: boolean
  blocklistedFields: string[]
  entityBlocklistedFields?: Record<string, string[]>
  maxFieldChars?: number
  maxTokensPerField?: number
  maxTokensPerRecord?: number
}

export const DEFAULT_SEARCH_MIN_TOKEN_LENGTH = 3
export const DEFAULT_SEARCH_MAX_FIELD_CHARS = 20_000
export const DEFAULT_SEARCH_MAX_TOKENS_PER_FIELD = 5_000
export const DEFAULT_SEARCH_MAX_TOKENS_PER_RECORD = 20_000

export type SearchTokenLimits = {
  maxFieldChars: number
  maxTokensPerField: number
  maxTokensPerRecord: number
}

const DEFAULT_BLOCKLIST = ['password', 'token', 'secret', 'hash']

const ENTITY_BLOCKLIST_SEPARATOR = '@'

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  return parseBooleanWithDefault(raw, fallback)
}

function parseNumber(raw: string | undefined, fallback: number, min = 1): number {
  return parseNumberWithDefault(raw, fallback, { integer: true, min })
}

export function resolveSearchTokenLimits(config: SearchConfig): SearchTokenLimits {
  const resolveLimit = (value: number | undefined, fallback: number): number => {
    if (value === undefined) return fallback
    if (!Number.isFinite(value) || value < 0) return fallback
    return Math.trunc(value)
  }
  return {
    maxFieldChars: resolveLimit(config.maxFieldChars, DEFAULT_SEARCH_MAX_FIELD_CHARS),
    maxTokensPerField: resolveLimit(config.maxTokensPerField, DEFAULT_SEARCH_MAX_TOKENS_PER_FIELD),
    maxTokensPerRecord: resolveLimit(config.maxTokensPerRecord, DEFAULT_SEARCH_MAX_TOKENS_PER_RECORD),
  }
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
    useIlikeForNonEncryptedFields: parseBoolean(process.env.OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS, false),
    blocklistedFields: blocklist.global,
    entityBlocklistedFields: blocklist.byEntity,
    maxFieldChars: parseNumber(process.env.OM_SEARCH_MAX_FIELD_CHARS, DEFAULT_SEARCH_MAX_FIELD_CHARS, 0),
    maxTokensPerField: parseNumber(process.env.OM_SEARCH_MAX_TOKENS_PER_FIELD, DEFAULT_SEARCH_MAX_TOKENS_PER_FIELD, 0),
    maxTokensPerRecord: parseNumber(process.env.OM_SEARCH_MAX_TOKENS_PER_RECORD, DEFAULT_SEARCH_MAX_TOKENS_PER_RECORD, 0),
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

/**
 * Removes blocklisted fields from an index document before it is stored.
 *
 * Why: `isSearchFieldBlocklisted` governs what is TOKENISED — the per-field
 * token path and the `search_text` aggregate (#4624). Neither of them touches
 * the document itself, and both `buildIndexDocument()` and `buildIndexDoc()`
 * copy every base column into it verbatim, so a blocklisted column is still
 * stored in `entity_indexes.doc` in full. For the default blocklist that means
 * `doc->>'password_hash'` is the bcrypt verifier and `doc->>'token'` is the
 * session token, projected into a table whose access controls are not the ones
 * the source table was given. `packages/search`'s fallback presenter iterates
 * the document and returns the first short string it finds, so for an entity
 * with no display field a credential can even reach a search result's title.
 *
 * How to apply: call once on the base row, before custom fields and
 * translations are merged in and before `encryptIndexDocForStorage()` runs.
 * Reads back are unaffected — the query engine selects a base column from the
 * base table (`applySelection` guards on `columns.has(field)`) and only reaches
 * `doc ->> field` when `resolveBaseColumn()` returns null, which a base column
 * never does.
 *
 * Two properties are load-bearing:
 *
 *  - Only the GLOBAL blocklist applies, hence the `null` entity type. The
 *    per-entity entries (`customers:customer_interaction@body`) exist to keep a
 *    large free-text column out of the token index, not to mark it secret, and
 *    that same column is read out of `doc` by a presenter — `customers`'
 *    `formatResult` builds an interaction's subtitle from `record.body`. Honouring
 *    them here would blank that subtitle in global search for the exact recipe
 *    this file documents.
 *  - `cf:` and `l10n:` keys are kept. A base column is re-read from the base
 *    table on every query, so dropping it from the document costs nothing;
 *    custom fields and translations are the opposite — the document is their only
 *    store, and the engine reads them straight back out of it. They are excluded
 *    from `search_text` and from `search_tokens` either way, which is the
 *    exposure that matters. The call sites strip before merging those keys in, so
 *    this guard is what keeps that ordering from being load-bearing.
 */
export function stripBlocklistedDocFields(
  doc: Record<string, unknown>,
  config: SearchConfig = resolveSearchConfig(),
): Record<string, unknown> {
  for (const key of Object.keys(doc)) {
    if (key.startsWith('cf:') || key.startsWith('l10n:')) continue
    if (isSearchFieldBlocklisted(key, null, config)) delete doc[key]
  }
  return doc
}
