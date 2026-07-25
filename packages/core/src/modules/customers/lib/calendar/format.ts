const DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

export function formatDateLabel(locale: string, date: Date): string {
  return new Intl.DateTimeFormat(locale, DATE_OPTIONS).format(date)
}

export function formatDateRangeLabel(locale: string, from: Date, to: Date): string {
  const formatter = new Intl.DateTimeFormat(locale, DATE_OPTIONS)
  try {
    return formatter.formatRange(from, to)
  } catch {
    return `${formatter.format(from)} – ${formatter.format(to)}`
  }
}

export function formatTimeRangeLabel(locale: string, start: Date, end: Date): string {
  const formatter = new Intl.DateTimeFormat(locale, TIME_OPTIONS)
  try {
    return formatter.formatRange(start, end)
  } catch {
    return `${formatter.format(start)} – ${formatter.format(end)}`
  }
}
