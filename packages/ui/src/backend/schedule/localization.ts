import type { Locale } from 'date-fns/locale'
import { enUS } from 'date-fns/locale/en-US'
import { pl } from 'date-fns/locale/pl'
import { de } from 'date-fns/locale/de'
import { es } from 'date-fns/locale/es'
import { ko } from 'date-fns/locale/ko'

export const scheduleLocales: Record<string, Locale> = { en: enUS, 'en-US': enUS, pl, de, es, ko }

export function getScheduleLocale(locale?: string): Locale {
  return scheduleLocales[locale ?? 'en'] ?? scheduleLocales[locale?.split('-')[0] ?? 'en'] ?? enUS
}
