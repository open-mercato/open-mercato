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
}

/**
 * Wrap a short-lived token source as a RESP credentials provider: tokens are
 * reused until `expiresAt - refreshSkewMs`, concurrent callers share one fetch,
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
            throw new CacheProviderError('unavailable', `Cache provider "${options.providerId}" received an empty credential from ${options.sourceLabel}`, { providerId: options.providerId })
          }
          cached = token
          return token
        },
        (error: unknown) => {
          inflight = null
          throw error instanceof CacheProviderError
            ? error
            : new CacheProviderError(
              'unavailable',
              `Cache provider "${options.providerId}" could not obtain a credential from ${options.sourceLabel}; check the workload identity and its data-access assignment`,
              { providerId: options.providerId, cause: error },
            )
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
  })
}
