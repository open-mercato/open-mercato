/** @jest-environment node */
import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import { createModuleQueue } from '@open-mercato/queue'
import {
  Booking,
  Building,
  Floor,
  Lease,
  OpeningHours,
  ProductUse,
  PropertyManagementSettings,
  SalesOperation,
  Space,
  Unavailability,
  Unit,
  UnitProductPeriod,
} from '../data/entities'
import { FakeEm } from './support/fakeEm'
import { withClosureLeaseSql } from './support/closureLeaseSql'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => {
  const enqueue = jest.fn(async () => undefined)
  return { createModuleQueue: jest.fn(() => ({ enqueue })) }
})
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined) }))
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null) }
})
jest.mock('../lib/productUse', () => {
  const actual = jest.requireActual('../lib/productUse')
  return { ...actual, resolvePriceSnapshot: jest.fn(async () => ({ priceAmount: '50.0000', currencyCode: 'PLN', priceKindId: null })) }
})
jest.mock('../lib/salesOperations', () => {
  const actual = jest.requireActual('../lib/salesOperations')
  return { ...actual, enqueueSalesOperations: jest.fn(async () => undefined) }
})
jest.mock('../lib/bookingEvents', () => {
  const actual = jest.requireActual('../lib/bookingEvents')
  return { ...actual, emitBookingEvent: jest.fn(async () => undefined), markBookingChanged: jest.fn(async () => undefined) }
})
jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return { ...actual, emitSideEffects: jest.fn(async () => undefined) }
})
jest.mock('../events', () => ({ emitPropertyManagementEvent: jest.fn(async () => undefined) }))

import '../commands'
import { previewUnavailability } from '../commands/availability'
import { assertUnitAvailableForTerm } from '../commands/lease'
import { assertMoveDestinationAvailable } from '../commands/unit'
import { emitBookingEvent } from '../lib/bookingEvents'
import { enqueueSalesOperations, hashPayload } from '../lib/salesOperations'
import { emitPropertyManagementEvent } from '../events'
import { PREVIEW_LIST_LIMIT, previewTokenOf } from '../lib/unavailabilityImpact'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { weekdayOf } from '../lib/openingHours'
import { RESUME_APPLY_BATCH, resumeApplyingUnavailabilities, runUnavailabilityApply, UNAVAILABILITY_APPLY_MAX_ATTEMPTS } from '../lib/unavailabilityApply'
import { reenqueueCursorKey, reenqueueOpenOperations } from '../lib/leaseSweep'
import { runBookingSweep, SWEEP_CURSOR_TTL_MS, sweepCursorKey, SWEEP_MAX_COMPLETE_ATTEMPTS, SWEEP_MAX_CONSECUTIVE_FAILURES } from '../lib/bookingSweep'
import handleUnavailabilityApply from '../workers/unavailability-apply'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { registerTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const FULL_CRM = { people: true, companies: true }
const BUILDING = '50000000-0000-4000-8000-000000000001'
const FLOOR = '50000000-0000-4000-8000-000000000002'
const SPACE = '50000000-0000-4000-8000-000000000003'
const OTHER_SPACE = '50000000-0000-4000-8000-000000000004'
const UNIT = '50000000-0000-4000-8000-000000000005'
const PRODUCT = '50000000-0000-4000-8000-000000000006'
const PERSON = '50000000-0000-4000-8000-000000000007'
const COMPANY = '50000000-0000-4000-8000-000000000008'
const CHANNEL = '50000000-0000-4000-8000-000000000009'
const CANCELLED = '50000000-0000-4000-8000-00000000000a'
const BOOKING = '50000000-0000-4000-8000-00000000000b'

function isoDay(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const TODAY = isoDay(0)
const DAY = isoDay(1)
const RETRY_FAILURE_MESSAGE = 'Cancelling the bookings failed. It is retried automatically.'
const FINAL_FAILURE_MESSAGE =
  'Cancelling the bookings failed and will not be retried right away. The booking sweep tries again within half an hour while the unavailability is still applying.'
const SETTLED_COMPLETE_FAILED_MESSAGE = 'The bookings were handled, but closing this progress entry failed.'

function seed(): FakeEm {
  const em = withClosureLeaseSql(new FakeEm())
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', openingHoursEnabled: false, deletedAt: null } as never)
  em.seed(Floor, { id: FLOOR, ...scope, buildingId: BUILDING, number: 0, name: 'Ground', deletedAt: null } as never)
  em.seed(Space, { id: SPACE, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'East wing', deletedAt: null } as never)
  em.seed(Space, { id: OTHER_SPACE, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'West wing', deletedAt: null } as never)
  em.seed(Unit, { id: UNIT, ...scope, buildingId: BUILDING, floorId: FLOOR, spaceId: SPACE, name: 'Studio 2B', catalogProductId: PRODUCT, deletedAt: null } as never)
  em.seed(UnitProductPeriod, { id: 'period-1', ...scope, unitId: UNIT, catalogProductId: PRODUCT, productName: 'Meeting room', use: 'bookable', billingUnit: 'hour', validTo: null } as never)
  em.seed(ProductUse, { id: 'use-1', ...scope, catalogProductId: PRODUCT, use: 'bookable', billingUnit: 'hour' } as never)
  em.seed(CatalogProduct, { id: PRODUCT, ...scope, title: 'Meeting room', deletedAt: null } as never)
  em.seed(CustomerEntity, { id: PERSON, ...scope, kind: 'person', displayName: 'Marcus Webb', deletedAt: null } as never)
  em.seed(CustomerEntity, { id: COMPANY, ...scope, kind: 'company', displayName: 'Solstice Analytics', deletedAt: null } as never)
  em.seed(CustomerPersonProfile, { id: 'profile-1', ...scope, entity: PERSON, company: COMPANY } as never)
  em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, billingChannelId: CHANNEL, cancelledOrderStatusEntryId: CANCELLED } as never)
  return em
}

function seedBooking(em: FakeEm, overrides: Record<string, unknown> = {}): Booking {
  return em.seed(Booking, {
    id: BOOKING,
    ...scope,
    buildingId: BUILDING,
    unitId: UNIT,
    bookedByPersonId: PERSON,
    productName: 'Meeting room',
    status: 'confirmed',
    startsAt: `${DAY}T10:00:00`,
    endsAt: `${DAY}T12:00:00`,
    salesOrderId: 'order-1',
    deletedAt: null,
    ...overrides,
  } as never) as unknown as Booking
}

function buildCtx(em: FakeEm): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } as never,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

async function run<T>(commandId: string, input: Record<string, unknown>, em: FakeEm): Promise<T> {
  const handler = commandRegistry.get(commandId)
  if (!handler) throw new Error(`[internal] missing command ${commandId}`)
  return handler.execute({ ...scope, ...input }, buildCtx(em)) as Promise<T>
}

async function expectHttpError(promise: Promise<unknown>, status: number, code?: string): Promise<void> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(CrudHttpError)
    expect((err as CrudHttpError).status).toBe(status)
    if (code) expect((err as CrudHttpError).body).toMatchObject({ code })
    return
  }
  throw new Error('[internal] expected the command to fail')
}

const closeFloor = (overrides: Record<string, unknown> = {}) => ({
  subjectType: 'floor',
  subjectId: FLOOR,
  reasonText: 'Renovation',
  startsAt: `${TODAY}T00:00`,
  endsAt: null,
  ...overrides,
})

const tokenOf = (ids: readonly string[], overrides: Record<string, unknown> = {}) => {
  const input = closeFloor(overrides) as { subjectType: 'floor' | 'space'; subjectId: string; startsAt: string; endsAt: string | null }
  return previewTokenOf({ subjectType: input.subjectType, subjectId: input.subjectId, start: input.startsAt, end: input.endsAt }, ids)
}

const confirmFloor = (ids: readonly string[], overrides: Record<string, unknown> = {}) => closeFloor({ ...overrides, previewToken: tokenOf(ids, overrides) })

beforeEach(() => jest.clearAllMocks())

async function withReportedErrors(run: (reportError: jest.Mock) => Promise<void>): Promise<void> {
  const reportError = jest.fn()
  const unregister = registerTelemetryRuntime({ reportError } as never)
  try {
    await run(reportError)
  } finally {
    unregister()
  }
}

describe('unavailability dry run and confirm', () => {
  it('previews the bookings it cancels and the leases it flags, with a token over the booking ids', async () => {
    const em = seed()
    seedBooking(em)
    em.seed(Lease, { id: 'lease-1', ...scope, unitId: UNIT, reference: 'L-2026-001', customerCompanyId: COMPANY, status: 'active', startsOn: '2026-01-01', endsOn: '2099-12-31', pendingChange: null, deletedAt: null } as never)
    em.seed(Lease, { id: 'lease-2', ...scope, unitId: UNIT, reference: 'L-2020-001', customerCompanyId: COMPANY, status: 'ended', startsOn: '2020-01-01', endsOn: '2020-12-31', pendingChange: null, deletedAt: null } as never)
    const preview = await previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor() } as never, FULL_CRM)
    expect(preview).toMatchObject({
      subject: { type: 'floor', id: FLOOR, name: 'Ground' },
      unitCount: 1,
      bookingCount: 1,
      bookingsToCancel: [{ id: BOOKING, unit: 'Studio 2B', person: 'Marcus Webb', startsAt: `${DAY}T10:00` }],
      leaseCount: 1,
      leasesToFlag: [{ id: 'lease-1', reference: 'L-2026-001', company: 'Solstice Analytics', unit: 'Studio 2B' }],
      previewToken: tokenOf([BOOKING]),
    })
    const later = await previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor({ startsAt: `${DAY}T12:00` }) } as never, FULL_CRM)
    expect(later.bookingCount).toBe(0)
  })

  it('lists only the first bookings of a large closure while counting and tokenizing all of them in SQL', async () => {
    const em = seed()
    const ids: string[] = []
    for (let index = 0; index < 130; index += 1) {
      const id = `50000000-0000-4000-9000-${String(129 - index).padStart(12, '0')}`
      ids.push(id)
      seedBooking(em, { id, salesOrderId: null, status: 'pending', startsAt: `${isoDay(2 + index)}T10:00:00`, endsAt: `${isoDay(2 + index)}T11:00:00` })
    }
    const find = jest.spyOn(em, 'find')
    const preview = await previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor() } as never, FULL_CRM)
    expect(preview.bookingCount).toBe(130)
    expect(preview.bookingsToCancel).toHaveLength(100)
    expect(preview.bookingsToCancel.map((booking) => booking.id)).toEqual(ids.slice(0, 100))
    expect(preview.previewToken).toBe(tokenOf(ids))
    const bookingFinds = find.mock.calls.filter(([entity]) => entity === Booking)
    expect(bookingFinds).toHaveLength(1)
    expect(bookingFinds[0][2]).toMatchObject({ limit: 100 })
    expect(em.executed.some((entry) => entry.sql.includes('string_agg(id::text'))).toBe(true)
  })

  it('counts every flagged lease in SQL but loads only the first page of them', async () => {
    const em = seed()
    const ids: string[] = []
    for (let index = 0; index < PREVIEW_LIST_LIMIT + 30; index += 1) {
      const id = `60000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      ids.push(id)
      em.seed(Lease, { id, ...scope, unitId: UNIT, reference: `L-${index}`, customerCompanyId: COMPANY, status: 'active', startsOn: isoDay(-200 + index), endsOn: '2099-12-31', pendingChange: null, deletedAt: null } as never)
    }
    const find = jest.spyOn(em, 'find')
    const preview = await previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor() } as never, FULL_CRM)
    expect(preview.leaseCount).toBe(PREVIEW_LIST_LIMIT + 30)
    expect(preview.leasesToFlag.map((lease) => lease.id)).toEqual(ids.slice(0, PREVIEW_LIST_LIMIT))
    const leaseFinds = find.mock.calls.filter(([entity]) => entity === Lease)
    expect(leaseFinds).toHaveLength(1)
    expect((leaseFinds[0][1] as { id: { $in: string[] } }).id.$in).toHaveLength(PREVIEW_LIST_LIMIT)
    const listed = em.executed.find((entry) => entry.sql.includes('from property_management_leases lease') && entry.sql.includes('limit ?'))
    expect(listed?.params[listed.params.length - 1]).toBe(PREVIEW_LIST_LIMIT)
  })

  it.each(['space', 'unit'] as const)('refuses to close a %s deleted while the layout locks were awaited', async (subjectType) => {
    const em = seed()
    const subjectId = subjectType === 'space' ? SPACE : UNIT
    const subjectRow = em.rows(subjectType === 'space' ? Space : Unit).find((row) => row.id === subjectId)
    const transactional = em.transactional.bind(em)
    em.transactional = async (callback) => {
      if (subjectRow) subjectRow.deletedAt = new Date()
      return transactional(callback)
    }
    await expectHttpError(run('property_management.unavailability.create', confirmFloor([], { subjectType, subjectId }), em), 404)
    expect(em.rows(Unavailability)).toHaveLength(0)
  })

  it('flags a lease whose pending end still reserves the closed period and skips leases outside it', async () => {
    const em = seed()
    const closure = closeFloor({ startsAt: `${isoDay(10)}T00:00`, endsAt: `${isoDay(20)}T00:00` })
    em.seed(Lease, { id: 'lease-ending', ...scope, unitId: UNIT, reference: 'L-2026-010', customerCompanyId: COMPANY, status: 'active', startsOn: '2026-01-01', endsOn: isoDay(5), pendingChange: { kind: 'end', previous: { startsOn: '2026-01-01', endsOn: '2099-12-31' } }, deletedAt: null } as never)
    em.seed(Lease, { id: 'lease-before', ...scope, unitId: UNIT, reference: 'L-2026-011', customerCompanyId: COMPANY, status: 'active', startsOn: '2026-01-01', endsOn: isoDay(5), pendingChange: null, deletedAt: null } as never)
    em.seed(Lease, { id: 'lease-after', ...scope, unitId: UNIT, reference: 'L-2026-012', customerCompanyId: COMPANY, status: 'pending_order', startsOn: isoDay(30), endsOn: isoDay(90), pendingChange: null, deletedAt: null } as never)
    em.seed(Lease, { id: 'lease-during', ...scope, unitId: UNIT, reference: 'L-2026-013', customerCompanyId: COMPANY, status: 'active', startsOn: '2026-01-01', endsOn: isoDay(12), pendingChange: null, deletedAt: null } as never)
    const preview = await previewUnavailability(em as never, scope, null, { ...scope, ...closure } as never, FULL_CRM)
    expect(preview.leaseCount).toBe(2)
    expect(preview.leasesToFlag.map((lease) => lease.id).sort()).toEqual(['lease-during', 'lease-ending'])
  })

  it('refuses a stale preview, then cancels the bookings with the unavailability as reason', async () => {
    const em = seed()
    const booking = seedBooking(em)
    await expectHttpError(run('property_management.unavailability.create', confirmFloor([]), em), 409, 'preview_stale')
    expect(em.rows(Unavailability)).toHaveLength(0)
    await expectHttpError(run('property_management.unavailability.create', closeFloor(), em), 422, 'preview_token_required')
    const result = await run<{ unavailabilityId: string; cancelledBookings: number; applyStatus: string }>(
      'property_management.unavailability.create',
      confirmFloor([BOOKING]),
      em,
    )
    expect(result).toMatchObject({ cancelledBookings: 1, applyStatus: 'applied', queuedBookings: 0, flaggedLeases: 0 })
    expect(booking).toMatchObject({ status: 'cancelled', cancelReason: 'unavailability', unavailabilityId: result.unavailabilityId, holdToken: null })
    const [operation] = em.rows(SalesOperation) as unknown as SalesOperation[]
    expect(operation).toMatchObject({ kind: 'order_status', subjectKey: 'order_status:order-1:cancelled', payload: { orderId: 'order-1', statusEntryId: CANCELLED } })
    expect(enqueueSalesOperations).toHaveBeenCalledWith([operation.id])
    expect(emitBookingEvent).toHaveBeenCalledWith('property_management.booking.cancelled', booking)
    expect(emitPropertyManagementEvent).toHaveBeenCalledWith(
      'property_management.unavailability.created',
      expect.objectContaining({ subjectType: 'floor', subjectId: FLOOR, cancelledBookingCount: 1 }),
      { persistent: true, ...scope },
    )
    expect(em.rows(Unavailability)[0]).toMatchObject({ buildingId: BUILDING, cancelledBookingCount: 1, applyStatus: 'applied', startsAt: `${TODAY}T00:00:00` })
  })

  it('keeps the preview token valid when a booking ends between preview and confirm', async () => {
    const em = seed()
    const booking = seedBooking(em)
    const preview = await previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor() } as never, FULL_CRM)
    expect(preview.bookingCount).toBe(1)
    booking.startsAt = `${TODAY}T00:00:00`
    booking.endsAt = `${TODAY}T00:01:00`
    booking.status = 'completed'
    const result = await run<{ cancelledBookings: number }>('property_management.unavailability.create', closeFloor({ previewToken: preview.previewToken }), em)
    expect(result.cancelledBookings).toBe(0)
    expect(booking.status).toBe('completed')
  })

  it('refuses a preview token taken for another subject or range', async () => {
    const em = seed()
    const otherRange = await previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor({ startsAt: `${DAY}T00:00` }) } as never, FULL_CRM)
    await expectHttpError(run('property_management.unavailability.create', closeFloor({ previewToken: otherRange.previewToken }), em), 409, 'preview_stale')
    await expectHttpError(
      run('property_management.unavailability.create', closeFloor({ subjectType: 'space', subjectId: SPACE, previewToken: tokenOf([]) }), em),
      409,
      'preview_stale',
    )
    expect(em.rows(Unavailability)).toHaveLength(0)
  })

  it('does not name a deleted CRM person in the preview', async () => {
    const em = seed()
    seedBooking(em)
    ;(em.rows(CustomerEntity).find((row) => row.id === PERSON) as Record<string, unknown>).deletedAt = new Date()
    const preview = await previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor() } as never, FULL_CRM)
    expect(preview.bookingsToCancel).toEqual([expect.objectContaining({ id: BOOKING, person: null })])
  })

  describe('CRM names in the preview', () => {
    function seedImpact(): FakeEm {
      const em = seed()
      seedBooking(em)
      em.seed(Lease, { id: 'lease-1', ...scope, unitId: UNIT, reference: 'L-2026-001', customerCompanyId: COMPANY, status: 'active', startsOn: '2026-01-01', endsOn: '2099-12-31', pendingChange: null, deletedAt: null } as never)
      return em
    }

    it.each([
      { access: { people: true, companies: true }, person: 'Marcus Webb', company: 'Solstice Analytics', reads: [PERSON, COMPANY] },
      { access: { people: true, companies: false }, person: 'Marcus Webb', company: undefined, reads: [PERSON] },
      { access: { people: false, companies: true }, person: undefined, company: 'Solstice Analytics', reads: [COMPANY] },
    ])('names only what $access allows and reads only those CRM records', async ({ access, person, company, reads }) => {
      const em = seedImpact()
      const find = jest.spyOn(em, 'find')
      const preview = await previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor() } as never, access)
      expect(preview.crmAccess).toEqual(access)
      expect(preview.bookingsToCancel[0].person).toBe(person)
      expect('person' in preview.bookingsToCancel[0]).toBe(access.people)
      expect(preview.leasesToFlag[0].company).toBe(company)
      expect('company' in preview.leasesToFlag[0]).toBe(access.companies)
      const crmFinds = find.mock.calls.filter(([entity]) => entity === CustomerEntity)
      expect(crmFinds).toHaveLength(1)
      expect((crmFinds[0][1] as { id: { $in: string[] } }).id.$in.sort()).toEqual([...reads].sort())
    })

    it('omits every name and reads no CRM record without the customers view features', async () => {
      const em = seedImpact()
      const find = jest.spyOn(em, 'find')
      const access = { people: false, companies: false }
      const preview = await previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor() } as never, access)
      expect(preview.crmAccess).toEqual(access)
      expect(Object.keys(preview.bookingsToCancel[0])).not.toContain('person')
      expect(Object.keys(preview.leasesToFlag[0])).not.toContain('company')
      expect(preview.bookingsToCancel[0].id).toBe(BOOKING)
      expect(preview.leasesToFlag[0].id).toBe('lease-1')
      expect(find.mock.calls.filter(([entity]) => entity === CustomerEntity)).toHaveLength(0)
    })
  })

  it('checks the optimistic lock against the row it locked when ending', async () => {
    const em = seed()
    const { unavailabilityId } = await run<{ unavailabilityId: string }>('property_management.unavailability.create', confirmFloor([]), em)
    const findOne = jest.spyOn(em, 'findOne')
    const lockCheck = enforceCommandOptimisticLockWithGuards as jest.Mock
    lockCheck.mockClear()
    await run('property_management.unavailability.end', { id: unavailabilityId }, em)
    const lockedRead = findOne.mock.calls.findIndex(
      ([entity, , options]) => entity === Unavailability && (options as { lockMode?: number } | undefined)?.lockMode === LockMode.PESSIMISTIC_WRITE,
    )
    expect(lockedRead).toBeGreaterThanOrEqual(0)
    expect(lockCheck).toHaveBeenCalledTimes(1)
    expect(lockCheck.mock.invocationCallOrder[0]).toBeGreaterThan(findOne.mock.invocationCallOrder[lockedRead])
    expect(lockCheck).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resourceId: unavailabilityId }))
  })

  it('emits the ended event with trusted tenant and organization scope as a persistent event', async () => {
    const em = seed()
    const { unavailabilityId } = await run<{ unavailabilityId: string }>('property_management.unavailability.create', confirmFloor([]), em)
    await run('property_management.unavailability.end', { id: unavailabilityId }, em)
    expect(emitPropertyManagementEvent).toHaveBeenCalledWith(
      'property_management.unavailability.ended',
      expect.objectContaining({ unavailabilityId, subjectType: 'floor', subjectId: FLOOR, ...scope }),
      { persistent: true, ...scope },
    )
  })

  it('cancels up to 200 bookings at once and queues the rest', async () => {
    const em = seed()
    const ids: string[] = []
    for (let index = 0; index < 205; index += 1) {
      const id = `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      ids.push(id)
      seedBooking(em, { id, salesOrderId: null, status: 'pending', startsAt: `${isoDay(2 + index)}T10:00:00`, endsAt: `${isoDay(2 + index)}T11:00:00` })
    }
    const result = await run<{ cancelledBookings: number; queuedBookings: number; applyStatus: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    expect(result).toMatchObject({ cancelledBookings: 200, queuedBookings: 5, applyStatus: 'applying' })
    expect(em.rows(Booking).filter((row) => row.status === 'cancelled')).toHaveLength(200)
    const queue = (createModuleQueue as jest.Mock).mock.results.at(-1)?.value as { enqueue: jest.Mock }
    expect(queue.enqueue).toHaveBeenCalledWith({ unavailabilityId: expect.any(String), progressJobId: null, userId: 'user-1' })
  })

  it('reindexes the inline-cancelled bookings in one flush', async () => {
    const em = seed()
    const ids = [0, 1, 2].map((index) => {
      const id = `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      seedBooking(em, { id, salesOrderId: null, status: 'pending', startsAt: `${isoDay(2 + index)}T10:00:00`, endsAt: `${isoDay(2 + index)}T11:00:00` })
      return id
    })
    const dataEngine = { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn(async () => undefined) }
    const ctx = buildCtx(em)
    const handler = commandRegistry.get('property_management.unavailability.create')
    if (!handler) throw new Error('[internal] missing property_management.unavailability.create')
    await handler.execute(
      { ...scope, ...confirmFloor(ids) },
      { ...ctx, container: { resolve: (name: string) => (name === 'dataEngine' ? dataEngine : ctx.container.resolve(name)) } as never },
    )
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(3)
    expect(dataEngine.flushOrmEntityChanges).toHaveBeenCalledTimes(1)
  })

  it('writes a booking-cancel audit entry for every inline cancellation, like the queued ones get', async () => {
    const em = seed()
    const ids = [0, 1].map((index) => {
      const id = `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      seedBooking(em, { id, salesOrderId: null, status: 'pending', startsAt: `${isoDay(2 + index)}T10:00:00`, endsAt: `${isoDay(2 + index)}T11:00:00` })
      return id
    })
    const actionLogService = { log: jest.fn(async () => null) }
    const ctx = buildCtx(em)
    const handler = commandRegistry.get('property_management.unavailability.create')
    if (!handler) throw new Error('[internal] missing property_management.unavailability.create')
    const result = (await handler.execute(
      { ...scope, ...confirmFloor(ids) },
      { ...ctx, container: { resolve: (name: string) => (name === 'actionLogService' ? actionLogService : ctx.container.resolve(name)) } as never },
    )) as { unavailabilityId: string }
    expect(actionLogService.log).toHaveBeenCalledTimes(2)
    for (const id of ids) {
      expect(actionLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          ...scope,
          actorUserId: 'user-1',
          commandId: 'property_management.booking.cancel',
          resourceKind: 'property_management.booking',
          resourceId: id,
          relatedResourceKind: 'property_management.unavailability',
          relatedResourceId: result.unavailabilityId,
        }),
        expect.anything(),
      )
    }
  })

  it('keeps the closure when writing the inline cancellation audit entries fails', async () => {
    const em = seed()
    seedBooking(em)
    const actionLogService = { log: jest.fn(async () => { throw new Error('[internal] audit down') }) }
    const ctx = buildCtx(em)
    const handler = commandRegistry.get('property_management.unavailability.create')
    if (!handler) throw new Error('[internal] missing property_management.unavailability.create')
    await withReportedErrors(async (reportError) => {
      const result = (await handler.execute(
        { ...scope, ...confirmFloor([BOOKING]) },
        { ...ctx, container: { resolve: (name: string) => (name === 'actionLogService' ? actionLogService : ctx.container.resolve(name)) } as never },
      )) as { cancelledBookings: number }
      expect(result.cancelledBookings).toBe(1)
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'property_management.unavailability_cancel_log_failed' }))
    })
  })

  it('records an order cancellation for every inline booking that has an order', async () => {
    const em = seed()
    const first = seedBooking(em)
    const second = seedBooking(em, { id: '50000000-0000-4000-8000-0000000000b2', salesOrderId: 'order-2', startsAt: `${DAY}T14:00:00`, endsAt: `${DAY}T15:00:00` })
    const result = await run<{ cancelledBookings: number }>(
      'property_management.unavailability.create',
      confirmFloor([first.id, second.id]),
      em,
    )
    expect(result.cancelledBookings).toBe(2)
    expect(first).toMatchObject({ status: 'cancelled', cancelReason: 'unavailability' })
    expect(second).toMatchObject({ status: 'cancelled', cancelReason: 'unavailability' })
    const operations = em.rows(SalesOperation) as unknown as SalesOperation[]
    expect(operations.map((operation) => operation.subjectKey).sort()).toEqual(['order_status:order-1:cancelled', 'order_status:order-2:cancelled'])
    expect(operations.every((operation) => operation.kind === 'order_status')).toBe(true)
    expect(enqueueSalesOperations).toHaveBeenCalledWith(operations.map((operation) => operation.id))
  })

  it('records every order cancellation before releasing the bookings and flushes the confirm once', async () => {
    const em = seed()
    const first = seedBooking(em)
    const second = seedBooking(em, { id: '50000000-0000-4000-8000-0000000000b3', salesOrderId: 'order-3', startsAt: `${DAY}T14:00:00`, endsAt: `${DAY}T15:00:00` })
    const third = seedBooking(em, { id: '50000000-0000-4000-8000-0000000000b4', salesOrderId: null, startsAt: `${DAY}T16:00:00`, endsAt: `${DAY}T17:00:00` })
    const statusesAtLookup: string[] = []
    const find = em.find.bind(em)
    jest.spyOn(em, 'find').mockImplementation(async (entity, where, options) => {
      if (entity === SalesOperation) statusesAtLookup.push(...[first, second, third].map((booking) => booking.status))
      return find(entity, where, options)
    })
    em.flushes = 0
    const result = await run<{ cancelledBookings: number }>(
      'property_management.unavailability.create',
      confirmFloor([first.id, second.id, third.id]),
      em,
    )
    expect(result.cancelledBookings).toBe(3)
    expect(em.flushes).toBe(1)
    expect(statusesAtLookup.length).toBeGreaterThan(0)
    expect(statusesAtLookup.every((status) => status !== 'cancelled')).toBe(true)
    expect([first, second, third].map((booking) => booking.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
    expect((em.rows(SalesOperation) as unknown as SalesOperation[]).map((operation) => operation.subjectKey).sort()).toEqual([
      'order_status:order-1:cancelled',
      'order_status:order-3:cancelled',
    ])
  })

  it('looks up the order cancellations of all inline bookings in one query', async () => {
    const em = seed()
    const ids: string[] = []
    for (let index = 0; index < 25; index += 1) {
      const id = `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      ids.push(id)
      seedBooking(em, { id, salesOrderId: `order-${index}`, status: 'pending', startsAt: `${isoDay(2 + index)}T10:00:00`, endsAt: `${isoDay(2 + index)}T11:00:00` })
    }
    em.seed(SalesOperation, {
      id: 'operation-existing',
      ...scope,
      kind: 'order_status',
      subjectKey: 'order_status:order-0:cancelled',
      payloadHash: hashPayload({ orderId: 'order-0', statusEntryId: CANCELLED }),
      payload: { orderId: 'order-0', statusEntryId: CANCELLED },
      status: 'failed',
    } as never)
    const find = jest.spyOn(em, 'find')
    const findOne = jest.spyOn(em, 'findOne')
    const result = await run<{ cancelledBookings: number }>('property_management.unavailability.create', confirmFloor(ids), em)
    expect(result.cancelledBookings).toBe(25)
    expect(find.mock.calls.filter(([entity]) => entity === SalesOperation)).toHaveLength(1)
    expect(findOne.mock.calls.filter(([entity]) => entity === SalesOperation)).toHaveLength(0)
    expect(em.rows(SalesOperation)).toHaveLength(25)
    const enqueued = (enqueueSalesOperations as jest.Mock).mock.calls[0][0] as string[]
    expect(enqueued).toHaveLength(25)
    expect(enqueued).toContain('operation-existing')
  })

  it('refuses up front when a queued booking has an order and no cancelled status is configured', async () => {
    const em = seed()
    ;(em.rows(PropertyManagementSettings)[0] as unknown as PropertyManagementSettings).cancelledOrderStatusEntryId = null
    const ids: string[] = []
    for (let index = 0; index < 205; index += 1) {
      const id = `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      ids.push(id)
      seedBooking(em, { id, salesOrderId: index === 204 ? 'order-204' : null, status: 'pending', startsAt: `${isoDay(2 + index)}T10:00:00`, endsAt: `${isoDay(2 + index)}T11:00:00` })
    }
    await expectHttpError(run('property_management.unavailability.create', confirmFloor(ids), em), 422, 'cancelled_status_missing')
    expect(em.rows(Unavailability)).toHaveLength(0)
    expect(em.rows(Booking).filter((row) => row.status === 'cancelled')).toHaveLength(0)
  })

  it('refuses to cancel pending bookings whose orders are still being created when no cancelled status is configured', async () => {
    const em = seed()
    ;(em.rows(PropertyManagementSettings)[0] as unknown as PropertyManagementSettings).cancelledOrderStatusEntryId = null
    const ids = [0, 1].map((index) => {
      const id = `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      seedBooking(em, { id, salesOrderId: null, status: 'pending', startsAt: `${isoDay(2 + index)}T10:00:00`, endsAt: `${isoDay(2 + index)}T11:00:00` })
      return id
    })
    await expectHttpError(run('property_management.unavailability.create', confirmFloor(ids), em), 422, 'cancelled_status_missing')
    expect(em.rows(Booking).filter((row) => row.status === 'cancelled')).toHaveLength(0)
    expect(em.rows(SalesOperation)).toHaveLength(0)
  })

  it('refuses up front when only queued pending bookings without orders need the cancelled status', async () => {
    const em = seed()
    ;(em.rows(PropertyManagementSettings)[0] as unknown as PropertyManagementSettings).cancelledOrderStatusEntryId = null
    const ids: string[] = []
    for (let index = 0; index < 205; index += 1) {
      const id = `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      ids.push(id)
      seedBooking(em, {
        id,
        salesOrderId: null,
        status: index === 204 ? 'pending' : 'confirmed',
        startsAt: `${isoDay(2 + index)}T10:00:00`,
        endsAt: `${isoDay(2 + index)}T11:00:00`,
      })
    }
    await expectHttpError(run('property_management.unavailability.create', confirmFloor(ids), em), 422, 'cancelled_status_missing')
    expect(em.rows(Unavailability)).toHaveLength(0)
    expect(em.rows(Booking).filter((row) => row.status === 'cancelled')).toHaveLength(0)
  })

  it('refuses the preview for a pending booking without an order when no cancelled status is configured', async () => {
    const em = seed()
    ;(em.rows(PropertyManagementSettings)[0] as unknown as PropertyManagementSettings).cancelledOrderStatusEntryId = null
    seedBooking(em, { salesOrderId: null, status: 'pending' })
    await expectHttpError(
      previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor() } as never, FULL_CRM),
      422,
      'cancelled_status_missing',
    )
  })

  it('still previews confirmed bookings without orders when no cancelled status is configured', async () => {
    const em = seed()
    ;(em.rows(PropertyManagementSettings)[0] as unknown as PropertyManagementSettings).cancelledOrderStatusEntryId = null
    seedBooking(em, { salesOrderId: null, status: 'confirmed' })
    const preview = await previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor() } as never, FULL_CRM)
    expect(preview.bookingCount).toBe(1)
  })

  it('refuses an archived building and a period already over', async () => {
    const em = seed()
    em.rows(Building)[0].status = 'archived'
    await expectHttpError(run('property_management.unavailability.create', confirmFloor([]), em), 409, 'subject_archived')
    await expectHttpError(
      previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor({ startsAt: '2020-01-01T00:00', endsAt: '2020-01-02T00:00' }) } as never, FULL_CRM),
      422,
      'unavailability_in_past',
    )
  })

  it('refuses a dry run for a reason that is no longer in the active reasons list, before issuing a token', async () => {
    const em = seed()
    seedBooking(em)
    const staleReason = { reasonEntryId: '50000000-0000-4000-8000-0000000000ee' }
    await expectHttpError(
      previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor(staleReason) } as never, FULL_CRM),
      422,
      'unavailability_reason_invalid',
    )
    await expectHttpError(run('property_management.unavailability.create', confirmFloor([BOOKING], staleReason), em), 422, 'unavailability_reason_invalid')
    expect(em.rows(Unavailability)).toHaveLength(0)
  })

  it('hides subjects of buildings the caller does not manage', async () => {
    await expectHttpError(previewUnavailability(seed() as never, scope, [], { ...scope, ...closeFloor() } as never, FULL_CRM), 404)
  })

  it('refuses a period starting before today and accepts one starting today or later', async () => {
    const em = seed()
    const yesterday = closeFloor({ startsAt: `${isoDay(-1)}T00:00`, endsAt: `${isoDay(3)}T00:00` })
    await expectHttpError(previewUnavailability(em as never, scope, null, { ...scope, ...yesterday } as never, FULL_CRM), 422, 'unavailability_start_in_past')
    await expectHttpError(run('property_management.unavailability.create', { ...yesterday, previewToken: tokenOf([]) }, em), 422, 'unavailability_start_in_past')
    expect(em.rows(Unavailability)).toHaveLength(0)
    const today = await previewUnavailability(em as never, scope, null, { ...scope, ...closeFloor({ startsAt: `${TODAY}T00:00` }) } as never, FULL_CRM)
    expect(today.bookingCount).toBe(0)
    const tomorrow = await run<{ unavailabilityId: string }>('property_management.unavailability.create', confirmFloor([], { startsAt: `${DAY}T00:00` }), em)
    expect(tomorrow.unavailabilityId).toEqual(expect.any(String))
  })

  it('confirms with narrowed unit and lease reads', async () => {
    const em = seed()
    const first = seedBooking(em)
    const second = seedBooking(em, { id: '50000000-0000-4000-8000-0000000000b2', salesOrderId: 'order-2', startsAt: `${DAY}T14:00:00`, endsAt: `${DAY}T15:00:00` })
    em.seed(Lease, { id: 'lease-1', ...scope, unitId: UNIT, reference: 'L-2026-001', customerCompanyId: COMPANY, status: 'active', startsOn: '2026-01-01', endsOn: '2099-12-31', pendingChange: null, deletedAt: null } as never)
    const find = jest.spyOn(em, 'find')
    const respond = em.respond
    em.respond = (sql, params) => (sql.includes('from property_management_leases lease') ? [{ total: 1 }] : respond(sql, params))
    const result = await run<{ cancelledBookings: number; flaggedLeases: number }>(
      'property_management.unavailability.create',
      confirmFloor([first.id, second.id]),
      em,
    )
    expect(result).toMatchObject({ cancelledBookings: 2, flaggedLeases: 1 })
    const unitFind = find.mock.calls.find(([entity]) => entity === Unit)
    expect(unitFind?.[2]).toMatchObject({ fields: ['id'], lockMode: LockMode.PESSIMISTIC_WRITE })
    expect(find.mock.calls.some(([entity]) => entity === Lease)).toBe(false)
    const leaseCount = em.executed.find((entry) => entry.sql.includes('from property_management_leases lease'))
    expect(leaseCount?.sql).toContain('count(*)::int as total')
    expect(leaseCount?.params.slice(0, 3)).toEqual([scope.organizationId, scope.tenantId, UNIT])
    expect(em.rows(SalesOperation)).toHaveLength(2)
  })
})

describe('unavailability apply worker', () => {
  const PROGRESS_JOB = '50000000-0000-4000-8000-00000000000c'

  function seedFutureBookings(em: FakeEm, count: number): string[] {
    const ids: string[] = []
    for (let index = 0; index < count; index += 1) {
      const id = `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      ids.push(id)
      seedBooking(em, { id, salesOrderId: null, status: 'pending', startsAt: `${isoDay(2 + index)}T10:00:00`, endsAt: `${isoDay(2 + index)}T11:00:00` })
    }
    return ids
  }

  function expectClosureWritesKeepVersion(nativeUpdate: jest.SpyInstance, expectedWrites: number): void {
    const closureWrites = nativeUpdate.mock.calls.filter(([entity]) => entity === Unavailability).map((call) => call[2] as Record<string, unknown>)
    expect(closureWrites).toHaveLength(expectedWrites)
    for (const data of closureWrites) {
      expect(data).toEqual(expect.objectContaining({ cancelledBookingCount: expect.any(Number), applyHeartbeatAt: expect.any(Date) }))
      expect(data).not.toHaveProperty('updatedAt')
    }
  }

  function workerContainer(
    em: FakeEm,
    onProgress: () => Promise<void>,
    onCommand: (commandId: string, input: Record<string, unknown>) => Promise<void> = async () => undefined,
  ) {
    const progressService = {
      startJob: jest.fn(async () => ({})),
      getJob: jest.fn(
        async (): Promise<{ status?: string; processedCount: number; totalCount?: number | null; meta?: Record<string, unknown> | null } | null> => ({
          processedCount: 0,
          totalCount: null,
          meta: null,
        }),
      ),
      updateProgress: jest.fn(async () => {
        await onProgress()
        return {}
      }),
      completeJob: jest.fn(async () => ({})),
      failJob: jest.fn(async () => ({})),
      touchJobHeartbeat: jest.fn(async () => undefined),
    }
    const commandBus = {
      execute: async (commandId: string, { input, ctx }: { input: Record<string, unknown>; ctx: CommandRuntimeContext }) => {
        const handler = commandRegistry.get(commandId)
        if (!handler) throw new Error(`[internal] missing command ${commandId}`)
        await onCommand(commandId, input)
        return { result: await handler.execute(input, ctx) }
      },
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'commandBus') return commandBus
        if (name === 'progressService') return progressService
        throw new Error(`[internal] unexpected ${name}`)
      },
    }
    return { container, progressService }
  }

  it('lets a manager end a closure while it is still applying, and the worker then stops', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 305)
    const { unavailabilityId } = await run<{ unavailabilityId: string; queuedBookings: number }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    const closure = em.rows(Unavailability)[0]
    const loadedVersion = new Date('2026-01-01T00:00:00.000Z')
    closure.updatedAt = loadedVersion
    let ended = false
    const { container, progressService } = workerContainer(em, async () => {
      if (ended) return
      ;(enforceCommandOptimisticLockWithGuards as jest.Mock).mockImplementationOnce(async (_container: unknown, options: { current: Date }) => {
        if (options.current.getTime() !== loadedVersion.getTime()) throw new CrudHttpError(409, { code: 'record_conflict' })
      })
      await run('property_management.unavailability.end', { id: unavailabilityId }, em)
      ended = true
    })
    progressService.getJob.mockResolvedValueOnce({ processedCount: 0, totalCount: 105, meta: { inlineCancelled: 200 } })
    const nativeUpdate = jest.spyOn(em, 'nativeUpdate')
    const summary = await runUnavailabilityApply(
      { container: container as never, em: em as never },
      { unavailabilityId, progressJobId: PROGRESS_JOB, scope: { ...scope, userId: 'user-1' } },
    )
    expect(ended).toBe(true)
    expect(summary).toEqual({ cancelled: 100, skipped: 0 })
    expect(closure).toMatchObject({ applyStatus: 'applied', cancelledBookingCount: 300 })
    expect(closure.endedAt).toBeTruthy()
    expect(closure.applyHeartbeatAt).toBeInstanceOf(Date)
    expect(em.rows(Booking).filter((row) => row.status === 'pending')).toHaveLength(5)
    expect(progressService.updateProgress).toHaveBeenCalledTimes(1)
    expect(progressService.completeJob).toHaveBeenCalledWith(PROGRESS_JOB, { resultSummary: { cancelled: 100, skipped: 0 } }, expect.anything())
    expectClosureWritesKeepVersion(nativeUpdate, 2)
  })

  it('records chunk progress without bumping the closure version', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    const closure = em.rows(Unavailability)[0]
    const loadedVersion = new Date('2026-01-01T00:00:00.000Z')
    closure.updatedAt = loadedVersion
    const { container } = workerContainer(em, async () => undefined)
    const nativeUpdate = jest.spyOn(em, 'nativeUpdate')
    await runUnavailabilityApply({ container: container as never, em: em as never }, { unavailabilityId, scope })
    expect(closure).toMatchObject({ applyStatus: 'applied', cancelledBookingCount: 205 })
    expect((closure.updatedAt as Date).getTime()).toBe(loadedVersion.getTime())
    expectClosureWritesKeepVersion(nativeUpdate, 2)
    expect(nativeUpdate.mock.calls.at(-1)?.[2]).toMatchObject({ applyStatus: 'applied', cancelledBookingCount: 205 })
  })

  it('stops instead of skipping bookings when the cancelled status was removed meanwhile', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    const queued = em.rows(Booking).find((row) => row.status === 'pending') as unknown as Booking
    queued.salesOrderId = 'order-queued'
    ;(em.rows(PropertyManagementSettings)[0] as unknown as PropertyManagementSettings).cancelledOrderStatusEntryId = null
    const { container, progressService } = workerContainer(em, async () => undefined)
    await expect(
      runUnavailabilityApply({ container: container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope }),
    ).rejects.toMatchObject({ status: 422 })
    expect(em.rows(Unavailability)[0]).toMatchObject({ applyStatus: 'applying' })
    expect(queued.status).toBe('pending')
    expect(progressService.failJob).toHaveBeenCalledWith(
      PROGRESS_JOB,
      {
        errorMessage:
          'Bookings could not be cancelled: choose the sales order status used for cancelled bookings in the Property Management settings. Cancelling resumes once it is set.',
      },
      expect.anything(),
    )
  })

  it('stops cancelling the rest of a chunk once the closure is ended mid-chunk', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 305)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    let cancels = 0
    const { container } = workerContainer(em, async () => undefined, async (commandId) => {
      if (commandId !== 'property_management.booking.cancel') return
      cancels += 1
      if (cancels === 51) await run('property_management.unavailability.end', { id: unavailabilityId }, em)
    })
    const summary = await runUnavailabilityApply({ container: container as never, em: em as never }, { unavailabilityId, scope })
    expect(summary).toEqual({ cancelled: 50, skipped: 50 })
    expect(em.rows(Booking).filter((row) => row.status === 'pending')).toHaveLength(55)
    expect(em.rows(Unavailability)[0]).toMatchObject({ applyStatus: 'applied', cancelledBookingCount: 250 })
    expect(em.rows(Unavailability)[0].endedAt).toBeTruthy()
  })

  it('logs every booking it skips with the closure, booking, error code and status', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    const queued = em.rows(Booking).filter((row) => row.status === 'pending')
    const skippedId = queued[0].id
    const warn = jest.spyOn(createLogger('property_management'), 'warn')
    try {
      const { container } = workerContainer(em, async () => undefined, async (commandId, input) => {
        if (commandId === 'property_management.booking.cancel' && input.id === skippedId) {
          throw new CrudHttpError(409, { error: 'Booking changed', code: 'booking_not_cancellable' })
        }
      })
      const summary = await runUnavailabilityApply({ container: container as never, em: em as never }, { unavailabilityId, scope })
      expect(summary).toEqual({ cancelled: queued.length - 1, skipped: 1 })
      expect(warn).toHaveBeenCalledWith(expect.any(String), {
        unavailabilityId,
        bookingId: skippedId,
        code: 'booking_not_cancellable',
        status: 409,
      })
    } finally {
      warn.mockRestore()
    }
  })

  it('refuses an unavailability cancellation for a booking the closure does not cover', async () => {
    const em = seed()
    const booking = seedBooking(em, { status: 'pending', salesOrderId: null })
    const OTHER_CLOSURE = '50000000-0000-4000-8000-0000000000f1'
    const UNDONE_CLOSURE = '50000000-0000-4000-8000-0000000000f2'
    em.seed(Unavailability, { id: OTHER_CLOSURE, ...scope, buildingId: BUILDING, subjectType: 'space', subjectId: OTHER_SPACE, reasonText: 'Works', startsAt: `${TODAY}T00:00:00`, endsAt: null, endedAt: null, deletedAt: null, applyStatus: 'applying' } as never)
    em.seed(Unavailability, { id: UNDONE_CLOSURE, ...scope, buildingId: BUILDING, subjectType: 'floor', subjectId: FLOOR, reasonText: 'Works', startsAt: `${TODAY}T00:00:00`, endsAt: null, endedAt: null, deletedAt: new Date(), applyStatus: 'applying' } as never)
    const cancel = (unavailabilityId: string) => run('property_management.booking.cancel', { id: BOOKING, reason: 'unavailability', unavailabilityId }, em)
    await expectHttpError(cancel(OTHER_CLOSURE), 409, 'unavailability_not_covering')
    await expectHttpError(cancel(UNDONE_CLOSURE), 409, 'unavailability_not_covering')
    expect(booking.status).toBe('pending')
  })

  it('keeps the cancelled count of a chunk that failed midway and reports progress from it on retry', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 305)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    let cancels = 0
    const failing = workerContainer(em, async () => undefined, async () => {
      cancels += 1
      if (cancels === 31) throw new Error('[internal] connection lost')
    })
    await expect(
      runUnavailabilityApply({ container: failing.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope }),
    ).rejects.toThrow('[internal] connection lost')
    expect(em.rows(Unavailability)[0]).toMatchObject({ applyStatus: 'applying', cancelledBookingCount: 230 })
    const retry = workerContainer(em, async () => undefined)
    retry.progressService.getJob.mockResolvedValueOnce({ processedCount: 10, meta: { inlineCancelled: 200 } })
    await runUnavailabilityApply({ container: retry.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope })
    expect(em.rows(Unavailability)[0]).toMatchObject({ applyStatus: 'applied', cancelledBookingCount: 305 })
    expect(retry.progressService.updateProgress).toHaveBeenCalledWith(PROGRESS_JOB, { processedCount: 105 }, expect.anything())
    expect(retry.progressService.completeJob).toHaveBeenCalledWith(PROGRESS_JOB, { resultSummary: { cancelled: 105, skipped: 0 } }, expect.anything())
  })

  it('cancels the booking of a unit moved into the closed subject between chunks', async () => {
    const em = seed()
    const MOVED_UNIT = '50000000-0000-4000-8000-0000000000d1'
    const MOVED_BOOKING = '50000000-0000-4000-8000-0000000000d2'
    em.seed(Unit, { id: MOVED_UNIT, ...scope, buildingId: BUILDING, floorId: FLOOR, spaceId: OTHER_SPACE, name: 'Studio 3C', catalogProductId: PRODUCT, deletedAt: null } as never)
    const moved = seedBooking(em, { id: MOVED_BOOKING, unitId: MOVED_UNIT, salesOrderId: null, status: 'pending', startsAt: `${isoDay(400)}T10:00:00`, endsAt: `${isoDay(400)}T11:00:00` })
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string; queuedBookings: number }>(
      'property_management.unavailability.create',
      confirmFloor(ids, { subjectType: 'space', subjectId: SPACE }),
      em,
    )
    expect(moved.status).toBe('pending')
    const { container, progressService } = workerContainer(em, async () => {
      ;(em.rows(Unit).find((unit) => unit.id === MOVED_UNIT) as unknown as Unit).spaceId = SPACE
    })
    progressService.getJob.mockResolvedValueOnce({ processedCount: 0, totalCount: 5, meta: { inlineCancelled: 200 } })
    const summary = await runUnavailabilityApply({ container: container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope })
    expect(summary).toEqual({ cancelled: 6, skipped: 0 })
    expect(moved).toMatchObject({ status: 'cancelled', cancelReason: 'unavailability', unavailabilityId })
    expect(progressService.updateProgress.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { processedCount: 5 },
      { totalCount: 6, processedCount: 6 },
    ])
  })

  it('leaves past bookings of an applying closure to the worker instead of completing them', async () => {
    const em = seed()
    const OUTSIDE_UNIT = '50000000-0000-4000-8000-0000000000e1'
    const INSIDE = '50000000-0000-4000-8000-0000000000e2'
    const OUTSIDE = '50000000-0000-4000-8000-0000000000e3'
    const CLOSURE = '50000000-0000-4000-8000-0000000000e4'
    const YESTERDAY = isoDay(-1)
    em.seed(Unit, { id: OUTSIDE_UNIT, ...scope, buildingId: BUILDING, floorId: FLOOR, spaceId: OTHER_SPACE, name: 'Studio 3C', catalogProductId: PRODUCT, deletedAt: null } as never)
    const inside = seedBooking(em, { id: INSIDE, salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    const outside = seedBooking(em, { id: OUTSIDE, unitId: OUTSIDE_UNIT, salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    em.seed(Unavailability, {
      id: CLOSURE,
      ...scope,
      buildingId: BUILDING,
      subjectType: 'space',
      subjectId: SPACE,
      reasonText: 'Works',
      startsAt: `${isoDay(-2)}T00:00:00`,
      endsAt: null,
      endedAt: null,
      deletedAt: null,
      applyStatus: 'applying',
      cancelledBookingCount: 0,
      applyHeartbeatAt: new Date(),
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    } as never)
    const { container } = workerContainer(em, async () => undefined)
    const sweep = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
    expect(sweep.completed).toBe(1)
    expect(outside.status).toBe('completed')
    expect(inside.status).toBe('confirmed')
    await runUnavailabilityApply({ container: container as never, em: em as never }, { unavailabilityId: CLOSURE, scope })
    expect(inside).toMatchObject({ status: 'cancelled', cancelReason: 'unavailability', unavailabilityId: CLOSURE })
  })

  it('completes past bookings that ended before a backdated closure was created, since the worker never cancels them', async () => {
    const em = seed()
    const CLOSURE = '50000000-0000-4000-8000-0000000000e5'
    const YESTERDAY = isoDay(-1)
    const ended = seedBooking(em, { salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    em.seed(Unavailability, {
      id: CLOSURE,
      ...scope,
      buildingId: BUILDING,
      subjectType: 'space',
      subjectId: SPACE,
      reasonText: 'Works',
      startsAt: `${isoDay(-2)}T00:00:00`,
      endsAt: null,
      endedAt: null,
      deletedAt: null,
      applyStatus: 'applying',
      cancelledBookingCount: 0,
      applyHeartbeatAt: new Date(),
      createdAt: new Date(),
    } as never)
    const { container } = workerContainer(em, async () => undefined)
    const sweep = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
    expect(sweep.completed).toBe(1)
    expect(ended.status).toBe('completed')
  })

  it('confirms a closure loading only the needed booking fields and full rows just for the inline cancellations', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const find = jest.spyOn(em, 'find')
    await run('property_management.unavailability.create', confirmFloor(ids), em)
    const bookingFinds = find.mock.calls.filter(([entity]) => entity === Booking)
    expect(bookingFinds).toHaveLength(2)
    expect(bookingFinds[0][2]).toMatchObject({ limit: 200, fields: ['id', 'unitId', 'startsAt', 'endsAt', 'bookedByPersonId', 'salesOrderId'] })
    expect(bookingFinds[1][1]).toMatchObject({ id: { $in: ids.slice(0, 200) } })
    expect(bookingFinds[1][2]).not.toHaveProperty('fields')
    expect(em.rows(Booking).filter((row) => row.status === 'cancelled').map((row) => row.id)).toEqual(ids.slice(0, 200))
  })

  it('stores the inline cancellations on the progress job so the worker reports only its own share', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const createJob = jest.fn(async () => ({ id: PROGRESS_JOB }))
    const handler = commandRegistry.get('property_management.unavailability.create')
    if (!handler) throw new Error('[internal] missing command')
    const ctx = buildCtx(em)
    ctx.container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'progressService') return { createJob }
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never
    await handler.execute({ ...scope, ...confirmFloor(ids) }, ctx)
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({ totalCount: 5, meta: expect.objectContaining({ inlineCancelled: 200 }) }),
      expect.anything(),
    )
    expect(em.rows(Unavailability)[0]).toMatchObject({ progressJobId: PROGRESS_JOB })
    const worker = workerContainer(em, async () => undefined)
    worker.progressService.getJob.mockResolvedValueOnce({ processedCount: 0, meta: { inlineCancelled: 200 } })
    await runUnavailabilityApply({ container: worker.container as never, em: em as never }, { unavailabilityId: em.rows(Unavailability)[0].id, progressJobId: PROGRESS_JOB, scope })
    expect(worker.progressService.updateProgress).toHaveBeenCalledWith(PROGRESS_JOB, { processedCount: 5 }, expect.anything())
  })

  it('keeps the progress job alive while a chunk is being cancelled, throttled by time', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    let clock = 1_000_000
    const now = jest.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      const steady = workerContainer(em, async () => undefined)
      const job = { unavailabilityId, progressJobId: PROGRESS_JOB, scope }
      const pending = em.rows(Booking).filter((row) => row.status === 'pending')
      const slow = workerContainer(em, async () => undefined, async () => {
        clock += 6_000
      })
      await runUnavailabilityApply({ container: slow.container as never, em: em as never }, job)
      expect(slow.progressService.touchJobHeartbeat).toHaveBeenCalledTimes(pending.length)
      expect(slow.progressService.touchJobHeartbeat).toHaveBeenCalledWith(PROGRESS_JOB, expect.objectContaining(scope))
      for (const row of pending) row.status = 'pending'
      em.rows(Unavailability)[0].applyStatus = 'applying'
      await runUnavailabilityApply({ container: steady.container as never, em: em as never }, job)
      expect(steady.progressService.touchJobHeartbeat).toHaveBeenCalledTimes(1)
    } finally {
      now.mockRestore()
    }
  })

  it('recounts the cancelled bookings from the rows after a crash left a chunk unrecorded', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    const unrecorded = em.rows(Booking).filter((row) => row.status === 'pending').slice(0, 2)
    for (const row of unrecorded) Object.assign(row, { status: 'cancelled', cancelReason: 'unavailability', unavailabilityId })
    expect(em.rows(Unavailability)[0]).toMatchObject({ cancelledBookingCount: 200 })
    const { container } = workerContainer(em, async () => undefined)
    const summary = await runUnavailabilityApply({ container: container as never, em: em as never }, { unavailabilityId, scope })
    expect(summary).toEqual({ cancelled: 3, skipped: 0 })
    expect(em.rows(Unavailability)[0]).toMatchObject({ applyStatus: 'applied', cancelledBookingCount: 205 })
  })

  it('coalesces apply deliveries per closure on a single-concurrency queue', async () => {
    await jest.isolateModulesAsync(async () => {
      const queueModule = await import('@open-mercato/queue')
      const apply = await import('../lib/unavailabilityApply')
      apply.getUnavailabilityApplyQueue()
      apply.getUnavailabilityApplyQueue()
      const create = queueModule.createModuleQueue as jest.Mock
      expect(create).toHaveBeenCalledTimes(1)
      const [name, options] = create.mock.calls[0] as [string, { concurrency: number; coalesceBy: (job: unknown) => string }]
      expect(name).toBe(apply.UNAVAILABILITY_APPLY_QUEUE)
      expect(options.concurrency).toBe(1)
      expect((options as { attempts?: number }).attempts).toBe(UNAVAILABILITY_APPLY_MAX_ATTEMPTS)
      expect(options.coalesceBy({ unavailabilityId: 'closure-1', progressJobId: 'job-a', scope })).toBe('unavailability:closure-1')
      expect(options.coalesceBy({ unavailabilityId: 'closure-1', progressJobId: null, scope })).toBe('unavailability:closure-1')
    })
  })

  it('ignores a late delivery for an applied closure, even after its end is undone, and completes its open progress job', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    const first = workerContainer(em, async () => undefined)
    await runUnavailabilityApply({ container: first.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope })
    const closure = em.rows(Unavailability)[0]
    expect(closure).toMatchObject({ applyStatus: 'applied', cancelledBookingCount: 205 })
    closure.endedAt = null
    const gap = seedBooking(em, { id: '50000000-0000-4000-8000-0000000000c1', salesOrderId: null, status: 'pending', startsAt: `${isoDay(500)}T10:00:00`, endsAt: `${isoDay(500)}T11:00:00` })
    const late = workerContainer(em, async () => undefined)
    late.progressService.getJob.mockResolvedValueOnce({ status: 'running', processedCount: 0, meta: { inlineCancelled: 200 } })
    const summary = await runUnavailabilityApply({ container: late.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope })
    expect(summary).toEqual({ cancelled: 0, skipped: 0 })
    expect(gap.status).toBe('pending')
    expect(late.progressService.startJob).not.toHaveBeenCalled()
    expect(late.progressService.updateProgress).not.toHaveBeenCalled()
    expect(late.progressService.completeJob).toHaveBeenCalledWith(PROGRESS_JOB, { resultSummary: { cancelled: 5, skipped: 0 } }, expect.anything())
    const finished = workerContainer(em, async () => undefined)
    finished.progressService.getJob.mockResolvedValueOnce({ status: 'completed', processedCount: 5, meta: null })
    await runUnavailabilityApply({ container: finished.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope })
    expect(finished.progressService.completeJob).not.toHaveBeenCalled()
    expect(closure).toMatchObject({ applyStatus: 'applied', cancelledBookingCount: 205 })
  })

  it('ignores a delivery for an undone or missing closure and leaves its bookings alone', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    em.rows(Unavailability)[0].deletedAt = new Date()
    const worker = workerContainer(em, async () => undefined)
    worker.progressService.getJob.mockResolvedValueOnce({ status: 'pending', processedCount: 0, meta: { inlineCancelled: 200 } })
    const summary = await runUnavailabilityApply({ container: worker.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope })
    expect(summary).toEqual({ cancelled: 0, skipped: 0 })
    expect(em.rows(Booking).filter((row) => row.status === 'pending')).toHaveLength(5)
    expect(em.rows(Unavailability)[0]).toMatchObject({ applyStatus: 'applying' })
    expect(worker.progressService.completeJob).toHaveBeenCalledWith(PROGRESS_JOB, { resultSummary: { cancelled: 0, skipped: 0 } }, expect.anything())
    const missing = workerContainer(em, async () => undefined)
    missing.progressService.getJob.mockResolvedValueOnce({ status: 'running', processedCount: 0, meta: null })
    const gone = await runUnavailabilityApply(
      { container: missing.container as never, em: em as never },
      { unavailabilityId: '50000000-0000-4000-8000-0000000000c2', progressJobId: PROGRESS_JOB, scope },
    )
    expect(gone).toEqual({ cancelled: 0, skipped: 0 })
    expect(missing.progressService.getJob).not.toHaveBeenCalled()
    expect(missing.progressService.startJob).not.toHaveBeenCalled()
    expect(missing.progressService.updateProgress).not.toHaveBeenCalled()
    expect(missing.progressService.completeJob).not.toHaveBeenCalled()
    expect(em.rows(Booking).filter((row) => row.status === 'pending')).toHaveLength(5)
  })

  it('takes the tenant and organization from the closure row, not from the job payload', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    const forged = { tenantId: '99999999-9999-4999-8999-999999999999', organizationId: '88888888-8888-4888-8888-888888888888' }
    const worker = workerContainer(em, async () => undefined)
    const summary = await runUnavailabilityApply(
      { container: worker.container as never, em: em as never },
      { unavailabilityId, progressJobId: PROGRESS_JOB, scope: { ...forged, userId: 'user-1' } },
    )
    expect(summary).toEqual({ cancelled: 5, skipped: 0 })
    expect(worker.progressService.getJob).toHaveBeenCalledWith(PROGRESS_JOB, { ...scope, userId: 'user-1' })
    expect(worker.progressService.completeJob).toHaveBeenCalledWith(PROGRESS_JOB, expect.anything(), { ...scope, userId: 'user-1' })
    expect(em.rows(Booking).filter((row) => row.status === 'pending')).toHaveLength(0)
  })

  it('resumes a bounded batch of stale closures, oldest first', async () => {
    const em = seed()
    const stale = new Date(Date.now() - 60 * 60 * 1000)
    const base = { ...scope, buildingId: BUILDING, subjectType: 'floor', subjectId: FLOOR, reasonText: 'Works', startsAt: `${TODAY}T00:00:00`, applyStatus: 'applying', deletedAt: null, applyHeartbeatAt: stale }
    em.seed(Unavailability, { id: 'newer', ...base, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } as never)
    em.seed(Unavailability, { id: 'older', ...base, createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } as never)
    const find = jest.spyOn(em, 'find')
    const enqueue = jest.fn(async () => undefined)
    await resumeApplyingUnavailabilities(em as never, scope, enqueue)
    const options = find.mock.calls.find(([entity]) => entity === Unavailability)?.[2]
    expect(options).toMatchObject({ limit: RESUME_APPLY_BATCH, orderBy: { createdAt: 'asc', id: 'asc' } })
    expect(enqueue.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      expect.objectContaining({ unavailabilityId: 'older' }),
      expect.objectContaining({ unavailabilityId: 'newer' }),
    ])
  })

  it('resumes stale closures by their own heartbeat and keeps the stored progress job', async () => {
    const em = seed()
    const stale = new Date(Date.now() - 60 * 60 * 1000)
    const base = { ...scope, buildingId: BUILDING, subjectType: 'floor', subjectId: FLOOR, reasonText: 'Works', startsAt: `${TODAY}T00:00:00`, applyStatus: 'applying', deletedAt: null }
    em.seed(Unavailability, { id: 'stale-heartbeat', ...base, applyHeartbeatAt: stale, updatedAt: new Date(), progressJobId: PROGRESS_JOB } as never)
    em.seed(Unavailability, { id: 'fresh-heartbeat', ...base, applyHeartbeatAt: new Date(), updatedAt: stale } as never)
    em.seed(Unavailability, { id: 'never-started', ...base, applyHeartbeatAt: null, updatedAt: stale } as never)
    const enqueue = jest.fn(async () => undefined)
    const resumed = await resumeApplyingUnavailabilities(em as never, scope, enqueue)
    expect(resumed).toBe(2)
    expect(enqueue).toHaveBeenCalledWith({ unavailabilityId: 'stale-heartbeat', progressJobId: PROGRESS_JOB })
    expect(enqueue).toHaveBeenCalledWith({ unavailabilityId: 'never-started', progressJobId: null })
  })
  function seedApplyingSpaceClosure(em: FakeEm, id: string, createdAt: Date): void {
    em.seed(Unavailability, {
      id,
      ...scope,
      buildingId: BUILDING,
      subjectType: 'space',
      subjectId: SPACE,
      reasonText: 'Works',
      startsAt: `${isoDay(-2)}T00:00:00`,
      endsAt: null,
      endedAt: null,
      deletedAt: null,
      applyStatus: 'applying',
      cancelledBookingCount: 0,
      applyHeartbeatAt: new Date(),
      createdAt,
    } as never)
  }

  it('pages past more than a batch of held-back bookings so the rest of the organization still completes', async () => {
    const em = seed()
    const OUTSIDE_UNIT = '50000000-0000-4000-8000-0000000000e1'
    const OUTSIDE = '50000000-0000-4000-8000-0000000000e3'
    const YESTERDAY = isoDay(-1)
    em.seed(Unit, { id: OUTSIDE_UNIT, ...scope, buildingId: BUILDING, floorId: FLOOR, spaceId: OTHER_SPACE, name: 'Studio 3C', catalogProductId: PRODUCT, deletedAt: null } as never)
    const sameEnd = seedBooking(em, {
      id: '50000000-0000-4000-9000-999999999999',
      unitId: OUTSIDE_UNIT,
      salesOrderId: null,
      startsAt: `${YESTERDAY}T10:00:00`,
      endsAt: `${YESTERDAY}T11:00:00`,
    })
    const held: Booking[] = []
    for (let index = 0; index < 501; index += 1) {
      const id = `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      held.push(seedBooking(em, { id, salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` }))
    }
    const outside = seedBooking(em, { id: OUTSIDE, unitId: OUTSIDE_UNIT, salesOrderId: null, startsAt: `${YESTERDAY}T11:00:00`, endsAt: `${YESTERDAY}T12:00:00` })
    seedApplyingSpaceClosure(em, '50000000-0000-4000-8000-0000000000e4', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
    const { container } = workerContainer(em, async () => undefined)
    const sweep = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
    expect(sweep.completed).toBe(2)
    expect(sameEnd.status).toBe('completed')
    expect(outside.status).toBe('completed')
    expect(held.every((booking) => booking.status === 'confirmed')).toBe(true)
  })

  it('holds back a past booking whose applying closure sorts after 500 older applying closures elsewhere in the organization', async () => {
    const em = seed()
    const YESTERDAY = isoDay(-1)
    const covered = seedBooking(em, { salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    const longAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    for (let index = 0; index < 500; index += 1) {
      em.seed(Unavailability, {
        id: `50000000-0000-4000-a000-${String(index).padStart(12, '0')}`,
        ...scope,
        buildingId: '50000000-0000-4000-8000-0000000000fa',
        subjectType: 'unit',
        subjectId: `50000000-0000-4000-b000-${String(index).padStart(12, '0')}`,
        reasonText: 'Elsewhere',
        startsAt: `${isoDay(-40)}T00:00:00`,
        endsAt: null,
        endedAt: null,
        deletedAt: null,
        applyStatus: 'applying',
        cancelledBookingCount: 0,
        applyHeartbeatAt: new Date(),
        createdAt: new Date(longAgo + index),
      } as never)
    }
    seedApplyingSpaceClosure(em, '50000000-0000-4000-8000-0000000000ed', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
    const attempted: unknown[] = []
    const { container } = workerContainer(em, async () => undefined, async (commandId, input) => {
      if (commandId === 'property_management.booking.complete') attempted.push(input.id)
    })
    const find = jest.spyOn(em, 'find')
    const sweep = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
    expect(sweep.completed).toBe(0)
    expect(covered.status).toBe('confirmed')
    expect(attempted).toEqual([])
    const closureReads = find.mock.calls.filter(([entity, where]) => entity === Unavailability && (where as { applyStatus?: unknown }).applyStatus === 'applying')
    expect(closureReads.length).toBeGreaterThan(0)
    expect(closureReads.every(([, where]) => Array.isArray((where as { $or?: unknown }).$or))).toBe(true)
  })

  it('stops paging past held-back bookings after the page cap', async () => {
    const em = seed()
    const OUTSIDE_UNIT = '50000000-0000-4000-8000-0000000000e1'
    const YESTERDAY = isoDay(-1)
    em.seed(Unit, { id: OUTSIDE_UNIT, ...scope, buildingId: BUILDING, floorId: FLOOR, spaceId: OTHER_SPACE, name: 'Studio 3C', catalogProductId: PRODUCT, deletedAt: null } as never)
    for (let index = 0; index < 20 * 500; index += 1) {
      seedBooking(em, { id: `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`, salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    }
    const beyondCap = seedBooking(em, { id: '50000000-0000-4000-8000-0000000000e3', unitId: OUTSIDE_UNIT, salesOrderId: null, startsAt: `${YESTERDAY}T11:00:00`, endsAt: `${YESTERDAY}T12:00:00` })
    seedApplyingSpaceClosure(em, '50000000-0000-4000-8000-0000000000e4', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
    const find = jest.spyOn(em, 'find')
    const { container } = workerContainer(em, async () => undefined)
    const sweep = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
    expect(sweep.completed).toBe(0)
    expect(beyondCap.status).toBe('confirmed')
    const pages = find.mock.calls.filter(([entity, where]) => entity === Booking && (where as { status?: unknown }).status === 'confirmed')
    expect(pages).toHaveLength(20)
  })

  it('leaves a past booking alone when a closure covering it starts applying while the sweep runs', async () => {
    const em = seed()
    const YESTERDAY = isoDay(-1)
    const booking = seedBooking(em, { salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    const { container } = workerContainer(em, async () => undefined, async (commandId) => {
      if (commandId !== 'property_management.booking.complete' || em.rows(Unavailability).length) return
      seedApplyingSpaceClosure(em, '50000000-0000-4000-8000-0000000000e8', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
    })
    const sweep = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
    expect(sweep.completed).toBe(0)
    expect(booking.status).toBe('confirmed')
    em.rows(Unavailability)[0].applyStatus = 'applied'
    const retry = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
    expect(retry.completed).toBe(1)
    expect(booking.status).toBe('completed')
  })

  it('stops holding a past booking back, in the sweep and in the complete command, once the closure is ended before it', async () => {
    const em = seed()
    const YESTERDAY = isoDay(-1)
    const byCommand = seedBooking(em, { salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    const bySweep = seedBooking(em, { id: '50000000-0000-4000-8000-0000000000e9', salesOrderId: null, startsAt: `${YESTERDAY}T12:00:00`, endsAt: `${YESTERDAY}T13:00:00` })
    seedApplyingSpaceClosure(em, '50000000-0000-4000-8000-0000000000ea', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
    expect(await run('property_management.booking.complete', { id: byCommand.id }, em)).toMatchObject({ completed: false })
    const { container } = workerContainer(em, async () => undefined)
    const sweepDeps = { container: container as never, em: em as never, enqueuer: async () => undefined }
    expect((await runBookingSweep(sweepDeps, scope)).completed).toBe(0)
    expect(bySweep.status).toBe('confirmed')
    em.rows(Unavailability)[0].endedAt = `${YESTERDAY}T09:00:00`
    expect(await run('property_management.booking.complete', { id: byCommand.id }, em)).toMatchObject({ completed: true })
    expect((await runBookingSweep(sweepDeps, scope)).completed).toBe(1)
    expect(byCommand.status).toBe('completed')
    expect(bySweep.status).toBe('completed')
  })

  it('does not hold back past bookings of a deleted unit, which the closure worker never cancels', async () => {
    const em = seed()
    const YESTERDAY = isoDay(-1)
    const booking = seedBooking(em, { salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    const other = seedBooking(em, { id: '50000000-0000-4000-8000-0000000000eb', salesOrderId: null, startsAt: `${YESTERDAY}T12:00:00`, endsAt: `${YESTERDAY}T13:00:00` })
    seedApplyingSpaceClosure(em, '50000000-0000-4000-8000-0000000000ec', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
    em.rows(Unit)[0].deletedAt = new Date()
    expect(await run('property_management.booking.complete', { id: booking.id }, em)).toMatchObject({ completed: true })
    const { container } = workerContainer(em, async () => undefined)
    const sweep = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
    expect(sweep.completed).toBe(1)
    expect(other.status).toBe('completed')
  })

  it('caps the complete attempts of one sweep run even when they do not complete', async () => {
    const em = seed()
    const YESTERDAY = isoDay(-1)
    for (let index = 0; index < 1100; index += 1) {
      seedBooking(em, { id: `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`, salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    }
    let attempts = 0
    const { container } = workerContainer(em, async () => undefined, async (commandId, input) => {
      if (commandId !== 'property_management.booking.complete') return
      attempts += 1
      const row = em.rows(Booking).find((candidate) => candidate.id === input.id)
      if (row) row.status = 'cancelled'
    })
    const sweep = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
    expect(sweep.completed).toBe(0)
    expect(attempts).toBe(SWEEP_MAX_COMPLETE_ATTEMPTS)
  })

  it('stops completing past bookings after a run of consecutive failures', async () => {
    const em = seed()
    const YESTERDAY = isoDay(-1)
    for (let index = 0; index < 600; index += 1) {
      seedBooking(em, { id: `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`, salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    }
    let attempts = 0
    const { container } = workerContainer(em, async () => undefined, async (commandId) => {
      if (commandId !== 'property_management.booking.complete') return
      attempts += 1
      if (attempts !== 5) throw new Error('[internal] connection lost')
    })
    await withReportedErrors(async (reportError) => {
      const sweep = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
      expect(sweep.completed).toBe(1)
      expect(attempts).toBe(5 + SWEEP_MAX_CONSECUTIVE_FAILURES)
      const failures = reportError.mock.calls.filter(([, context]) => (context as { code?: string }).code === 'property_management.booking_complete_failed')
      expect(failures).toHaveLength(4 + SWEEP_MAX_CONSECUTIVE_FAILURES)
    })
  })

  function memoryCache() {
    const entries = new Map<string, unknown>()
    return {
      entries,
      get: jest.fn(async (key: string) => entries.get(key) ?? null),
      set: jest.fn(async (key: string, value: unknown, _options?: { ttl?: number }) => {
        entries.set(key, value)
      }),
      delete: jest.fn(async (key: string) => entries.delete(key)),
    }
  }

  function sweepDepsWith(em: FakeEm, cache: unknown, complete: (id: string) => Promise<{ completed: boolean }>) {
    const commandBus = {
      execute: async (commandId: string, { input }: { input: { id: string } }) => {
        if (commandId !== 'property_management.booking.complete') throw new Error(`[internal] unexpected ${commandId}`)
        return { result: await complete(input.id) }
      },
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'commandBus') return commandBus
        if (name === 'cache' && cache) return cache
        throw new Error(`[internal] unexpected ${name}`)
      },
    }
    return { container: container as never, em: em as never, enqueuer: async () => undefined }
  }

  function seedPastBookings(em: FakeEm, count: number): string[] {
    const ids: string[] = []
    for (let index = 0; index < count; index += 1) {
      const id = `50000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      ids.push(id)
      seedBooking(em, { id, salesOrderId: null, startsAt: `${isoDay(-1)}T10:00:00`, endsAt: `${isoDay(-1)}T11:00:00` })
    }
    return ids
  }

  it('resumes after the attempt cap on the next run and wraps around to the oldest past bookings', async () => {
    const em = seed()
    const ids = seedPastBookings(em, 700)
    const cache = memoryCache()
    const attempted: string[] = []
    const deps = sweepDepsWith(em, cache, async (id) => {
      attempted.push(id)
      return { completed: false }
    })
    await runBookingSweep(deps, scope)
    expect(attempted).toEqual(ids.slice(0, SWEEP_MAX_COMPLETE_ATTEMPTS))
    expect(cache.entries.get(sweepCursorKey(scope))).toEqual({ endsAt: `${isoDay(-1)}T11:00:00`, id: ids[499] })
    expect(cache.set).toHaveBeenCalledWith(sweepCursorKey(scope), expect.anything(), { ttl: SWEEP_CURSOR_TTL_MS })
    attempted.length = 0
    await runBookingSweep(deps, scope)
    expect(attempted).toEqual([...ids.slice(500), ...ids.slice(0, 300)])
    expect(cache.entries.get(sweepCursorKey(scope))).toEqual({ endsAt: `${isoDay(-1)}T11:00:00`, id: ids[299] })
  })

  it('wraps around only up to where the run started and clears the cursor once every past booking was visited', async () => {
    const em = seed()
    const ids = seedPastBookings(em, 30)
    const cache = memoryCache()
    cache.entries.set(sweepCursorKey(scope), { endsAt: `${isoDay(-1)}T11:00:00`, id: ids[9] })
    const attempted: string[] = []
    const deps = sweepDepsWith(em, cache, async (id) => {
      attempted.push(id)
      return { completed: false }
    })
    await runBookingSweep(deps, scope)
    expect(attempted).toEqual([...ids.slice(10), ...ids.slice(0, 10)])
    expect(cache.entries.has(sweepCursorKey(scope))).toBe(false)
  })

  it('does not let bookings that always fail at the front starve the later ones', async () => {
    const em = seed()
    const ids = seedPastBookings(em, 40)
    const failing = new Set(ids.slice(0, 25))
    const cache = memoryCache()
    const deps = sweepDepsWith(em, cache, async (id) => {
      if (failing.has(id)) throw new Error('[internal] booking order is locked')
      const row = em.rows(Booking).find((candidate) => candidate.id === id)
      if (row) row.status = 'completed'
      return { completed: true }
    })
    await withReportedErrors(async () => {
      expect((await runBookingSweep(deps, scope)).completed).toBe(0)
      expect(cache.entries.get(sweepCursorKey(scope))).toEqual({ endsAt: `${isoDay(-1)}T11:00:00`, id: ids[SWEEP_MAX_CONSECUTIVE_FAILURES - 1] })
      expect((await runBookingSweep(deps, scope)).completed).toBe(15)
    })
    expect(em.rows(Booking).filter((row) => row.status === 'completed').map((row) => row.id)).toEqual(ids.slice(25))
  })

  it('starts from the oldest past booking and reports it when the sweep cursor store fails', async () => {
    const em = seed()
    const ids = seedPastBookings(em, 3)
    const cache = memoryCache()
    cache.get.mockRejectedValueOnce(new Error('[internal] cache down'))
    cache.delete.mockRejectedValueOnce(new Error('[internal] cache down'))
    cache.entries.set(sweepCursorKey(scope), { endsAt: `${isoDay(-1)}T11:00:00`, id: ids[1] })
    const attempted: string[] = []
    const deps = sweepDepsWith(em, cache, async (id) => {
      attempted.push(id)
      return { completed: false }
    })
    await withReportedErrors(async (reportError) => {
      await runBookingSweep(deps, scope)
      const failures = reportError.mock.calls.filter(([, context]) => (context as { code?: string }).code === 'property_management.booking_sweep_cursor_failed')
      expect(failures.map(([, context]) => (context as { attributes?: { operation?: string } }).attributes?.operation)).toEqual(['load', 'save'])
    })
    expect(attempted).toEqual(ids)
  })

  it('keeps sweeping the other steps when completing past bookings fails', async () => {
    const em = seed()
    const stale = new Date(Date.now() - 60 * 60 * 1000)
    em.seed(Unavailability, { id: 'stale', ...scope, buildingId: BUILDING, subjectType: 'floor', subjectId: FLOOR, reasonText: 'Works', startsAt: `${TODAY}T00:00:00`, applyStatus: 'applying', applyHeartbeatAt: stale, deletedAt: null } as never)
    const find = em.find.bind(em)
    jest.spyOn(em, 'find').mockImplementation(async (entity, where, options) => {
      if (entity === Booking) throw new Error('[internal] connection lost')
      return find(entity, where, options)
    })
    const { container } = workerContainer(em, async () => undefined)
    await withReportedErrors(async (reportError) => {
      const sweep = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
      expect(sweep).toMatchObject({ completed: 0, resumedClosures: 1 })
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: '[internal] connection lost' }),
        expect.objectContaining({ code: 'property_management.booking_sweep_step_failed', attributes: { step: 'complete_past_bookings' } }),
      )
    })
  })

  it('orders the cursor by end time before id, so a later end with a smaller id comes after and an earlier end with a larger id wraps', async () => {
    const em = seed()
    const YESTERDAY = isoDay(-1)
    const earlyLargeId = seedBooking(em, { id: '50000000-0000-4000-9000-ffffffffffff', salesOrderId: null, startsAt: `${YESTERDAY}T08:00:00`, endsAt: `${YESTERDAY}T09:00:00` })
    const atCursor = seedBooking(em, { id: '50000000-0000-4000-9000-000000000001', salesOrderId: null, startsAt: `${YESTERDAY}T09:00:00`, endsAt: `${YESTERDAY}T10:00:00` })
    const sameEndLargerId = seedBooking(em, { id: '50000000-0000-4000-9000-000000000003', salesOrderId: null, startsAt: `${YESTERDAY}T09:00:00`, endsAt: `${YESTERDAY}T10:00:00` })
    const lateSmallId = seedBooking(em, { id: '50000000-0000-4000-9000-000000000000', salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    const cache = memoryCache()
    cache.entries.set(sweepCursorKey(scope), { endsAt: `${YESTERDAY}T10:00:00`, id: atCursor.id })
    const attempted: string[] = []
    const deps = sweepDepsWith(em, cache, async (id) => {
      attempted.push(id)
      return { completed: false }
    })
    await runBookingSweep(deps, scope)
    expect(attempted).toEqual([sameEndLargerId.id, lateSmallId.id, earlyLargeId.id, atCursor.id])
    expect(cache.entries.has(sweepCursorKey(scope))).toBe(false)
  })

  it('treats a malformed sweep cursor as no cursor and deletes it instead of failing at the database every run', async () => {
    const em = seed()
    const ids = seedPastBookings(em, 3)
    for (const malformed of [
      { endsAt: 'yesterday', id: ids[1] },
      { endsAt: `${isoDay(-1)}T25:00:00`, id: ids[1] },
      { endsAt: '2026-02-30T10:00:00', id: ids[1] },
      { endsAt: `${isoDay(-1)}T11:00:00`, id: 'not-a-uuid' },
      'garbage',
    ]) {
      const cache = memoryCache()
      cache.entries.set(sweepCursorKey(scope), malformed)
      const attempted: string[] = []
      const deps = sweepDepsWith(em, cache, async (id) => {
        attempted.push(id)
        return { completed: false }
      })
      await withReportedErrors(async (reportError) => {
        await runBookingSweep(deps, scope)
        expect(reportError).not.toHaveBeenCalled()
      })
      expect(attempted).toEqual(ids)
      expect(cache.delete).toHaveBeenCalledWith(sweepCursorKey(scope))
      expect(cache.entries.has(sweepCursorKey(scope))).toBe(false)
    }
  })

  it('leaves operation re-enqueueing to the caller when asked, so a CLI run does not dispatch them twice', async () => {
    const em = seed()
    em.seed(SalesOperation, { id: '50000000-0000-4000-8000-0000000000d1', ...scope, status: 'pending' } as never)
    const enqueuer = jest.fn(async () => undefined)
    const deps = { ...sweepDepsWith(em, null, async () => ({ completed: false })), enqueuer }
    expect(await runBookingSweep({ ...deps, skipReenqueue: true }, scope)).toMatchObject({ reenqueued: 0 })
    expect(enqueuer).not.toHaveBeenCalled()
    expect(await runBookingSweep(deps, scope)).toMatchObject({ reenqueued: 1 })
    expect(enqueuer).toHaveBeenCalledWith(['50000000-0000-4000-8000-0000000000d1'])
  })

  it('rotates through more open operations than one batch under SKIP LOCKED, so newer ones are not starved', async () => {
    const em = seed()
    const ids: string[] = []
    for (let index = 0; index < 600; index += 1) {
      const id = `50000000-0000-4000-a000-${String(index).padStart(12, '0')}`
      ids.push(id)
      em.seed(SalesOperation, { id, ...scope, status: index % 2 ? 'pending' : 'compensating', createdAt: new Date(Date.now() - (600 - index) * 1000) } as never)
    }
    em.seed(SalesOperation, { id: '50000000-0000-4000-a000-999999999999', ...scope, status: 'done' } as never)
    const cache = memoryCache()
    const dispatched: string[][] = []
    const deps = { container: sweepDepsWith(em, cache, async () => ({ completed: false })).container, em: em as never, enqueuer: async (batch: readonly string[]) => void dispatched.push([...batch]) }
    const find = jest.spyOn(em, 'find')
    expect(await reenqueueOpenOperations(deps, scope)).toBe(500)
    expect(dispatched[0]).toEqual(ids.slice(0, 500))
    const options = find.mock.calls.find(([entity]) => entity === SalesOperation)?.[2]
    expect(options).toMatchObject({ lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE, limit: 500, orderBy: { id: 'asc' } })
    expect(cache.entries.get(reenqueueCursorKey(scope))).toBe(ids[499])
    expect(await reenqueueOpenOperations(deps, scope)).toBe(500)
    expect(dispatched[1]).toEqual([...ids.slice(500), ...ids.slice(0, 400)])
    expect(cache.entries.get(reenqueueCursorKey(scope))).toBe(ids[399])
    for (const row of em.rows(SalesOperation).slice(0, 300)) row.status = 'done'
    expect(await reenqueueOpenOperations(deps, scope)).toBe(300)
    expect(dispatched[2]).toEqual([...ids.slice(400), ...ids.slice(300, 400)])
    expect(cache.entries.has(reenqueueCursorKey(scope))).toBe(false)
    cache.entries.set(reenqueueCursorKey(scope), 'not-a-uuid')
    expect(await reenqueueOpenOperations(deps, scope)).toBe(300)
    expect(dispatched[3]).toEqual(ids.slice(300))
  })

  it('completes a booking that ended exactly when the applying closure was created and holds back a later one', async () => {
    const em = seed()
    const LATER = '50000000-0000-4000-8000-0000000000e6'
    const YESTERDAY = isoDay(-1)
    const [year, month, day] = YESTERDAY.split('-').map(Number)
    const atCutoff = seedBooking(em, { salesOrderId: null, startsAt: `${YESTERDAY}T10:00:00`, endsAt: `${YESTERDAY}T11:00:00` })
    const later = seedBooking(em, { id: LATER, salesOrderId: null, startsAt: `${YESTERDAY}T11:00:00`, endsAt: `${YESTERDAY}T12:00:00` })
    seedApplyingSpaceClosure(em, '50000000-0000-4000-8000-0000000000e7', new Date(year, month - 1, day, 11, 0, 0))
    const { container } = workerContainer(em, async () => undefined)
    const sweep = await runBookingSweep({ container: container as never, em: em as never, enqueuer: async () => undefined }, scope)
    expect(sweep.completed).toBe(1)
    expect(atCutoff.status).toBe('completed')
    expect(later.status).toBe('confirmed')
  })

  it('skips an inline booking the sweep completed meanwhile and still queues only the rest', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const raced = em.rows(Booking).find((row) => row.id === ids[0]) as unknown as Booking
    Object.assign(raced, { status: 'confirmed', salesOrderId: 'order-raced' })
    const find = em.find.bind(em)
    jest.spyOn(em, 'find').mockImplementation(async (entity, where, options) => {
      const idFilter = (where as { id?: { $in?: unknown[] } }).id
      if (entity === Booking && idFilter?.$in?.includes(raced.id)) raced.status = 'completed'
      return find(entity, where, options)
    })
    const result = await run<{ cancelledBookings: number; queuedBookings: number; applyStatus: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    expect(result).toMatchObject({ cancelledBookings: 199, queuedBookings: 5, applyStatus: 'applying' })
    expect(raced.status).toBe('completed')
    expect(raced.unavailabilityId ?? null).toBeNull()
    expect(em.rows(SalesOperation)).toHaveLength(0)
    expect(em.rows(Unavailability)[0]).toMatchObject({ cancelledBookingCount: 199, applyStatus: 'applying' })
    expect(em.rows(Booking).filter((row) => row.status === 'cancelled')).toHaveLength(199)
  })

  it('still queues the worker with the progress job when storing the job id on the closure fails', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const createJob = jest.fn(async () => ({ id: PROGRESS_JOB }))
    const handler = commandRegistry.get('property_management.unavailability.create')
    if (!handler) throw new Error('[internal] missing command')
    const ctx = buildCtx(em)
    ctx.container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'progressService') return { createJob }
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never
    const findOne = em.findOne.bind(em)
    jest.spyOn(em, 'findOne').mockImplementation(async (entity, where, options) => {
      if (entity === Unavailability) throw new Error('[internal] connection lost')
      return findOne(entity, where, options)
    })
    await withReportedErrors(async (reportError) => {
      const result = (await handler.execute({ ...scope, ...confirmFloor(ids) }, ctx)) as { progressJobId: string | null; queuedBookings: number }
      expect(result).toMatchObject({ progressJobId: PROGRESS_JOB, queuedBookings: 5 })
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: '[internal] connection lost' }),
        expect.objectContaining({ code: 'property_management.unavailability_progress_store_failed' }),
      )
    })
    expect(em.rows(Unavailability)[0].progressJobId).toBeUndefined()
    const queue = (createModuleQueue as jest.Mock).getMockImplementation()?.() as { enqueue: jest.Mock }
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ unavailabilityId: em.rows(Unavailability)[0].id, progressJobId: PROGRESS_JOB }))
    ;(em.findOne as jest.Mock).mockRestore()
    const worker = workerContainer(em, async () => undefined)
    worker.progressService.getJob.mockResolvedValueOnce({ processedCount: 0, totalCount: 5, meta: { inlineCancelled: 200 } })
    await runUnavailabilityApply({ container: worker.container as never, em: em as never }, { unavailabilityId: em.rows(Unavailability)[0].id, progressJobId: PROGRESS_JOB, scope })
    expect(em.rows(Unavailability)[0]).toMatchObject({ progressJobId: PROGRESS_JOB, applyStatus: 'applied' })
  })

  it('fails the progress job at once when neither its id is stored nor the worker queued', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const createJob = jest.fn(async () => ({ id: PROGRESS_JOB }))
    const failJob = jest.fn(async () => ({}))
    const handler = commandRegistry.get('property_management.unavailability.create')
    if (!handler) throw new Error('[internal] missing command')
    const ctx = buildCtx(em)
    ctx.container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'progressService') return { createJob, failJob }
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never
    const findOne = em.findOne.bind(em)
    jest.spyOn(em, 'findOne').mockImplementation(async (entity, where, options) => {
      if (entity === Unavailability) throw new Error('[internal] connection lost')
      return findOne(entity, where, options)
    })
    const queue = (createModuleQueue as jest.Mock).getMockImplementation()?.() as { enqueue: jest.Mock }
    queue.enqueue.mockRejectedValueOnce(new Error('[internal] queue down'))
    await withReportedErrors(async (reportError) => {
      const result = (await handler.execute({ ...scope, ...confirmFloor(ids) }, ctx)) as { progressJobId: string | null; applyStatus: string }
      expect(result).toMatchObject({ progressJobId: PROGRESS_JOB, applyStatus: 'applying' })
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'property_management.unavailability_progress_unreachable' }))
    })
    expect(failJob).toHaveBeenCalledWith(
      PROGRESS_JOB,
      { errorMessage: FINAL_FAILURE_MESSAGE },
      expect.objectContaining(scope),
    )
  })

  it('fails the progress job with a retry message on an unexpected error, even when translations are unavailable', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    const failing = () =>
      workerContainer(em, async () => undefined, async () => {
        throw new Error('[internal] connection lost')
      })
    const first = failing()
    await expect(
      runUnavailabilityApply({ container: first.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope }),
    ).rejects.toThrow('[internal] connection lost')
    expect(first.progressService.failJob).toHaveBeenCalledWith(
      PROGRESS_JOB,
      { errorMessage: 'Cancelling the bookings failed. It is retried automatically.' },
      expect.anything(),
    )
    const second = failing()
    ;(resolveTranslations as jest.Mock).mockRejectedValueOnce(new Error('[internal] dictionary missing'))
    await expect(
      runUnavailabilityApply({ container: second.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope }),
    ).rejects.toThrow('[internal] connection lost')
    expect(second.progressService.failJob).toHaveBeenCalledWith(
      PROGRESS_JOB,
      { errorMessage: 'Cancelling the bookings failed. It is retried automatically.' },
      expect.anything(),
    )
  })

  it('says the apply is retried only while the queue has another delivery attempt left', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    const deliver = async (attemptNumber: number) => {
      const worker = workerContainer(em, async () => undefined, async () => {
        throw new Error('[internal] connection lost')
      })
      const job = { id: `job-${attemptNumber}`, payload: { unavailabilityId, progressJobId: PROGRESS_JOB, scope }, createdAt: new Date().toISOString() }
      const ctx = { jobId: job.id, attemptNumber, queueName: 'property_management-unavailability-apply', resolve: worker.container.resolve, container: worker.container }
      await expect(handleUnavailabilityApply(job, ctx as never)).rejects.toThrow('[internal] connection lost')
      return worker.progressService.failJob
    }
    expect(await deliver(UNAVAILABILITY_APPLY_MAX_ATTEMPTS - 1)).toHaveBeenCalledWith(PROGRESS_JOB, { errorMessage: RETRY_FAILURE_MESSAGE }, expect.anything())
    expect(await deliver(UNAVAILABILITY_APPLY_MAX_ATTEMPTS)).toHaveBeenCalledWith(PROGRESS_JOB, { errorMessage: FINAL_FAILURE_MESSAGE }, expect.anything())
    expect(em.rows(Unavailability)[0]).toMatchObject({ applyStatus: 'applying' })
  })

  it('reports and rethrows when completing the progress job of a settled closure fails, so the delivery is retried', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    em.rows(Unavailability)[0].applyStatus = 'applied'
    const broken = workerContainer(em, async () => undefined)
    broken.progressService.getJob.mockResolvedValueOnce({ status: 'running', processedCount: 0, meta: { inlineCancelled: 200 } })
    broken.progressService.completeJob.mockRejectedValueOnce(new Error('[internal] progress store down'))
    await withReportedErrors(async (reportError) => {
      await expect(
        runUnavailabilityApply({ container: broken.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope }),
      ).rejects.toThrow('[internal] progress store down')
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: '[internal] progress store down' }),
        expect.objectContaining({ code: 'property_management.unavailability_progress_complete_failed' }),
      )
    })
    expect(broken.progressService.failJob).toHaveBeenCalledWith(PROGRESS_JOB, { errorMessage: SETTLED_COMPLETE_FAILED_MESSAGE }, expect.anything())
    const retry = workerContainer(em, async () => undefined)
    retry.progressService.getJob.mockResolvedValueOnce({ status: 'failed', processedCount: 0, meta: { inlineCancelled: 200 } })
    await runUnavailabilityApply({ container: retry.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope })
    expect(retry.progressService.completeJob).toHaveBeenCalledWith(PROGRESS_JOB, { resultSummary: { cancelled: 0, skipped: 0 } }, expect.anything())
    expect(retry.progressService.failJob).not.toHaveBeenCalled()
  })

  it('replaces the retry message of a job an earlier attempt failed with the final one, even when the last attempt fails before starting it', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    const findOne = em.findOne.bind(em)
    jest.spyOn(em, 'findOne').mockImplementation(async (entity, where, options) => {
      if (entity === Unavailability && (options as { refresh?: boolean } | undefined)?.refresh) throw new Error('[internal] connection lost')
      return findOne(entity, where, options)
    })
    const deliver = async (attemptNumber: number, current: { status: string; errorMessage: string | null }) => {
      const worker = workerContainer(em, async () => undefined)
      worker.progressService.getJob.mockResolvedValue({ ...current, processedCount: 0, meta: null })
      await expect(
        runUnavailabilityApply(
          { container: worker.container as never, em: em as never, attempt: { attemptNumber, maxAttempts: UNAVAILABILITY_APPLY_MAX_ATTEMPTS } },
          { unavailabilityId, progressJobId: PROGRESS_JOB, scope },
        ),
      ).rejects.toThrow('[internal] connection lost')
      return worker.progressService
    }
    await withReportedErrors(async () => {
      const last = await deliver(UNAVAILABILITY_APPLY_MAX_ATTEMPTS, { status: 'failed', errorMessage: RETRY_FAILURE_MESSAGE })
      expect(last.startJob).toHaveBeenCalledWith(PROGRESS_JOB, expect.anything())
      expect(last.failJob).toHaveBeenCalledWith(PROGRESS_JOB, { errorMessage: FINAL_FAILURE_MESSAGE }, expect.anything())
      expect(last.startJob.mock.invocationCallOrder[0]).toBeLessThan(last.failJob.mock.invocationCallOrder[0])
      const repeated = await deliver(UNAVAILABILITY_APPLY_MAX_ATTEMPTS - 1, { status: 'failed', errorMessage: RETRY_FAILURE_MESSAGE })
      expect(repeated.startJob).not.toHaveBeenCalled()
      expect(repeated.failJob).not.toHaveBeenCalled()
      const finished = await deliver(UNAVAILABILITY_APPLY_MAX_ATTEMPTS, { status: 'completed', errorMessage: null })
      expect(finished.startJob).not.toHaveBeenCalled()
      expect(finished.failJob).not.toHaveBeenCalled()
    })
  })

  it('raises the progress total instead of hiding bookings processed beyond it', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor(ids),
      em,
    )
    const worker = workerContainer(em, async () => undefined)
    worker.progressService.getJob.mockResolvedValueOnce({ processedCount: 0, totalCount: 3, meta: { inlineCancelled: 200 } })
    await runUnavailabilityApply({ container: worker.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope })
    expect(worker.progressService.updateProgress.mock.calls.map((call) => (call as unknown[])[1])).toEqual([{ totalCount: 5, processedCount: 5 }])
  })

  it('keeps cancelling when the progress service errors, reporting each failure', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>('property_management.unavailability.create', confirmFloor(ids), em)
    await withReportedErrors(async (reportError) => {
      const broken = workerContainer(em, async () => {
        throw new Error('[internal] progress store down')
      })
      broken.progressService.startJob.mockRejectedValueOnce(new Error('[internal] progress store down'))
      broken.progressService.completeJob.mockRejectedValueOnce(new Error('[internal] progress store down'))
      const summary = await runUnavailabilityApply({ container: broken.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope })
      expect(summary).toEqual({ cancelled: 5, skipped: 0 })
      expect(em.rows(Unavailability)[0]).toMatchObject({ applyStatus: 'applied', cancelledBookingCount: 205 })
      expect(broken.progressService.updateProgress).toHaveBeenCalled()
      expect(broken.progressService.completeJob).toHaveBeenCalled()
      expect(broken.progressService.failJob).toHaveBeenCalledWith(PROGRESS_JOB, expect.anything(), expect.anything())
      const codes = reportError.mock.calls.map(([, context]) => (context as { code: string }).code)
      expect(codes).toEqual(
        expect.arrayContaining([
          'property_management.unavailability_progress_start_failed',
          'property_management.unavailability_progress_update_failed',
          'property_management.unavailability_progress_complete_failed',
        ]),
      )
    })
  })

  it('keeps cancelling without progress when reading the progress job fails', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>('property_management.unavailability.create', confirmFloor(ids), em)
    await withReportedErrors(async (reportError) => {
      const broken = workerContainer(em, async () => undefined)
      broken.progressService.getJob.mockRejectedValueOnce(new Error('[internal] progress store down'))
      const summary = await runUnavailabilityApply({ container: broken.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope })
      expect(summary).toEqual({ cancelled: 5, skipped: 0 })
      expect(broken.progressService.startJob).not.toHaveBeenCalled()
      expect(broken.progressService.updateProgress).not.toHaveBeenCalled()
      expect(em.rows(Unavailability)[0]).toMatchObject({ applyStatus: 'applied' })
      expect(reportError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: 'property_management.unavailability_progress_read_failed' }))
    })
  })

  it('applies the closure without progress when its progress job is gone', async () => {
    const em = seed()
    const ids = seedFutureBookings(em, 205)
    const { unavailabilityId } = await run<{ unavailabilityId: string }>('property_management.unavailability.create', confirmFloor(ids), em)
    em.rows(Unavailability)[0].progressJobId = PROGRESS_JOB
    const orphan = workerContainer(em, async () => undefined)
    orphan.progressService.getJob.mockResolvedValueOnce(null)
    const summary = await runUnavailabilityApply({ container: orphan.container as never, em: em as never }, { unavailabilityId, progressJobId: PROGRESS_JOB, scope })
    expect(summary).toEqual({ cancelled: 5, skipped: 0 })
    expect(orphan.progressService.startJob).not.toHaveBeenCalled()
    expect(orphan.progressService.updateProgress).not.toHaveBeenCalled()
    expect(orphan.progressService.completeJob).not.toHaveBeenCalled()
    expect(em.rows(Unavailability)[0]).toMatchObject({ applyStatus: 'applied', cancelledBookingCount: 205, progressJobId: null })
  })
})

describe('building opening hours on update', () => {
  const hoursOn = (opensAt: string) => [{ weekday: weekdayOf(DAY), opensAt, closesAt: '15:00' }]

  it('lists bookings outside the hours only when the hours actually changed', async () => {
    const em = seed()
    seedBooking(em)
    em.rows(Building)[0].openingHoursEnabled = true
    em.seed(OpeningHours, { id: 'hours-1', ...scope, buildingId: BUILDING, weekday: weekdayOf(DAY), opensAt: '11:00:00', closesAt: '15:00:00' } as never)
    const renamed = await run<{ bookingsOutsideHours: unknown[] }>(
      'property_management.building.update',
      { id: BUILDING, name: 'Harbor Point East', openingHoursEnabled: true, openingHours: hoursOn('11:00') },
      em,
    )
    expect(renamed.bookingsOutsideHours).toEqual([])
    expect(em.rows(OpeningHours).map((row) => row.id)).toEqual(['hours-1'])
    const narrowed = await run<{ bookingsOutsideHours: Array<Record<string, unknown>> }>(
      'property_management.building.update',
      { id: BUILDING, openingHoursEnabled: true, openingHours: hoursOn('11:30') },
      em,
    )
    expect(narrowed.bookingsOutsideHours).toEqual([
      expect.objectContaining({ id: BOOKING, productName: 'Meeting room', startsAt: `${DAY}T10:00`, endsAt: `${DAY}T12:00` }),
    ])
  })

  it('lists bookings outside the hours when the hours are switched on', async () => {
    const em = seed()
    seedBooking(em)
    const switched = await run<{ bookingsOutsideHours: Array<{ id: string }> }>(
      'property_management.building.update',
      { id: BUILDING, openingHoursEnabled: true, openingHours: hoursOn('11:00') },
      em,
    )
    expect(switched.bookingsOutsideHours.map((booking) => booking.id)).toEqual([BOOKING])
  })
})

describe('booking guards', () => {
  const bookingInput = (overrides: Record<string, unknown> = {}) => ({
    unitId: UNIT,
    startsAt: `${DAY}T10:00`,
    endsAt: `${DAY}T12:00`,
    bookedByPersonId: PERSON,
    customerCompanyId: COMPANY,
    ...overrides,
  })

  it('refuses a booking while the floor is unavailable and accepts it once the closure ends', async () => {
    const em = seed()
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor([]),
      em,
    )
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 409, 'unit_unavailable')
    await run('property_management.unavailability.end', { id: unavailabilityId }, em)
    expect(em.rows(Unavailability)[0].endedAt).toBeTruthy()
    await expectHttpError(run('property_management.unavailability.end', { id: unavailabilityId }, em), 409, 'unavailability_already_ended')
    const created = await run<{ status: string }>('property_management.booking.create', bookingInput(), em)
    expect(created.status).toBe('pending')
  })

  it('refuses a booking outside the opening hours of its weekday', async () => {
    const em = seed()
    em.rows(Building)[0].openingHoursEnabled = true
    em.seed(OpeningHours, { id: 'hours-1', ...scope, buildingId: BUILDING, weekday: weekdayOf(DAY), opensAt: '11:00:00', closesAt: '15:00:00' } as never)
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 409, 'booking_outside_opening_hours')
    const created = await run<{ status: string }>('property_management.booking.create', bookingInput({ startsAt: `${DAY}T11:00`, endsAt: `${DAY}T13:00` }), em)
    expect(created.status).toBe('pending')
  })

  it('refuses a lease term on an unavailable unit with 422', async () => {
    const em = seed()
    em.seed(Unavailability, { id: 'closure', ...scope, buildingId: BUILDING, subjectType: 'space', subjectId: SPACE, reasonText: 'Works', startsAt: `${DAY}T00:00:00`, endsAt: `${isoDay(3)}T00:00:00`, endedAt: null, deletedAt: null } as never)
    const unit = em.rows(Unit)[0] as unknown as Unit
    await expectHttpError(assertUnitAvailableForTerm(em as never, scope, unit, { startsOn: TODAY, endsOn: isoDay(40) }), 422, 'unit_unavailable')
    await assertUnitAvailableForTerm(em as never, scope, unit, { startsOn: isoDay(3), endsOn: isoDay(40) })
  })
})

describe('unit move guard', () => {
  it('refuses moving a booked unit into a space that is unavailable at the booking time', async () => {
    const em = seed()
    const booking = seedBooking(em)
    em.seed(Unavailability, { id: 'closure', ...scope, buildingId: BUILDING, subjectType: 'space', subjectId: OTHER_SPACE, reasonText: 'Works', startsAt: `${TODAY}T00:00:00`, endsAt: null, endedAt: null, deletedAt: null } as never)
    const unit = em.rows(Unit)[0] as unknown as Unit
    await expectHttpError(assertMoveDestinationAvailable(em as never, scope, unit, { floorId: FLOOR, spaceId: OTHER_SPACE }), 409, 'unit_move_destination_unavailable')
    await assertMoveDestinationAvailable(em as never, scope, unit, { floorId: FLOOR, spaceId: SPACE })
    booking.status = 'cancelled'
    await assertMoveDestinationAvailable(em as never, scope, unit, { floorId: FLOOR, spaceId: OTHER_SPACE })
  })
})

describe('undoing the end of an unavailability', () => {
  const bookingInput = () => ({
    unitId: UNIT,
    startsAt: `${DAY}T10:00`,
    endsAt: `${DAY}T12:00`,
    bookedByPersonId: PERSON,
    customerCompanyId: COMPANY,
  })

  async function closeAndEnd(em: FakeEm): Promise<string> {
    const { unavailabilityId } = await run<{ unavailabilityId: string }>(
      'property_management.unavailability.create',
      confirmFloor([]),
      em,
    )
    await run('property_management.unavailability.end', { id: unavailabilityId }, em)
    return unavailabilityId
  }

  async function undoEnd(em: FakeEm, unavailabilityId: string): Promise<void> {
    const handler = commandRegistry.get('property_management.unavailability.end')
    if (!handler?.undo) throw new Error('[internal] missing undo')
    const undo = { id: unavailabilityId, tenantId: TENANT, organizationId: ORG, previousEndedAt: null }
    await handler.undo({ logEntry: { payload: { undo } } as never, ctx: buildCtx(em) } as never)
  }

  it('refuses to restore the closure when a booking was made in its period after it ended', async () => {
    const em = seed()
    const unavailabilityId = await closeAndEnd(em)
    const closure = em.rows(Unavailability)[0]
    const endedAt = closure.endedAt
    const created = await run<{ status: string }>('property_management.booking.create', bookingInput(), em)
    expect(created.status).toBe('pending')
    const booked = em.rows(Booking)[0]
    try {
      await undoEnd(em, unavailabilityId)
      throw new Error('[internal] expected the undo to fail')
    } catch (err) {
      expect(err).toBeInstanceOf(CrudHttpError)
      expect((err as CrudHttpError).status).toBe(409)
      expect((err as CrudHttpError).body).toMatchObject({
        code: 'unavailability_undo_bookings',
        bookingCount: 1,
        bookings: [expect.objectContaining({ id: booked.id, unitId: UNIT, startsAt: `${DAY}T10:00`, endsAt: `${DAY}T12:00` })],
      })
    }
    expect(closure.endedAt).toBe(endedAt)
  })

  it('refuses while bookings the worker left behind after an end during applying still fall in the period', async () => {
    const em = seed()
    const unavailabilityId = await closeAndEnd(em)
    const closure = em.rows(Unavailability)[0]
    closure.applyStatus = 'applied'
    seedBooking(em, { salesOrderId: null, status: 'confirmed' })
    await expectHttpError(undoEnd(em, unavailabilityId), 409, 'unavailability_undo_bookings')
    em.rows(Booking)[0].status = 'cancelled'
    await undoEnd(em, unavailabilityId)
    expect(closure.endedAt).toBeNull()
  })

  it('counts every booking in the restored period but lists at most the preview limit, in start then id order', async () => {
    const em = seed()
    const unavailabilityId = await closeAndEnd(em)
    const closure = em.rows(Unavailability)[0]
    const endedAt = closure.endedAt
    const total = PREVIEW_LIST_LIMIT + 25
    for (let index = 0; index < total; index += 1) {
      const hour = String(8 + (index % 10)).padStart(2, '0')
      seedBooking(em, {
        id: `60000000-0000-4000-8000-${String(total - index).padStart(12, '0')}`,
        salesOrderId: null,
        startsAt: `${DAY}T${hour}:00:00`,
        endsAt: `${DAY}T${hour}:30:00`,
      })
    }
    const find = jest.spyOn(em, 'find')
    try {
      await undoEnd(em, unavailabilityId)
      throw new Error('[internal] expected the undo to fail')
    } catch (err) {
      expect(err).toBeInstanceOf(CrudHttpError)
      const body = (err as CrudHttpError).body as { error: string; code: string; bookingCount: number; bookings: Array<{ id: string; startsAt: string }> }
      expect(body.code).toBe('unavailability_undo_bookings')
      expect(body.error).toBe('Pending or confirmed bookings fall in this period ({count}). Cancel them or make the subject unavailable again.')
      expect(body.bookingCount).toBe(total)
      expect(body.bookings).toHaveLength(PREVIEW_LIST_LIMIT)
      const expected = [...em.rows(Booking)]
        .sort((left, right) => String(left.startsAt).localeCompare(String(right.startsAt)) || left.id.localeCompare(right.id))
        .slice(0, PREVIEW_LIST_LIMIT)
        .map((booking) => booking.id)
      expect(body.bookings.map((booking) => booking.id)).toEqual(expected)
    }
    const bookingFind = find.mock.calls.find(([entity]) => entity === Booking)
    expect(bookingFind?.[2]).toMatchObject({ limit: PREVIEW_LIST_LIMIT, orderBy: { startsAt: 'asc', id: 'asc' } })
    expect(closure.endedAt).toBe(endedAt)
  })

  it('restores the closure when no booking falls in its period, ignoring past and cancelled ones', async () => {
    const em = seed()
    const unavailabilityId = await closeAndEnd(em)
    seedBooking(em, { id: '50000000-0000-4000-8000-0000000000f1', salesOrderId: null, status: 'cancelled' })
    seedBooking(em, { id: '50000000-0000-4000-8000-0000000000f2', salesOrderId: null, status: 'confirmed', startsAt: `${isoDay(-1)}T10:00:00`, endsAt: `${isoDay(-1)}T11:00:00` })
    const closure = em.rows(Unavailability)[0]
    const before = closure.updatedAt as Date
    await new Promise((resolve) => setTimeout(resolve, 2))
    await undoEnd(em, unavailabilityId)
    expect(closure.endedAt).toBeNull()
    expect((closure.updatedAt as Date).getTime()).toBeGreaterThan(before.getTime())
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 409, 'unit_unavailable')
  })

  it('takes the building, floor and unit locks before the closure row, then checks the bookings', async () => {
    const em = seed()
    const unavailabilityId = await closeAndEnd(em)
    const steps: Array<{ entity: unknown; lockMode?: number }> = []
    const findOne = em.findOne.bind(em)
    const find = em.find.bind(em)
    jest.spyOn(em, 'findOne').mockImplementation(async (entity, where, options) => {
      steps.push({ entity, lockMode: options?.lockMode })
      return findOne(entity, where, options)
    })
    jest.spyOn(em, 'find').mockImplementation(async (entity, where, options) => {
      steps.push({ entity, lockMode: options?.lockMode })
      return find(entity, where, options)
    })
    const count = em.count.bind(em)
    jest.spyOn(em, 'count').mockImplementation(async (entity, where) => {
      steps.push({ entity })
      return count(entity, where)
    })
    await undoEnd(em, unavailabilityId)
    const locks = steps.filter((step) => step.lockMode !== undefined)
    expect(locks).toEqual([
      { entity: Building, lockMode: LockMode.PESSIMISTIC_WRITE },
      { entity: Floor, lockMode: LockMode.PESSIMISTIC_WRITE },
      { entity: Unit, lockMode: LockMode.PESSIMISTIC_WRITE },
      { entity: Unavailability, lockMode: LockMode.PESSIMISTIC_WRITE },
    ])
    const closureLock = steps.findIndex((step) => step.entity === Unavailability && step.lockMode === LockMode.PESSIMISTIC_WRITE)
    const bookingRead = steps.findIndex((step) => step.entity === Booking)
    expect(bookingRead).toBeGreaterThan(closureLock)
  })

  it('does nothing for a closure whose creation was undone', async () => {
    const em = seed()
    const unavailabilityId = await closeAndEnd(em)
    const closure = em.rows(Unavailability)[0]
    closure.deletedAt = new Date()
    const endedAt = closure.endedAt
    ;(emitPropertyManagementEvent as jest.Mock).mockClear()
    await undoEnd(em, unavailabilityId)
    expect(closure.endedAt).toBe(endedAt)
    expect(emitPropertyManagementEvent).not.toHaveBeenCalledWith('property_management.unavailability.restored', expect.anything(), expect.anything())
  })

  it('emits a persistent restored event with trusted scope once the end is undone', async () => {
    const em = seed()
    const unavailabilityId = await closeAndEnd(em)
    ;(emitPropertyManagementEvent as jest.Mock).mockClear()
    await undoEnd(em, unavailabilityId)
    expect(emitPropertyManagementEvent).toHaveBeenCalledTimes(1)
    expect(emitPropertyManagementEvent).toHaveBeenCalledWith(
      'property_management.unavailability.restored',
      expect.objectContaining({ unavailabilityId, buildingId: BUILDING, subjectType: 'floor', subjectId: FLOOR, endedAt: null, ...scope }),
      { persistent: true, ...scope },
    )
  })

  it('emits no restored event when the undo is refused', async () => {
    const em = seed()
    const unavailabilityId = await closeAndEnd(em)
    seedBooking(em, { salesOrderId: null, status: 'confirmed' })
    ;(emitPropertyManagementEvent as jest.Mock).mockClear()
    await expectHttpError(undoEnd(em, unavailabilityId), 409, 'unavailability_undo_bookings')
    expect(emitPropertyManagementEvent).not.toHaveBeenCalled()
  })
})
