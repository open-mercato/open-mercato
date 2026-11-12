import type { AwilixContainer } from 'awilix'
import {
  canonicalizeResourceTag,
  invalidateCrudCache,
  type CrudCacheIdentifiers,
} from '@open-mercato/shared/lib/crud/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { staffTimeEntryCrudEvents } from '../crud'

const logger = createLogger('staff').child({ component: 'timesheets-cache' })

/**
 * The resource tag the CRUD list cache stores time-entry payloads under.
 *
 * `resolveResourceAliasesList` in the CRUD factory prefers the route's `events`
 * config over the create command id, so the tag follows `staff.timesheets.time_entry`
 * canonicalized (underscores become dots) rather than the command-derived
 * `staff.timesheet`. Deriving it here from the very object the route passes as its
 * `events` config keeps the flush tag equal to the store tag; a hand-typed literal is
 * how a custom write route silently flushes nothing (#3143, #3711). The literal
 * fallback only guards against a null derivation at runtime — the unit test pins the
 * derived value so drift fails in CI instead of in production.
 */
export const staffTimeEntryCacheResource =
  canonicalizeResourceTag(`${staffTimeEntryCrudEvents.module}.${staffTimeEntryCrudEvents.entity}`)
  ?? 'staff.timesheets.time.entry'

/**
 * Flush the cached time-entry collections and record entries after a committed write.
 *
 * Custom write routes that mutate `StaffTimeEntry` through the EntityManager bypass
 * `makeCrudRoute`'s own POST/PUT/DELETE handlers and the command bus, so neither of
 * the platform's two `invalidateCrudCache` call sites runs for them. Without this the
 * opt-in CRUD list cache (`ENABLE_CRUD_API_CACHE`) keeps serving the pre-write payload
 * and the weekly timesheet grid reloads without the rows it just saved (#4970).
 *
 * MUST be called after the transaction commits, never inside it. Because the write is
 * already committed by then, a failing cache backend is logged rather than thrown — the
 * command bus guards its own invalidation the same way. Surfacing it would turn a
 * successful write into an error response and invite a duplicating client retry, while
 * swallowing it costs at most one TTL of staleness.
 */
export async function invalidateStaffTimeEntryCache(
  container: AwilixContainer,
  identifiers: CrudCacheIdentifiers,
  fallbackTenant: string | null,
  reason: string,
): Promise<void> {
  try {
    await invalidateCrudCache(
      container,
      staffTimeEntryCacheResource,
      identifiers,
      fallbackTenant,
      reason,
    )
  } catch (err) {
    logger.warn('Time-entry cache invalidation failed', {
      resource: staffTimeEntryCacheResource,
      recordId: identifiers.id ?? null,
      reason,
      err,
    })
  }
}
