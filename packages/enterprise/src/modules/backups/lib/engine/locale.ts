import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import es from '../../i18n/es.json'
import ko from '../../i18n/ko.json'
import pl from '../../i18n/pl.json'
export function backupTranslation(key: keyof typeof en): string {
  const locale = (process.env.LC_ALL || process.env.LANG || 'en').slice(0, 2)
  const messages = { en, de, es, ko, pl }[locale as 'en' | 'de' | 'es' | 'ko' | 'pl'] ?? en
  return messages[key] ?? en[key]
}
