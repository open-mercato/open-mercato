import { getTranslatableFields, isSafeTranslationField } from './translatable-fields'

export function applyLocalizedContent<T extends Record<string, unknown>>(
  record: T,
  translations: Record<string, Record<string, unknown>> | null | undefined,
  locale: string,
  entityType?: string,
  allowedFields?: ReadonlySet<string>,
): T & { _locale?: string; _translated?: string[] } {
  const overlay = translations && Object.hasOwn(translations, locale) ? translations[locale] : undefined
  const fields = entityType ? getTranslatableFields(entityType) : undefined
  if (!overlay || !fields?.length) return record

  const result: Record<string, unknown> = { ...record }
  const translated: string[] = []
  for (const [key, value] of Object.entries(overlay)) {
    if (!fields.includes(key) || (allowedFields && !allowedFields.has(key))) continue
    if (!isSafeTranslationField(key) || !Object.hasOwn(record, key)) continue
    const baseValue = record[key]
    if (typeof value === 'string' && (typeof baseValue === 'string' || baseValue === null)) {
      result[key] = value
      translated.push(key)
    }
  }
  if (translated.length === 0) return record
  return { ...result, _locale: locale, _translated: translated } as T & { _locale: string; _translated: string[] }
}
