export function applyLocalizedContent<T extends Record<string, unknown>>(
  record: T,
  translations: Record<string, Record<string, unknown>> | null | undefined,
  locale: string,
): T & { _locale?: string; _translated?: string[] } {
  if (!translations || !translations[locale]) return record
  const overlay = translations[locale]
  const result = { ...record }
  const translated: string[] = []
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== null && value !== undefined && key in record) {
      ;(result as Record<string, unknown>)[key] = value
      translated.push(key)
    }
  }
  if (translated.length > 0) {
    ;(result as Record<string, unknown>)._locale = locale
    ;(result as Record<string, unknown>)._translated = translated
  }
  return result
}
