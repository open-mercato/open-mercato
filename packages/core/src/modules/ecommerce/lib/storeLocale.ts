/**
 * Storefront locale negotiation (SPEC-029 §4.1 step 7, §6.2): `?locale` → `X-Locale` →
 * `Accept-Language` (q-values honored) → `store.defaultLocale`. A candidate is used only when it
 * matches one of `store.supportedLocales`; an unsupported request falls back without failing.
 */

export type StoreLocaleSettings = {
  defaultLocale: string
  supportedLocales: string[]
}

export type StoreLocaleCandidates = {
  queryLocale?: string | null
  headerLocale?: string | null
  acceptLanguage?: string | null
}

export type StoreLocaleResolution = {
  effectiveLocale: string
  requestedLocale: string | null
}

const LOCALE_TAG_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/
const LOCALE_TAG_MAX_LENGTH = 35
const ACCEPT_LANGUAGE_MAX_LENGTH = 1024
const ACCEPT_LANGUAGE_MAX_ENTRIES = 20
const QUALITY_PATTERN = /^q=([01](?:\.\d{0,3})?)$/i

export function sanitizeLocaleTag(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.length || trimmed.length > LOCALE_TAG_MAX_LENGTH) return null
  const normalized = trimmed.replace(/_/g, '-')
  return LOCALE_TAG_PATTERN.test(normalized) ? normalized : null
}

export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (typeof header !== 'string' || !header.trim().length) return []
  const entries = header
    .slice(0, ACCEPT_LANGUAGE_MAX_LENGTH)
    .split(',')
    .slice(0, ACCEPT_LANGUAGE_MAX_ENTRIES)
    .map((part, index) => {
      const [rawTag, ...params] = part.split(';')
      let quality = 1
      for (const param of params) {
        const match = QUALITY_PATTERN.exec(param.trim())
        if (match) quality = Number.parseFloat(match[1])
      }
      return { tag: sanitizeLocaleTag(rawTag), quality, index }
    })
    .filter((entry): entry is { tag: string; quality: number; index: number } => entry.tag !== null && entry.quality > 0)
  entries.sort((left, right) => right.quality - left.quality || left.index - right.index)
  return entries.map((entry) => entry.tag)
}

function baseLanguage(locale: string): string {
  return locale.toLowerCase().split('-')[0]
}

export function matchSupportedLocale(candidate: string, supportedLocales: string[]): string | null {
  const lowered = candidate.toLowerCase()
  const exact = supportedLocales.find((locale) => locale.toLowerCase() === lowered)
  if (exact) return exact
  const base = baseLanguage(candidate)
  const baseExact = supportedLocales.find((locale) => locale.toLowerCase() === base)
  if (baseExact) return baseExact
  return supportedLocales.find((locale) => baseLanguage(locale) === base) ?? null
}

export function resolveStoreLocale(
  store: StoreLocaleSettings,
  candidates: StoreLocaleCandidates,
): StoreLocaleResolution {
  const queryLocale = sanitizeLocaleTag(candidates.queryLocale)
  const headerLocale = sanitizeLocaleTag(candidates.headerLocale)
  const ordered = [
    ...(queryLocale ? [queryLocale] : []),
    ...(headerLocale ? [headerLocale] : []),
    ...parseAcceptLanguage(candidates.acceptLanguage),
  ]
  const requestedLocale = queryLocale ?? headerLocale ?? null
  for (const candidate of ordered) {
    const matched = matchSupportedLocale(candidate, store.supportedLocales)
    if (matched) return { effectiveLocale: matched, requestedLocale }
  }
  return { effectiveLocale: store.defaultLocale, requestedLocale }
}
