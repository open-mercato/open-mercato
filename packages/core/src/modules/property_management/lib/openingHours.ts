import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Booking, OpeningHours } from '../data/entities'
import type { OpeningHoursEntry } from '../data/validators'
import type { OpeningWindow } from './bookingSlots'
import { HOLDING_BOOKING_STATUSES, type UsageBlocker } from './usageGuards'
import {
  localNow,
  MINUTES_PER_DAY,
  normalizeWallClock,
  timeOfDayToMinutes,
  toStoredWallClock,
} from './wallClock'
import type { Scope } from './productUse'

export const CLOSED_WINDOW: OpeningWindow = { opensAt: '00:00', closesAt: '00:00' }

export type WeeklyHours = Map<number, OpeningWindow>

export type BuildingOpening = { enabled: boolean; weekly: WeeklyHours }

export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

function trimSeconds(value: string): string {
  return value.trim().slice(0, 5)
}

export function toWeeklyHours(rows: ReadonlyArray<{ weekday: number; opensAt: string; closesAt: string }>): WeeklyHours {
  const weekly: WeeklyHours = new Map()
  for (const row of rows) weekly.set(row.weekday, { opensAt: trimSeconds(row.opensAt), closesAt: trimSeconds(row.closesAt) })
  return weekly
}

export function serializeWeeklyHours(weekly: WeeklyHours): OpeningHoursEntry[] {
  return Array.from(weekly.entries())
    .sort(([left], [right]) => left - right)
    .map(([weekday, window]) => ({ weekday, opensAt: window.opensAt, closesAt: window.closesAt }))
}

export function sameOpeningHours(left: readonly OpeningHoursEntry[], right: readonly OpeningHoursEntry[]): boolean {
  const normalized = (entries: readonly OpeningHoursEntry[]) => JSON.stringify(serializeWeeklyHours(toWeeklyHours(entries)))
  return normalized(left) === normalized(right)
}

export function openingWindowFor(opening: BuildingOpening | null, date: string): OpeningWindow | null {
  if (!opening || !opening.enabled) return null
  return opening.weekly.get(weekdayOf(date)) ?? CLOSED_WINDOW
}

export async function loadOpeningHours(em: EntityManager, scope: Scope, buildingIds: readonly string[]): Promise<Map<string, WeeklyHours>> {
  const result = new Map<string, WeeklyHours>()
  if (!buildingIds.length) return result
  const rows = await findWithDecryption(
    em,
    OpeningHours,
    { ...scope, buildingId: { $in: [...buildingIds] } },
    { orderBy: { weekday: 'asc' } },
    scope,
  )
  for (const buildingId of buildingIds) {
    result.set(buildingId, toWeeklyHours(rows.filter((row) => row.buildingId === buildingId)))
  }
  return result
}

export async function loadBuildingOpening(
  em: EntityManager,
  scope: Scope,
  building: { id: string; openingHoursEnabled: boolean },
): Promise<BuildingOpening> {
  if (!building.openingHoursEnabled) return { enabled: false, weekly: new Map() }
  const weekly = (await loadOpeningHours(em, scope, [building.id])).get(building.id) ?? new Map()
  return { enabled: true, weekly }
}

export async function replaceOpeningHours(
  em: EntityManager,
  scope: Scope,
  buildingId: string,
  entries: readonly OpeningHoursEntry[],
): Promise<void> {
  const existing = await findWithDecryption(em, OpeningHours, { ...scope, buildingId }, undefined, scope)
  for (const row of existing) em.remove(row)
  await em.flush()
  for (const entry of entries) {
    em.persist(
      em.create(OpeningHours, {
        ...scope,
        buildingId,
        weekday: entry.weekday,
        opensAt: `${trimSeconds(entry.opensAt)}:00`,
        closesAt: `${trimSeconds(entry.closesAt)}:00`,
      }),
    )
  }
  await em.flush()
}

export type BookingOutsideHours = UsageBlocker & { productName: string; startsAt: string; endsAt: string }

export const OUTSIDE_HOURS_LIST_LIMIT = 100

export type BookingsOutsideHours = { bookings: BookingOutsideHours[]; total: number }

export function openWindowsCondition(opening: BuildingOpening): { sql: string; params: number[] } {
  const clauses: string[] = []
  const params: number[] = []
  const entries = Array.from(opening.weekly.entries()).sort(([left], [right]) => left - right)
  for (const [weekday, window] of entries) {
    const opensAt = timeOfDayToMinutes(window.opensAt)
    const closesAt = timeOfDayToMinutes(window.closesAt)
    if (opensAt === null || closesAt === null || closesAt <= opensAt || closesAt > MINUTES_PER_DAY) continue
    clauses.push(
      '(extract(isodow from starts_at) = ?::int and starts_at >= starts_at::date + make_interval(mins => ?::int) and ends_at <= starts_at::date + make_interval(mins => ?::int))',
    )
    params.push(weekday + 1, opensAt, closesAt)
  }
  return { sql: clauses.length ? clauses.join(' or ') : 'false', params }
}

type OutsideHoursRow = { id: string; total: string | number }

export async function findBookingsOutsideHours(
  em: EntityManager,
  scope: Scope,
  buildingId: string,
  opening: BuildingOpening,
  now: string = localNow(),
  limit: number = OUTSIDE_HOURS_LIST_LIMIT,
): Promise<BookingsOutsideHours> {
  if (!opening.enabled) return { bookings: [], total: 0 }
  const windows = openWindowsCondition(opening)
  const statuses = [...HOLDING_BOOKING_STATUSES]
  const rows = await em.getConnection().execute<OutsideHoursRow[]>(
    `select id, count(*) over () as total from property_management_bookings
      where organization_id = ? and tenant_id = ? and building_id = ?
        and status in (${statuses.map(() => '?').join(', ')})
        and ends_at > ?::timestamp and deleted_at is null
        and not (${windows.sql})
      order by starts_at asc, id asc
      limit ?::int`,
    [scope.organizationId, scope.tenantId, buildingId, ...statuses, toStoredWallClock(now), ...windows.params, limit],
  )
  if (!rows.length) return { bookings: [], total: 0 }
  const ids = rows.map((row) => String(row.id))
  const records = await findWithDecryption(
    em,
    Booking,
    { ...scope, id: { $in: ids } },
    { fields: ['id', 'unitId', 'productName', 'startsAt', 'endsAt'] },
    scope,
  )
  const byId = new Map(records.map((booking) => [booking.id, booking]))
  const bookings = ids.flatMap((id) => {
    const booking = byId.get(id)
    if (!booking) return []
    const range = { start: normalizeWallClock(booking.startsAt), end: normalizeWallClock(booking.endsAt) }
    return [{
      kind: 'booking' as const,
      id: booking.id,
      label: `${booking.productName} · ${range.start}`,
      unitId: booking.unitId,
      until: range.end,
      productName: booking.productName,
      startsAt: range.start,
      endsAt: range.end,
    }]
  })
  return { bookings, total: Number(rows[0].total) || bookings.length }
}
