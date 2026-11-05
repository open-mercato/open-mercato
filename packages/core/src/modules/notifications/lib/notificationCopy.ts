import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { defaultLocale, type Locale } from '@open-mercato/shared/lib/i18n/config'

/**
 * Localizable notification copy: i18n keys + variables, with already-resolved (or raw) strings as
 * the fallback when a key is absent or has no translation. Structurally satisfied by a `Notification`
 * row (in-app/email delivery) and built ad hoc by the push fan-out (per-device delivery).
 */
export type NotificationCopySource = {
  titleKey?: string | null
  bodyKey?: string | null
  titleVariables?: Record<string, string> | null
  bodyVariables?: Record<string, string> | null
  title: string
  body?: string | null
}

/**
 * Resolve a notification's title/body in a given locale. Dictionaries are memoized by
 * {@link loadDictionary}, so repeated calls per locale are cheap. Also returns the translator so
 * callers can localize sibling strings (email chrome, action labels) without reloading the dictionary.
 */
export async function resolveNotificationCopy(source: NotificationCopySource, locale: Locale = defaultLocale) {
  const dictionary = await loadDictionary(locale)
  const t = createFallbackTranslator(dictionary)
  const title = source.titleKey
    ? t(source.titleKey, source.title ?? source.titleKey, source.titleVariables ?? undefined)
    : source.title
  const body = source.bodyKey
    ? t(source.bodyKey, source.body ?? source.bodyKey ?? '', source.bodyVariables ?? undefined)
    : source.body ?? null
  return { title, body, t }
}
