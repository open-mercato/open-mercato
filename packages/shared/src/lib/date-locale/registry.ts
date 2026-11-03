import { createLogger } from '../logger'
import { resolveDateLocaleSettings } from './resolve'
import type { ResolvedDateLocaleSettings } from './types'

/**
 * Resolves the effective settings for the current request (tenant + signed-in user), or `null`
 * when there is no tenant context. Registered by the `configs` module; `@open-mercato/shared`
 * cannot read tenant configuration itself.
 */
export type DateLocaleSettingsResolver = () => Promise<ResolvedDateLocaleSettings | null>

const RESOLVER_GLOBAL_KEY = '__openMercatoDateLocaleSettingsResolver__'

type ResolverGlobalScope = typeof globalThis & {
  [RESOLVER_GLOBAL_KEY]?: DateLocaleSettingsResolver | null
}

const logger = () => createLogger('shared').child({ component: 'date-locale-registry' })

/** One slot: a second registration replaces the first (and is warned about). */
export function registerDateLocaleSettingsResolver(resolver: DateLocaleSettingsResolver | null): void {
  const scope = globalThis as ResolverGlobalScope
  if (resolver && scope[RESOLVER_GLOBAL_KEY]) {
    logger().warn('Replacing an already-registered date/locale settings resolver')
  }
  scope[RESOLVER_GLOBAL_KEY] = resolver
}

/**
 * The settings for the current request. Never throws — this runs in the root layout, where a
 * failure would take down every page — and falls back to env defaults when nothing is
 * registered, there is no tenant, or the resolver fails.
 */
export async function resolveDateLocaleSettingsForRequest(): Promise<ResolvedDateLocaleSettings> {
  const resolver = (globalThis as ResolverGlobalScope)[RESOLVER_GLOBAL_KEY]
  if (resolver) {
    try {
      const resolved = await resolver()
      if (resolved) return resolved
    } catch (err) {
      logger().debug('Date/locale settings resolver failed; using env defaults', { err })
    }
  }
  return resolveDateLocaleSettings({})
}
