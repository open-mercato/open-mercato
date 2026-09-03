import { locales, type Locale } from './config'
import { invalidateDictionaryCache } from './dictionary-cache'
import { isValidIso639 } from './iso639'
import { createLogger } from '../logger'

const logger = createLogger('shared').child({ component: 'i18n-locale-registry' })

// Registration pattern for publishable packages.
// Use globalThis to survive tsx/esbuild module duplication where the same file
// can be loaded as multiple module instances when mixing dynamic and static
// imports. The registry and the dictionary cache it invalidates must stay
// coherent across those instances. Mirrors `../modules/registry.ts` and
// `./dictionary-cache.ts`.
const GLOBAL_KEY = '__openMercatoI18nLocaleRegistry__'

type LocaleRegistryGlobalScope = typeof globalThis & {
  [GLOBAL_KEY]?: Set<string>
}

function getRegistered(): Set<string> {
  const globalScope = globalThis as LocaleRegistryGlobalScope
  if (!globalScope[GLOBAL_KEY]) {
    globalScope[GLOBAL_KEY] = new Set<string>()
  }
  return globalScope[GLOBAL_KEY]
}

function normalizeLocaleCode(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

/**
 * Register additional locales this application serves on top of the ones the
 * platform ships in `locales`.
 *
 * Runtime half of the extension point; the compile-time half is augmenting
 * `LocaleRegistry` in `./config`. Both are needed for an app-defined locale to
 * be usable, and this one is the authority — the type layer cannot be trusted to
 * reflect what the running app actually registered.
 *
 * Codes are normalized (`pt_BR` → `pt-br`) and validated against ISO 639-1;
 * unknown codes are ignored with a warning rather than thrown, so one bad entry
 * in app config cannot take the app down at boot. Registering is idempotent, and
 * re-registering the shipped locales is a no-op.
 */
export function registerLocales(codes: readonly string[]): void {
  const registered = getRegistered()
  let added = false

  for (const code of codes) {
    const normalized = normalizeLocaleCode(code)
    if (!normalized) continue
    if ((locales as readonly string[]).includes(normalized)) continue
    if (registered.has(normalized)) continue
    // Region subtags (`pt-br`) are normalized but validated on their base code,
    // matching how `resolveSupportedLocale` folds a region down to its language.
    if (!isValidIso639(normalized.split('-')[0] ?? normalized)) {
      logger.warn('Ignoring unknown locale code', { code })
      continue
    }
    registered.add(normalized)
    added = true
  }

  // The dictionary a locale resolves to is derived from the supported set, so a
  // widened set invalidates everything built from the narrower one.
  if (added) invalidateDictionaryCache()
}

/**
 * Every locale this application can serve: the platform baseline plus anything
 * registered by the app. The single runtime authority on the locale set — prefer
 * it over importing `locales` directly anywhere a user-supplied value is being
 * validated or a locale list is being rendered.
 */
export function getSupportedLocales(): readonly Locale[] {
  const registered = getRegistered()
  if (registered.size === 0) return locales
  return [...locales, ...registered] as Locale[]
}

/** True when `code` is a locale this application serves. */
export function isSupportedLocale(code: string): boolean {
  return (getSupportedLocales() as readonly string[]).includes(code)
}

/** Locales registered by the app, excluding the platform baseline. Test seam. */
export function getRegisteredLocales(): readonly string[] {
  return [...getRegistered()]
}

/** Drop every app-registered locale. Intended for tests. */
export function clearRegisteredLocales(): void {
  const registered = getRegistered()
  if (registered.size === 0) return
  registered.clear()
  invalidateDictionaryCache()
}

/**
 * Resolves the locale codes the current tenant has opted into, or `null` when
 * there is no tenant context or no stored selection.
 */
export type SupportedLocalesResolver = () => Promise<readonly string[] | null>

const RESOLVER_GLOBAL_KEY = '__openMercatoI18nSupportedLocalesResolver__'

type ResolverGlobalScope = typeof globalThis & {
  [RESOLVER_GLOBAL_KEY]?: SupportedLocalesResolver | null
}

/**
 * Register the source of per-tenant locale configuration.
 *
 * `@open-mercato/shared` cannot read tenant configuration itself — that needs a
 * DI container and a domain module — so the owning module registers a resolver
 * here, the same way `registerTranslationOverlayPlugin` inverts the dependency
 * for content translations. With nothing registered the served set is exactly
 * the process-local registry, which is today's behaviour.
 */
export function registerSupportedLocalesResolver(resolver: SupportedLocalesResolver | null): void {
  ;(globalThis as ResolverGlobalScope)[RESOLVER_GLOBAL_KEY] = resolver
}

/**
 * The locales to offer for the current request: the tenant's selection narrowed
 * to those the app can actually serve.
 *
 * Intersecting rather than replacing means a code that was configured but has no
 * dictionary source behind it can never reach a language switcher, so a typo in
 * the settings screen cannot strand a tenant in a broken UI. An empty
 * intersection falls back to the full set for the same reason. Never throws —
 * this runs in the root layout, where a failure would take down every page.
 */
export async function resolveSupportedLocalesForRequest(): Promise<readonly Locale[]> {
  const available = getSupportedLocales()
  const resolver = (globalThis as ResolverGlobalScope)[RESOLVER_GLOBAL_KEY]
  if (!resolver) return available

  try {
    const configured = await resolver()
    if (!configured || configured.length === 0) return available

    const selected = new Set(configured.map(normalizeLocaleCode))
    const served = available.filter((locale) => selected.has(locale))
    return served.length > 0 ? served : available
  } catch (err) {
    logger.warn('Failed to resolve tenant supported locales; serving the full set', { err })
    return available
  }
}
