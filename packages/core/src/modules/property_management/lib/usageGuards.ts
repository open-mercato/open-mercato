import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Booking, Lease, Unit, type BookingStatus } from '../data/entities'
import { isCurrentOrUpcoming, RESERVING_LEASE_STATUSES } from './leaseOccupancy'
import { addDays, reservedInterval } from './leaseTerm'
import { localNow, normalizeWallClock, toStoredWallClock } from './wallClock'
import type { Scope } from './productUse'

export type UsageBlocker = {
  kind: 'lease' | 'booking'
  id: string
  label: string
  unitId: string
  until: string | null
  startsAt?: string
  endsAt?: string
  startsOn?: string
  endsOn?: string
}

export const USAGE_BLOCKER_LIST_LIMIT = 100

export const UNIT_LIST_BLOCKER_LIMIT = 10

export type UsageBlockerList = { blockers: UsageBlocker[]; total: number }

export type UsageBlockerListOptions = { now?: string; limit?: number }

export type UsageBlockerConflictBody = { blockers: UsageBlocker[]; blockerCount: number }

const BOOKING_BLOCKER_FIELDS = ['id', 'unitId', 'productName', 'startsAt', 'endsAt'] as const

function listLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return USAGE_BLOCKER_LIST_LIMIT
  return Math.min(USAGE_BLOCKER_LIST_LIMIT, Math.max(1, Math.floor(limit)))
}

export function usageBlockerListOf(blockers: readonly UsageBlocker[], limit?: number): UsageBlockerList {
  return { blockers: blockers.slice(0, listLimit(limit)), total: blockers.length }
}

export function usageBlockerConflictBody(list: UsageBlockerList): UsageBlockerConflictBody {
  return { blockers: list.blockers.slice(0, USAGE_BLOCKER_LIST_LIMIT), blockerCount: Math.max(list.total, list.blockers.length) }
}

export async function findActiveLeases(em: EntityManager, scope: Scope, unitIds: readonly string[]): Promise<UsageBlocker[]> {
  if (!unitIds.length) return []
  const leases = await findWithDecryption(
    em,
    Lease,
    { ...scope, unitId: { $in: [...unitIds] }, status: { $in: RESERVING_LEASE_STATUSES }, deletedAt: null },
    { orderBy: { startsOn: 'asc' } },
    scope,
  )
  return leaseBlockersOf(leases)
}

export function leaseBlockersOf(leases: readonly Lease[]): UsageBlocker[] {
  return leases
    .filter((lease) => RESERVING_LEASE_STATUSES.includes(lease.status))
    .map((lease) => ({ lease, reserved: reservedInterval(lease) }))
    .filter(({ reserved }) => isCurrentOrUpcoming(reserved))
    .map(({ lease, reserved }) => ({
      kind: 'lease' as const,
      id: lease.id,
      label: lease.reference,
      unitId: lease.unitId,
      until: reserved.endsOn,
      startsOn: reserved.startsOn,
      endsOn: reserved.endsOn,
    }))
}

export const HOLDING_BOOKING_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed']

function bookingBlocker(booking: Booking): UsageBlocker {
  const startsAt = normalizeWallClock(booking.startsAt)
  const endsAt = normalizeWallClock(booking.endsAt)
  return { kind: 'booking', id: booking.id, label: `${booking.productName} · ${startsAt}`, unitId: booking.unitId, until: endsAt, startsAt, endsAt }
}

type BookingRangeWhere = { unitId: string | { $in: string[] }; startsAt?: { $lt: string }; endsAt: { $gt: string } }

async function listHoldingBookings(
  em: EntityManager,
  scope: Scope,
  where: BookingRangeWhere,
  limit: number | undefined,
): Promise<UsageBlockerList> {
  const size = listLimit(limit)
  const filter: FilterQuery<Booking> = { ...scope, ...where, status: { $in: [...HOLDING_BOOKING_STATUSES] }, deletedAt: null }
  const bookings = await findWithDecryption(
    em,
    Booking,
    filter,
    { fields: [...BOOKING_BLOCKER_FIELDS], orderBy: { startsAt: 'asc', id: 'asc' }, limit: size },
    scope,
  )
  const total = bookings.length < size ? bookings.length : await em.count(Booking, filter)
  return { blockers: bookings.map(bookingBlocker), total: Math.max(total, bookings.length) }
}

export async function findUpcomingBookingList(
  em: EntityManager,
  scope: Scope,
  unitIds: readonly string[],
  options: UsageBlockerListOptions = {},
): Promise<UsageBlockerList> {
  const ids = Array.from(new Set(unitIds))
  if (!ids.length) return { blockers: [], total: 0 }
  return listHoldingBookings(
    em,
    scope,
    { unitId: { $in: ids }, endsAt: { $gt: toStoredWallClock(options.now ?? localNow()) } },
    options.limit,
  )
}

export async function findUpcomingBookings(
  em: EntityManager,
  scope: Scope,
  unitIds: readonly string[],
  now: string = localNow(),
): Promise<UsageBlocker[]> {
  return (await findUpcomingBookingList(em, scope, unitIds, { now })).blockers
}

export async function findUnitsWithUpcomingBookings(
  em: EntityManager,
  scope: Scope,
  unitIds: readonly string[],
  now: string = localNow(),
): Promise<Set<string>> {
  const ids = Array.from(new Set(unitIds))
  if (!ids.length) return new Set()
  const rows = await em.getConnection().execute<Array<{ unit_id: string }>>(
    `select distinct unit_id from property_management_bookings
     where organization_id = ?
       and tenant_id = ?
       and unit_id in (${ids.map(() => '?').join(', ')})
       and status in (${HOLDING_BOOKING_STATUSES.map(() => '?').join(', ')})
       and ends_at > ?
       and deleted_at is null`,
    [scope.organizationId, scope.tenantId, ...ids, ...HOLDING_BOOKING_STATUSES, toStoredWallClock(now)],
    'all',
    em.getTransactionContext(),
  )
  return new Set(rows.map((row) => String(row.unit_id)))
}

export async function findBookingListInTerm(
  em: EntityManager,
  scope: Scope,
  unitId: string,
  term: { startsOn: string; endsOn: string },
  options: UsageBlockerListOptions = {},
): Promise<UsageBlockerList> {
  const termStart = `${term.startsOn}T00:00`
  const now = normalizeWallClock(options.now ?? localNow())
  const notOverAt = now > termStart ? now : termStart
  return listHoldingBookings(
    em,
    scope,
    {
      unitId,
      startsAt: { $lt: toStoredWallClock(`${addDays(term.endsOn, 1)}T00:00`) },
      endsAt: { $gt: toStoredWallClock(notOverAt) },
    },
    options.limit,
  )
}

export async function findBookingsInTerm(
  em: EntityManager,
  scope: Scope,
  unitId: string,
  term: { startsOn: string; endsOn: string },
  now: string = localNow(),
): Promise<UsageBlocker[]> {
  return (await findBookingListInTerm(em, scope, unitId, term, { now })).blockers
}

export async function findUnitBlockerList(
  em: EntityManager,
  scope: Scope,
  unitIds: readonly string[],
  options: UsageBlockerListOptions = {},
): Promise<UsageBlockerList> {
  const leases = await findActiveLeases(em, scope, unitIds)
  const bookings = await findUpcomingBookingList(em, scope, unitIds, options)
  const merged = usageBlockerListOf([...leases, ...bookings.blockers], options.limit)
  return { blockers: merged.blockers, total: leases.length + bookings.total }
}

export async function findUnitBlockers(em: EntityManager, scope: Scope, unitIds: readonly string[]): Promise<UsageBlocker[]> {
  return (await findUnitBlockerList(em, scope, unitIds)).blockers
}

type RankedBookingRow = { id: string; unit_id: string; unit_total: string | number }

export async function findUnitBlockerListsByUnit(
  em: EntityManager,
  scope: Scope,
  unitIds: readonly string[],
  perUnitLimit: number = UNIT_LIST_BLOCKER_LIMIT,
  now: string = localNow(),
): Promise<Map<string, UsageBlockerList>> {
  const ids = Array.from(new Set(unitIds))
  const result = new Map<string, UsageBlockerList>()
  if (!ids.length) return result
  const size = listLimit(perUnitLimit)
  const statuses = [...HOLDING_BOOKING_STATUSES]
  const leases = await findActiveLeases(em, scope, ids)
  const rows = await em.getConnection().execute<RankedBookingRow[]>(
    `select id, unit_id, unit_total from (
       select id, unit_id, starts_at,
              count(*) over (partition by unit_id) as unit_total,
              row_number() over (partition by unit_id order by starts_at asc, id asc) as position
         from property_management_bookings
        where organization_id = ?
          and tenant_id = ?
          and unit_id in (${ids.map(() => '?').join(', ')})
          and status in (${statuses.map(() => '?').join(', ')})
          and ends_at > ?
          and deleted_at is null
     ) ranked
     where position <= ?::int
     order by unit_id asc, starts_at asc, id asc`,
    [scope.organizationId, scope.tenantId, ...ids, ...statuses, toStoredWallClock(now), size],
    'all',
    em.getTransactionContext(),
  )
  const bookingIds = rows.map((row) => String(row.id))
  const records = bookingIds.length
    ? await findWithDecryption(em, Booking, { ...scope, id: { $in: bookingIds } }, { fields: [...BOOKING_BLOCKER_FIELDS] }, scope)
    : []
  const byId = new Map(records.map((booking) => [booking.id, booking]))
  const bookingTotals = new Map<string, number>()
  const bookingsByUnit = new Map<string, UsageBlocker[]>()
  for (const row of rows) {
    const unitId = String(row.unit_id)
    bookingTotals.set(unitId, Number(row.unit_total) || 0)
    const booking = byId.get(String(row.id))
    if (!booking) continue
    bookingsByUnit.set(unitId, [...(bookingsByUnit.get(unitId) ?? []), bookingBlocker(booking)])
  }
  for (const unitId of ids) {
    const unitLeases = leases.filter((lease) => lease.unitId === unitId)
    const unitBookings = bookingsByUnit.get(unitId) ?? []
    const merged = usageBlockerListOf([...unitLeases, ...unitBookings], size)
    result.set(unitId, {
      blockers: merged.blockers,
      total: unitLeases.length + Math.max(bookingTotals.get(unitId) ?? 0, unitBookings.length),
    })
  }
  return result
}

async function findUnitsEverBooked(em: EntityManager, scope: Scope, unitIds: readonly string[]): Promise<string[]> {
  const rows = await em.getConnection().execute<Array<{ unit_id: string }>>(
    `select distinct unit_id from property_management_bookings
     where organization_id = ?
       and tenant_id = ?
       and unit_id in (${unitIds.map(() => '?').join(', ')})`,
    [scope.organizationId, scope.tenantId, ...unitIds],
    'all',
    em.getTransactionContext(),
  )
  return rows.map((row) => String(row.unit_id))
}

export async function findUnitsEverUsed(em: EntityManager, scope: Scope, unitIds: readonly string[]): Promise<string[]> {
  const ids = Array.from(new Set(unitIds))
  if (!ids.length) return []
  const [leases, bookedUnitIds] = await Promise.all([
    findWithDecryption(
      em,
      Lease,
      {
        ...scope,
        unitId: { $in: ids },
        status: { $nin: ['withdrawn', 'expired', 'declined'] },
        $or: [{ deletedAt: null }, { pendingChange: { $ne: null } }, { billingAttention: true }],
      },
      { fields: ['id', 'unitId'] },
      scope,
    ),
    findUnitsEverBooked(em, scope, ids),
  ])
  return Array.from(new Set([...leases.map((lease) => lease.unitId), ...bookedUnitIds]))
}

export async function findBuildingUnitsEverUsed(em: EntityManager, scope: Scope, buildingId: string): Promise<string[]> {
  const units = await findWithDecryption(em, Unit, { ...scope, buildingId }, { fields: ['id'] }, scope)
  return findUnitsEverUsed(em, scope, units.map((unit) => unit.id))
}
