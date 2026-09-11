import type { CoalesceKeyResolver, EnqueueOptions } from './types'

/**
 * Resolves the coalescing key for one enqueue.
 *
 * A key passed at the call site wins over the queue's own `coalesceBy`, so a caller can coalesce
 * something the queue does not, or key one enqueue differently. Falsy results mean "do not
 * coalesce": a resolver returning `null` for payloads it has no opinion about is the documented way
 * to leave them alone, and an empty string is never a usable key.
 */
export function resolveCoalesceKey<T>(
  payload: T,
  options?: EnqueueOptions,
  coalesceBy?: CoalesceKeyResolver<T>,
): string | undefined {
  const explicitKey = options?.coalesce?.key
  if (explicitKey) return explicitKey
  return coalesceBy?.(payload) || undefined
}
