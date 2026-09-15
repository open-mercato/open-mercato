import { extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'

/**
 * Apply a 409 optimistic-lock `currentUpdatedAt` into a mutable token holder so
 * ASN complete retries send a fresh If-Match.
 * Returns the refreshed token, or null when the response is not a lock conflict.
 */
export function applyAsnCompleteLockTokenFromConflict(
  tokenHolder: { current: string | null },
  response: { status: number; body: unknown },
): string | null {
  const conflict = extractOptimisticLockConflict({
    status: response.status,
    body: response.body,
  })
  if (!conflict?.currentUpdatedAt) return null
  tokenHolder.current = conflict.currentUpdatedAt
  return conflict.currentUpdatedAt
}

/**
 * Prefer a mutable ASN lock ref (updated on receive success) over the async
 * query `updated_at`, so a second receive before header refetch does not send
 * a stale If-Match.
 */
export function resolveAsnReceiveLockToken(
  tokenHolder: { current: string | null },
  asnUpdatedAt?: string | null,
): string | null {
  if (typeof tokenHolder.current === 'string' && tokenHolder.current.trim()) {
    return tokenHolder.current.trim()
  }
  if (typeof asnUpdatedAt === 'string' && asnUpdatedAt.trim()) {
    return asnUpdatedAt.trim()
  }
  return asnUpdatedAt ?? null
}

/**
 * Store ASN `updated_at` from a successful receive so the next openReceive /
 * query-cache seed uses a fresh If-Match without waiting on refetch.
 */
export function applyAsnReceiveLockTokenFromSuccess(
  tokenHolder: { current: string | null },
  asnUpdatedAt?: string | null,
): string | null {
  if (typeof asnUpdatedAt !== 'string') return null
  const trimmed = asnUpdatedAt.trim()
  if (!trimmed) return null
  tokenHolder.current = trimmed
  return trimmed
}
