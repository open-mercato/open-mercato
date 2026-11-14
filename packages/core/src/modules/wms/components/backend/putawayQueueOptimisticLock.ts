import { extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'

/**
 * Apply a 409 optimistic-lock `currentUpdatedAt` into a mutable token map so
 * putaway queue assign/start/cancel retries send a fresh If-Match.
 * Returns the refreshed token, or null when the response is not a lock conflict.
 */
export function applyPutawayLockTokenFromConflict(
  tokens: Record<string, string>,
  taskId: string,
  response: { status: number; body: unknown },
): string | null {
  const conflict = extractOptimisticLockConflict({
    status: response.status,
    body: response.body,
  })
  if (!conflict?.currentUpdatedAt) return null
  tokens[taskId] = conflict.currentUpdatedAt
  return conflict.currentUpdatedAt
}
