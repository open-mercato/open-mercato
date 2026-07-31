import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'

export type SearchConfig = {
  enabled: boolean
  minTokenLength: number
  enablePartials: boolean
  hashAlgorithm: 'sha256' | 'sha1' | 'md5'
  storeRawTokens: boolean
  blocklistedFields: string[]
  // #4681: optional so the exported shape stays backward compatible — third-party
  // modules that build a SearchConfig literal keep compiling. `resolveSearchConfig`
  // always populates them; consumers normalize a missing value to the default via
  // `resolveTokenCaps`.
  maxFieldChars?: number
  maxTokensPerField?: number
  maxTokensPerRecord?: number
}

export type ResolvedTokenCaps = {
  maxFieldChars: number
  maxTokensPerField: number
  maxTokensPerRecord: number
}

/**
 * Normalize the optional token-cap fields to concrete numbers, applying the
 * module defaults when a caller passed a legacy `SearchConfig` literal without
 * them. A non-positive value means "no cap" and is preserved as `0`.
 */
export function resolveTokenCaps(config: Pick<SearchConfig, 'maxFieldChars' | 'maxTokensPerField' | 'maxTokensPerRecord'>): ResolvedTokenCaps {
  const normalize = (value: number | undefined, fallback: number): number => {
    if (value === undefined) return fallback
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
  }
  return {
    maxFieldChars: normalize(config.maxFieldChars, DEFAULT_SEARCH_MAX_FIELD_CHARS),
    maxTokensPerField: normalize(config.maxTokensPerField, DEFAULT_SEARCH_MAX_TOKENS_PER_FIELD),
    maxTokensPerRecord: normalize(config.maxTokensPerRecord, DEFAULT_SEARCH_MAX_TOKENS_PER_RECORD),
  }
}

export const DEFAULT_SEARCH_MIN_TOKEN_LENGTH = 3
// #4681: caps that bound how many tokens a single record can produce. Without
// them, partial-prefix expansion over a large text field (e.g. a long email
// body) generated 61k+ tokens for one field, feeding the runaway growth of
// search_tokens.
export const DEFAULT_SEARCH_MAX_FIELD_CHARS = 20000
export const DEFAULT_SEARCH_MAX_TOKENS_PER_FIELD = 5000
export const DEFAULT_SEARCH_MAX_TOKENS_PER_RECORD = 20000

const DEFAULT_BLOCKLIST = ['password', 'token', 'secret', 'hash']

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

export function resolveSearchConfig(): SearchConfig {
  return {
    enabled: parseBoolean(process.env.OM_SEARCH_ENABLED, true),
    minTokenLength: resolveSearchMinTokenLength(),
    enablePartials: parseBoolean(process.env.OM_SEARCH_ENABLE_PARTIAL, true),
    hashAlgorithm: parseHashAlgorithm(process.env.OM_SEARCH_HASH_ALGO),
    storeRawTokens: parseBoolean(process.env.OM_SEARCH_STORE_RAW_TOKENS, false),
    blocklistedFields: (process.env.OM_SEARCH_FIELD_BLOCKLIST ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .map((entry) => entry.toLowerCase())
      .concat(DEFAULT_BLOCKLIST)
      .filter((value, index, arr) => arr.indexOf(value) === index),
    maxFieldChars: parseNumber(process.env.OM_SEARCH_MAX_FIELD_CHARS, DEFAULT_SEARCH_MAX_FIELD_CHARS),
    maxTokensPerField: parseNumber(process.env.OM_SEARCH_MAX_TOKENS_PER_FIELD, DEFAULT_SEARCH_MAX_TOKENS_PER_FIELD),
    maxTokensPerRecord: parseNumber(process.env.OM_SEARCH_MAX_TOKENS_PER_RECORD, DEFAULT_SEARCH_MAX_TOKENS_PER_RECORD),
  }
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
