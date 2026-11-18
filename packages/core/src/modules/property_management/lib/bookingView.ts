import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Building, Floor, Unit, type Booking } from '../data/entities'
import { loadSalesDocuments } from './salesLookups'
import { loadSettings } from './settings'
import type { Scope } from './productUse'
import { localNow, normalizeWallClock } from './wallClock'
import { isCancellableByManager } from './bookingCancel'
import { crmName, loadCrmRecords, type CrmAccess } from './crmAccess'

export type BookingSummary = {
  id: string
  status: string
  buildingId: string
  buildingName: string | null
  unitId: string
  unitName: string | null
  floorName: string | null
  bookedByPersonId: string
  bookedByName?: string | null
  customerCompanyId: string | null
  companyName?: string | null
  customerUserId: string | null
  startsAt: string
  endsAt: string
  catalogProductId: string
  productName: string
  unitPrice: string
  quantity: number
  billingUnit: string
  totalAmount: string
  currencyCode: string | null
  cancelReason: string | null
  salesOrderId: string | null
  salesOrderNumber: string | null
  salesOrderCancelled: boolean
  cancellable: boolean
  createdAt: string
  updatedAt: string
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

export type BookingSummaryOptions = { crmAccess: CrmAccess; salesOrderNumbers?: boolean; now?: string }

export async function summarizeBookings(
  em: EntityManager,
  scope: Scope,
  bookings: readonly Booking[],
  options: BookingSummaryOptions,
): Promise<BookingSummary[]> {
  if (!bookings.length) return []
  const unitIds = uniqueIds(bookings.map((booking) => booking.unitId))
  const buildingIds = uniqueIds(bookings.map((booking) => booking.buildingId))
  const orderIds = uniqueIds(bookings.map((booking) => booking.salesOrderId))
  const [units, buildings, customers, orders, settings] = await Promise.all([
    findWithDecryption(em, Unit, { ...scope, id: { $in: unitIds } }, undefined, scope),
    findWithDecryption(em, Building, { ...scope, id: { $in: buildingIds } }, undefined, scope),
    loadCrmRecords(em, scope, options.crmAccess, {
      people: bookings.map((booking) => booking.bookedByPersonId),
      companies: bookings.map((booking) => booking.customerCompanyId),
    }),
    loadSalesDocuments(em, scope, 'order', orderIds),
    loadSettings(em, scope),
  ])
  const floorIds = uniqueIds(units.map((unit) => unit.floorId))
  const floors = floorIds.length ? await findWithDecryption(em, Floor, { ...scope, id: { $in: floorIds } }, undefined, scope) : []
  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  const buildingById = new Map(buildings.map((building) => [building.id, building]))
  const floorById = new Map(floors.map((floor) => [floor.id, floor]))
  const now = options.now ?? localNow()
  return bookings.map((booking) => {
    const unit = unitById.get(booking.unitId)
    const order = booking.salesOrderId ? orders.get(booking.salesOrderId) : undefined
    const cancelledEntryId = settings.cancelledOrderStatusEntryId
    return {
      id: booking.id,
      status: booking.status,
      buildingId: booking.buildingId,
      buildingName: buildingById.get(booking.buildingId)?.name ?? null,
      unitId: booking.unitId,
      unitName: unit?.name ?? null,
      floorName: unit ? floorById.get(unit.floorId)?.name ?? null : null,
      bookedByPersonId: booking.bookedByPersonId,
      ...(options.crmAccess.people ? { bookedByName: crmName(customers, booking.bookedByPersonId) } : {}),
      customerCompanyId: booking.customerCompanyId ?? null,
      ...(options.crmAccess.companies ? { companyName: crmName(customers, booking.customerCompanyId) } : {}),
      customerUserId: booking.customerUserId ?? null,
      startsAt: normalizeWallClock(booking.startsAt),
      endsAt: normalizeWallClock(booking.endsAt),
      catalogProductId: booking.catalogProductId,
      productName: booking.productName,
      unitPrice: booking.unitPrice,
      quantity: booking.quantity,
      billingUnit: booking.billingUnit,
      totalAmount: booking.totalAmount,
      currencyCode: booking.currencyCode ?? null,
      cancelReason: booking.cancelReason ?? null,
      salesOrderId: booking.salesOrderId ?? null,
      salesOrderNumber: options.salesOrderNumbers === false ? null : order?.number ?? null,
      salesOrderCancelled: Boolean(order && cancelledEntryId && order.statusEntryId === cancelledEntryId),
      cancellable: isCancellableByManager(booking, now),
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
    }
  })
}
