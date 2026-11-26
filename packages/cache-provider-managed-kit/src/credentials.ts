import { CacheProviderError } from '@open-mercato/cache/provider'
import type { RespCredentials, RespCredentialsProvider } from '@open-mercato/cache-redis-protocol'

export type ManagedAccessToken = {
  username?: string
  password: string
  /** Epoch milliseconds after which the token must not be presented; `null` when unknown. */
  expiresAt: number | null
}

export type ManagedAccessTokenSource = () => Promise<ManagedAccessToken>

export type CachedCredentialsOptions = {
  providerId: string
  /** Operator-safe label of the identity source, used in diagnostics. */
  sourceLabel: string
  /** Fetch a new token once the cached one is this close to expiry. */
  refreshSkewMs: number
  now?: () => number
}

export type CachedCredentialsProvider = RespCredentialsProvider & {
  /** Drop the cached token so the next call fetches a fresh one. */
  invalidate(): void
  /**
   * Delay until the next live re-`AUTH`: the configured interval, shortened so
   * it lands no later than the moment the cached token stops being fresh
   * (`expiresAt - refreshSkewMs`), where the cache fetches a new token. Never
   * below `MANAGED_REAUTH_FLOOR_MS` unless the interval itself is shorter.
   */
  nextRefreshDelayMs(maxIntervalMs: number): number
}

/** Shortest token-driven re-`AUTH` delay, so a token close to expiry cannot cause a tight loop. */
export const MANAGED_REAUTH_FLOOR_MS = 5_000

const credentialErrors = new WeakSet<object>()

/**
 * True for the sanitized error raised when the identity source could not
 * supply a credential (missing workload identity, unreachable token endpoint):
 * an environment problem, not a provider or server failure.
 */
export function isManagedCredentialUnavailableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && credentialErrors.has(error)
}

function markCredentialError(error: CacheProviderError): CacheProviderError {
  if (error.code === 'unavailable') credentialErrors.add(error)
  return error
}

/**
 * Wrap a short-lived token source as a RESP credentials provider: tokens are
 * reused until `expiresAt - refreshSkewMs` (a token without a known expiry is
 * never reused), concurrent callers share one fetch,
 * and failures surface as a sanitized `unavailable` error (the original error
 * is kept only as the non-enumerable cause).
 */
export function createCachedCredentialsProvider(
  source: ManagedAccessTokenSource,
  options: CachedCredentialsOptions,
): CachedCredentialsProvider {
  const now = options.now ?? Date.now
  let cached: ManagedAccessToken | null = null
  let inflight: Promise<ManagedAccessToken> | null = null

  const isFresh = (token: ManagedAccessToken | null): token is ManagedAccessToken => token !== null
    && token.expiresAt !== null
    && now() < token.expiresAt - options.refreshSkewMs

  const fetchToken = (): Promise<ManagedAccessToken> => {
    if (!inflight) {
      inflight = source().then(
        (token) => {
          inflight = null
          if (!token || typeof token.password !== 'string' || token.password.length === 0) {
            throw markCredentialError(new CacheProviderError('unavailable', `Cache provider "${options.providerId}" received an empty credential from ${options.sourceLabel}`, { providerId: options.providerId }))
          }
          cached = token
          return token
        },
        (error: unknown) => {
          inflight = null
          throw markCredentialError(error instanceof CacheProviderError
            ? error
            : new CacheProviderError(
              'unavailable',
              `Cache provider "${options.providerId}" could not obtain a credential from ${options.sourceLabel}; check the workload identity and its data-access assignment`,
              { providerId: options.providerId, cause: error },
            ))
        },
      )
    }
    return inflight
  }

  const provider = async (): Promise<RespCredentials> => {
    const token = isFresh(cached) ? cached : await fetchToken()
    return token.username !== undefined ? { username: token.username, password: token.password } : { password: token.password }
  }
  return Object.assign(provider, {
    invalidate() {
      cached = null
    },
    nextRefreshDelayMs(maxIntervalMs: number): number {
      if (cached === null || cached.expiresAt === null) return maxIntervalMs
      const untilStale = cached.expiresAt - options.refreshSkewMs - now()
      return Math.min(maxIntervalMs, Math.max(MANAGED_REAUTH_FLOOR_MS, untilStale))
    },
  })
}
