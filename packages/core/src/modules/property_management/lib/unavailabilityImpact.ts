import { createHash } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Booking, Building, Floor, Lease, Space, Unit, type BookingStatus, type UnavailabilitySubjectType } from '../data/entities'
import { isBuildingPermitted, type PermittedBuildings } from './buildingAccess'
import { notFoundError } from './errors'
import { reservedEndSql, reservedStartSql } from './leaseAvailability'
import { RESERVING_LEASE_STATUSES } from './leaseOccupancy'
import { localToday } from './leaseTerm'
import { HOLDING_BOOKING_STATUSES } from './usageGuards'
import { addMinutes, compareWallClock, datePartOf, toStoredWallClock } from './wallClock'
import type { OpenRange } from './availabilityResolver'
import type { Scope } from './productUse'

export const INLINE_CANCEL_LIMIT = 200
export const PREVIEW_LIST_LIMIT = 100

const PREVIEW_UNIT_FIELDS = ['id', 'name']
const PREVIEW_BOOKING_FIELDS = ['id', 'unitId', 'startsAt', 'endsAt', 'bookedByPersonId']
const PREVIEW_LEASE_FIELDS = ['id', 'unitId', 'reference', 'customerCompanyId', 'startsOn', 'endsOn', 'pendingChange']
export const CONFIRM_BOOKING_FIELDS = [...PREVIEW_BOOKING_FIELDS, 'salesOrderId']
export const CONFIRM_UNIT_FIELDS = ['id']

export type UnavailabilitySubject = {
  type: UnavailabilitySubjectType
  id: string
  name: string
  buildingId: string
  floorId: string | null
}

export type ClosureBookingSummary = { count: number; previewToken: string; needsCancelledStatus: boolean }

export type ClosureImpact = {
  units: Unit[]
  bookings: Booking[]
  bookingCount: number
  previewToken: string
  bookingsNeedCancelledStatus: boolean
  leases: Lease[]
  leaseCount: number
}

export function unitFilterOf(subject: { type: UnavailabilitySubjectType; id: string }): Record<string, string> {
  if (subject.type === 'building') return { buildingId: subject.id }
  if (subject.type === 'floor') return { floorId: subject.id }
  if (subject.type === 'space') return { spaceId: subject.id }
  return { id: subject.id }
}

async function subjectNotFound(): Promise<never> {
  throw await notFoundError('property_management.errors.unavailabilitySubjectNotFound', 'The building, floor, space or unit was not found.')
}

export async function loadUnavailabilitySubject(
  em: EntityManager,
  scope: Scope,
  permitted: PermittedBuildings,
  type: UnavailabilitySubjectType,
  id: string,
): Promise<UnavailabilitySubject> {
  const where = { id, ...scope, deletedAt: null }
  let subject: UnavailabilitySubject | null = null
  if (type === 'building') {
    const building = await findOneWithDecryption(em, Building, where, undefined, scope)
    if (building) subject = { type, id, name: building.name, buildingId: building.id, floorId: null }
  } else if (type === 'floor') {
    const floor = await findOneWithDecryption(em, Floor, where, undefined, scope)
    if (floor) subject = { type, id, name: floor.name, buildingId: floor.buildingId, floorId: floor.id }
  } else if (type === 'space') {
    const space = await findOneWithDecryption(em, Space, where, undefined, scope)
    if (space) subject = { type, id, name: space.name, buildingId: space.buildingId, floorId: space.floorId }
  } else {
    const unit = await findOneWithDecryption(em, Unit, where, undefined, scope)
    if (unit) subject = { type, id, name: unit.name, buildingId: unit.buildingId, floorId: unit.floorId }
  }
  if (!subject || !isBuildingPermitted(permitted, subject.buildingId)) return subjectNotFound()
  return subject
}

export async function assertSubjectStillExists(em: EntityManager, scope: Scope, subject: UnavailabilitySubject): Promise<void> {
  if (subject.type !== 'space' && subject.type !== 'unit') return
  const where = { id: subject.id, ...scope, deletedAt: null }
  const current = subject.type === 'space'
    ? await findOneWithDecryption(em, Space, where, { refresh: true, fields: ['id'] }, scope)
    : await findOneWithDecryption(em, Unit, where, { refresh: true, fields: ['id'] }, scope)
  if (!current) await subjectNotFound()
}

export type PreviewTokenBinding = {
  subjectType: UnavailabilitySubjectType
  subjectId: string
  start: string
  end: string | null
}

export function previewTokenPrefix(binding: PreviewTokenBinding): string {
  return `${binding.subjectType}|${binding.subjectId}|${binding.start}|${binding.end ?? ''}|`
}

export function previewTokenOf(binding: PreviewTokenBinding, bookingIds: readonly string[]): string {
  const canonical = [...bookingIds].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join(',')
  return createHash('sha256').update(`${previewTokenPrefix(binding)}${canonical}`).digest('hex')
}

function bindingOf(subject: { type: UnavailabilitySubjectType; id: string }, range: OpenRange & { start: string }): PreviewTokenBinding {
  return { subjectType: subject.type, subjectId: subject.id, start: range.start, end: range.end }
}

export function closureDates(range: OpenRange & { start: string }): { startsOn: string; endsOn: string | null } {
  return {
    startsOn: datePartOf(range.start),
    endsOn: range.end === null ? null : datePartOf(addMinutes(range.end, -1)),
  }
}

function closureBookingsFrom(range: OpenRange & { start: string }, now: string): string {
  return compareWallClock(range.start, now) > 0 ? range.start : now
}

function closureBookingWhere(
  scope: Scope,
  unitIds: readonly string[],
  range: OpenRange & { start: string },
  now: string,
  excludeIds?: readonly string[],
): FilterQuery<Booking> {
  const from = closureBookingsFrom(range, now)
  const where: Record<string, unknown> = {
    ...scope,
    unitId: { $in: [...unitIds] },
    status: { $in: [...HOLDING_BOOKING_STATUSES] },
    endsAt: { $gt: toStoredWallClock(from) },
    deletedAt: null,
  }
  if (range.end !== null) where.startsAt = { $lt: toStoredWallClock(range.end) }
  if (excludeIds?.length) where.id = { $nin: [...excludeIds] }
  return where as FilterQuery<Booking>
}

export async function findClosureBookings(
  em: EntityManager,
  scope: Scope,
  unitIds: readonly string[],
  range: OpenRange & { start: string },
  now: string,
  options: { limit?: number; excludeIds?: readonly string[]; fields?: readonly string[] } = {},
): Promise<Booking[]> {
  if (!unitIds.length) return []
  return findWithDecryption(
    em,
    Booking,
    closureBookingWhere(scope, unitIds, range, now, options.excludeIds),
    {
      orderBy: { startsAt: 'asc', id: 'asc' },
      refresh: true,
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.fields ? { fields: [...options.fields] } : {}),
    },
    scope,
  )
}

export async function countClosureBookings(
  em: EntityManager,
  scope: Scope,
  unitIds: readonly string[],
  range: OpenRange & { start: string },
  now: string,
): Promise<number> {
  if (!unitIds.length) return 0
  return em.count(Booking, closureBookingWhere(scope, unitIds, range, now))
}

const TOKEN_BOOKING_STATUSES: readonly BookingStatus[] = [...HOLDING_BOOKING_STATUSES, 'completed']
const PENDING_BOOKING_STATUS: BookingStatus = 'pending'

type ClosureBookingSummaryRow = { total: number | string; token: string | null; needs_cancelled_status: boolean | string | null }

export async function summarizeClosureBookings(
  em: EntityManager,
  scope: Scope,
  subject: { type: UnavailabilitySubjectType; id: string },
  unitIds: readonly string[],
  range: OpenRange & { start: string },
  now: string,
): Promise<ClosureBookingSummary> {
  const binding = bindingOf(subject, range)
  if (!unitIds.length) return { count: 0, previewToken: previewTokenOf(binding, []), needsCancelledStatus: false }
  const holding = [...HOLDING_BOOKING_STATUSES]
  const tokenStatuses = [...TOKEN_BOOKING_STATUSES]
  const params: unknown[] = [
    ...holding,
    toStoredWallClock(closureBookingsFrom(range, now)),
    scope.organizationId,
    scope.tenantId,
    ...unitIds,
    ...tokenStatuses,
    toStoredWallClock(range.start),
  ]
  if (range.end !== null) params.push(toStoredWallClock(range.end))
  params.push(previewTokenPrefix(binding), PENDING_BOOKING_STATUS)
  const rows = await em.getConnection().execute<ClosureBookingSummaryRow[]>(
    `with candidates as (
       select id,
              sales_order_id,
              status,
              (status in (${holding.map(() => '?').join(', ')}) and ends_at > ?::timestamp) as affected
         from property_management_bookings
        where organization_id = ?
          and tenant_id = ?
          and unit_id in (${unitIds.map(() => '?').join(', ')})
          and status in (${tokenStatuses.map(() => '?').join(', ')})
          and ends_at > ?::timestamp
          ${range.end !== null ? 'and starts_at < ?::timestamp' : ''}
          and deleted_at is null
     )
     select count(*) filter (where affected)::int as total,
            encode(sha256(convert_to(?::text || coalesce(string_agg(id::text, ',' order by id), ''), 'UTF8')), 'hex') as token,
            coalesce(bool_or(sales_order_id is not null or status = ?) filter (where affected), false) as needs_cancelled_status
       from candidates`,
    params,
    'all',
    em.getTransactionContext(),
  )
  const row = rows[0]
  return {
    count: row ? Number(row.total) : 0,
    previewToken: row?.token ?? previewTokenOf(binding, []),
    needsCancelledStatus: row?.needs_cancelled_status === true || row?.needs_cancelled_status === 't' || row?.needs_cancelled_status === 'true',
  }
}

type ClosureLeaseQuery = { sql: string; params: unknown[] }

function closureLeaseQuery(
  select: string,
  scope: Scope,
  unitIds: readonly string[],
  range: OpenRange & { start: string },
  today: string,
): ClosureLeaseQuery {
  const dates = closureDates(range)
  const statuses = [...RESERVING_LEASE_STATUSES]
  const reservedEnd = reservedEndSql('lease')
  const params: unknown[] = [scope.organizationId, scope.tenantId, ...unitIds, ...statuses, today, dates.startsOn]
  if (dates.endsOn !== null) params.push(dates.endsOn)
  return {
    sql: `select ${select}
       from property_management_leases lease
      where lease.organization_id = ?
        and lease.tenant_id = ?
        and lease.unit_id in (${unitIds.map(() => '?').join(', ')})
        and lease.status in (${statuses.map(() => '?').join(', ')})
        and lease.deleted_at is null
        and ${reservedEnd} >= ?::date
        and ${reservedEnd} >= ?::date
        ${dates.endsOn !== null ? `and ${reservedStartSql('lease')} <= ?::date` : ''}`,
    params,
  }
}

export async function findClosureLeases(
  em: EntityManager,
  scope: Scope,
  unitIds: readonly string[],
  range: OpenRange & { start: string },
  today: string = localToday(),
  options: { fields?: readonly string[]; limit?: number } = {},
): Promise<Lease[]> {
  if (!unitIds.length) return []
  const query = closureLeaseQuery('lease.id', scope, unitIds, range, today)
  const limit = options.limit ? ' limit ?' : ''
  const rows = await em.getConnection().execute<Array<{ id: string }>>(
    `${query.sql}
      order by lease.starts_on asc, lease.id asc${limit}`,
    options.limit ? [...query.params, options.limit] : query.params,
    'all',
    em.getTransactionContext(),
  )
  const ids = rows.map((row) => String(row.id))
  if (!ids.length) return []
  const leases = await findWithDecryption(
    em,
    Lease,
    { ...scope, id: { $in: ids }, deletedAt: null },
    options.fields ? { fields: [...options.fields] } : undefined,
    scope,
  )
  const position = new Map(ids.map((id, index) => [id, index]))
  return leases.sort((left, right) => (position.get(left.id) ?? 0) - (position.get(right.id) ?? 0))
}

export async function countClosureLeases(
  em: EntityManager,
  scope: Scope,
  unitIds: readonly string[],
  range: OpenRange & { start: string },
  today: string = localToday(),
): Promise<number> {
  if (!unitIds.length) return 0
  const query = closureLeaseQuery('count(*)::int as total', scope, unitIds, range, today)
  const rows = await em.getConnection().execute<Array<{ total: number | string }>>(query.sql, query.params, 'all', em.getTransactionContext())
  return rows[0] ? Number(rows[0].total) : 0
}

export async function findSubjectUnits(
  em: EntityManager,
  scope: Scope,
  subject: { type: UnavailabilitySubjectType; id: string },
  options: { lock?: boolean; fields?: readonly string[] } = {},
): Promise<Unit[]> {
  return findWithDecryption(
    em,
    Unit,
    { ...scope, ...unitFilterOf(subject), deletedAt: null },
    {
      orderBy: { id: 'asc' },
      refresh: true,
      ...(options.lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
      ...(options.fields ? { fields: [...options.fields] } : {}),
    },
    scope,
  )
}

export async function computeClosureImpact(
  em: EntityManager,
  scope: Scope,
  subject: { type: UnavailabilitySubjectType; id: string },
  range: OpenRange & { start: string },
  now: string,
  options: {
    bookingLimit: number
    lockUnits?: boolean
    preview?: boolean
    unitFields?: readonly string[]
    bookingFields?: readonly string[]
    leaseFields?: readonly string[]
    countLeasesOnly?: boolean
  },
): Promise<ClosureImpact> {
  const unitFields = options.unitFields ?? (options.preview ? PREVIEW_UNIT_FIELDS : undefined)
  const units = await findSubjectUnits(em, scope, subject, { lock: options.lockUnits, fields: unitFields })
  const unitIds = units.map((unit) => unit.id)
  const summary = await summarizeClosureBookings(em, scope, subject, unitIds, range, now)
  const bookingFields = options.bookingFields ?? (options.preview ? PREVIEW_BOOKING_FIELDS : undefined)
  const bookings = summary.count > 0
    ? await findClosureBookings(em, scope, unitIds, range, now, { limit: options.bookingLimit, fields: bookingFields })
    : []
  const today = localToday()
  const leaseFields = options.leaseFields ?? (options.preview ? PREVIEW_LEASE_FIELDS : undefined)
  const leaseCount = await countClosureLeases(em, scope, unitIds, range, today)
  const leases = options.countLeasesOnly || leaseCount === 0
    ? []
    : await findClosureLeases(em, scope, unitIds, range, today, { fields: leaseFields, limit: PREVIEW_LIST_LIMIT })
  return {
    units,
    bookings,
    bookingCount: summary.count,
    previewToken: summary.previewToken,
    bookingsNeedCancelledStatus: summary.needsCancelledStatus,
    leases,
    leaseCount,
  }
}
