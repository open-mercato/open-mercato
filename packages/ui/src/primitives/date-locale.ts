"use client"

import { useOptionalLocale } from '@open-mercato/shared/lib/i18n/context'
import type { Locale as DateFnsLocale } from 'date-fns/locale'
import { resolveDateFnsLocale } from './date-fns-locales'

export { resolveDateFnsLocale }

export type TimeDisplayFormat = '12h' | '24h'

/** The date-fns locale for the active `I18nProvider` locale, or `undefined` outside a provider. */
export function useDateFnsLocale(): DateFnsLocale | undefined {
  return resolveDateFnsLocale(useOptionalLocale())
}

/**
 * Whether a locale writes the time of day on a 12- or 24-hour clock.
 *
 * Asked of `Intl` rather than a "not English means 24h" heuristic, because that heuristic is
 * wrong for two of the five locales this repo ships: Korean is a 12-hour locale (오전/오후), as
 * is English, while Polish, German and Spanish are not. `12h` is the fallback when `Intl` cannot
 * answer, matching the `TimePicker` primitive's own default.
 */
// Constructing an `Intl.DateTimeFormat` costs ~40x using one, and this runs on every render of
// every time picker — so the answer is kept per locale, exactly as `date-format.ts` caches its
// formatters. The key space is the locales a deployment ships and the answer never changes.
const timeFormatCache = new Map<string, TimeDisplayFormat>()

export function deriveTimeDisplayFormat(locale?: string | null): TimeDisplayFormat {
  if (!locale) return '12h'
  const cached = timeFormatCache.get(locale)
  if (cached) return cached
  let resolved: TimeDisplayFormat = '12h'
  try {
    if (new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 === false) {
      resolved = '24h'
    }
  } catch {
    resolved = '12h'
  }
  timeFormatCache.set(locale, resolved)
  return resolved
}

/** The clock convention of the active `I18nProvider` locale; `12h` outside a provider. */
export function useTimeDisplayFormat(): TimeDisplayFormat {
  return deriveTimeDisplayFormat(useOptionalLocale())
}
