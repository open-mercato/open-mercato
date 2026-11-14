import type { FirstDayOfWeek, ResolvedDateLocaleSettings } from './types'

/** Used when neither a first day of week nor a formatting locale is configured. */
export const DEFAULT_FIRST_DAY_OF_WEEK: FirstDayOfWeek = 1

export type FirstDayOfWeekSource = 'setting' | 'locale' | 'default'

export type ResolvedFirstDayOfWeek = {
  day: FirstDayOfWeek
  source: FirstDayOfWeekSource
  /** The formatting locale the day was derived from, when `source` is `locale`. */
  locale: string | null
}

type WeekInfo = { firstDay?: number }
type LocaleWithWeekInfo = Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo }

// Fallback for runtimes without `Intl.Locale` week info, keyed by the maximized region (CLDR
// supplemental `weekData` `firstDay`). Every region not listed starts on Monday.
const FRIDAY_FIRST_REGIONS = new Set(['MV'])
const SATURDAY_FIRST_REGIONS = new Set(['AF', 'BH', 'DJ', 'DZ', 'EG', 'IQ', 'IR', 'JO', 'KW', 'LY', 'OM', 'QA', 'SD', 'SY'])
const SUNDAY_FIRST_REGIONS = new Set([
  'AG', 'AS', 'BD', 'BR', 'BS', 'BT', 'BW', 'BZ', 'CA', 'CO', 'DM', 'DO', 'ET', 'GT', 'GU', 'HK', 'HN', 'ID', 'IL', 'IN',
  'IS', 'JM', 'JP', 'KE', 'KH', 'KR', 'LA', 'MH', 'MM', 'MO', 'MT', 'MX', 'MZ', 'NI', 'NP', 'PA', 'PE', 'PH', 'PK', 'PR',
  'PT', 'PY', 'SA', 'SG', 'SV', 'TH', 'TT', 'TW', 'UM', 'US', 'VE', 'VI', 'WS', 'YE', 'ZA', 'ZW',
])

/**
 * The first day of the week a full locale tag uses (`en-GB` → Monday, `en-US` → Sunday), or `null`
 * when the tag cannot be resolved. A bare language tag is maximized first (`en` → `en-US`).
 */
export function firstDayOfWeekForLocale(tag: string | null | undefined): FirstDayOfWeek | null {
  if (!tag) return null
  let locale: LocaleWithWeekInfo
  try {
    locale = new Intl.Locale(tag) as LocaleWithWeekInfo
  } catch {
    return null
  }
  try {
    const info = typeof locale.getWeekInfo === 'function' ? locale.getWeekInfo() : locale.weekInfo
    if (info && typeof info.firstDay === 'number') return (info.firstDay % 7) as FirstDayOfWeek
  } catch {}
  const region = locale.maximize().region
  if (!region) return null
  if (SUNDAY_FIRST_REGIONS.has(region)) return 0
  if (SATURDAY_FIRST_REGIONS.has(region)) return 6
  if (FRIDAY_FIRST_REGIONS.has(region)) return 5
  return 1
}

/**
 * The effective first day of the week: the configured day, otherwise the configured formatting
 * locale's own week start, otherwise Monday. The app language deliberately does not take part —
 * an unconfigured tenant keeps a Monday week whatever language its users read the UI in.
 */
export function resolveFirstDayOfWeek(
  settings: Pick<ResolvedDateLocaleSettings, 'firstDayOfWeek' | 'locale'>,
): ResolvedFirstDayOfWeek {
  if (settings.firstDayOfWeek !== null) return { day: settings.firstDayOfWeek, source: 'setting', locale: null }
  const fromLocale = firstDayOfWeekForLocale(settings.locale)
  if (fromLocale !== null) return { day: fromLocale, source: 'locale', locale: settings.locale }
  return { day: DEFAULT_FIRST_DAY_OF_WEEK, source: 'default', locale: null }
}
