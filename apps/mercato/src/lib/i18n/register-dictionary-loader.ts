import { registerAppDictionaryLoader } from '@open-mercato/shared/lib/i18n/server'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import { loadI18nModules } from '@/.mercato/generated/modules.i18n.loaders.generated'

const GLOBAL_LOCALE_MODULES_KEY = '__openMercatoLoadedI18nModules__'

function getLoadedLocaleModules(): Map<string, Module[]> {
  const globalScope = globalThis as typeof globalThis & {
    [GLOBAL_LOCALE_MODULES_KEY]?: Map<string, Module[]>
  }
  if (!globalScope[GLOBAL_LOCALE_MODULES_KEY]) {
    globalScope[GLOBAL_LOCALE_MODULES_KEY] = new Map<string, Module[]>()
  }
  return globalScope[GLOBAL_LOCALE_MODULES_KEY]
}

function registerLoadedLocaleModules(
  locale: Locale,
  localeModules: Module[],
  registrar: typeof registerModules = registerModules,
): void {
  const loadedByLocale = getLoadedLocaleModules()
  loadedByLocale.set(locale, localeModules)

  const mergedById = new Map<string, Module>()
  for (const modules of loadedByLocale.values()) {
    for (const moduleEntry of modules) {
      const existing = mergedById.get(moduleEntry.id)
      mergedById.set(moduleEntry.id, {
        id: moduleEntry.id,
        translations: {
          ...(existing?.translations ?? {}),
          ...(moduleEntry.translations ?? {}),
        },
      })
    }
  }
  const mergedModules = [...mergedById.values()]
  if (mergedModules.length > 0) registrar(mergedModules)
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
    registerLoadedLocaleModules(locale, localeModules, registerLocaleModules)
    return appDictionary
  }
}

registerAppDictionaryLoader(createAppDictionaryLoader())
