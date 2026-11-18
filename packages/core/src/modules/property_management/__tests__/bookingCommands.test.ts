/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import {
  Booking,
  Building,
  Lease,
  OpeningHours,
  ProductUse,
  PropertyManagementSettings,
  SalesOperation,
  Unavailability,
  Unit,
  UnitProductPeriod,
} from '../data/entities'
import { LockMode } from '@mikro-orm/core'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined) }))
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null) }
})
jest.mock('../lib/productUse', () => {
  const actual = jest.requireActual('../lib/productUse')
  const price = { priceAmount: '50.0000', currencyCode: 'PLN', priceKindId: null }
  return { ...actual, resolvePriceSnapshot: jest.fn(async () => price), openPeriodPrice: jest.fn(async () => price) }
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

import '../commands'
import { emitSideEffects } from '../commands/shared'
import { emitBookingEvent } from '../lib/bookingEvents'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { enqueueSalesOperations } from '../lib/salesOperations'
import { permittedBuildingIds } from '../lib/buildingAccess'
import { localNow } from '../lib/wallClock'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '40000000-0000-4000-8000-000000000001'
const UNIT = '40000000-0000-4000-8000-000000000002'
const PRODUCT = '40000000-0000-4000-8000-000000000003'
const PERSON = '40000000-0000-4000-8000-000000000004'
const COMPANY = '40000000-0000-4000-8000-000000000005'
const CHANNEL = '40000000-0000-4000-8000-000000000006'
const CANCELLED = '40000000-0000-4000-8000-000000000007'

function tomorrow(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const DAY = tomorrow()

function seed(settings: Partial<PropertyManagementSettings> = { billingChannelId: CHANNEL, cancelledOrderStatusEntryId: CANCELLED }): FakeEm {
  const em = new FakeEm()
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null } as never)
  em.seed(Unit, { id: UNIT, ...scope, buildingId: BUILDING, floorId: 'f1', spaceId: 's1', name: 'Studio 2B', catalogProductId: PRODUCT, deletedAt: null } as never)
  em.seed(UnitProductPeriod, { id: 'period-1', ...scope, unitId: UNIT, catalogProductId: PRODUCT, productName: 'Meeting room', use: 'bookable', billingUnit: 'hour', validTo: null } as never)
  em.seed(ProductUse, { id: 'use-1', ...scope, catalogProductId: PRODUCT, use: 'bookable', billingUnit: 'hour' } as never)
  em.seed(CatalogProduct, { id: PRODUCT, ...scope, title: 'Meeting room', deletedAt: null } as never)
  em.seed(CustomerEntity, { id: PERSON, ...scope, kind: 'person', displayName: 'Marcus Webb', deletedAt: null } as never)
  em.seed(CustomerEntity, { id: COMPANY, ...scope, kind: 'company', displayName: 'Solstice Analytics', deletedAt: null } as never)
  em.seed(CustomerPersonProfile, { id: 'profile-1', ...scope, entity: PERSON, company: COMPANY } as never)
  em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, ...settings } as never)
  return em
}

const STAFF_AUTH = { sub: 'user-1', tenantId: TENANT, orgId: ORG }

function customerAuth(customerUserId: string) {
  return { sub: customerUserId, sid: 'session-1', type: 'customer', tenantId: TENANT, orgId: ORG, email: 'tenant@example.com' }
}

function buildCtx(em: FakeEm, auth: Record<string, unknown> = STAFF_AUTH): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: auth as never,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

async function run<T>(commandId: string, input: Record<string, unknown>, em: FakeEm, auth?: Record<string, unknown>): Promise<T> {
  const handler = commandRegistry.get(commandId)
  if (!handler) throw new Error(`[internal] missing command ${commandId}`)
  return handler.execute({ ...scope, ...input }, buildCtx(em, auth)) as Promise<T>
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

const bookingInput = (overrides: Record<string, unknown> = {}) => ({
  unitId: UNIT,
  startsAt: `${DAY}T10:00`,
  endsAt: `${DAY}T12:00`,
  bookedByPersonId: PERSON,
  customerCompanyId: COMPANY,
  ...overrides,
})

beforeEach(() => jest.clearAllMocks())

describe('property_management.booking.create', () => {
  it('totals the snapshot price times the quantity in decimal, without float drift', async () => {
    const { resolvePriceSnapshot } = jest.requireMock('../lib/productUse') as { resolvePriceSnapshot: jest.Mock }
    resolvePriceSnapshot.mockImplementationOnce(async () => ({ priceAmount: '0.1000', currencyCode: 'PLN', priceKindId: null }))
    const em = seed()
    await run('property_management.booking.create', bookingInput({ endsAt: `${DAY}T13:00` }), em)
    const [booking] = em.rows(Booking) as unknown as Booking[]
    expect(booking).toMatchObject({ unitPrice: '0.1', quantity: 3, totalAmount: '0.3' })
  })

  it('holds the slot, snapshots product and price and records one booking order operation', async () => {
    const em = seed()
    const result = await run<{ bookingId: string; status: string; operationId: string }>('property_management.booking.create', bookingInput(), em)
    expect(result.status).toBe('pending')
    const [booking] = em.rows(Booking) as unknown as Booking[]
    expect(booking).toMatchObject({
      unitId: UNIT,
      buildingId: BUILDING,
      status: 'pending',
      startsAt: `${DAY}T10:00:00`,
      endsAt: `${DAY}T12:00:00`,
      productName: 'Meeting room',
      unitPrice: '50',
      quantity: 2,
      totalAmount: '100',
      currencyCode: 'PLN',
      customerUserId: null,
    })
    const [operation] = em.rows(SalesOperation) as unknown as SalesOperation[]
    expect(operation).toMatchObject({ kind: 'booking_order', subjectKey: `booking_order:${booking.id}`, targetType: 'booking', token: booking.holdToken })
    expect(operation.payload).toMatchObject({
      channelId: CHANNEL,
      customerEntityId: COMPANY,
      customerContactId: PERSON,
      lines: [expect.objectContaining({ productId: PRODUCT, quantity: '2', unitPriceNet: '50', currencyCode: 'PLN' })],
    })
    expect(enqueueSalesOperations).toHaveBeenCalledWith([operation.id])
    expect(emitSideEffects).toHaveBeenCalledWith(
      expect.anything(),
      'created',
      booking,
      expect.objectContaining({ events: expect.objectContaining({ module: 'property_management', entity: 'booking' }) }),
    )
  })

  it('refuses a slot already held by a pending or confirmed booking', async () => {
    const em = seed()
    em.seed(Booking, { id: 'held', ...scope, unitId: UNIT, status: 'confirmed', startsAt: `${DAY}T11:00:00`, endsAt: `${DAY}T12:00:00`, deletedAt: null } as never)
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 409, 'booking_slot_taken')
    em.rows(Booking)[0].status = 'cancelled'
    await run('property_management.booking.create', bookingInput(), em)
  })

  it('records the price on an unpriced unit period only once the booking passes its checks', async () => {
    const em = seed()
    const [period] = em.rows(UnitProductPeriod) as unknown as UnitProductPeriod[]
    em.seed(Booking, { id: 'held', ...scope, unitId: UNIT, status: 'confirmed', startsAt: `${DAY}T11:00:00`, endsAt: `${DAY}T12:00:00`, deletedAt: null } as never)
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 409, 'booking_slot_taken')
    expect(period.priceAmount ?? null).toBeNull()
    em.rows(Booking)[0].status = 'cancelled'
    await run('property_management.booking.create', bookingInput(), em)
    expect(period).toMatchObject({ priceAmount: '50.0000', currencyCode: 'PLN' })
  })

  it('needs the billing channel and the cancelled order status', async () => {
    await expectHttpError(run('property_management.booking.create', bookingInput(), seed({ cancelledOrderStatusEntryId: CANCELLED })), 422, 'billing_channel_missing')
    await expectHttpError(run('property_management.booking.create', bookingInput(), seed({ billingChannelId: CHANNEL })), 422, 'cancelled_status_missing')
  })

  it('applies the booking rules', async () => {
    await expectHttpError(run('property_management.booking.create', bookingInput({ startsAt: `${DAY}T10:30` }), seed()), 422, 'booking_not_on_the_hour')
    await expectHttpError(run('property_management.booking.create', bookingInput({ endsAt: `${DAY}T23:00` }), seed()), 422, 'booking_too_long')
  })

  it('refuses a person outside the company', async () => {
    const em = seed()
    em.rows(CustomerPersonProfile).splice(0)
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 422)
  })

  describe('portal user', () => {
    const USER = '40000000-0000-4000-8000-0000000000a1'
    const OTHER = '40000000-0000-4000-8000-0000000000a2'

    function seedUser(em: FakeEm, data: Record<string, unknown>) {
      em.seed(CustomerUser, { id: USER, ...scope, isActive: true, deletedAt: null, ...data } as never)
    }

    async function expectFieldError(em: FakeEm, overrides: Record<string, unknown> = {}) {
      try {
        await run('property_management.booking.create', bookingInput({ customerUserId: USER, ...overrides }), em)
      } catch (err) {
        expect(err).toBeInstanceOf(CrudHttpError)
        expect((err as CrudHttpError).status).toBe(422)
        expect((err as CrudHttpError).body).toMatchObject({ fieldErrors: { customerUserId: 'property_management.errors.customerUserMismatch' } })
        expect(em.rows(Booking)).toHaveLength(0)
        return
      }
      throw new Error('[internal] expected the command to fail')
    }

    it('records the portal user of the person booking', async () => {
      const em = seed()
      seedUser(em, { personEntityId: PERSON, customerEntityId: COMPANY })
      await run('property_management.booking.create', bookingInput({ customerUserId: USER }), em)
      expect(em.rows(Booking)[0]).toMatchObject({ customerUserId: USER })
    })

    it('accepts a portal user with no company link', async () => {
      const em = seed()
      seedUser(em, { personEntityId: PERSON, customerEntityId: null })
      await run('property_management.booking.create', bookingInput({ customerUserId: USER }), em)
      expect(em.rows(Booking)[0]).toMatchObject({ customerUserId: USER })
    })

    it('refuses a portal user of another person', async () => {
      const em = seed()
      seedUser(em, { personEntityId: OTHER, customerEntityId: COMPANY })
      await expectFieldError(em)
    })

    it('refuses a portal user without a person link', async () => {
      const em = seed()
      seedUser(em, { personEntityId: null, customerEntityId: COMPANY })
      await expectFieldError(em)
    })

    it('refuses a portal user of another company', async () => {
      const em = seed()
      seedUser(em, { personEntityId: PERSON, customerEntityId: OTHER })
      await expectFieldError(em)
    })

    it('refuses a portal user of a company when no company is booked', async () => {
      const em = seed()
      seedUser(em, { personEntityId: PERSON, customerEntityId: OTHER })
      await expectFieldError(em, { customerCompanyId: null })
    })

    it('accepts a portal user without a company when no company is booked', async () => {
      const em = seed()
      seedUser(em, { personEntityId: PERSON, customerEntityId: null })
      await run('property_management.booking.create', bookingInput({ customerUserId: USER, customerCompanyId: null }), em)
      expect(em.rows(Booking)[0]).toMatchObject({ customerUserId: USER, customerCompanyId: null })
    })

    it('links only a portal user without a company when no company is booked and none is passed', async () => {
      const em = seed()
      seedUser(em, { personEntityId: PERSON, customerEntityId: OTHER })
      await run('property_management.booking.create', bookingInput({ customerCompanyId: null }), em)
      expect(em.rows(Booking)[0]).toMatchObject({ customerUserId: null, customerCompanyId: null })
    })
  })
})

describe('property_management.booking.cancel', () => {
  it('moves the order of a confirmed booking to the cancelled status and releases the slot', async () => {
    const em = seed()
    const booking = em.seed(Booking, {
      id: '40000000-0000-4000-8000-0000000000bb',
      ...scope,
      buildingId: BUILDING,
      unitId: UNIT,
      status: 'confirmed',
      startsAt: `${DAY}T10:00:00`,
      endsAt: `${DAY}T11:00:00`,
      salesOrderId: 'order-1',
      deletedAt: null,
    } as never) as unknown as Booking
    await expectHttpError(run('property_management.booking.cancel', { id: '40000000-0000-4000-8000-0000000000aa' }, em), 404)
    const cancelled = await run<{ status: string; operationId: string | null }>('property_management.booking.cancel', { id: booking.id }, em)
    expect(cancelled.status).toBe('cancelled')
    expect(booking).toMatchObject({ status: 'cancelled', cancelReason: 'manager', holdToken: null })
    const [operation] = em.rows(SalesOperation) as unknown as SalesOperation[]
    expect(operation).toMatchObject({ kind: 'order_status', subjectKey: 'order_status:order-1:cancelled', payload: { orderId: 'order-1', statusEntryId: CANCELLED } })
    expect(emitBookingEvent).toHaveBeenCalledWith('property_management.booking.cancelled', booking)
    await expectHttpError(run('property_management.booking.cancel', { id: booking.id }, em), 409, 'booking_not_cancellable')
  })

  it('checks the optimistic lock against the booking read under the row lock', async () => {
    const em = seed()
    const booking = em.seed(Booking, {
      id: '40000000-0000-4000-8000-0000000000bd',
      ...scope,
      buildingId: BUILDING,
      unitId: UNIT,
      status: 'confirmed',
      startsAt: `${DAY}T10:00:00`,
      endsAt: `${DAY}T11:00:00`,
      salesOrderId: null,
      updatedAt: new Date('2026-11-01T00:00:00Z'),
      deletedAt: null,
    } as never) as unknown as Booking
    const concurrentUpdate = new Date('2026-11-02T00:00:00Z')
    const findOne = em.findOne.bind(em)
    em.findOne = async (entity, where, options) => {
      if (entity === Unit && options?.lockMode === LockMode.PESSIMISTIC_WRITE) booking.updatedAt = concurrentUpdate
      return findOne(entity, where, options)
    }
    const enforce = jest.mocked(enforceCommandOptimisticLockWithGuards)
    enforce.mockClear()
    await run('property_management.booking.cancel', { id: booking.id }, em)
    expect(enforce).toHaveBeenCalledTimes(1)
    expect(enforce.mock.calls[0][1]).toMatchObject({ resourceId: booking.id, current: concurrentUpdate })
  })

  it('lets a customer cancel only their own booking and only before it starts', async () => {
    const em = seed()
    const started = em.seed(Booking, {
      id: '40000000-0000-4000-8000-0000000000cc',
      ...scope,
      buildingId: BUILDING,
      unitId: UNIT,
      customerUserId: '40000000-0000-4000-8000-0000000000dd',
      status: 'confirmed',
      startsAt: '2020-01-01T10:00:00',
      endsAt: `${DAY}T11:00:00`,
      deletedAt: null,
    } as never) as unknown as Booking
    const owner = customerAuth('40000000-0000-4000-8000-0000000000dd')
    await expectHttpError(
      run('property_management.booking.cancel', { id: started.id, reason: 'customer' }, em, customerAuth('40000000-0000-4000-8000-0000000000ee')),
      404,
    )
    await expectHttpError(
      run('property_management.booking.cancel', { id: started.id, reason: 'customer', customerUserId: started.customerUserId }, em, owner),
      409,
      'booking_already_started',
    )
  })

  function seedManagerBooking(em: FakeEm, id: string, startsAt: string, endsAt: string): Booking {
    return em.seed(Booking, {
      id,
      ...scope,
      buildingId: BUILDING,
      unitId: UNIT,
      status: 'confirmed',
      startsAt,
      endsAt,
      salesOrderId: 'order-1',
      deletedAt: null,
    } as never) as unknown as Booking
  }

  it('refuses a manager cancellation once the booking has ended, before the sweep completes it', async () => {
    const em = seed()
    const ended = seedManagerBooking(em, '40000000-0000-4000-8000-0000000000e1', '2020-01-01T10:00:00', '2020-01-01T11:00:00')
    await expectHttpError(run('property_management.booking.cancel', { id: ended.id }, em), 409, 'booking_already_ended')
    expect(ended.status).toBe('confirmed')
    expect(ended.cancelReason ?? null).toBeNull()
    expect(em.rows(SalesOperation)).toHaveLength(0)
  })

  it('treats a booking ending this minute as ended', async () => {
    const em = seed()
    const endsNow = seedManagerBooking(em, '40000000-0000-4000-8000-0000000000e2', '2020-01-01T10:00:00', `${localNow()}:00`)
    await expectHttpError(run('property_management.booking.cancel', { id: endsNow.id }, em), 409, 'booking_already_ended')
    expect(endsNow.status).toBe('confirmed')
  })

  it('still lets a manager cancel a booking in progress or in the future', async () => {
    const em = seed()
    const inProgress = seedManagerBooking(em, '40000000-0000-4000-8000-0000000000e3', '2020-01-01T10:00:00', `${DAY}T11:00:00`)
    const future = seedManagerBooking(em, '40000000-0000-4000-8000-0000000000e4', `${DAY}T12:00:00`, `${DAY}T13:00:00`)
    await expect(run('property_management.booking.cancel', { id: inProgress.id }, em)).resolves.toMatchObject({ status: 'cancelled' })
    await expect(run('property_management.booking.cancel', { id: future.id }, em)).resolves.toMatchObject({ status: 'cancelled' })
    expect(inProgress).toMatchObject({ status: 'cancelled', cancelReason: 'manager' })
    expect(future).toMatchObject({ status: 'cancelled', cancelReason: 'manager' })
  })

  afterEach(() => jest.mocked(permittedBuildingIds).mockImplementation(async () => null))

  function seedFutureCustomerBooking(em: FakeEm, buildingId: string = BUILDING): Booking {
    return em.seed(Booking, {
      id: '40000000-0000-4000-8000-0000000000c1',
      ...scope,
      buildingId,
      unitId: UNIT,
      customerUserId: '40000000-0000-4000-8000-0000000000dd',
      status: 'confirmed',
      startsAt: `${DAY}T10:00:00`,
      endsAt: `${DAY}T11:00:00`,
      salesOrderId: null,
      deletedAt: null,
    } as never) as unknown as Booking
  }

  it('refuses a customer cancellation from a staff caller, even for a booking outside its buildings', async () => {
    const em = seed()
    const booking = seedFutureCustomerBooking(em)
    jest.mocked(permittedBuildingIds).mockResolvedValue(['40000000-0000-4000-8000-0000000000ff'])
    await expectHttpError(
      run('property_management.booking.cancel', { id: booking.id, reason: 'customer', customerUserId: booking.customerUserId }, em),
      403,
      'customer_auth_required',
    )
    await expectHttpError(
      run('property_management.booking.cancel', { id: booking.id, reason: 'customer', customerUserId: booking.customerUserId }, em, { ...STAFF_AUTH, isSuperAdmin: true }),
      403,
      'customer_auth_required',
    )
    expect(booking.status).toBe('confirmed')
  })

  it('refuses a customer cancellation whose input names another customer user than the authenticated one', async () => {
    const em = seed()
    const booking = seedFutureCustomerBooking(em)
    await expectHttpError(
      run(
        'property_management.booking.cancel',
        { id: booking.id, reason: 'customer', customerUserId: booking.customerUserId },
        em,
        customerAuth('40000000-0000-4000-8000-0000000000ee'),
      ),
      404,
    )
    await expectHttpError(
      run(
        'property_management.booking.cancel',
        { id: booking.id, reason: 'customer', customerUserId: '40000000-0000-4000-8000-0000000000ee' },
        em,
        customerAuth(booking.customerUserId as string),
      ),
      404,
    )
    await expectHttpError(
      run('property_management.booking.cancel', { id: booking.id, reason: 'customer' }, em, {
        ...customerAuth(booking.customerUserId as string),
        orgId: '22222222-2222-4222-8222-2222222222ff',
      }),
      403,
    )
    expect(booking.status).toBe('confirmed')
  })

  it('lets the authenticated customer cancel their own future booking', async () => {
    const em = seed()
    const booking = seedFutureCustomerBooking(em, '40000000-0000-4000-8000-0000000000fe')
    jest.mocked(permittedBuildingIds).mockResolvedValue([])
    const result = await run<{ status: string }>(
      'property_management.booking.cancel',
      { id: booking.id, reason: 'customer' },
      em,
      customerAuth(booking.customerUserId as string),
    )
    expect(result.status).toBe('cancelled')
    expect(booking).toMatchObject({ status: 'cancelled', cancelReason: 'customer' })
  })
})

describe('property_management.booking.cancel without a cancelled order status', () => {
  function seedBooking(em: FakeEm, overrides: Record<string, unknown>): Booking {
    return em.seed(Booking, {
      id: '40000000-0000-4000-8000-0000000000f1',
      ...scope,
      buildingId: BUILDING,
      unitId: UNIT,
      startsAt: `${DAY}T10:00:00`,
      endsAt: `${DAY}T11:00:00`,
      holdToken: 'token-1',
      deletedAt: null,
      ...overrides,
    } as never) as unknown as Booking
  }

  it('refuses a pending booking whose order is still being created with 422 cancelled_status_missing', async () => {
    const em = seed({ billingChannelId: CHANNEL, cancelledOrderStatusEntryId: null })
    const booking = seedBooking(em, { status: 'pending', salesOrderId: null })
    await expectHttpError(run('property_management.booking.cancel', { id: booking.id }, em), 422, 'cancelled_status_missing')
    expect(booking).toMatchObject({ status: 'pending', holdToken: 'token-1' })
    expect(em.rows(SalesOperation)).toHaveLength(0)
  })

  it('cancels a pending booking without recording an order operation once the cancelled status is set', async () => {
    const em = seed()
    const booking = seedBooking(em, { status: 'pending', salesOrderId: null })
    const result = await run<{ status: string; operationId: string | null }>('property_management.booking.cancel', { id: booking.id }, em)
    expect(result).toMatchObject({ status: 'cancelled', operationId: null })
    expect(booking).toMatchObject({ status: 'cancelled', holdToken: null })
    expect(em.rows(SalesOperation)).toHaveLength(0)
  })

  it('still cancels a confirmed booking that never got an order', async () => {
    const em = seed({ billingChannelId: CHANNEL, cancelledOrderStatusEntryId: null })
    const booking = seedBooking(em, { status: 'confirmed', salesOrderId: null, holdToken: null })
    const result = await run<{ status: string }>('property_management.booking.cancel', { id: booking.id }, em)
    expect(result.status).toBe('cancelled')
  })
})

describe('property_management.booking.complete', () => {
  it('completes a confirmed booking once it has ended and leaves future bookings alone', async () => {
    const em = seed()
    const past = em.seed(Booking, {
      id: '40000000-0000-4000-8000-0000000000f1',
      ...scope,
      unitId: UNIT,
      status: 'confirmed',
      startsAt: '2020-01-01T10:00:00',
      endsAt: '2020-01-01T11:00:00',
      deletedAt: null,
    } as never) as unknown as Booking
    const future = em.seed(Booking, {
      id: '40000000-0000-4000-8000-0000000000f2',
      ...scope,
      unitId: UNIT,
      status: 'confirmed',
      startsAt: `${DAY}T10:00:00`,
      endsAt: `${DAY}T11:00:00`,
      deletedAt: null,
    } as never) as unknown as Booking
    expect(await run('property_management.booking.complete', { id: past.id }, em)).toEqual({ bookingId: past.id, completed: true })
    expect(past.status).toBe('completed')
    expect(emitBookingEvent).toHaveBeenCalledWith('property_management.booking.completed', past)
    expect(await run('property_management.booking.complete', { id: future.id }, em)).toEqual({ bookingId: future.id, completed: false })
    expect(future.status).toBe('confirmed')
  })

  it('locks the unit before the booking so completing serialises with closures that lock the units', async () => {
    const em = seed()
    const past = em.seed(Booking, {
      id: '40000000-0000-4000-8000-0000000000f3',
      ...scope,
      unitId: UNIT,
      status: 'confirmed',
      startsAt: '2020-01-01T10:00:00',
      endsAt: '2020-01-01T11:00:00',
      deletedAt: null,
    } as never) as unknown as Booking
    const lockedInOrder: Array<{ entity: unknown; lockMode: number }> = []
    const findOne = em.findOne.bind(em)
    const find = em.find.bind(em)
    jest.spyOn(em, 'findOne').mockImplementation(async (entity, where, options) => {
      if (options?.lockMode !== undefined) lockedInOrder.push({ entity, lockMode: options.lockMode })
      return findOne(entity, where, options)
    })
    jest.spyOn(em, 'find').mockImplementation(async (entity, where, options) => {
      if (options?.lockMode !== undefined) lockedInOrder.push({ entity, lockMode: options.lockMode })
      return find(entity, where, options)
    })
    expect(await run('property_management.booking.complete', { id: past.id }, em)).toEqual({ bookingId: past.id, completed: true })
    expect(lockedInOrder).toEqual([
      { entity: Unit, lockMode: LockMode.PESSIMISTIC_WRITE },
      { entity: Booking, lockMode: LockMode.PESSIMISTIC_WRITE },
      { entity: Unavailability, lockMode: LockMode.PESSIMISTIC_READ },
    ])
  })

  it('does not complete a booking an applying closure still has to cancel, and completes one that ended before the closure', async () => {
    const em = seed()
    const past = em.seed(Booking, {
      id: '40000000-0000-4000-8000-0000000000f4',
      ...scope,
      unitId: UNIT,
      status: 'confirmed',
      startsAt: '2020-01-01T10:00:00',
      endsAt: '2020-01-01T11:00:00',
      deletedAt: null,
    } as never) as unknown as Booking
    const closure = em.seed(Unavailability, {
      id: '40000000-0000-4000-8000-0000000000f5',
      ...scope,
      buildingId: BUILDING,
      subjectType: 'space',
      subjectId: 's1',
      reasonText: 'Works',
      startsAt: '2019-12-31T00:00:00',
      endsAt: null,
      endedAt: null,
      deletedAt: null,
      applyStatus: 'applying',
      createdAt: new Date(2020, 0, 1, 10, 30, 0),
    } as never) as unknown as Unavailability
    expect(await run('property_management.booking.complete', { id: past.id }, em)).toEqual({ bookingId: past.id, completed: false })
    expect(past.status).toBe('confirmed')
    expect(emitBookingEvent).not.toHaveBeenCalled()
    closure.createdAt = new Date(2020, 0, 1, 11, 0, 0)
    expect(await run('property_management.booking.complete', { id: past.id }, em)).toEqual({ bookingId: past.id, completed: true })
    expect(past.status).toBe('completed')
  })
})

describe('property_management.booking.create refusals', () => {
  it('refuses a booking in an archived building with 409 location_unavailable', async () => {
    const em = seed()
    em.rows(Building)[0].status = 'archived'
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 409, 'location_unavailable')
    expect(em.rows(Booking)).toHaveLength(0)
    expect(em.rows(SalesOperation)).toHaveLength(0)
  })

  it('refuses a booking when the building is archived between the pre-check and the transaction', async () => {
    const em = seed()
    const { resolvePriceSnapshot } = jest.requireMock('../lib/productUse') as { resolvePriceSnapshot: jest.Mock }
    resolvePriceSnapshot.mockImplementationOnce(async () => {
      em.rows(Building)[0].status = 'archived'
      return { priceAmount: '50.0000', currencyCode: 'PLN', priceKindId: null }
    })
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 409, 'location_unavailable')
    expect(em.rows(Booking)).toHaveLength(0)
  })

  it('locks the building FOR SHARE before the unit FOR UPDATE, so it serialises with an archive holding the building FOR UPDATE', async () => {
    const em = seed()
    const locks: Array<{ entity: unknown; lockMode: number }> = []
    const findOne = em.findOne.bind(em)
    jest.spyOn(em, 'findOne').mockImplementation(async (entity, where, options) => {
      if (options?.lockMode !== undefined) locks.push({ entity, lockMode: options.lockMode })
      return findOne(entity, where, options)
    })
    await run('property_management.booking.create', bookingInput(), em)
    expect(locks.slice(0, 2)).toEqual([
      { entity: Building, lockMode: LockMode.PESSIMISTIC_READ },
      { entity: Unit, lockMode: LockMode.PESSIMISTIC_WRITE },
    ])
  })

  it('refuses a unit leased at that time with 409 unit_leased', async () => {
    const em = seed()
    em.seed(Lease, {
      id: '40000000-0000-4000-8000-0000000000c1',
      ...scope,
      reference: 'L-2030-001',
      buildingId: BUILDING,
      unitId: UNIT,
      status: 'active',
      startsOn: DAY,
      endsOn: DAY,
      pendingChange: null,
      deletedAt: null,
    } as never)
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 409, 'unit_leased')
    expect(em.rows(Booking)).toHaveLength(0)
  })

  it('refuses a product without a net price with 422 booking_price_missing', async () => {
    const em = seed()
    const { resolvePriceSnapshot } = jest.requireMock('../lib/productUse') as { resolvePriceSnapshot: jest.Mock }
    resolvePriceSnapshot.mockImplementationOnce(async () => ({ priceAmount: null, currencyCode: 'PLN', priceKindId: null }))
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 422, 'booking_price_missing')
    expect(em.rows(Booking)).toHaveLength(0)
  })

  it('re-checks the opening hours under the building lock and refuses a booking the hours were narrowed away from', async () => {
    const em = seed()
    em.rows(Building)[0].openingHoursEnabled = true
    for (let weekday = 0; weekday < 7; weekday += 1) {
      em.seed(OpeningHours, { id: `hours-${weekday}`, ...scope, buildingId: BUILDING, weekday, opensAt: '08:00:00', closesAt: '18:00:00' } as never)
    }
    const { resolvePriceSnapshot } = jest.requireMock('../lib/productUse') as { resolvePriceSnapshot: jest.Mock }
    resolvePriceSnapshot.mockImplementationOnce(async () => {
      for (const row of em.rows(OpeningHours)) row.opensAt = '11:00:00'
      return { priceAmount: '50.0000', currencyCode: 'PLN', priceKindId: null }
    })
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 409, 'booking_outside_opening_hours')
    expect(em.rows(Booking)).toHaveLength(0)
  })

  it('prices the booking in the billing channel for the booked company and time', async () => {
    const em = seed()
    await run('property_management.booking.create', bookingInput(), em)
    const { resolvePriceSnapshot } = jest.requireMock('../lib/productUse') as { resolvePriceSnapshot: jest.Mock }
    const [, , , productId, context] = resolvePriceSnapshot.mock.calls[0]
    expect(productId).toBe(PRODUCT)
    expect(context).toMatchObject({ quantity: 2, channelId: CHANNEL, customerIds: [PERSON, COMPANY] })
    const [year, month, day] = DAY.split('-').map(Number)
    expect(context.date).toEqual(new Date(year, month - 1, day, 10, 0, 0))
  })
})

describe('property_management.booking.create product serialisation', () => {
  it('refuses the booking when the product billing unit changes between the pre-check and the transaction', async () => {
    const em = seed()
    const { resolvePriceSnapshot } = jest.requireMock('../lib/productUse') as { resolvePriceSnapshot: jest.Mock }
    resolvePriceSnapshot.mockImplementationOnce(async () => {
      em.rows(ProductUse)[0].billingUnit = 'day'
      return { priceAmount: '50.0000', currencyCode: 'PLN', priceKindId: null }
    })
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 409, 'booking_product_changed')
    expect(em.rows(Booking)).toHaveLength(0)
  })

  it('refuses the booking when the unit moved away from the product and back meanwhile', async () => {
    const em = seed()
    const { resolvePriceSnapshot } = jest.requireMock('../lib/productUse') as { resolvePriceSnapshot: jest.Mock }
    resolvePriceSnapshot.mockImplementationOnce(async () => {
      const [period] = em.rows(UnitProductPeriod) as unknown as UnitProductPeriod[]
      period.validTo = new Date()
      em.seed(UnitProductPeriod, { id: 'period-2', ...scope, unitId: UNIT, catalogProductId: PRODUCT, productName: 'Meeting room', use: 'bookable', billingUnit: 'hour', validTo: null } as never)
      return { priceAmount: '50.0000', currencyCode: 'PLN', priceKindId: null }
    })
    await expectHttpError(run('property_management.booking.create', bookingInput(), em), 409, 'booking_product_changed')
    expect(em.rows(Booking)).toHaveLength(0)
  })
})
