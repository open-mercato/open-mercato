export function formatDate(iso: string, locale: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}
