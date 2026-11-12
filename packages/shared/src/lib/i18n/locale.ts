import type { Locale } from './config'
import { getSupportedLocales } from './locale-set'

function normalizeLocaleToken(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

/**
 * Canonicalize a user-supplied locale token against the set of locales that may
 * be served, folding a region subtag down to its base language (`de-AT` → `de`).
 *
 * `supported` defaults to the process-wide set. Pass the request's served set —
 * from `resolveSupportedLocalesForRequest()` — anywhere the answer is written
 * somewhere durable, such as the `locale` cookie: the process-wide set is wider
 * than a tenant's selection, so validating against it would accept a locale that
 * every later render then discards, and report success while nothing changes.
 */
export function resolveSupportedLocale(
  value: string | null | undefined,
  supported: readonly Locale[] = getSupportedLocales(),
): Locale | null {
  if (typeof value !== 'string') return null

  const normalized = normalizeLocaleToken(value)
  if (!normalized) return null

  if (supported.includes(normalized as Locale)) {
    return normalized as Locale
  }

  const baseLocale = normalized.split('-')[0]
  if (baseLocale && supported.includes(baseLocale as Locale)) {
    return baseLocale as Locale
  }

  return null
}

export function resolveLocaleFromCandidates(
  candidates: Iterable<string | null | undefined>,
  supported?: readonly Locale[],
): Locale | null {
  for (const candidate of candidates) {
    const resolved = resolveSupportedLocale(candidate, supported)
    if (resolved) return resolved
  }
  return null
}

/**
 * Reads the optional `OM_FORCE_LOCALE` env override. When set to a supported
 * locale (e.g. `pl`), the whole app is pinned to it and cookie/Accept-Language
 * detection is bypassed. Unset (the default) → `null` → normal detection.
 * Pure: pass the env bag so it stays testable and safe to call server-side only.
 */
export function resolveForcedLocale(
  env: Record<string, string | undefined>,
): Locale | null {
  return resolveSupportedLocale(env.OM_FORCE_LOCALE)
}

export function resolveLocaleFromAcceptLanguage(
  acceptLanguage: string | null | undefined,
  supported?: readonly Locale[],
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

  return resolveLocaleFromCandidates(rankedCandidates.map((entry) => entry.locale), supported)
}
