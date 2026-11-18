import { LockMode, type FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import {
  CustomerEntity,
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '@open-mercato/core/modules/customers/data/entities'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { Booking, Building, Unit, UnitProductPeriod } from '../data/entities'
import { isBuildingPermitted, type PermittedBuildings } from './buildingAccess'
import { conflictError, notFoundError, unprocessableError } from './errors'
import { isBookableBillingUnit, type BookableBillingUnit, type TimeRange } from './bookingSlots'
import { loadProductUses, type PriceContext, type Scope } from './productUse'
import { formatAmount } from './money'
import { HOLDING_BOOKING_STATUSES } from './usageGuards'
import { findOverlaps, loadReservedRanges } from './leaseOccupancy'
import { resolveUnitAvailability, unavailableDuring } from './availabilityResolver'
import { addMinutes, datePartOf, normalizeWallClock, parseWallClock, toStoredWallClock } from './wallClock'

export type BookingProduct = {
  periodId: string
  catalogProductId: string
  productName: string
  billingUnit: BookableBillingUnit
}

export type BookingParty = {
  bookedByPersonId: string
  customerCompanyId: string | null
  customerUserId: string | null
}

export function wallClockDate(value: string): Date {
  const parts = parseWallClock(value)
  if (!parts) throw new Error(`[internal] Invalid wall-clock time: ${value}`)
  return new Date(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes, parts.seconds)
}

export function bookingPriceContext(input: {
  channelId: string | null
  startsAt: string
  quantity?: number
  party?: Pick<BookingParty, 'bookedByPersonId' | 'customerCompanyId'> | null
}): PriceContext {
  return {
    quantity: input.quantity ?? 1,
    channelId: input.channelId,
    date: wallClockDate(input.startsAt),
    customerIds: input.party ? [input.party.bookedByPersonId, input.party.customerCompanyId] : [],
  }
}

export async function loadPermittedBooking(em: EntityManager, scope: Scope, permitted: PermittedBuildings, id: string): Promise<Booking> {
  const booking = await findOneWithDecryption(em, Booking, { id, ...scope, deletedAt: null }, undefined, scope)
  if (!booking || !isBuildingPermitted(permitted, booking.buildingId)) {
    throw await notFoundError('property_management.errors.bookingNotFound', 'Booking not found.')
  }
  return booking
}

export async function lockBookingRow(em: EntityManager, scope: Scope, id: string): Promise<Booking | null> {
  return findOneWithDecryption(
    em,
    Booking,
    { id, ...scope, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    scope,
  )
}

export async function lockBookingWithUnit(em: EntityManager, scope: Scope, id: string): Promise<Booking | null> {
  const current = await findOneWithDecryption(em, Booking, { id, ...scope, deletedAt: null }, { refresh: true }, scope)
  if (!current) return null
  await findOneWithDecryption(em, Unit, { id: current.unitId, ...scope }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
  return lockBookingRow(em, scope, id)
}

export async function assertBuildingOpenForBooking(em: EntityManager, scope: Scope, buildingId: string): Promise<Building> {
  const building = await findOneWithDecryption(
    em,
    Building,
    { id: buildingId, ...scope, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_READ, refresh: true },
    scope,
  )
  if (!building || building.status === 'archived') {
    throw await conflictError('property_management.errors.locationUnavailable', 'This location no longer takes bookings.', {
      code: 'location_unavailable',
    })
  }
  return building
}

export async function assertUnitAvailableForBooking(em: EntityManager, scope: Scope, unit: Unit, range: TimeRange): Promise<void> {
  const closures = unavailableDuring(await resolveUnitAvailability(em, scope, unit, range), range)
  if (closures.length) {
    throw await conflictError('property_management.errors.unitUnavailable', 'The unit is unavailable at that time.', {
      code: 'unit_unavailable',
      conflicts: closures.map((closure) => ({ id: closure.id, source: closure.source, startsAt: closure.start, endsAt: closure.end })),
    })
  }
  const term = { startsOn: datePartOf(range.start), endsOn: datePartOf(addMinutes(range.end, -1)) }
  const leases = findOverlaps(await loadReservedRanges(em, scope, [unit.id]), unit.id, term)
  if (leases.length) {
    throw await conflictError('property_management.errors.unitLeased', 'The unit is leased at that time.', {
      code: 'unit_leased',
      conflicts: leases.map((lease) => ({ reference: lease.reference, startsOn: lease.startsOn, endsOn: lease.endsOn })),
    })
  }
}

export async function resolveBookingProduct(em: EntityManager, scope: Scope, unit: Unit): Promise<BookingProduct> {
  const period = await findOneWithDecryption(em, UnitProductPeriod, { ...scope, unitId: unit.id, validTo: null }, { refresh: true }, scope)
  const uses = period ? await loadProductUses(em, scope, [period.catalogProductId]) : new Map()
  const use = period ? uses.get(period.catalogProductId) : undefined
  if (!period || period.use !== 'bookable' || !use || use.use !== 'bookable' || !isBookableBillingUnit(use.billingUnit)) {
    throw await unprocessableError('property_management.errors.unitNotBookable', 'This unit is not bookable.', {
      code: 'unit_not_bookable',
      fieldErrors: { unitId: 'property_management.errors.unitNotBookable' },
    })
  }
  const product = await findOneWithDecryption(em, CatalogProduct, { id: period.catalogProductId, ...scope, deletedAt: null }, undefined, scope)
  if (!product) {
    throw await unprocessableError('property_management.errors.unitProductMissing', 'The unit has no product. Set a product before leasing it.', {
      code: 'unit_product_missing',
    })
  }
  return { periodId: period.id, catalogProductId: period.catalogProductId, productName: period.productName, billingUnit: use.billingUnit }
}

async function personBelongsToCompany(em: EntityManager, scope: Scope, personId: string, companyId: string): Promise<boolean> {
  const profile = await findOneWithDecryption(em, CustomerPersonProfile, { entity: personId, company: companyId, ...scope }, undefined, scope)
  if (profile) return true
  const link = await findOneWithDecryption(em, CustomerPersonCompanyLink, { person: personId, company: companyId, ...scope, deletedAt: null }, undefined, scope)
  return Boolean(link)
}

function customerAccountsEnabled(): boolean {
  const modules = tryGetModules()
  return modules === null || modules.some((entry) => entry.id === 'customer_accounts')
}

function fitsBookingCompany(user: CustomerUser, companyId: string | null): boolean {
  return !user.customerEntityId || user.customerEntityId === companyId
}

async function assertBookingCustomerUser(
  em: EntityManager,
  scope: Scope,
  customerUserId: string,
  personId: string,
  companyId: string | null,
): Promise<string> {
  const user = customerAccountsEnabled()
    ? await findOneWithDecryption(em, CustomerUser, { id: customerUserId, ...scope, isActive: true, deletedAt: null }, undefined, scope)
    : null
  if (!user) {
    throw await unprocessableError('property_management.errors.customerUserNotFound', 'The portal user is not a customer user of this organization.', {
      fieldErrors: { customerUserId: 'property_management.errors.customerUserNotFound' },
    })
  }
  if (user.personEntityId !== personId || !fitsBookingCompany(user, companyId)) {
    throw await unprocessableError('property_management.errors.customerUserMismatch', 'The portal user is not the person booking or does not belong to the company.', {
      fieldErrors: { customerUserId: 'property_management.errors.customerUserMismatch' },
    })
  }
  return user.id
}

async function findBookingCustomerUser(em: EntityManager, scope: Scope, personId: string, companyId: string | null): Promise<string | null> {
  if (!customerAccountsEnabled()) return null
  const base = { ...scope, personEntityId: personId, isActive: true, deletedAt: null }
  const where: FilterQuery<CustomerUser> = companyId
    ? { ...base, $or: [{ customerEntityId: null }, { customerEntityId: companyId }] }
    : { ...base, customerEntityId: null }
  const users = await findWithDecryption(em, CustomerUser, where, { limit: 2 }, scope)
  return users.length === 1 ? users[0].id : null
}

export async function resolveBookingParty(
  em: EntityManager,
  scope: Scope,
  input: { bookedByPersonId: string; customerCompanyId?: string | null; customerUserId?: string | null },
): Promise<BookingParty> {
  const person = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: input.bookedByPersonId, ...scope, kind: 'person', deletedAt: null },
    undefined,
    scope,
  )
  if (!person) {
    throw await unprocessableError('property_management.errors.bookingPersonNotFound', 'The person booking is not a person of this organization.', {
      fieldErrors: { bookedByPersonId: 'property_management.errors.bookingPersonNotFound' },
    })
  }
  let companyId: string | null = null
  if (input.customerCompanyId) {
    const company = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: input.customerCompanyId, ...scope, kind: 'company', deletedAt: null },
      undefined,
      scope,
    )
    if (!company) {
      throw await unprocessableError('property_management.errors.companyNotFound', 'The tenant company is not a company of this organization.', {
        fieldErrors: { customerCompanyId: 'property_management.errors.companyNotFound' },
      })
    }
    if (!(await personBelongsToCompany(em, scope, person.id, company.id))) {
      throw await unprocessableError('property_management.errors.bookingPersonNotInCompany', 'The person booking does not belong to the company.', {
        fieldErrors: { bookedByPersonId: 'property_management.errors.bookingPersonNotInCompany' },
      })
    }
    companyId = company.id
  }
  const customerUserId = input.customerUserId
    ? await assertBookingCustomerUser(em, scope, input.customerUserId, person.id, companyId)
    : await findBookingCustomerUser(em, scope, person.id, companyId)
  return { bookedByPersonId: person.id, customerCompanyId: companyId, customerUserId }
}

export async function findOverlappingBookings(
  em: EntityManager,
  scope: Scope,
  unitId: string,
  range: TimeRange,
  options: { excludeBookingId?: string | null } = {},
): Promise<Booking[]> {
  const bookings = await findWithDecryption(
    em,
    Booking,
    {
      ...scope,
      unitId,
      status: { $in: [...HOLDING_BOOKING_STATUSES] },
      startsAt: { $lt: toStoredWallClock(range.end) },
      endsAt: { $gt: toStoredWallClock(range.start) },
      deletedAt: null,
    },
    { refresh: true, orderBy: { startsAt: 'asc' } },
    scope,
  )
  return bookings.filter((booking) => booking.id !== options.excludeBookingId)
}

export function bookingRangeOf(booking: { startsAt: string; endsAt: string }): TimeRange {
  return { start: normalizeWallClock(booking.startsAt), end: normalizeWallClock(booking.endsAt) }
}

function describeBookingTime(unitName: string, billingUnit: string, range: TimeRange): string {
  const date = datePartOf(range.start)
  if (billingUnit === 'day') return `${unitName} · ${date}`
  return `${unitName} · ${date} ${range.start.slice(11)}–${range.end.slice(11)}`
}

export type BookingOrderInput = {
  booking: Booking
  unitName: string
  channelId: string
}

export function buildBookingOrderPayload(input: BookingOrderInput): Record<string, unknown> {
  const { booking } = input
  const range = bookingRangeOf(booking)
  const customerEntityId = booking.customerCompanyId ?? booking.bookedByPersonId
  return {
    channelId: input.channelId,
    customerEntityId,
    ...(booking.customerCompanyId ? { customerContactId: booking.bookedByPersonId } : {}),
    currencyCode: booking.currencyCode,
    externalReference: booking.id,
    metadata: {
      propertyManagementBookingId: booking.id,
      propertyManagementUnitId: booking.unitId,
    },
    lines: [
      {
        kind: 'product',
        productId: booking.catalogProductId,
        name: booking.productName,
        description: describeBookingTime(input.unitName, booking.billingUnit, range),
        quantity: String(booking.quantity),
        unitPriceNet: formatAmount(booking.unitPrice),
        currencyCode: booking.currencyCode,
      },
    ],
  }
}
