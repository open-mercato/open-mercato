import type { Locale } from './config'
import { invalidateDictionaryCache } from './dictionary-cache'

type DictionaryLoader = (locale: Locale) => Promise<Record<string, unknown>>

let _appDictionaryLoader: DictionaryLoader | null = null

export function registerAppDictionaryLoader(loader: DictionaryLoader): void {
  _appDictionaryLoader = loader
  invalidateDictionaryCache()
}

export async function loadAppDictionary(locale: Locale): Promise<Record<string, unknown>> {
  if (!_appDictionaryLoader) return {}
  try {
    return await _appDictionaryLoader(locale)
  } catch {
    return {}
  }
}
