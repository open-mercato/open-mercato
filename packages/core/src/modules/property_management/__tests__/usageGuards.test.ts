/** @jest-environment node */
import { Booking, Lease } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

import { findBookingsInTerm, findUnitsEverUsed, findUnitsWithUpcomingBookings, findUpcomingBookings, leaseBlockersOf } from '../lib/usageGuards'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const NOW = '2026-11-11T12:00'

function seedBooking(em: FakeEm, id: string, overrides: Partial<Booking>): Booking {
  return em.seed(Booking, {
    id,
    ...scope,
    buildingId: 'b1',
    unitId: 'unit-1',
    bookedByPersonId: 'person-1',
    status: 'confirmed',
    startsAt: '2026-11-12T10:00:00',
    endsAt: '2026-11-12T11:00:00',
    productName: 'Meeting room',
    deletedAt: null,
    ...overrides,
  } as never) as unknown as Booking
}

describe('booking usage guards', () => {
  it('counts pending and confirmed bookings that have not ended yet as upcoming', async () => {
    const em = new FakeEm()
    seedBooking(em, 'future', {})
    seedBooking(em, 'pending', { status: 'pending', startsAt: '2026-11-13T10:00:00', endsAt: '2026-11-13T11:00:00' })
    seedBooking(em, 'running', { startsAt: '2026-11-11T11:00:00', endsAt: '2026-11-11T13:00:00' })
    seedBooking(em, 'past', { startsAt: '2026-11-10T10:00:00', endsAt: '2026-11-10T11:00:00' })
    seedBooking(em, 'cancelled', { status: 'cancelled' })
    seedBooking(em, 'completed', { status: 'completed' })
    seedBooking(em, 'other-unit', { unitId: 'unit-2' })
    const blockers = await findUpcomingBookings(em as never, scope, ['unit-1'], NOW)
    expect(blockers.map((blocker) => blocker.id).sort()).toEqual(['future', 'pending', 'running'])
    expect(blockers.find((blocker) => blocker.id === 'future')).toMatchObject({
      kind: 'booking',
      unitId: 'unit-1',
      until: '2026-11-12T11:00',
      label: 'Meeting room · 2026-11-12T10:00',
      startsAt: '2026-11-12T10:00',
      endsAt: '2026-11-12T11:00',
    })
    expect(await findUpcomingBookings(em as never, scope, [], NOW)).toEqual([])
  })

  it('returns only the ids of units holding an upcoming booking, one per unit, from a scoped distinct query', async () => {
    const em = new FakeEm()
    seedBooking(em, 'future', {})
    seedBooking(em, 'future-twin', { startsAt: '2026-11-14T10:00:00', endsAt: '2026-11-14T11:00:00' })
    seedBooking(em, 'running', { unitId: 'unit-2', startsAt: '2026-11-11T11:00:00', endsAt: '2026-11-11T13:00:00' })
    seedBooking(em, 'past', { unitId: 'unit-3', startsAt: '2026-11-10T10:00:00', endsAt: '2026-11-10T11:00:00' })
    seedBooking(em, 'cancelled', { unitId: 'unit-4', status: 'cancelled' })
    seedBooking(em, 'other-org', { unitId: 'unit-5', organizationId: '33333333-3333-4333-8333-333333333333' })
    em.respond = (sql, params) => {
      const [organizationId, tenantId, ...rest] = params as string[]
      const endsAfter = rest[rest.length - 1]
      const statuses = rest.slice(-3, -1)
      const unitIds = rest.slice(0, -3)
      const hits = em
        .rows(Booking)
        .filter((row) => row.organizationId === organizationId && row.tenantId === tenantId)
        .filter((row) => unitIds.includes(String(row.unitId)) && statuses.includes(String(row.status)))
        .filter((row) => String(row.endsAt) > endsAfter && !row.deletedAt)
      return Array.from(new Set(hits.map((row) => String(row.unitId)))).map((unitId) => ({ unit_id: unitId }))
    }
    const units = await findUnitsWithUpcomingBookings(em as never, scope, ['unit-1', 'unit-2', 'unit-3', 'unit-4', 'unit-5', 'unit-1'], NOW)
    expect([...units].sort()).toEqual(['unit-1', 'unit-2'])
    expect(em.executed).toHaveLength(1)
    const [{ sql, params }] = em.executed
    expect(sql).toMatch(/select distinct unit_id from property_management_bookings/)
    expect(sql).toMatch(/organization_id = \?\s+and tenant_id = \?/)
    expect(sql).toMatch(/deleted_at is null/)
    expect(params).toEqual([scope.organizationId, scope.tenantId, 'unit-1', 'unit-2', 'unit-3', 'unit-4', 'unit-5', 'pending', 'confirmed', '2026-11-11T12:00:00'])
    expect(await findUnitsWithUpcomingBookings(em as never, scope, [], NOW)).toEqual(new Set())
    expect(em.executed).toHaveLength(1)
  })

  it('finds holding bookings inside a lease term, including its first and last day', async () => {
    const em = new FakeEm()
    seedBooking(em, 'first-day', { startsAt: '2026-12-01T09:00:00', endsAt: '2026-12-01T10:00:00' })
    seedBooking(em, 'last-day', { startsAt: '2027-02-28T22:00:00', endsAt: '2027-03-01T00:00:00' })
    seedBooking(em, 'before', { startsAt: '2026-11-30T09:00:00', endsAt: '2026-11-30T10:00:00' })
    seedBooking(em, 'after', { startsAt: '2027-03-01T00:00:00', endsAt: '2027-03-01T01:00:00' })
    seedBooking(em, 'cancelled', { status: 'cancelled', startsAt: '2026-12-10T09:00:00', endsAt: '2026-12-10T10:00:00' })
    const inside = await findBookingsInTerm(em as never, scope, 'unit-1', { startsOn: '2026-12-01', endsOn: '2027-02-28' }, NOW)
    expect(inside.map((blocker) => blocker.id).sort()).toEqual(['first-day', 'last-day'])
  })

  it('ignores bookings of a term already started that are over, even before the sweep completes them', async () => {
    const em = new FakeEm()
    seedBooking(em, 'ended-this-morning', { startsAt: '2026-11-11T08:00:00', endsAt: '2026-11-11T09:00:00' })
    seedBooking(em, 'running', { startsAt: '2026-11-11T11:00:00', endsAt: '2026-11-11T13:00:00' })
    seedBooking(em, 'later', { startsAt: '2026-11-20T10:00:00', endsAt: '2026-11-20T11:00:00' })
    const inside = await findBookingsInTerm(em as never, scope, 'unit-1', { startsOn: '2026-11-11', endsOn: '2027-02-28' }, NOW)
    expect(inside.map((blocker) => blocker.id).sort()).toEqual(['later', 'running'])
  })

  it('treats a unit with any booking ever as used, from a scoped distinct query over every booking status', async () => {
    const em = new FakeEm()
    seedBooking(em, 'old', { unitId: 'unit-booked', status: 'cancelled' })
    seedBooking(em, 'old-twin', { unitId: 'unit-booked', status: 'completed' })
    seedBooking(em, 'deleted', { unitId: 'unit-deleted-booking', status: 'cancelled', deletedAt: new Date() })
    seedBooking(em, 'other-org', { unitId: 'unit-free', organizationId: '33333333-3333-4333-8333-333333333333' })
    em.seed(Lease, { id: 'lease-1', ...scope, unitId: 'unit-leased', status: 'active' } as never)
    em.seed(Lease, { id: 'lease-2', ...scope, unitId: 'unit-withdrawn', status: 'withdrawn' } as never)
    em.respond = (sql, params) => {
      const [organizationId, tenantId, ...unitIds] = params as string[]
      const hits = em
        .rows(Booking)
        .filter((row) => row.organizationId === organizationId && row.tenantId === tenantId && unitIds.includes(String(row.unitId)))
      return Array.from(new Set(hits.map((row) => String(row.unitId)))).map((unitId) => ({ unit_id: unitId }))
    }
    const used = await findUnitsEverUsed(em as never, scope, ['unit-booked', 'unit-deleted-booking', 'unit-leased', 'unit-withdrawn', 'unit-free', 'unit-booked'])
    expect(used.sort()).toEqual(['unit-booked', 'unit-deleted-booking', 'unit-leased'])
    expect(em.executed).toHaveLength(1)
    const [{ sql, params }] = em.executed
    expect(sql).toMatch(/select distinct unit_id from property_management_bookings/)
    expect(sql).toMatch(/organization_id = \?\s+and tenant_id = \?/)
    expect(sql).not.toMatch(/status|deleted_at/)
    expect(params).toEqual([scope.organizationId, scope.tenantId, 'unit-booked', 'unit-deleted-booking', 'unit-leased', 'unit-withdrawn', 'unit-free'])
    expect(await findUnitsEverUsed(em as never, scope, [])).toEqual([])
    expect(em.executed).toHaveLength(1)
  })

  it('ignores a settled deleted lease but keeps counting one whose delete may still revert or left billing behind', async () => {
    const em = new FakeEm()
    em.respond = () => []
    const deletedAt = new Date('2026-11-01T10:00:00Z')
    em.seed(Lease, { id: 'settled', ...scope, unitId: 'unit-settled', status: 'active', deletedAt, pendingChange: null, billingAttention: false } as never)
    em.seed(Lease, {
      id: 'pending-delete',
      ...scope,
      unitId: 'unit-pending',
      status: 'active',
      deletedAt,
      pendingChange: { kind: 'delete', changeId: 'change-1', previous: {}, operationIds: ['op-1'] },
      billingAttention: false,
    } as never)
    em.seed(Lease, { id: 'attention', ...scope, unitId: 'unit-attention', status: 'active', deletedAt, pendingChange: null, billingAttention: true } as never)
    em.seed(Lease, { id: 'live', ...scope, unitId: 'unit-live', status: 'ended', deletedAt: null, pendingChange: null, billingAttention: false } as never)
    const used = await findUnitsEverUsed(em as never, scope, ['unit-settled', 'unit-pending', 'unit-attention', 'unit-live'])
    expect(used.sort()).toEqual(['unit-attention', 'unit-live', 'unit-pending'])
  })
})

describe('lease usage blockers', () => {
  it('carries the reserved dates as structured fields next to the reference label', () => {
    const lease = {
      id: 'lease-1',
      ...scope,
      unitId: 'unit-1',
      reference: 'L-2026-001',
      status: 'active',
      startsOn: '2026-01-01',
      endsOn: '2099-06-30',
      pendingChange: { kind: 'end', previous: { startsOn: '2026-01-01', endsOn: '2099-12-31' } },
    } as unknown as Lease
    expect(leaseBlockersOf([lease])).toEqual([
      { kind: 'lease', id: 'lease-1', label: 'L-2026-001', unitId: 'unit-1', until: '2099-12-31', startsOn: '2026-01-01', endsOn: '2099-12-31' },
    ])
  })
})
