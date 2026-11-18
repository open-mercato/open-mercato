import type { EntityManager } from '@mikro-orm/postgresql'
import { HOLDING_BOOKING_STATUSES } from './usageGuards'
import { addDays } from './leaseTerm'
import { localNow, normalizeWallClock, toStoredWallClock } from './wallClock'
import type { Scope } from './productUse'

export function bookingTermBounds(term: { startsOn: string; endsOn: string }, now: string = localNow()): { startsBefore: string; endsAfter: string } {
  const termStart = `${term.startsOn}T00:00`
  const current = normalizeWallClock(now)
  return { startsBefore: `${addDays(term.endsOn, 1)}T00:00`, endsAfter: current > termStart ? current : termStart }
}

export async function findUnitsWithBookingsInTerm(
  em: EntityManager,
  scope: Scope,
  unitIds: readonly string[],
  term: { startsOn: string; endsOn: string },
  now: string = localNow(),
): Promise<Set<string>> {
  const ids = Array.from(new Set(unitIds))
  if (!ids.length) return new Set()
  const bounds = bookingTermBounds(term, now)
  const rows = await em.getConnection().execute<Array<{ unit_id: string }>>(
    `select distinct unit_id from property_management_bookings
     where organization_id = ?
       and tenant_id = ?
       and unit_id in (${ids.map(() => '?').join(', ')})
       and status in (${HOLDING_BOOKING_STATUSES.map(() => '?').join(', ')})
       and starts_at < ?
       and ends_at > ?
       and deleted_at is null`,
    [
      scope.organizationId,
      scope.tenantId,
      ...ids,
      ...HOLDING_BOOKING_STATUSES,
      toStoredWallClock(bounds.startsBefore),
      toStoredWallClock(bounds.endsAfter),
    ],
    'all',
    em.getTransactionContext(),
  )
  return new Set(rows.map((row) => String(row.unit_id)))
}
