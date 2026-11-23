import type { EntityManager } from '@mikro-orm/postgresql'
import { AdvisoryLockUnavailableError, withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { XeroScope } from './owner'

const XERO_CONNECTION_LOCK_NAMESPACE = 'sync_xero_connection'
const XERO_CONNECTION_LOCK_WAIT_MS = 5_000
const XERO_CONNECTION_LOCK_MAX_HOLDERS = 4

export function xeroConnectionLockKey(scope: XeroScope): string {
  return `${XERO_CONNECTION_LOCK_NAMESPACE}:${scope.tenantId}:${scope.organizationId}`
}

/**
 * One advisory lock per OM organization that orders the writes starting and ending its Xero
 * connection: the callback re-reads the Client ID and Secret and stores the grant under it, and
 * Disconnect's destructive follow-ups check for a live grant and write under it. `work` does
 * database work only and makes no Xero call. The lock transaction writes nothing itself, so a
 * commit that fails after `work` returned leaves `work`'s result standing.
 */
export async function withXeroConnectionLock<T>(
  container: AppContainer,
  scope: XeroScope,
  work: (lockEm: EntityManager) => Promise<T>,
): Promise<T> {
  const attempt: { finished: { value: T } | null } = { finished: null }
  try {
    return await withAdvisoryXactLock(
      container.resolve<EntityManager>('em'),
      xeroConnectionLockKey(scope),
      async (lockEm) => {
        const value = await work(lockEm)
        attempt.finished = { value }
        return value
      },
      { waitDeadlineMs: XERO_CONNECTION_LOCK_WAIT_MS, maxConcurrentHolders: XERO_CONNECTION_LOCK_MAX_HOLDERS },
    )
  } catch (error) {
    const finished = attempt.finished
    if (finished && error instanceof AdvisoryLockUnavailableError && error.reason === 'commit_unknown') return finished.value
    throw error
  }
}
