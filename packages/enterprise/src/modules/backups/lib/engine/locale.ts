import { readFileSync } from 'node:fs'
import type en from '../../i18n/en.json'
const cache = new Map<string, Record<string, string>>()
export function backupTranslation(key: keyof typeof en): string {
  const requested = (process.env.LC_ALL || process.env.LANG || 'en').slice(0, 2)
  const locale = ['en', 'de', 'es', 'ko', 'pl'].includes(requested) ? requested : 'en'
  let messages = cache.get(locale)
  if (!messages) {
    const content: unknown = JSON.parse(readFileSync(new URL(`../../i18n/${locale}.json`, import.meta.url), 'utf8'))
    if (!content || typeof content !== 'object' || Object.values(content).some((value) => typeof value !== 'string')) throw new Error('[internal] BACKUP_LOCALE_INVALID')
    messages = content as Record<string, string>
    cache.set(locale, messages)
  }
  return messages[key] ?? key
}
