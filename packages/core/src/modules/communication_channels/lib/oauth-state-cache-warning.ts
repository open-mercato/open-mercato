import { createLogger } from '@open-mercato/shared/lib/logger'
import { describeCacheSelection, type CacheSelection } from '@open-mercato/cache'
import { readSelectedCacheProviderId } from '@open-mercato/cache/provider'

const oauthStateLogger = createLogger('communication_channels').child({ component: 'oauth-state' })

const WARNING_STATE_KEY = Symbol.for('@open-mercato/core/communication_channels/oauth-state-cache-warning')

type OAuthStateCacheWarningState = {
  emitted: boolean
  deferred: boolean
}

type GlobalWithWarningState = typeof globalThis & {
  [WARNING_STATE_KEY]?: OAuthStateCacheWarningState
}

function warningState(): OAuthStateCacheWarningState {
  const scope = globalThis as GlobalWithWarningState
  if (!scope[WARNING_STATE_KEY]) scope[WARNING_STATE_KEY] = { emitted: false, deferred: false }
  return scope[WARNING_STATE_KEY]
}

function describeSelectedProviderPlacement(
  providerId: string,
  describeSelection: () => CacheSelection,
): CacheSelection['placement'] | null {
  try {
    const selection = describeSelection()
    return selection.kind === 'provider' && selection.id === providerId ? selection.placement : null
  } catch {
    return null
  }
}

/**
 * Emit a one-time startup warning unless the effective cache is shared across
 * replicas. With a registered cache provider (`CACHE_PROVIDER`) its resolved
 * placement decides; when that selection cannot be described yet (bootstrap has
 * not prepared it), the check is deferred to
 * {@link runDeferredOAuthStateCacheWarningCheck} instead of consulting a possibly
 * stale `CACHE_STRATEGY`. For stock strategies every value other than redis
 * (memory, sqlite, jsonfile) keeps replay markers per process or per node, so the
 * single-use guarantee only holds across replicas on redis.
 */
export function emitOAuthStateMemoryCacheStartupWarningIfNeeded(
  env: NodeJS.ProcessEnv = process.env,
  describeSelection: () => CacheSelection = describeCacheSelection,
): void {
  const state = warningState()
  if (state.emitted) return
  const providerId = readSelectedCacheProviderId(env)
  if (providerId) {
    const placement = describeSelectedProviderPlacement(providerId, describeSelection)
    if (placement === null) {
      state.deferred = true
      return
    }
    state.deferred = false
    if (placement === 'shared') return
    state.emitted = true
    oauthStateLogger.warn(
      `OAuth state single-use protection needs a store shared across replicas. CACHE_PROVIDER=${providerId} resolves to a local (per-process or per-node) cache; multi-replica deployments MUST select a shared cache.`,
      { context: 'startup', startup: true, cacheProvider: providerId },
    )
    return
  }
  state.deferred = false
  const strategy = (env.CACHE_STRATEGY ?? 'memory').trim().toLowerCase()
  if (strategy === 'redis') return
  state.emitted = true
  oauthStateLogger.warn(
    `OAuth state single-use protection needs a store shared across replicas. CACHE_STRATEGY=${strategy} is per-process or per-node; multi-replica deployments MUST set CACHE_STRATEGY=redis.`,
    { context: 'startup', startup: true, cacheStrategy: strategy },
  )
}

/**
 * Re-run a startup check that was deferred because the cache provider selection
 * was not prepared yet. Core bootstrap calls this after
 * `prepareCacheProviderSelection()` settles; it is a no-op when nothing was deferred.
 */
export function runDeferredOAuthStateCacheWarningCheck(
  env: NodeJS.ProcessEnv = process.env,
  describeSelection: () => CacheSelection = describeCacheSelection,
): void {
  const state = warningState()
  if (!state.deferred || state.emitted) return
  emitOAuthStateMemoryCacheStartupWarningIfNeeded(env, describeSelection)
}

/** Test helper — reset the one-time startup warning latch and any deferred check. */
export function resetOAuthStateMemoryCacheStartupWarningForTests(): void {
  const state = warningState()
  state.emitted = false
  state.deferred = false
}
