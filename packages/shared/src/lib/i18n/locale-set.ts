import { defaultLocale, locales, type Locale } from './config'

// The read side of the locale registry, kept in its own module with no imports
// beyond `./config` so it is safe — and cheap — to pull into a client bundle.
// `context.tsx` is a "use client" module and needs `getSupportedLocales()`; if it
// reached for `./locale-registry` instead it would drag the logger facade, the
// dictionary cache and the ISO 639 table into every route that mounts
// `I18nProvider`, because `./locale-registry` has module-level side effects that
// no bundler can tree-shake away.
//
// Registration pattern for publishable packages.
// Use globalThis to survive tsx/esbuild module duplication where the same file
// can be loaded as multiple module instances when mixing dynamic and static
// imports. The registry and the dictionary cache it invalidates must stay
// coherent across those instances. Mirrors `../modules/registry.ts` and
// `./dictionary-cache.ts`.
const GLOBAL_KEY = '__openMercatoI18nLocaleRegistry__'
const CACHE_KEY = '__openMercatoI18nSupportedLocales__'
const RESTRICTION_KEY = '__openMercatoI18nServedLocaleRestriction__'

type LocaleSetGlobalScope = typeof globalThis & {
  [GLOBAL_KEY]?: Set<string>
  [CACHE_KEY]?: readonly Locale[] | null
  [RESTRICTION_KEY]?: readonly string[] | null
}

function globalScope(): LocaleSetGlobalScope {
  return globalThis as LocaleSetGlobalScope
}

function getRegistered(): Set<string> {
  const scope = globalScope()
  if (!scope[GLOBAL_KEY]) {
    scope[GLOBAL_KEY] = new Set<string>()
  }
  return scope[GLOBAL_KEY]
}

/** `pt_BR` → `pt-br`. Applied on both sides of every comparison. */
export function normalizeLocaleCode(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

/**
 * Every locale this application can serve: the platform baseline plus anything
 * registered by the app. The single runtime authority on the locale set — prefer
 * it over importing `locales` directly anywhere a user-supplied value is being
 * validated or a locale list is being rendered.
 *
 * Memoized so the returned array keeps a stable identity between mutations.
 * `useSupportedLocales()` hands this straight to callers, and a fresh array on
 * every render would re-fire any `useEffect`/`useMemo` that depends on it.
 */
export function getSupportedLocales(): readonly Locale[] {
  const scope = globalScope()
  const cached = scope[CACHE_KEY]
  if (cached) return cached

  const restriction = scope[RESTRICTION_KEY]
  if (restriction) {
    // A restriction is the app's explicit statement about what it can serve, so
    // it replaces the registration set. It never filters down to nothing — a
    // restriction made only of unknown codes (a typo) falls back to the full set
    // rather than leaving the app with no locale — and it never drops the default
    // locale, which every fallback path assumes is servable.
    const available = new Set<string>([...locales, ...getRegistered()])
    const narrowed = restriction.filter((code) => available.has(code))
    const resolved =
      narrowed.length === 0
        ? locales
        : ((narrowed.includes(defaultLocale) ? narrowed : [defaultLocale, ...narrowed]) as Locale[])
    scope[CACHE_KEY] = resolved
    return resolved
  }

  const registered = getRegistered()
  // With nothing registered this is `locales` itself, not a copy, so the common
  // case allocates nothing and callers can compare by identity.
  const resolved = registered.size === 0 ? locales : ([...locales, ...registered] as Locale[])
  scope[CACHE_KEY] = resolved
  return resolved
}

/** True when `code` is a locale this application serves. */
export function isSupportedLocale(code: string): boolean {
  return (getSupportedLocales() as readonly string[]).includes(normalizeLocaleCode(code))
}

/** Locales registered by the app, excluding the platform baseline. Test seam. */
export function getRegisteredLocales(): readonly string[] {
  return [...getRegistered()]
}

/**
 * Add one already-normalized, already-validated code. Returns whether the set
 * actually changed, so the caller knows when to invalidate what it derived.
 * Internal to `./locale-registry` — applications call `registerLocales`.
 */
export function addRegisteredLocale(normalized: string): boolean {
  const registered = getRegistered()
  if (registered.has(normalized)) return false
  registered.add(normalized)
  globalScope()[CACHE_KEY] = null
  return true
}

/**
 * Drop every app-registered locale. Returns whether the set actually changed.
 * Internal to `./locale-registry` — tests call `clearRegisteredLocales`.
 */
export function clearRegisteredLocaleSet(): boolean {
  const registered = getRegistered()
  if (registered.size === 0) return false
  registered.clear()
  globalScope()[CACHE_KEY] = null
  return true
}

/**
 * Declare the exact locales this application serves, replacing the platform
 * baseline plus registrations.
 *
 * `registerLocales` answers "what can this app render?"; this answers "what may
 * it offer?". They differ when an app ships dictionaries for a subset of the
 * platform's languages — a scaffold that keeps `en` and `ar` and drops the rest
 * must not keep advertising Polish in its language switcher, because a locale
 * with no dictionary renders raw keys.
 *
 * Codes are normalized and validated against the locales that actually exist
 * (shipped or registered), `defaultLocale` is always included, and an all-unknown
 * restriction falls back to the full set so a typo cannot leave the app with no
 * servable language. Returns whether a restriction is now in force.
 */
export function restrictServedLocales(codes: readonly string[]): boolean {
  const scope = globalScope()
  const normalized = [...new Set(codes.map(normalizeLocaleCode).filter((code) => code.length > 0))]
  scope[RESTRICTION_KEY] = normalized
  scope[CACHE_KEY] = null
  return true
}

/** Drop the restriction, restoring the platform baseline. Intended for tests. */
export function clearServedLocaleRestriction(): boolean {
  const scope = globalScope()
  if (!scope[RESTRICTION_KEY]) return false
  scope[RESTRICTION_KEY] = null
  scope[CACHE_KEY] = null
  return true
}

/** The active restriction, or `null` when the app serves the full set. Test seam. */
export function getServedLocaleRestriction(): readonly string[] | null {
  return globalScope()[RESTRICTION_KEY] ?? null
}
