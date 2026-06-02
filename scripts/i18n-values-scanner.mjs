/**
 * Pure helpers for the i18n value-coverage scanner.
 *
 * Compares non-English locale dictionaries against the English baseline and
 * reports the number / share of entries that are still byte-identical — those
 * are almost certainly untranslated.
 *
 * Shared between `i18n-check-values.mjs` and the node:test suite so the
 * "looks-already-translated" heuristic stays unit-testable.
 */

const PROPER_NOUN_HINTS = new Set([
  'OK',
  'API',
  'URL',
  'HTTP',
  'HTTPS',
  'JSON',
  'XML',
  'CSV',
  'PDF',
  'SQL',
  'UUID',
  'JWT',
  'SaaS',
  'AI',
  'CRM',
  'POS',
  'CMS',
  'MFA',
  'SSO',
  'IP',
  'DNS',
  'SSL',
  'TLS',
  'OAuth',
  'WebSocket',
  'GraphQL',
  'WebHook',
])

const ACRONYM_PATTERN = /^[A-Z0-9]{2,6}$/
const SINGLE_TOKEN_PATTERN = /^[A-Za-z][\w-]*$/
const NUMERIC_PATTERN = /^[\d.,\-\s%$€£¥]+$/
const PLACEHOLDER_ONLY_PATTERN = /^\{\{?[^{}]+\}?\}$/
const URL_PATTERN = /^(?:https?:|mailto:|tel:|\/|\.\/|\.\.\/|file:|data:)/

export function isLegitimatelyIdenticalValue(value) {
  if (typeof value !== 'string') return true
  const trimmed = value.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length <= 2) return true
  if (NUMERIC_PATTERN.test(trimmed)) return true
  if (PLACEHOLDER_ONLY_PATTERN.test(trimmed)) return true
  if (URL_PATTERN.test(trimmed)) return true
  if (ACRONYM_PATTERN.test(trimmed)) return true
  if (PROPER_NOUN_HINTS.has(trimmed)) return true
  if (SINGLE_TOKEN_PATTERN.test(trimmed) && trimmed.length <= 4) return true
  return false
}

export function flattenDictionary(source, prefix = '') {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  const result = {}
  for (const [key, value] of Object.entries(source)) {
    if (!key) continue
    const nextKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      result[nextKey] = value
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenDictionary(value, nextKey))
    }
  }
  return result
}

export function compareLocale(enFlat, localeFlat, { allowlist } = {}) {
  const allow = allowlist instanceof Set ? allowlist : new Set(allowlist ?? [])
  let identical = 0
  let identicalSignificant = 0
  let missing = 0
  let translated = 0
  const samples = []

  for (const [key, enValue] of Object.entries(enFlat)) {
    const localeValue = localeFlat[key]
    if (localeValue === undefined) {
      missing += 1
      continue
    }
    if (localeValue === enValue) {
      identical += 1
      if (allow.has(key)) continue
      if (isLegitimatelyIdenticalValue(localeValue)) continue
      identicalSignificant += 1
      if (samples.length < 25) samples.push({ key, value: enValue })
      continue
    }
    translated += 1
  }

  return {
    total: Object.keys(enFlat).length,
    identical,
    identicalSignificant,
    missing,
    translated,
    samples,
  }
}
