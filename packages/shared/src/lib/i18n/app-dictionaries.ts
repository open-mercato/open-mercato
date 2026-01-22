import type { Locale } from './config'

type DictionaryLoader = (locale: Locale) => Promise<Record<string, unknown>>

let _appDictionaryLoader: DictionaryLoader | null = null

export function registerAppDictionaryLoader(loader: DictionaryLoader): void {
  _appDictionaryLoader = loader
}

export async function loadAppDictionary(locale: Locale): Promise<Record<string, unknown>> {
  if (!_appDictionaryLoader) return {}
  try {
    return await _appDictionaryLoader(locale)
  } catch {
    return {}
  }
}
