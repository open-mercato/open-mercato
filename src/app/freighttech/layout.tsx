import { I18nProvider } from '@/lib/i18n/context'
import { detectLocale, loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import type { Metadata } from 'next'

// Import FreightTech translations
import en from './i18n/en.json'

const freightTechTranslations: Record<string, Record<string, unknown>> = {
  en,
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
  title: 'FreightTech',
  description: 'AI-powered freight management system',
  icons: {
    icon: '/fms/freighttech-logo.png',
  },
}

export default async function FreightTechLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await detectLocale()
  const baseDict = await loadDictionary(locale)

  // Load FreightTech translations for current locale (fallback to en)
  const freightTechDict = freightTechTranslations[locale] || freightTechTranslations.en || {}
  const flatFreightTechDict = flattenDict(freightTechDict)

  // Merge: FreightTech translations override base translations
  const mergedDict = { ...baseDict, ...flatFreightTechDict }

  return (
    <I18nProvider locale={locale} dict={mergedDict}>
      {children}
    </I18nProvider>
  )
}
