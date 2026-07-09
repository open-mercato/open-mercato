import { defaultLocale, locales, type Locale } from './config'
import type { Dict } from './context'
import { resolveForcedLocale, resolveLocaleFromAcceptLanguage } from './locale'
import { createFallbackTranslator, createTranslator } from './translate'
import { getModules } from '../modules/registry'
import { loadAppDictionary } from './app-dictionaries'
import { getCachedDictionary, setCachedDictionary } from './dictionary-cache'

// Re-export for backwards compatibility
export { registerModules, getModules } from '../modules/registry'
export { registerAppDictionaryLoader } from './app-dictionaries'
export { invalidateDictionaryCache } from './dictionary-cache'

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

export async function detectLocale(): Promise<Locale> {
  // Ops-level override: pin the whole app to one locale (default: unset).
  const forced = resolveForcedLocale(process.env)
  if (forced) return forced
  // Dynamic import to avoid requiring Next.js in non-Next.js contexts (CLI, tests)
  try {
    const { cookies, headers } = await import('next/headers')
    try {
      const c = (await cookies()).get('locale')?.value
      if (c && locales.includes(c as Locale)) return c as Locale
    } catch {
      // cookies() may not be available outside request context (e.g., in tests)
    }
    try {
      const accept = (await headers()).get('accept-language') || ''
      const match = resolveLocaleFromAcceptLanguage(accept)
      if (match) return match
    } catch {
      // headers() may not be available outside request context (e.g., in tests)
    }
  } catch {
    // next/headers not available (CLI context)
  }
  return defaultLocale
}

export async function loadDictionary(locale: Locale): Promise<Dict> {
  // Locale dictionaries are immutable at runtime, so the flatten+merge below
  // only needs to run once per locale. The cache is invalidated whenever
  // modules or the app dictionary loader are (re)registered.
  const cached = getCachedDictionary(locale)
  if (cached) return cached
  // Load from registry instead of @/ import (works in standalone packages)
  const baseRaw = await loadAppDictionary(locale)
  const merged: Dict = { ...flattenDictionary(baseRaw) }
  const modules = getModules()
  for (const m of modules) {
    let dict = m.translations?.[locale]
    if (!dict) {
      const loader = m.translationsLoaders?.[locale]
      if (loader) {
        try {
          dict = await loader()
          // Hydrate so later sync reads (and repeat loads) see the resolved
          // dictionary without re-importing the locale bundle.
          if (dict) m.translations = { ...(m.translations ?? {}), [locale]: dict }
        } catch (err) {
          console.warn(`[i18n] failed to load '${locale}' translations for module '${m.id}'`, err)
        }
      }
    }
    if (dict) Object.assign(merged, flattenDictionary(dict))
  }
  setCachedDictionary(locale, merged)
  return merged
}

export async function resolveTranslations() {
  const locale = await detectLocale()
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
