import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export type SearchConfig = {
  enabled: boolean
  minTokenLength: number
  enablePartials: boolean
  hashAlgorithm: 'sha256' | 'sha1' | 'md5'
  storeRawTokens: boolean
  blocklistedFields: string[]
}

export const DEFAULT_SEARCH_MIN_TOKEN_LENGTH = 3

const DEFAULT_BLOCKLIST = ['password', 'token', 'secret', 'hash']

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  return parseBooleanWithDefault(raw, fallback)
}

function parseNumber(raw: string | undefined, fallback: number, min = 1): number {
  if (raw == null) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value)) return fallback
  if (value < min) return fallback
  return value
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
