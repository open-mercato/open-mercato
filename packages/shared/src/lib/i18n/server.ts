import { cookies, headers } from 'next/headers'
import { defaultLocale, locales, type Locale } from './config'
import type { Dict } from './context'
import { modules } from '@/generated/modules.generated'
import { createFallbackTranslator, createTranslator } from './translate'

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
  const c = (await cookies()).get('locale')?.value
  if (c && locales.includes(c as Locale)) return c as Locale
  const accept = (await headers()).get('accept-language') || ''
  const match = locales.find(l => new RegExp(`(^|,)\s*${l}(-|;|,|$)`, 'i').test(accept))
  return match ?? defaultLocale
}

export async function loadDictionary(locale: Locale): Promise<Dict> {
  const baseRaw = await import(`@/i18n/${locale}.json`).then(m => m.default).catch(() => ({} as Record<string, unknown>))
  const merged: Dict = { ...flattenDictionary(baseRaw) }
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
import 'server-only'
