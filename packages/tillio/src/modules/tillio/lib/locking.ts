import type { EntityManager } from '@mikro-orm/postgresql'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'

/**
 * Runs `run` with a scope-wide lock held. Both call sites read state, talk to Tillio and then
 * write, and neither store underneath them offers a compare-and-set, so re-checking before the
 * write can only narrow the race, never close it.
 *
 * `pg_advisory_xact_lock` is the same primitive `attachments`, `notifications` and `sso` use, and
 * it releases with the transaction, so a request that dies mid-section cannot leave it held. The
 * transaction exists to own the lock: the work inside writes through its own services and is not
 * made atomic by it.
 */
export type TillioLockRunner = <T>(run: () => Promise<T>) => Promise<T>

export function createTillioLock(em: EntityManager, key: string): TillioLockRunner {
  return async <T>(run: () => Promise<T>): Promise<T> =>
    em.transactional(async (tx) => {
      await tx.getConnection().execute('select pg_advisory_xact_lock(hashtext(?::text))', [key])
      return run()
    })
}

export function tillioOperatorLockKey(scope: IntegrationScope): string {
  return `tillio:operators:${scope.tenantId}:${scope.organizationId}`
}

export function tillioPullLockKey(scope: IntegrationScope): string {
  return `tillio:pull:${scope.tenantId}:${scope.organizationId}`
}
