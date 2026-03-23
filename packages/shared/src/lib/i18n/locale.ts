import { locales, type Locale } from './config'

function normalizeLocaleToken(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

export function resolveSupportedLocale(value: string | null | undefined): Locale | null {
  if (typeof value !== 'string') return null

  const normalized = normalizeLocaleToken(value)
  if (!normalized) return null

  if (locales.includes(normalized as Locale)) {
    return normalized as Locale
  }

  const baseLocale = normalized.split('-')[0]
  if (baseLocale && locales.includes(baseLocale as Locale)) {
    return baseLocale as Locale
  }

  return null
}

export function resolveLocaleFromCandidates(
  candidates: Iterable<string | null | undefined>,
): Locale | null {
  for (const candidate of candidates) {
    const resolved = resolveSupportedLocale(candidate)
    if (resolved) return resolved
  }
  return null
}

export function resolveLocaleFromAcceptLanguage(
  acceptLanguage: string | null | undefined,
): Locale | null {
  if (typeof acceptLanguage !== 'string' || acceptLanguage.trim().length === 0) {
    return null
  }

  const rankedCandidates = acceptLanguage
    .split(',')
    .map((entry, index) => {
      const [rawLocale, ...rawParams] = entry.split(';')
      const locale = rawLocale?.trim() ?? ''
      const qParam = rawParams.find((param) => param.trim().startsWith('q='))
      const parsedQ = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1
      const quality = Number.isFinite(parsedQ) ? Math.min(Math.max(parsedQ, 0), 1) : 1

      return { locale, quality, index }
    })
    .filter((entry) => entry.locale.length > 0 && entry.quality > 0)
    .sort((left, right) => {
      if (right.quality !== left.quality) {
        return right.quality - left.quality
      }
      return left.index - right.index
    })

  return resolveLocaleFromCandidates(rankedCandidates.map((entry) => entry.locale))
}
