/** @jest-environment node */
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { Booking, Lease, LeaseProposal, PropertyManagementSettings, Unavailability } from '../data/entities'
import type { UnavailabilityWindow } from '../lib/availabilityResolver'
import {
  isLeaseEnding,
  leaseInForceOn,
  loadFloorLeases,
  loadFloorStatus,
  projectUnitStatus,
  resolveCrmAccess,
  resolveUnitStatus,
  unavailableAreasOn,
  type StatusBooking,
  type StatusLease,
  type StatusProposal,
  type UnitStatusInput,
} from '../lib/floorStatus'
import { pixelsPerMetre, rectStyle } from '../components/floor/scale'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const DATE = '2026-11-11'
const FULL_CRM = { people: true, companies: true }
const NO_CRM = { people: false, companies: false }

function lease(overrides: Partial<StatusLease> = {}): StatusLease {
  return {
    id: 'lease-1',
    reference: 'L-2026-001',
    status: 'active',
    unitId: 'unit-1',
    startsOn: '2026-01-01',
    endsOn: '2027-12-31',
    customerCompanyId: 'company-1',
    primaryContactPersonId: 'person-1',
    ...overrides,
  }
}

function booking(overrides: Partial<StatusBooking> = {}): StatusBooking {
  return {
    id: 'booking-1',
    unitId: 'unit-1',
    status: 'confirmed',
    startsAt: `${DATE} 10:00:00`,
    endsAt: `${DATE} 11:00:00`,
    billingUnit: 'hour',
    productName: 'Meeting room',
    bookedByPersonId: 'person-2',
    customerCompanyId: 'company-2',
    ...overrides,
  }
}

function closure(source: UnavailabilityWindow['source'], subjectId: string, start: string | null, end: string | null): UnavailabilityWindow {
  return { id: `${source}-${subjectId}`, source, subjectId, reasonEntryId: null, reasonText: 'Water damage', start, end }
}

function input(overrides: Partial<UnitStatusInput> = {}): UnitStatusInput {
  return {
    use: 'leasable',
    date: DATE,
    thresholdDays: 60,
    leases: [],
    proposals: [],
    bookings: [],
    windows: [],
    contacts: new Map([
      ['company-1', { name: 'Vertex Robotics', email: null }],
      ['person-1', { name: 'Priya Natarajan', email: 'priya@example.com' }],
      ['person-2', { name: 'Marcus Webb', email: null }],
      ['company-2', { name: 'Byteworks', email: null }],
    ]),
    crmAccess: FULL_CRM,
    ...overrides,
  }
}

describe('resolveUnitStatus precedence', () => {
  it('lets unavailable win over a lease and over bookings', () => {
    expect(resolveUnitStatus({ use: 'leasable', unavailable: true, leaseInForce: true, bookingCount: 0 })).toBe('unavailable')
    expect(resolveUnitStatus({ use: 'bookable', unavailable: true, leaseInForce: false, bookingCount: 2 })).toBe('unavailable')
  })

  it('maps leasable units to occupied / available and bookable units to booked / free', () => {
    expect(resolveUnitStatus({ use: 'leasable', unavailable: false, leaseInForce: true, bookingCount: 0 })).toBe('occupied')
    expect(resolveUnitStatus({ use: 'leasable', unavailable: false, leaseInForce: false, bookingCount: 0 })).toBe('available')
    expect(resolveUnitStatus({ use: 'bookable', unavailable: false, leaseInForce: false, bookingCount: 1 })).toBe('booked')
    expect(resolveUnitStatus({ use: 'bookable', unavailable: false, leaseInForce: false, bookingCount: 0 })).toBe('free')
  })

  it('falls back on the data for a unit whose product has no use', () => {
    expect(resolveUnitStatus({ use: null, unavailable: false, leaseInForce: true, bookingCount: 0 })).toBe('occupied')
    expect(resolveUnitStatus({ use: null, unavailable: false, leaseInForce: false, bookingCount: 1 })).toBe('booked')
    expect(resolveUnitStatus({ use: null, unavailable: false, leaseInForce: false, bookingCount: 0 })).toBe('available')
  })
})

describe('projectUnitStatus', () => {
  it('shows an occupied unit with its tenant, contact and days left', () => {
    const result = projectUnitStatus(input({ leases: [lease()] }))
    expect(result.status).toBe('occupied')
    expect(result.lease).toMatchObject({ reference: 'L-2026-001', companyName: 'Vertex Robotics', contactName: 'Priya Natarajan', contactEmail: 'priya@example.com' })
    expect(result.leaseEnding).toBe(false)
    expect(result.proposed).toBe(false)
  })

  it('marks a lease ending within the threshold without changing the status', () => {
    const result = projectUnitStatus(input({ leases: [lease({ endsOn: '2026-12-11' })] }))
    expect(result.status).toBe('occupied')
    expect(result.lease?.daysLeft).toBe(30)
    expect(result.leaseEnding).toBe(true)
    expect(projectUnitStatus(input({ leases: [lease({ endsOn: '2026-12-11' })], thresholdDays: 29 })).leaseEnding).toBe(false)
  })

  it('applies the threshold inclusively and counts days from the viewed date', () => {
    expect(isLeaseEnding(60, 60)).toBe(true)
    expect(isLeaseEnding(61, 60)).toBe(false)
    expect(isLeaseEnding(-1, 60)).toBe(false)
    const result = projectUnitStatus(input({ date: '2026-12-11', leases: [lease({ endsOn: '2026-12-11' })] }))
    expect(result.lease?.daysLeft).toBe(0)
    expect(result.leaseEnding).toBe(true)
  })

  it('ignores leases that are not in force on the date', () => {
    expect(leaseInForceOn([lease({ startsOn: '2026-12-01' })], DATE)).toBeNull()
    expect(leaseInForceOn([lease({ endsOn: '2026-11-10', status: 'ended' })], DATE)).toBeNull()
    expect(leaseInForceOn([lease({ status: 'ended', endsOn: '2026-11-30' })], DATE)?.id).toBe('lease-1')
    expect(leaseInForceOn([lease({ status: 'pending_order' })], DATE)?.id).toBe('lease-1')
    expect(leaseInForceOn([lease({ status: 'proposed' })], DATE)).toBeNull()
  })

  it('keeps the available fill and adds the Proposed badge for an open new-lease proposal', () => {
    const proposed = lease({ id: 'lease-2', reference: 'L-2026-014', status: 'proposed', startsOn: '2026-12-01', endsOn: '2027-11-30' })
    const proposal: StatusProposal = { id: 'proposal-1', leaseId: 'lease-2', kind: 'new', status: 'sent', respondBy: '2026-11-20', startsOn: '2026-12-01', endsOn: '2027-11-30' }
    const result = projectUnitStatus(input({ leases: [proposed], proposals: [proposal] }))
    expect(result.status).toBe('available')
    expect(result.proposed).toBe(true)
    expect(result.proposal).toMatchObject({ id: 'proposal-1', reference: 'L-2026-014', respondBy: '2026-11-20', companyName: 'Vertex Robotics' })
    expect(result.lease).toBeNull()
  })

  it('reports an open extension proposal on the lease in force without the Proposed badge', () => {
    const proposal: StatusProposal = { id: 'proposal-2', leaseId: 'lease-1', kind: 'extension', status: 'sent', respondBy: '2026-11-25', startsOn: '2028-01-01', endsOn: '2028-12-31' }
    const result = projectUnitStatus(input({ leases: [lease()], proposals: [proposal] }))
    expect(result.proposed).toBe(false)
    expect(result.lease?.extensionRespondBy).toBe('2026-11-25')
    expect(result.lease?.extensionStatus).toBe('sent')
  })

  it('reports a declined proposal that is still approvable', () => {
    const proposed = lease({ id: 'lease-2', reference: 'L-2026-014', status: 'proposed', startsOn: '2026-12-01', endsOn: '2027-11-30' })
    const proposal: StatusProposal = { id: 'proposal-1', leaseId: 'lease-2', kind: 'new', status: 'declined', respondBy: '2026-11-20', startsOn: '2026-12-01', endsOn: '2027-11-30' }
    const result = projectUnitStatus(input({ leases: [proposed], proposals: [proposal] }))
    expect(result.proposal).toMatchObject({ status: 'declined', respondBy: '2026-11-20' })
  })

  it('marks the released months of a pending end as reserved until the previous end', () => {
    const ending = lease({
      endsOn: '2026-10-31',
      pendingChange: {
        kind: 'end',
        changeId: 'change-1',
        previous: { startsOn: '2026-01-01', endsOn: '2027-12-31', status: 'active', termMonths: 24, currentVersionId: null },
        operationIds: [],
      },
    })
    const result = projectUnitStatus(input({ leases: [ending] }))
    expect(result.lease).toBeNull()
    expect(result.status).toBe('available')
    expect(result.reservation).toEqual({ leaseId: 'lease-1', reference: 'L-2026-001', until: '2027-12-31' })
    expect(projectUnitStatus(input({ leases: [ending], date: '2028-01-05' })).reservation).toBeNull()
    expect(projectUnitStatus(input({ leases: [lease()] })).reservation).toBeNull()
  })

  it('lists the day\'s bookings in order with the booking person', () => {
    const result = projectUnitStatus(
      input({
        use: 'bookable',
        bookings: [
          booking({ id: 'booking-2', startsAt: `${DATE} 13:00:00`, endsAt: `${DATE} 14:00:00` }),
          booking(),
          booking({ id: 'booking-3', status: 'cancelled', startsAt: `${DATE} 15:00:00`, endsAt: `${DATE} 16:00:00` }),
        ],
      }),
    )
    expect(result.status).toBe('booked')
    expect(result.bookings.map((entry) => [entry.id, entry.startsAt, entry.endsAt])).toEqual([
      ['booking-1', `${DATE}T10:00`, `${DATE}T11:00`],
      ['booking-2', `${DATE}T13:00`, `${DATE}T14:00`],
    ])
    expect(result.bookings[0]).toMatchObject({ personName: 'Marcus Webb', companyName: 'Byteworks' })
    expect(projectUnitStatus(input({ use: 'bookable' })).status).toBe('free')
  })

  it('shows an unavailable unit with the reason and the end of the merged closure, keeping the lease', () => {
    const windows = [
      closure('space', 'space-1', `${DATE}T00:00`, '2026-11-15T00:00'),
      closure('unit', 'unit-1', '2026-11-15T00:00', '2026-11-20T00:00'),
    ]
    const result = projectUnitStatus(input({ leases: [lease()], windows }))
    expect(result.status).toBe('unavailable')
    expect(result.unavailable).toEqual({ source: 'space', reasonLabel: null, reasonText: 'Water damage', from: `${DATE}T00:00`, until: '2026-11-20T00:00' })
    expect(result.lease?.id).toBe('lease-1')
  })

  it('treats a closure starting later in the day as unavailable and one starting tomorrow as not', () => {
    expect(projectUnitStatus(input({ windows: [closure('unit', 'unit-1', `${DATE}T14:00`, null)] })).status).toBe('unavailable')
    expect(projectUnitStatus(input({ windows: [closure('unit', 'unit-1', '2026-11-12T00:00', null)] })).status).toBe('available')
  })
})

describe('unavailableAreasOn', () => {
  it('returns the closed floor and spaces on the date and the archived building', () => {
    const windows = [
      closure('floor', 'floor-1', '2026-11-01T00:00', null),
      closure('space', 'space-1', '2026-11-12T00:00', null),
      closure('unit', 'unit-1', '2026-11-01T00:00', null),
    ]
    expect(unavailableAreasOn(windows, { id: 'building-1', archived: false }, DATE)).toEqual([
      { subjectType: 'floor', subjectId: 'floor-1', reasonLabel: null, reasonText: 'Water damage', from: '2026-11-01T00:00', until: null },
    ])
    expect(unavailableAreasOn([], { id: 'building-1', archived: true }, DATE)).toEqual([
      { subjectType: 'building', subjectId: 'building-1', reasonLabel: null, reasonText: null, from: null, until: null },
    ])
  })

  it('names the dictionary reason of a closure next to its description', () => {
    const windows = [{ ...closure('space', 'space-1', '2026-11-01T00:00', null), reasonEntryId: 'reason-maintenance' }]
    const labels = new Map([['reason-maintenance', 'Maintenance']])
    expect(unavailableAreasOn(windows, { id: 'building-1', archived: false }, DATE, labels)).toEqual([
      { subjectType: 'space', subjectId: 'space-1', reasonLabel: 'Maintenance', reasonText: 'Water damage', from: '2026-11-01T00:00', until: null },
    ])
    expect(projectUnitStatus(input({ windows, reasonLabels: labels })).unavailable).toMatchObject({ reasonLabel: 'Maintenance' })
  })
})

describe('loadFloorStatus', () => {
  function seedFloor(em: FakeEm, unitCount: number) {
    const units = Array.from({ length: unitCount }, (_, index) => ({
      id: `unit-${index}`,
      buildingId: 'building-1',
      floorId: 'floor-1',
      spaceId: 'space-1',
      catalogProductId: index % 2 === 0 ? 'product-office' : 'product-room',
    }))
    em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, leaseEndingThresholdDays: 45 } as never)
    em.seed(Lease, { id: 'lease-a', ...scope, reference: 'L-1', status: 'active', unitId: 'unit-0', startsOn: '2026-01-01', endsOn: '2026-12-01', customerCompanyId: 'company-1', primaryContactPersonId: 'person-1', deletedAt: null } as never)
    em.seed(Lease, { id: 'lease-old', ...scope, reference: 'L-0', status: 'ended', unitId: 'unit-0', startsOn: '2025-01-01', endsOn: '2025-12-31', customerCompanyId: 'company-1', primaryContactPersonId: null, deletedAt: null } as never)
    em.seed(LeaseProposal, { id: 'proposal-a', ...scope, leaseId: 'lease-a', kind: 'extension', status: 'sent', respondBy: '2026-11-20', startsOn: '2026-12-02', endsOn: '2027-12-01' } as never)
    em.seed(Booking, { id: 'booking-a', ...scope, unitId: 'unit-1', status: 'confirmed', startsAt: `${DATE}T09:00:00`, endsAt: `${DATE}T10:00:00`, billingUnit: 'hour', productName: 'Room', bookedByPersonId: 'person-2', customerCompanyId: null, deletedAt: null } as never)
    em.seed(Booking, { id: 'booking-b', ...scope, unitId: 'unit-1', status: 'confirmed', startsAt: '2026-11-12T09:00:00', endsAt: '2026-11-12T10:00:00', billingUnit: 'hour', productName: 'Room', bookedByPersonId: 'person-2', customerCompanyId: null, deletedAt: null } as never)
    em.seed(Unavailability, { id: 'closure-a', ...scope, buildingId: 'building-1', subjectType: 'unit', subjectId: 'unit-2', reasonText: 'Paint', startsAt: `${DATE}T00:00:00`, endsAt: null, endedAt: null, deletedAt: null } as never)
    em.seed(Unavailability, { id: 'closure-b', ...scope, buildingId: 'building-1', subjectType: 'space', subjectId: 'space-1', reasonText: 'Later', startsAt: '2026-12-01T00:00:00', endsAt: null, endedAt: null, deletedAt: null } as never)
    em.seed(CustomerEntity, { id: 'company-1', ...scope, displayName: 'Vertex Robotics', primaryEmail: null } as never)
    em.seed(CustomerEntity, { id: 'person-1', ...scope, displayName: 'Priya Natarajan', primaryEmail: 'priya@example.com' } as never)
    em.seed(CustomerEntity, { id: 'person-2', ...scope, displayName: 'Marcus Webb', primaryEmail: null } as never)
    const uses = new Map([
      ['product-office', 'leasable' as const],
      ['product-room', 'bookable' as const],
    ])
    return { units, uses }
  }

  async function run(em: FakeEm, unitCount: number, crmAccess = FULL_CRM) {
    const { units, uses } = seedFloor(em, unitCount)
    const leases = await loadFloorLeases(em as never, scope, units.map((unit) => unit.id), DATE)
    return loadFloorStatus(
      em as never,
      scope,
      { building: { id: 'building-1', archived: false }, floorId: 'floor-1', spaceIds: ['space-1'], units, uses, leases, crmAccess },
      DATE,
    )
  }

  it('projects the status of every unit from six queries', async () => {
    const em = new FakeEm()
    const find = jest.spyOn(em, 'find')
    const findOne = jest.spyOn(em, 'findOne')
    const result = await run(em, 4)
    expect(find.mock.calls.length + findOne.mock.calls.length).toBe(6)
    expect(result.leaseEndingThresholdDays).toBe(45)
    expect(result.units.get('unit-0')).toMatchObject({ status: 'occupied', leaseEnding: true, lease: { reference: 'L-1', daysLeft: 20, extensionRespondBy: '2026-11-20' } })
    expect(result.units.get('unit-1')).toMatchObject({ status: 'booked', bookings: [{ id: 'booking-a', personName: 'Marcus Webb' }] })
    expect(result.units.get('unit-2')).toMatchObject({ status: 'unavailable', unavailable: { source: 'unit', reasonText: 'Paint' } })
    expect(result.units.get('unit-3')?.status).toBe('free')
    expect(result.unavailableAreas).toEqual([])
  })

  it('keeps the query count when the floor has many more units', async () => {
    const em = new FakeEm()
    const find = jest.spyOn(em, 'find')
    const findOne = jest.spyOn(em, 'findOne')
    const result = await run(em, 60)
    expect(find.mock.calls.length + findOne.mock.calls.length).toBe(6)
    expect(result.units.size).toBe(60)
  })

  it('does not name a deleted CRM company or person', async () => {
    const em = new FakeEm()
    const crmAccess = FULL_CRM
    const { units, uses } = seedFloor(em, 2)
    await em.nativeUpdate(CustomerEntity, { id: { $in: ['company-1', 'person-1'] } }, { deletedAt: new Date('2026-11-01T00:00:00Z') })
    const leases = await loadFloorLeases(em as never, scope, units.map((unit) => unit.id), DATE)
    const result = await loadFloorStatus(
      em as never,
      scope,
      { building: { id: 'building-1', archived: false }, floorId: 'floor-1', spaceIds: ['space-1'], units, uses, leases, crmAccess },
      DATE,
    )
    expect(result.units.get('unit-0')?.lease).toMatchObject({ companyName: null, contactName: null, contactEmail: null })
    expect(result.units.get('unit-1')).toMatchObject({ bookings: [{ id: 'booking-a', personName: 'Marcus Webb' }] })
  })

  it('reads no CRM records and names nobody without the customers view features', async () => {
    const em = new FakeEm()
    const find = jest.spyOn(em, 'find')
    const result = await run(em, 2, NO_CRM)
    expect(find.mock.calls.some(([entity]) => entity === CustomerEntity)).toBe(false)
    const unitLease = result.units.get('unit-0')?.lease
    expect(unitLease).toMatchObject({ customerCompanyId: 'company-1', contactPersonId: 'person-1' })
    expect(unitLease).not.toHaveProperty('companyName')
    expect(unitLease).not.toHaveProperty('contactName')
    expect(unitLease).not.toHaveProperty('contactEmail')
    const [dayBooking] = result.units.get('unit-1')?.bookings ?? []
    expect(dayBooking).toMatchObject({ id: 'booking-a', personId: 'person-2' })
    expect(dayBooking).not.toHaveProperty('personName')
  })

  it('reads only the people when only people may be viewed', async () => {
    const em = new FakeEm()
    const find = jest.spyOn(em, 'find')
    const result = await run(em, 2, { people: true, companies: false })
    const crmCall = find.mock.calls.find(([entity]) => entity === CustomerEntity)
    expect((crmCall?.[1] as { id: { $in: string[] } }).id.$in.sort()).toEqual(['person-1', 'person-2'])
    const unitLease = result.units.get('unit-0')?.lease
    expect(unitLease).toMatchObject({ contactName: 'Priya Natarajan', contactEmail: 'priya@example.com' })
    expect(unitLease).not.toHaveProperty('companyName')
  })
})

describe('CRM gating of the projection', () => {
  it('omits company names but keeps people without customers.companies.view', () => {
    const proposed = lease({ id: 'lease-2', reference: 'L-2026-014', status: 'proposed', startsOn: '2026-12-01', endsOn: '2027-11-30' })
    const result = projectUnitStatus(input({ leases: [lease(), proposed], bookings: [booking()], crmAccess: { people: true, companies: false } }))
    expect(result.lease).toMatchObject({ contactName: 'Priya Natarajan', contactEmail: 'priya@example.com' })
    expect(result.lease).not.toHaveProperty('companyName')
    expect(result.proposal).not.toHaveProperty('companyName')
    expect(result.bookings[0]).toMatchObject({ personName: 'Marcus Webb', companyId: 'company-2' })
    expect(result.bookings[0]).not.toHaveProperty('companyName')
  })

  it('omits people and their email but keeps companies without customers.people.view', () => {
    const result = projectUnitStatus(input({ use: null, leases: [lease()], bookings: [booking()], crmAccess: { people: false, companies: true } }))
    expect(result.lease).toMatchObject({ companyName: 'Vertex Robotics', contactPersonId: 'person-1' })
    expect(result.lease).not.toHaveProperty('contactName')
    expect(result.lease).not.toHaveProperty('contactEmail')
    expect(result.bookings[0]).toMatchObject({ companyName: 'Byteworks', personId: 'person-2' })
    expect(result.bookings[0]).not.toHaveProperty('personName')
  })
})

describe('resolveCrmAccess', () => {
  const auth = { sub: 'user-1', tenantId: TENANT, orgId: ORG }

  function containerWith(granted: string[] | Error) {
    const rbac = {
      userHasAllFeatures: jest.fn(async (_user: string, features: string[]) => {
        if (granted instanceof Error) throw granted
        return features.every((feature) => granted.includes(feature))
      }),
    }
    return { rbac, container: { resolve: () => rbac } as never }
  }

  it('checks customers.people.view and customers.companies.view through the rbac service', async () => {
    const { rbac, container } = containerWith(['customers.people.view'])
    await expect(resolveCrmAccess(container, auth, scope)).resolves.toEqual({ people: true, companies: false })
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', ['customers.people.view'], scope)
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', ['customers.companies.view'], scope)
  })

  it('denies both without auth or when the check fails', async () => {
    await expect(resolveCrmAccess(containerWith([]).container, null, scope)).resolves.toEqual(NO_CRM)
    await expect(resolveCrmAccess(containerWith(new Error('[internal] rbac down')).container, auth, scope)).resolves.toEqual(NO_CRM)
  })
})

describe('floor drawing scale', () => {
  it('uses one scale per building, set by the widest floor', () => {
    const floors = [
      { id: 'f-0', number: 0, name: 'Ground', sizeX: 42, sizeY: 18 },
      { id: 'f-1', number: 1, name: 'Roof', sizeX: 24, sizeY: 18 },
    ]
    expect(pixelsPerMetre(floors, 24)).toBe(pixelsPerMetre(floors, 42))
    expect(pixelsPerMetre(floors, 24)).toBe(Math.floor(960 / 42))
  })

  it('clamps the scale for very small and very large floors', () => {
    expect(pixelsPerMetre([{ id: 'f', number: 0, name: 'Tiny', sizeX: 5, sizeY: 5 }], 5)).toBe(48)
    expect(pixelsPerMetre([{ id: 'f', number: 0, name: 'Huge', sizeX: 400, sizeY: 50 }], 400)).toBe(8)
  })

  it('positions rectangles in percent of the floor', () => {
    expect(rectStyle({ x: 8, y: 6, width: 8, depth: 6 }, 40, 12)).toEqual({ left: '20%', top: '50%', width: '20%', height: '50%' })
  })
})
