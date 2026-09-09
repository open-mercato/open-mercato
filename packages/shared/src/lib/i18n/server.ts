import { defaultLocale, locales, type Locale } from './config'
import type { Dict } from './context'
import { resolveForcedLocale, resolveLocaleFromAcceptLanguage } from './locale'
import { createFallbackTranslator, createTranslator } from './translate'
import { tryGetModules } from '../modules/registry'
import { loadAppDictionary } from './app-dictionaries'
import { getCachedDictionary, setCachedDictionary } from './dictionary-cache'
import { getSupportedLocales, resolveSupportedLocalesForRequest } from './locale-registry'

// Re-export for backwards compatibility
export { registerModules, getModules } from '../modules/registry'
export { registerAppDictionaryLoader } from './app-dictionaries'
export { invalidateDictionaryCache } from './dictionary-cache'
export {
  registerLocales,
  getSupportedLocales,
  registerSupportedLocalesResolver,
  resolveSupportedLocalesForRequest,
} from './locale-registry'

function flattenDictionary(source: unknown, prefix = ''): Dict {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  const result: Dict = {}
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
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

export type DetectLocaleOptions = {
  /**
   * Restrict detection to this set — typically the current tenant's selection,
   * resolved by the caller via `resolveSupportedLocalesForRequest()`. Omitted,
   * detection uses the process-wide supported set, which is the prior behaviour.
   */
  supportedLocales?: readonly Locale[]
}

export async function detectLocale(options?: DetectLocaleOptions): Promise<Locale> {
  // Ops-level override: pin the whole app to one locale (default: unset).
  const forced = resolveForcedLocale(process.env)
  if (forced) return forced
  const supported = options?.supportedLocales ?? getSupportedLocales()
  // Dynamic import to avoid requiring Next.js in non-Next.js contexts (CLI, tests)
  try {
    const { cookies, headers } = await import('next/headers')
    try {
      const c = (await cookies()).get('locale')?.value
      if (c && supported.includes(c as Locale)) return c as Locale
    } catch {
      // cookies() may not be available outside request context (e.g., in tests)
    }
    try {
      const accept = (await headers()).get('accept-language') || ''
      const match = resolveLocaleFromAcceptLanguage(accept)
      // `resolveLocaleFromAcceptLanguage` matches against the process-wide set,
      // so a tenant-narrowed set has to be re-checked here.
      if (match && supported.includes(match)) return match
    } catch {
      // headers() may not be available outside request context (e.g., in tests)
    }
  } catch {
    // next/headers not available (CLI context)
  }
  // The caller may have narrowed the set past the default locale, and returning
  // a locale outside the served set would render a page whose own language
  // switcher does not offer the language it is written in.
  // `resolveSupportedLocalesForRequest` keeps `defaultLocale` in the set for
  // exactly this reason; the `supported[0]` arm covers a caller that narrowed by
  // hand and did not.
  if (supported.includes(defaultLocale)) return defaultLocale
  return supported[0] ?? defaultLocale
}

export async function loadDictionary(locale: Locale): Promise<Dict> {
  // Locale dictionaries are immutable at runtime, so the flatten+merge below
  // only needs to run once per locale. The cache is invalidated whenever
  // modules or the app dictionary loader are (re)registered.
  const cached = getCachedDictionary(locale)
  if (cached) return cached
  // A locale the platform does not ship has no dictionaries of its own yet, and
  // roughly a quarter of `t()` call sites pass no inline fallback — without a
  // base layer those render as raw keys. Layering the default locale underneath
  // makes an app- or operator-added locale degrade to English instead, which is
  // what every comparable platform does. Shipped locales skip this entirely and
  // keep their previous merge semantics byte for byte.
  const needsDefaultLocaleBase =
    locale !== defaultLocale && !(locales as readonly string[]).includes(locale)
  const merged: Dict = needsDefaultLocaleBase ? { ...(await loadDictionary(defaultLocale)) } : {}
  // Load from registry instead of @/ import (works in standalone packages)
  const baseRaw = await loadAppDictionary(locale)
  Object.assign(merged, flattenDictionary(baseRaw))
  // Route handlers translate their responses, so they resolve a dictionary even
  // when they are exercised in isolation without a bootstrapped registry. The
  // app dictionary alone is the right degraded answer there — `registerModules`
  // invalidates this cache, so a later bootstrap still gets the merged result.
  const modules = tryGetModules() ?? []
  for (const m of modules) {
    const dict = m.translations?.[locale]
    if (dict) Object.assign(merged, flattenDictionary(dict))
  }
  setCachedDictionary(locale, merged)
  return merged
}

/**
 * Detect the locale and load its dictionary in one step.
 *
 * `options` is forwarded to `detectLocale`, so a caller that has already
 * resolved the request's served set (a layout mounting its own `I18nProvider`)
 * detects against that set instead of the process-wide one. Omitted — which is
 * every route handler — behaviour is unchanged and no tenant lookup is made.
 */
export async function resolveTranslations(options?: DetectLocaleOptions) {
  const locale = await detectLocale(options)
  const dict = await loadDictionary(locale)
  const t = createTranslator(dict)
  const translate = createFallbackTranslator(dict)
  return { locale, dict, t, translate }
}
// Hint Next.js to keep this server-only; ignore if unavailable when running scripts outside Next.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('server-only')
} catch {
  // noop: allows running generator scripts without Next's server-only package
}
