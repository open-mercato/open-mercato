/** @jest-environment node */
import { Booking, Lease, Unit } from '../data/entities'
import { FakeEm, type EntityClass, type Where } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

import {
  findBookingListInTerm,
  findBookingsInTerm,
  findBuildingUnitsEverUsed,
  findUnitBlockerList,
  findUnitBlockerListsByUnit,
  findUpcomingBookingList,
  findUpcomingBookings,
  USAGE_BLOCKER_LIST_LIMIT,
  usageBlockerConflictBody,
} from '../lib/usageGuards'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const NOW = '2026-11-11T12:00'

function pad(index: number): string {
  return String(index).padStart(3, '0')
}

function seedBookings(em: FakeEm, count: number, unitId: string = 'unit-1'): void {
  for (let index = 0; index < count; index += 1) {
    const day = 12 + Math.floor(index / 24)
    const hour = String(index % 24).padStart(2, '0')
    em.seed(Booking, {
      id: `${unitId}-booking-${pad(index)}`,
      ...scope,
      buildingId: 'b1',
      unitId,
      bookedByPersonId: 'person-1',
      status: index % 2 ? 'pending' : 'confirmed',
      startsAt: `2026-11-${day}T${hour}:00:00`,
      endsAt: `2026-11-${day}T${hour}:30:00`,
      productName: 'Meeting room',
      notes: 'secret',
      deletedAt: null,
    } as never)
  }
}

function spyFindOptions(em: FakeEm): Array<{ entity: string; options: Record<string, unknown> | undefined }> {
  const calls: Array<{ entity: string; options: Record<string, unknown> | undefined }> = []
  const find = em.find.bind(em)
  jest.spyOn(em, 'find').mockImplementation(async (entity: EntityClass, where: Where, options?: Record<string, unknown>) => {
    calls.push({ entity: entity.name, options })
    return find(entity, where, options as never)
  })
  return calls
}

describe('bounded booking blocker lists', () => {
  it('returns at most 100 upcoming bookings in start order with the total of all of them', async () => {
    const em = new FakeEm()
    seedBookings(em, 140)
    const list = await findUpcomingBookingList(em as never, scope, ['unit-1'], { now: NOW })
    expect(list.blockers).toHaveLength(USAGE_BLOCKER_LIST_LIMIT)
    expect(list.total).toBe(140)
    expect(list.blockers[0].id).toBe('unit-1-booking-000')
    expect(list.blockers[99].id).toBe('unit-1-booking-099')
    expect(await findUpcomingBookings(em as never, scope, ['unit-1'], NOW)).toHaveLength(USAGE_BLOCKER_LIST_LIMIT)
  })

  it('never selects the booking notes and caps the query with a limit', async () => {
    const em = new FakeEm()
    seedBookings(em, 3)
    const calls = spyFindOptions(em)
    await findUpcomingBookingList(em as never, scope, ['unit-1'], { now: NOW })
    await findBookingListInTerm(em as never, scope, 'unit-1', { startsOn: '2026-11-01', endsOn: '2026-12-31' }, { now: NOW })
    const bookingReads = calls.filter((call) => call.entity === 'Booking')
    expect(bookingReads).toHaveLength(2)
    for (const read of bookingReads) {
      expect(read.options?.fields).toEqual(['id', 'unitId', 'productName', 'startsAt', 'endsAt'])
      expect(read.options?.fields).not.toContain('notes')
      expect(read.options?.limit).toBe(USAGE_BLOCKER_LIST_LIMIT)
    }
  })

  it('counts only when the page is full', async () => {
    const em = new FakeEm()
    seedBookings(em, 5)
    const count = jest.spyOn(em, 'count')
    const small = await findUpcomingBookingList(em as never, scope, ['unit-1'], { now: NOW })
    expect(small.total).toBe(5)
    expect(count).not.toHaveBeenCalled()
    const capped = await findUpcomingBookingList(em as never, scope, ['unit-1'], { now: NOW, limit: 2 })
    expect(capped).toMatchObject({ total: 5 })
    expect(capped.blockers).toHaveLength(2)
    expect(count).toHaveBeenCalledTimes(1)
  })

  it('bounds the bookings inside a lease term and keeps the array helper compatible', async () => {
    const em = new FakeEm()
    seedBookings(em, 130)
    const term = { startsOn: '2026-11-01', endsOn: '2026-12-31' }
    const list = await findBookingListInTerm(em as never, scope, 'unit-1', term, { now: NOW })
    expect(list.blockers).toHaveLength(USAGE_BLOCKER_LIST_LIMIT)
    expect(list.total).toBe(130)
    expect(await findBookingsInTerm(em as never, scope, 'unit-1', term, NOW)).toHaveLength(USAGE_BLOCKER_LIST_LIMIT)
  })

  it('puts leases first, caps the merged list and counts leases plus every booking', async () => {
    const em = new FakeEm()
    seedBookings(em, 120)
    em.seed(Lease, {
      id: 'lease-1',
      ...scope,
      unitId: 'unit-1',
      reference: 'L-2026-001',
      status: 'active',
      startsOn: '2026-01-01',
      endsOn: '2099-12-31',
      deletedAt: null,
    } as never)
    const list = await findUnitBlockerList(em as never, scope, ['unit-1'], { now: NOW })
    expect(list.blockers).toHaveLength(USAGE_BLOCKER_LIST_LIMIT)
    expect(list.blockers[0]).toMatchObject({ kind: 'lease', id: 'lease-1' })
    expect(list.total).toBe(121)
  })

  it('builds 409 bodies with at most 100 blockers and the total count', () => {
    const blockers = Array.from({ length: 150 }, (_, index) => ({ kind: 'booking' as const, id: `b-${index}`, label: 'x', unitId: 'unit-1', until: null }))
    const body = usageBlockerConflictBody({ blockers, total: 150 })
    expect(body.blockers).toHaveLength(USAGE_BLOCKER_LIST_LIMIT)
    expect(body.blockerCount).toBe(150)
  })
})

describe('per-unit blocker lists for the unit list', () => {
  it('ranks bookings per unit in SQL, reads only the ranked ids without notes and keeps each unit total', async () => {
    const em = new FakeEm()
    seedBookings(em, 15, 'unit-1')
    seedBookings(em, 2, 'unit-2')
    em.respond = (sql, params) => {
      if (!sql.includes('row_number() over (partition by unit_id')) return []
      const [organizationId, tenantId, ...rest] = params as string[]
      const perUnit = Number(rest[rest.length - 1])
      const endsAfter = String(rest[rest.length - 2])
      const statuses = rest.slice(-4, -2)
      const unitIds = rest.slice(0, -4)
      const rows = em
        .rows(Booking)
        .filter((row) => row.organizationId === organizationId && row.tenantId === tenantId && !row.deletedAt)
        .filter((row) => unitIds.includes(String(row.unitId)) && statuses.includes(String(row.status)) && String(row.endsAt) > endsAfter)
        .sort((left, right) => String(left.startsAt).localeCompare(String(right.startsAt)))
      return unitIds.flatMap((unitId) => {
        const mine = rows.filter((row) => row.unitId === unitId)
        return mine.slice(0, perUnit).map((row) => ({ id: row.id, unit_id: unitId, unit_total: String(mine.length) }))
      })
    }
    const calls = spyFindOptions(em)
    const lists = await findUnitBlockerListsByUnit(em as never, scope, ['unit-1', 'unit-2', 'unit-3'], 10, NOW)
    expect(lists.get('unit-1')?.blockers).toHaveLength(10)
    expect(lists.get('unit-1')?.total).toBe(15)
    expect(lists.get('unit-2')).toMatchObject({ total: 2 })
    expect(lists.get('unit-2')?.blockers.map((blocker) => blocker.unitId)).toEqual(['unit-2', 'unit-2'])
    expect(lists.get('unit-3')).toEqual({ blockers: [], total: 0 })
    const [{ sql, params }] = em.executed
    expect(sql).toMatch(/organization_id = \?\s+and tenant_id = \?/)
    expect(sql).toMatch(/deleted_at is null/)
    expect(params[params.length - 1]).toBe(10)
    const bookingRead = calls.find((call) => call.entity === 'Booking')
    expect(bookingRead?.options?.fields).not.toContain('notes')
  })
})

describe('building usage', () => {
  it('checks soft-deleted units of the building as well as live ones', async () => {
    const em = new FakeEm()
    em.seed(Unit, { id: 'unit-live', ...scope, buildingId: 'b1', deletedAt: null } as never)
    em.seed(Unit, { id: 'unit-deleted', ...scope, buildingId: 'b1', deletedAt: new Date() } as never)
    em.seed(Unit, { id: 'unit-other', ...scope, buildingId: 'b2', deletedAt: null } as never)
    em.seed(Lease, { id: 'lease-1', ...scope, unitId: 'unit-deleted', status: 'ended' } as never)
    expect(await findBuildingUnitsEverUsed(em as never, scope, 'b1')).toEqual(['unit-deleted'])
    expect(em.executed[0].params).toEqual([scope.organizationId, scope.tenantId, 'unit-live', 'unit-deleted'])
  })
})
