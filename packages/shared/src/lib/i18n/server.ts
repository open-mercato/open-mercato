import { defaultLocale, locales, type Locale } from './config'
import type { Dict } from './context'
import { createFallbackTranslator, createTranslator } from './translate'
import { getModules } from '../modules/registry'
import { loadAppDictionary } from './app-dictionaries'

// Re-export for backwards compatibility
export { registerModules, getModules } from '../modules/registry'
export { registerAppDictionaryLoader } from './app-dictionaries'

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
      const match = locales.find(l => new RegExp(`(^|,)\\s*${l}(-|;|,|$)`, 'i').test(accept))
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
  // Load from registry instead of @/ import (works in standalone packages)
  const baseRaw = await loadAppDictionary(locale)
  const merged: Dict = { ...flattenDictionary(baseRaw) }
  const modules = getModules()
  for (const m of modules) {
    const dict = m.translations?.[locale]
    if (dict) Object.assign(merged, flattenDictionary(dict))
  }
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
