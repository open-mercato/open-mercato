import { displayLocale, type DisplayProfile } from '@open-mercato/shared/lib/display/profile'
import { optionalHour12 } from '@open-mercato/shared/lib/display/datetime'

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

const NON_CANONICAL_INTL_SPACING = /[    ]/g

function normalizeIntlSpacing(value: string): string {
  return value.replace(NON_CANONICAL_INTL_SPACING, ' ')
}

/**
 * The calendar renders date and time FRAGMENTS - a short date with no time, a time with no date -
 * which the display helpers deliberately do not expose. So these stay `Intl` calls, and what the
 * market contributes is the three things that decide how a fragment reads: the language, the hour
 * cycle, and the zone the instant is shown in.
 *
 * `optionalHour12` returns `undefined` without a profile, which leaves the decision to the locale
 * exactly as it is today.
 */
function resolveOptions(
  base: Intl.DateTimeFormatOptions,
  profile: DisplayProfile | null | undefined,
  withTime: boolean,
): Intl.DateTimeFormatOptions {
  const options: Intl.DateTimeFormatOptions = { ...base }
  if (withTime) {
    const hour12 = optionalHour12(profile)
    if (hour12 !== undefined) options.hour12 = hour12
    if (profile?.timeZone) options.timeZone = profile.timeZone
  }
  return options
}

function createFormatter(
  locale: string,
  base: Intl.DateTimeFormatOptions,
  profile: DisplayProfile | null | undefined,
  withTime: boolean,
): Intl.DateTimeFormat {
  const resolvedLocale = displayLocale(profile, locale) ?? locale
  try {
    return new Intl.DateTimeFormat(resolvedLocale, resolveOptions(base, profile, withTime))
  } catch {
    return new Intl.DateTimeFormat(locale, base)
  }
}

export function formatDateLabel(locale: string, date: Date, profile?: DisplayProfile | null): string {
  return createFormatter(locale, DATE_OPTIONS, profile, false).format(date)
}

export function formatDateRangeLabel(
  locale: string,
  from: Date,
  to: Date,
  profile?: DisplayProfile | null,
): string {
  const formatter = createFormatter(locale, DATE_OPTIONS, profile, false)
  try {
    return normalizeIntlSpacing(formatter.formatRange(from, to))
  } catch {
    return normalizeIntlSpacing(`${formatter.format(from)} – ${formatter.format(to)}`)
  }
}

export function formatTimeLabel(locale: string, date: Date, profile?: DisplayProfile | null): string {
  return normalizeIntlSpacing(createFormatter(locale, TIME_OPTIONS, profile, true).format(date))
}

export function formatTimeRangeLabel(
  locale: string,
  start: Date,
  end: Date,
  profile?: DisplayProfile | null,
): string {
  const formatter = createFormatter(locale, TIME_OPTIONS, profile, true)
  try {
    return normalizeIntlSpacing(formatter.formatRange(start, end))
  } catch {
    return normalizeIntlSpacing(`${formatter.format(start)} – ${formatter.format(end)}`)
  }
}
