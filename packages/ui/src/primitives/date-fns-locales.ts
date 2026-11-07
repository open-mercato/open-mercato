import type { Locale as DateFnsLocale } from 'date-fns/locale'
import { de } from 'date-fns/locale/de'
import { enUS } from 'date-fns/locale/en-US'
import { es } from 'date-fns/locale/es'
import { ko } from 'date-fns/locale/ko'
import { pl } from 'date-fns/locale/pl'

/**
 * The app locale is a bare language code (`'pl'`), but `react-day-picker` and every
 * date-fns formatter want a `Locale` object — the thing that knows month names and,
 * critically, `weekStartsOn`. Without one the picker falls back to the bundled `enUS`:
 * English month/weekday names and a Sunday-first week for every tenant.
 *
 * The five entries mirror `locales` in `@open-mercato/shared/lib/i18n/config`. They are
 * imported statically rather than loaded on demand because a picker renders its calendar
 * synchronously — an async locale would flash an English month header first.
 */
const DATE_FNS_LOCALES: Record<string, DateFnsLocale> = {
  de,
  en: enUS,
  es,
  ko,
  pl,
}

/**
 * The date-fns locale for an app locale code, or `undefined` when there is none to apply.
 *
 * `undefined` rather than `enUS` for an unknown code: the consumers pass this straight into
 * a `locale?: Locale` prop, and leaving it unset keeps their own documented default instead
 * of pinning English on a deployment that added a locale this map has not caught up with.
 */
export function resolveDateFnsLocale(locale?: string | null): DateFnsLocale | undefined {
  const code = locale?.split('-')[0]?.toLowerCase()
  return code ? DATE_FNS_LOCALES[code] : undefined
}
