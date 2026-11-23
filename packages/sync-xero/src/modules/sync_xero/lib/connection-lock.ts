import type { EntityManager } from '@mikro-orm/postgresql'
import { AdvisoryLockUnavailableError, withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { XeroScope } from './owner'

const XERO_CONNECTION_LOCK_NAMESPACE = 'sync_xero_connection'
const XERO_CONNECTION_LOCK_WAIT_MS = 20_000

export function xeroConnectionLockKey(scope: XeroScope): string {
  return `${XERO_CONNECTION_LOCK_NAMESPACE}:${scope.tenantId}:${scope.organizationId}`
}

/**
 * One advisory lock per OM organization that orders the writes starting and ending its Xero
 * connection: the callback re-reads the Client ID and Secret and stores the grant under it, and
 * Disconnect's destructive follow-ups check for a live grant and write under it. `work` makes no
 * Xero call; the grant store inside it may wait up to 15 s for the Grant Lock, so a waiter here
 * waits longer than that. Only one organization's callers share a key, and no per-process holder
 * cap is set, so one tenant's slow connect never holds up another's. The lock transaction writes
 * nothing itself, so a commit that fails after `work` returned leaves `work`'s result standing.
 * This is a mutex-only use of `withAdvisoryXactLock`: `work` writes through its own services and
 * connections (the Grant Lock, the state and credentials services), never through `lockEm`, which
 * serves fresh reads only. Callers always take this lock before the Grant Lock, never inside it.
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
      { waitDeadlineMs: XERO_CONNECTION_LOCK_WAIT_MS },
    )
  } catch (error) {
    const finished = attempt.finished
    if (finished && error instanceof AdvisoryLockUnavailableError && error.reason === 'commit_unknown') return finished.value
    throw error
  }
}
