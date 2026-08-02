const DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

const NON_CANONICAL_INTL_SPACING = /[\u00a0\u2007\u2009\u202f]/g

function normalizeIntlSpacing(value: string): string {
  return value.replace(NON_CANONICAL_INTL_SPACING, ' ')
}

export function formatDateLabel(locale: string, date: Date): string {
  return new Intl.DateTimeFormat(locale, DATE_OPTIONS).format(date)
}

export function formatDateRangeLabel(locale: string, from: Date, to: Date): string {
  const formatter = new Intl.DateTimeFormat(locale, DATE_OPTIONS)
  try {
    return normalizeIntlSpacing(formatter.formatRange(from, to))
  } catch {
    return normalizeIntlSpacing(`${formatter.format(from)} – ${formatter.format(to)}`)
  }
}

export function formatTimeRangeLabel(locale: string, start: Date, end: Date): string {
  const formatter = new Intl.DateTimeFormat(locale, TIME_OPTIONS)
  try {
    return normalizeIntlSpacing(formatter.formatRange(start, end))
  } catch {
    return normalizeIntlSpacing(`${formatter.format(start)} – ${formatter.format(end)}`)
  }
}
