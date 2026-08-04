import { registerAppDictionaryLoader } from '@open-mercato/shared/lib/i18n/server'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { modules as i18nModules } from '@/.mercato/generated/modules.i18n.generated'

registerModules(i18nModules)

registerAppDictionaryLoader(async (locale: Locale): Promise<Record<string, unknown>> => {
  switch (locale) {
    case 'en':
      return import('../../i18n/en.json').then((m) => m.default)
    case 'pl':
      return import('../../i18n/pl.json').then((m) => m.default)
    case 'es':
      return import('../../i18n/es.json').then((m) => m.default)
    case 'de':
      return import('../../i18n/de.json').then((m) => m.default)
    case 'ko':
      return import('../../i18n/ko.json').then((m) => m.default)
    default:
      return import('../../i18n/en.json').then((m) => m.default)
  }
})
