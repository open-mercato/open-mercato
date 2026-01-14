import { I18nProvider } from '@/lib/i18n/context'
import { detectLocale, loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import type { Metadata } from 'next'

// Import INF translations
import en from './i18n/en.json'
import pl from './i18n/pl.json'

const infTranslations: Record<string, Record<string, unknown>> = {
  en,
  pl,
}

// Flatten nested object to dot-notation keys
function flattenDict(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      result[fullKey] = value
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(result, flattenDict(value as Record<string, unknown>, fullKey))
    }
  }
  return result
}

export const metadata: Metadata = {
  title: 'INF Shipping Solutions',
  description: 'Professional shipping and logistics solutions',
  icons: {
    icon: '/fms/inf-logo.svg',
  },
}

export default async function INFLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await detectLocale()
  const baseDict = await loadDictionary(locale)

  // Load INF translations for current locale (fallback to en)
  const infDict = infTranslations[locale] || infTranslations.en || {}
  const flatInfDict = flattenDict(infDict)

  // Merge: INF translations override base translations
  const mergedDict = { ...baseDict, ...flatInfDict }

  return (
    <I18nProvider locale={locale} dict={mergedDict}>
      {children}
    </I18nProvider>
  )
}
