import { cookies, headers } from 'next/headers'
import { defaultLocale, locales, type Locale } from './config'
import type { Dict } from './context'
import { modules } from '@/generated/modules.generated'

export async function detectLocale(): Promise<Locale> {
  const c = (await cookies()).get('locale')?.value
  if (c && locales.includes(c as Locale)) return c as Locale
  const accept = (await headers()).get('accept-language') || ''
  const match = locales.find(l => new RegExp(`(^|,)\s*${l}(-|;|,|$)`, 'i').test(accept))
  return match ?? defaultLocale
}

export async function loadDictionary(locale: Locale): Promise<Dict> {
  const base = await import(`@/i18n/${locale}.json`).then(m => m.default).catch(() => ({} as Record<string,string>))
  const merged: Record<string, string> = { ...base }
  for (const m of modules) {
    const dict = m.translations?.[locale]
    if (dict) Object.assign(merged, dict)
  }
  return merged
}
