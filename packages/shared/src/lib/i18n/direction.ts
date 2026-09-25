import { normalizeLocaleCode } from './locale-set'

export type TextDirection = 'ltr' | 'rtl'

// Two-letter languages whose script is unambiguously right-to-left, so a locale
// code alone is enough to pick a direction. Codes whose common script is not
// settled are deliberately absent — Azerbaijani (`az`) and Kurdish (`ku`) are
// written in both Latin and Arabic script, and guessing wrong is worse than
// asking: an app that serves one of them declares its direction through
// `registerTextDirections`.
const RTL_BASE_LANGUAGES = new Set(['ar', 'dv', 'fa', 'he', 'ps', 'sd', 'ug', 'ur', 'yi'])

// Same registration pattern as `./locale-set`: the map lives on `globalThis` so
// it survives the module duplication tsx/esbuild can produce when the same file
// is loaded through both static and dynamic imports.
const GLOBAL_KEY = '__openMercatoI18nTextDirections__'
const CACHE_KEY = '__openMercatoI18nTextDirectionCache__'

type DirectionGlobalScope = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, TextDirection>
  [CACHE_KEY]?: Map<string, TextDirection>
}

function globalScope(): DirectionGlobalScope {
  return globalThis as DirectionGlobalScope
}

function getRegistered(): Map<string, TextDirection> {
  const scope = globalScope()
  if (!scope[GLOBAL_KEY]) {
    scope[GLOBAL_KEY] = new Map<string, TextDirection>()
  }
  return scope[GLOBAL_KEY]
}

// `getLocaleDirection` runs in the root layout of every request and through every
// `useDirection()` consumer, so resolved answers are memoized. The cache is
// dropped — not edited — whenever the registration changes, which keeps the
// invalidation logic to one line.
function getCache(): Map<string, TextDirection> {
  const scope = globalScope()
  if (!scope[CACHE_KEY]) {
    scope[CACHE_KEY] = new Map<string, TextDirection>()
  }
  return scope[CACHE_KEY]
}

/**
 * Declare the text direction of locales the platform's table does not cover.
 *
 * Runtime half of the direction extension point, shaped like `registerLocales`:
 * an app serving Central Kurdish (`ckb`), Arabic-script Azerbaijani, or a Latin
 * variant of a language the table defaults to RTL states it here once, at app
 * bootstrap, and every later `getLocaleDirection` call agrees. Codes are
 * normalized (`ar_SA` → `ar-sa`) and a registration for a base language also
 * covers its region subtags, unless a more specific code is registered too.
 *
 * Empty codes and directions other than `ltr`/`rtl` are ignored rather than
 * thrown, for the same reason `registerLocales` ignores unknown codes: one bad
 * entry in app configuration must not take the app down at boot.
 */
export function registerTextDirections(directions: Readonly<Record<string, TextDirection>>): void {
  const registered = getRegistered()
  let changed = false

  for (const [code, direction] of Object.entries(directions)) {
    const normalized = normalizeLocaleCode(code)
    if (!normalized) continue
    if (direction !== 'ltr' && direction !== 'rtl') continue
    if (registered.get(normalized) === direction) continue
    registered.set(normalized, direction)
    changed = true
  }

  if (changed) globalScope()[CACHE_KEY] = new Map<string, TextDirection>()
}

/** Drop every app-registered direction. Returns whether the registry changed. */
export function clearRegisteredTextDirections(): boolean {
  const registered = getRegistered()
  if (registered.size === 0) return false
  registered.clear()
  globalScope()[CACHE_KEY] = new Map<string, TextDirection>()
  return true
}

/** Directions registered by the app, excluding the built-in table. Test seam. */
export function getRegisteredTextDirections(): Readonly<Record<string, TextDirection>> {
  return Object.fromEntries(getRegistered())
}

/**
 * The text direction to render `locale` in.
 *
 * Resolution order: a registration for the exact normalized code, then for its
 * base language, then the built-in right-to-left language table, then `ltr`.
 * Never throws — every unknown, malformed or missing locale renders
 * left-to-right, which is what the platform did before this module existed.
 */
export function getLocaleDirection(locale: string | null | undefined): TextDirection {
  const normalized = typeof locale === 'string' ? normalizeLocaleCode(locale) : ''
  if (!normalized) return 'ltr'

  const cache = getCache()
  const cached = cache.get(normalized)
  if (cached) return cached

  const direction = resolveDirection(normalized)
  cache.set(normalized, direction)
  return direction
}

function resolveDirection(normalized: string): TextDirection {
  const registered = getRegistered()
  const exact = registered.get(normalized)
  if (exact) return exact

  const baseLanguage = normalized.split('-')[0] ?? normalized
  const baseOverride = registered.get(baseLanguage)
  if (baseOverride) return baseOverride

  return RTL_BASE_LANGUAGES.has(baseLanguage) ? 'rtl' : 'ltr'
}

/** True when `locale` renders right-to-left. */
export function isRtlLocale(locale: string | null | undefined): boolean {
  return getLocaleDirection(locale) === 'rtl'
}
