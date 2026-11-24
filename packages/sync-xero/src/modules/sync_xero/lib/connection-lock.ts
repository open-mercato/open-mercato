import type { EntityManager } from '@mikro-orm/postgresql'
import { AdvisoryLockUnavailableError, withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { XeroScope } from './owner'

const XERO_CONNECTION_LOCK_NAMESPACE = 'sync_xero_connection'
const XERO_CONNECTION_LOCK_WAIT_MS = 20_000
const XERO_CONNECTION_LOCK_MAX_HOLDERS = 4

export function xeroConnectionLockKey(scope: XeroScope): string {
  return `${XERO_CONNECTION_LOCK_NAMESPACE}:${scope.tenantId}:${scope.organizationId}`
}

/**
 * One advisory lock per OM organization that orders the writes starting and ending its Xero
 * connection: the callback re-reads the Client ID and Secret and stores the grant under it;
 * Disconnect erases and revokes the grant under it, and its destructive follow-ups check for a
 * live grant and write under it. A section is bounded by the Grant Lock waits (5 s for a
 * Disconnect, 15 s for a grant store) and the 8 s revoke, so a waiter here waits 20 s. At most four
 * sections run at once per process, each holding the lock connection plus at most one more, so the
 * pool is never exhausted; a waiter for a holder slot holds no connection. The lock transaction
 * writes nothing itself, so a commit that fails after `work` returned leaves `work`'s result standing.
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
      { waitDeadlineMs: XERO_CONNECTION_LOCK_WAIT_MS, maxConcurrentHolders: XERO_CONNECTION_LOCK_MAX_HOLDERS },
    )
  } catch (error) {
    const finished = attempt.finished
    if (finished && error instanceof AdvisoryLockUnavailableError && error.reason === 'commit_unknown') {
      getTelemetryRuntime()?.reportError(error, { module: 'sync_xero', code: 'sync_xero.connection_lock_commit_unknown' })
      return finished.value
    }
    throw error
  }
}
