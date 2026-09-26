import { registerAppDictionaryLoader } from '@open-mercato/shared/lib/i18n/server'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { registerLocales, restrictServedLocales } from '@open-mercato/shared/lib/i18n/locale-registry'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import { loadI18nModules } from '@/.mercato/generated/modules.i18n.loaders.generated'

// This app ships dictionaries for English and Arabic only.
//
// `registerLocales` declares a locale the app can render — declaration merging
// below is the compile-time half documented in
// `@open-mercato/shared/lib/i18n/config`, and `registerLocales` is the runtime
// authority. `restrictServedLocales` then narrows what the app *offers*: the
// platform also ships Polish, Spanish, German and Korean, and serving them here
// would put a language in the switcher whose strings fall back to English for
// every module that has no dictionary for it.
//
// Adding a language later means dropping its `<code>.json` into `src/i18n` and
// naming it in both calls — the dictionary loader below must gain a matching case.
declare module '@open-mercato/shared/lib/i18n/config' {
  interface LocaleRegistry {
    ar: true
  }
}

registerLocales(['ar'])
restrictServedLocales(['en', 'ar'])

function registerLoadedLocaleModules(
  localeModules: Module[],
  registrar: typeof registerModules = registerModules,
): void {
  if (localeModules.length > 0) registrar(localeModules)
}

async function loadAppDictionary(locale: Locale): Promise<Record<string, unknown>> {
  switch (locale) {
    case 'ar':
      return import('../../i18n/ar.json').then((module) => module.default)
    default:
      return import('../../i18n/en.json').then((module) => module.default)
  }
}

type DictionaryLoaderDependencies = {
  loadLocaleModules?: typeof loadI18nModules
  loadBaseDictionary?: typeof loadAppDictionary
  registerLocaleModules?: typeof registerModules
}

export function createAppDictionaryLoader({
  loadLocaleModules = loadI18nModules,
  loadBaseDictionary = loadAppDictionary,
  registerLocaleModules = registerModules,
}: DictionaryLoaderDependencies = {}) {
  return async (locale: Locale): Promise<Record<string, unknown>> => {
    const [localeModules, appDictionary] = await Promise.all([
      loadLocaleModules(locale),
      loadBaseDictionary(locale),
    ])
    registerLoadedLocaleModules(localeModules, registerLocaleModules)
    return appDictionary
  }
}

registerAppDictionaryLoader(createAppDictionaryLoader())
