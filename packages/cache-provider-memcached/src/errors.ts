import { CacheProviderError, isCacheProviderError } from '@open-mercato/cache/provider'
import { isMemcachedProtocolError } from './protocol/errors'
import { MEMCACHED_PROVIDER_ID } from './settings'

export type MemcachedCacheErrorCode = 'item_too_large' | 'cas_conflict' | 'incompatible_server' | 'protocol_error'

/**
 * Provider-specific failures outside the shared `CacheProviderError` codes.
 * Messages never include endpoints, keys or values.
 */
export class MemcachedCacheError extends Error {
  public readonly code: MemcachedCacheErrorCode
  public readonly providerId = MEMCACHED_PROVIDER_ID
  declare public readonly originalError?: unknown

  constructor(code: MemcachedCacheErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message)
    this.name = 'MemcachedCacheError'
    this.code = code
    Object.defineProperty(this, 'originalError', {
      value: options.cause,
      enumerable: false,
      writable: false,
      configurable: false,
    })
  }

  toJSON(): { name: string; code: MemcachedCacheErrorCode; message: string; providerId: string } {
    return { name: this.name, code: this.code, message: this.message, providerId: this.providerId }
  }
}

export function isMemcachedCacheError(error: unknown): error is MemcachedCacheError {
  return error instanceof MemcachedCacheError
    || (error instanceof Error && error.name === 'MemcachedCacheError' && typeof (error as { code?: unknown }).code === 'string')
}

/**
 * Maps transport and protocol failures onto the shared sanitized contract:
 * `CacheProviderError` (`timeout` / `unavailable`) for transport problems and
 * `MemcachedCacheError` for item limits and protocol violations.
 */
export function toProviderFailure(error: unknown): Error {
  if (isCacheProviderError(error) || isMemcachedCacheError(error)) return error
  if (isMemcachedProtocolError(error)) {
    switch (error.code) {
      case 'timeout':
        return new CacheProviderError('timeout', 'Memcached command timed out', { providerId: MEMCACHED_PROVIDER_ID, cause: error })
      case 'unavailable':
      case 'closed':
        return new CacheProviderError('unavailable', 'Memcached server is unavailable', { providerId: MEMCACHED_PROVIDER_ID, cause: error })
      case 'item_too_large':
        return new MemcachedCacheError('item_too_large', 'Memcached rejected a cache bucket larger than its item size limit', { cause: error })
      default:
        return new MemcachedCacheError('protocol_error', 'Memcached returned an unexpected reply', { cause: error })
    }
  }
  return new CacheProviderError('unavailable', 'Memcached cache operation failed', { providerId: MEMCACHED_PROVIDER_ID, cause: error })
}
