import type { EntityManager } from '@mikro-orm/postgresql'
import {
  FreightOrder,
  FreightTrip,
  type CargoUnit,
} from '../data/entities'
import { raiseFreightError } from './errors'

export type DeliveryNoteSourceScope = { tenantId: string; organizationId: string }

export type DeliveryNoteSourceInput = {
  freightOrderId?: string | null
  freightTripId?: string | null
}

export type DeliveryNoteSourceOverrides = {
  cargoDescription?: string | null
  cargoQuantity?: string | null
  cargoUnit?: CargoUnit | null
  cargoWeightKg?: string | null
  cargoVolumeM3?: string | null
  cargoHazardous?: boolean
  cargoRefrigerated?: boolean
  sealNumber?: string | null
}

export type DeliveryNoteSourceSnapshot = {
  freightOrderId: string | null
  freightTripId: string | null
  orderNumberSnapshot: string | null
  tripNumberSnapshot: string | null
  customerId: string
  customerSnapshot: Record<string, unknown>
  origin: string
  destination: string
  requestedPickupAt: Date | null
  requestedDeliveryAt: Date | null
  cargoDescription: string
  cargoQuantity: string | null
  cargoUnit: CargoUnit | null
  cargoWeightKg: string | null
  cargoVolumeM3: string | null
  cargoHazardous: boolean
  cargoRefrigerated: boolean
  sealNumber: string | null
  vehicleId: string | null
  driverId: string | null
  vehicleSnapshot: Record<string, unknown> | null
  driverSnapshot: Record<string, unknown> | null
}

const ORDER_DELIVERY_NOTE_STATUSES = new Set<FreightOrder['status']>([
  'confirmed',
  'assigned',
  'in_transit',
  'delivered',
  'completed',
  'invoiced',
])

const TRIP_DELIVERY_NOTE_STATUSES = new Set<FreightTrip['executionStatus']>([
  'planned',
  'dispatched',
  'in_transit',
  'delivered',
])

function optionalString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function fromOrder(order: FreightOrder): DeliveryNoteSourceSnapshot {
  return {
    freightOrderId: order.id,
    freightTripId: null,
    orderNumberSnapshot: order.orderNumber,
    tripNumberSnapshot: null,
    customerId: order.customerId,
    customerSnapshot: order.customerSnapshot,
    origin: order.pickupLocation,
    destination: order.dropoffLocation,
    requestedPickupAt: order.requestedPickupAt ?? null,
    requestedDeliveryAt: order.requestedDeliveryAt ?? null,
    cargoDescription: order.cargoDescription,
    cargoQuantity: order.cargoQuantity ?? null,
    cargoUnit: order.cargoUnit ?? null,
    cargoWeightKg: order.cargoWeightKg ?? null,
    cargoVolumeM3: order.cargoVolumeM3 ?? null,
    cargoHazardous: order.cargoHazardous,
    cargoRefrigerated: order.cargoRefrigerated,
    sealNumber: null,
    vehicleId: order.vehicleId ?? null,
    driverId: order.driverId ?? null,
    vehicleSnapshot: order.vehicleSnapshot ?? null,
    driverSnapshot: order.driverSnapshot ?? null,
  }
}

function fromTrip(trip: FreightTrip, order: FreightOrder | null): DeliveryNoteSourceSnapshot {
  return {
    freightOrderId: order?.id ?? trip.freightOrderId ?? null,
    freightTripId: trip.id,
    orderNumberSnapshot: order?.orderNumber ?? null,
    tripNumberSnapshot: trip.tripNumber,
    customerId: trip.customerId,
    customerSnapshot: trip.customerSnapshot,
    origin: trip.origin,
    destination: trip.destination,
    requestedPickupAt: order?.requestedPickupAt ?? trip.executionDate ?? null,
    requestedDeliveryAt: order?.requestedDeliveryAt ?? null,
    cargoDescription: order?.cargoDescription ?? '',
    cargoQuantity: order?.cargoQuantity ?? trip.quantity ?? null,
    cargoUnit: order?.cargoUnit ?? 'trip',
    cargoWeightKg: order?.cargoWeightKg ?? null,
    cargoVolumeM3: order?.cargoVolumeM3 ?? null,
    cargoHazardous: order?.cargoHazardous ?? false,
    cargoRefrigerated: order?.cargoRefrigerated ?? false,
    sealNumber: null,
    vehicleId: trip.vehicleId ?? order?.vehicleId ?? null,
    driverId: trip.driverId ?? order?.driverId ?? null,
    vehicleSnapshot: trip.vehicleSnapshot ?? order?.vehicleSnapshot ?? null,
    driverSnapshot: trip.driverSnapshot ?? order?.driverSnapshot ?? null,
  }
}

/**
 * Resolve the transport document's content from its source, never from the
 * client's word for it. The client may supply cargo/consignee corrections, but
 * the customer, lane and execution references always come from the scoped
 * order/trip read.
 */
export async function resolveDeliveryNoteSource(
  em: EntityManager,
  scope: DeliveryNoteSourceScope,
  input: DeliveryNoteSourceInput,
  overrides: DeliveryNoteSourceOverrides = {},
): Promise<DeliveryNoteSourceSnapshot> {
  const orderId = optionalString(input.freightOrderId)
  const tripId = optionalString(input.freightTripId)

  let order: FreightOrder | null = null
  let trip: FreightTrip | null = null

  if (orderId) {
    order = await em.findOne(FreightOrder, {
      id: orderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!order) return raiseFreightError(404, 'order_not_found', 'Freight order not found.')
    if (!ORDER_DELIVERY_NOTE_STATUSES.has(order.status)) {
      return raiseFreightError(
        409,
        'order_not_ready_for_delivery_note',
        'A delivery note can only be created from a confirmed or executed order.',
      )
    }
  }

  if (tripId) {
    trip = await em.findOne(FreightTrip, {
      id: tripId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!trip) return raiseFreightError(404, 'trip_not_found', 'Freight trip not found.')
    if (!TRIP_DELIVERY_NOTE_STATUSES.has(trip.executionStatus)) {
      return raiseFreightError(
        409,
        'trip_not_ready_for_delivery_note',
        'A delivery note cannot be created from a cancelled trip.',
      )
    }
    if (trip.freightOrderId && !order) {
      order = await em.findOne(FreightOrder, {
        id: trip.freightOrderId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
    }
    if (order && trip.freightOrderId !== order.id) {
      return raiseFreightError(
        409,
        'delivery_note_source_mismatch',
        'The selected trip does not belong to the selected order.',
      )
    }
  }

  const base = trip ? fromTrip(trip, order) : fromOrder(order as FreightOrder)
  const cargoDescription = optionalString(overrides.cargoDescription) ?? base.cargoDescription
  if (!cargoDescription) {
    return raiseFreightError(
      400,
      'cargo_description_required',
      'A cargo description is required when the delivery note has no order to copy it from.',
    )
  }

  return {
    ...base,
    cargoDescription,
    cargoQuantity:
      overrides.cargoQuantity === undefined ? base.cargoQuantity : optionalString(overrides.cargoQuantity),
    cargoUnit: overrides.cargoUnit === undefined ? base.cargoUnit : overrides.cargoUnit,
    cargoWeightKg:
      overrides.cargoWeightKg === undefined ? base.cargoWeightKg : optionalString(overrides.cargoWeightKg),
    cargoVolumeM3:
      overrides.cargoVolumeM3 === undefined ? base.cargoVolumeM3 : optionalString(overrides.cargoVolumeM3),
    cargoHazardous:
      overrides.cargoHazardous === undefined ? base.cargoHazardous : overrides.cargoHazardous,
    cargoRefrigerated:
      overrides.cargoRefrigerated === undefined ? base.cargoRefrigerated : overrides.cargoRefrigerated,
    sealNumber: overrides.sealNumber === undefined ? base.sealNumber : optionalString(overrides.sealNumber),
  }
}
