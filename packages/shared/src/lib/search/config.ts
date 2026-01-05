import { z } from 'zod'

const boolean = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .transform((value) => (['1', 'true', 'yes', 'on'].includes(value) ? true : ['0', 'false', 'no', 'off'].includes(value) ? false : null))
  .nullable()
  .default(null)

export type SearchConfig = {
  enabled: boolean
  minTokenLength: number
  enablePartials: boolean
  hashAlgorithm: 'sha256' | 'sha1' | 'md5'
  storeRawTokens: boolean
  blocklistedFields: string[]
}

const DEFAULT_BLOCKLIST = ['password', 'token', 'secret', 'hash']

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback
  const parsed = boolean.parse(raw)
  if (parsed === null) return fallback
  return parsed
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
    minTokenLength: parseNumber(process.env.OM_SEARCH_MIN_LEN, 3, 1),
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
