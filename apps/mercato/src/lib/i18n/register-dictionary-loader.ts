import { registerAppDictionaryLoader } from '@open-mercato/shared/lib/i18n/server'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import { loadI18nModules } from '@/.mercato/generated/modules.i18n.loaders.generated'

function registerLoadedLocaleModules(
  localeModules: Module[],
  registrar: typeof registerModules = registerModules,
): void {
  if (localeModules.length > 0) registrar(localeModules)
}

async function loadAppDictionary(locale: Locale): Promise<Record<string, unknown>> {
  switch (locale) {
    case 'en':
      return import('../../i18n/en.json').then((module) => module.default)
    case 'pl':
      return import('../../i18n/pl.json').then((module) => module.default)
    case 'es':
      return import('../../i18n/es.json').then((module) => module.default)
    case 'de':
      return import('../../i18n/de.json').then((module) => module.default)
    case 'ko':
      return import('../../i18n/ko.json').then((module) => module.default)
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
