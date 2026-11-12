import type { EntityManager } from '@mikro-orm/postgresql'

const STAFF_TIMER_LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?::text, 0))'

export type StaffTimerLockScope = {
  tenantId: string
  organizationId: string
}

export function staffTimerLockKey(scope: StaffTimerLockScope, staffMemberId: string): string {
  return `staff:timesheets:timer:${scope.tenantId}:${scope.organizationId}:${staffMemberId}`
}

/**
 * Serializes every write that can leave a staff member with a running timer
 * (`started_at IS NOT NULL AND ended_at IS NULL`). The single-active-timer
 * invariant (#2855) belongs to the member, not to any one entry, so a row lock on
 * the entry being opened cannot protect it: two undos of two different stopped
 * entries lock different rows, both read "nothing else running", and both reopen.
 *
 * A transaction-scoped advisory lock keyed by tenant, organization and member is
 * the shared gate instead. PostgreSQL releases it on commit or rollback, so the
 * caller MUST hold an open transaction, and MUST take this lock before any entry
 * row lock so every timer-opening path acquires the two in the same order.
 */
export async function lockStaffMemberTimers(
  em: EntityManager,
  scope: StaffTimerLockScope,
  staffMemberId: string,
): Promise<void> {
  if (!em.isInTransaction()) {
    throw new Error('[internal] The staff timer lock requires an active transaction')
  }
  await em.execute(STAFF_TIMER_LOCK_SQL, [staffTimerLockKey(scope, staffMemberId)])
}
