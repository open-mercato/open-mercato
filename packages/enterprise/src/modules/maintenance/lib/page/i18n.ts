import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { resolveLocaleFromAcceptLanguage } from '@open-mercato/shared/lib/i18n/locale'
import { getSupportedLocales } from '@open-mercato/shared/lib/i18n/locale-registry'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { defaultLocale, type Locale } from '@open-mercato/shared/lib/i18n/config'

export type MaintenanceTranslate = (key: string, fallback: string, params?: Record<string, string | number>) => string

export type MaintenanceLocaleContext = {
  locale: Locale
  t: MaintenanceTranslate
}

const fallbackTranslate: MaintenanceTranslate = (_key, fallback, params) =>
  params ? fallback.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] !== undefined ? String(params[name]) : match)) : fallback

export function resolveRequestLocale(acceptLanguage: string | null | undefined): Locale {
  let supported: readonly Locale[] = [defaultLocale]
  try {
    supported = getSupportedLocales()
  } catch {
    supported = [defaultLocale]
  }
  return resolveLocaleFromAcceptLanguage(acceptLanguage ?? '', supported) ?? (supported.includes(defaultLocale) ? defaultLocale : supported[0] ?? defaultLocale)
}

/** Never throws: falls back to the inline English strings when dictionaries are unavailable. */
export async function resolveMaintenanceTranslations(acceptLanguage: string | null | undefined): Promise<MaintenanceLocaleContext> {
  const locale = resolveRequestLocale(acceptLanguage)
  try {
    const translate = createTranslator(await loadDictionary(locale))
    return {
      locale,
      t: (key, fallback, params) => {
        const value = params ? translate(key, fallback, params) : translate(key, fallback)
        return value === key ? fallbackTranslate(key, fallback, params) : value
      },
    }
  } catch {
    return { locale, t: fallbackTranslate }
  }
}
