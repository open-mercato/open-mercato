import type { Locale } from './config'
import type { Dict } from './context'

// Process-level cache of flattened, module-merged translation dictionaries
// keyed by locale. Locale dictionaries are immutable at runtime, so the
// flatten+merge work in loadDictionary() only needs to run once per locale.
//
// Stored on globalThis for the same reason the module registry is: tsx/esbuild
// can load this file as multiple module instances when mixing dynamic and
// static imports, and the cache plus its invalidation must stay coherent across
// those instances. See ../modules/registry.ts for the original workaround.
const GLOBAL_KEY = '__openMercatoI18nDictionaryCache__'

function getCache(): Map<Locale, Dict> {
  const globalScope = globalThis as any
  if (!globalScope[GLOBAL_KEY]) {
    globalScope[GLOBAL_KEY] = new Map<Locale, Dict>()
  }
  return globalScope[GLOBAL_KEY]
}

export function getCachedDictionary(locale: Locale): Dict | undefined {
  return getCache().get(locale)
}

export function setCachedDictionary(locale: Locale, dict: Dict): void {
  getCache().set(locale, dict)
}

// Invalidate every cached locale dictionary. Called whenever the inputs to a
// dictionary build change: module registration (module translations) and the
// app dictionary loader registration (base translations).
export function invalidateDictionaryCache(): void {
  getCache().clear()
}
