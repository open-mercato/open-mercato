import { defaultLocale, locales, type Locale } from './config'
import { invalidateDictionaryCache } from './dictionary-cache'
import { isValidIso639 } from './iso639'
import { createLogger } from '../logger'
import {
  addRegisteredLocale,
  clearRegisteredLocaleSet,
  getSupportedLocales,
  normalizeLocaleCode,
} from './locale-set'

// Constructed lazily rather than at module scope: a module-level factory call is
// a side effect no bundler can drop, which would pin this whole module — and the
// logger facade behind it — into any bundle that merely imports one of its
// tree-shakeable exports.
let cachedLogger: ReturnType<typeof createLogger> | null = null
function logger() {
  if (!cachedLogger) cachedLogger = createLogger('shared').child({ component: 'i18n-locale-registry' })
  return cachedLogger
}

// The read side lives in `./locale-set`, which has no dependencies beyond
// `./config` so client bundles can import it without pulling in the logger, the
// ISO 639 table or the dictionary cache. Re-exported here so `locale-registry`
// remains the one import path callers need to know about.
export {
  getSupportedLocales,
  isSupportedLocale,
  getRegisteredLocales,
  normalizeLocaleCode,
} from './locale-set'

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
  let added = false

  for (const code of codes) {
    const normalized = normalizeLocaleCode(code)
    if (!normalized) continue
    if ((locales as readonly string[]).includes(normalized)) continue
    // Region subtags (`pt-br`) are normalized but validated on their base code,
    // matching how `resolveSupportedLocale` folds a region down to its language.
    if (!isValidIso639(normalized.split('-')[0] ?? normalized)) {
      logger().warn('Ignoring unknown locale code', { code })
      continue
    }
    if (addRegisteredLocale(normalized)) added = true
  }

  // The dictionary a locale resolves to is derived from the supported set, so a
  // widened set invalidates everything built from the narrower one.
  if (added) invalidateDictionaryCache()
}

/** Drop every app-registered locale. Intended for tests. */
export function clearRegisteredLocales(): void {
  if (clearRegisteredLocaleSet()) invalidateDictionaryCache()
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
 *
 * There is one slot: a second registration replaces the first. That is what
 * makes an enterprise overlay able to take over the tenant lookup, so it is not
 * an error, but it is warned about — silently losing the `translations` module's
 * resolver to an accidental second call is otherwise undiagnosable.
 */
export function registerSupportedLocalesResolver(resolver: SupportedLocalesResolver | null): void {
  const scope = globalThis as ResolverGlobalScope
  if (resolver && scope[RESOLVER_GLOBAL_KEY]) {
    logger().warn('Replacing an already-registered supported-locales resolver')
  }
  scope[RESOLVER_GLOBAL_KEY] = resolver
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
    if (!available.some((locale) => selected.has(locale))) return available

    // `detectLocale` falls back to `defaultLocale` whenever neither the cookie
    // nor Accept-Language matches, so the default has to stay servable. Without
    // this, a tenant selecting only `['pl','de']` renders an English page whose
    // own switcher does not list English: a blank Select trigger, no checked row
    // in the profile menu, and no way for the user to get back.
    selected.add(defaultLocale)
    // Filtering `available` rather than mapping the selection preserves the
    // platform's locale ordering instead of the tenant's.
    return available.filter((locale) => selected.has(locale))
  } catch (err) {
    logger().warn('Failed to resolve tenant supported locales; serving the full set', { err })
    return available
  }
}
