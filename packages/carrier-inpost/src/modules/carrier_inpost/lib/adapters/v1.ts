import type {
  ShippingAdapter,
  ShippingRate,
  CreateShipmentInput,
  CreateShipmentResult,
  TrackingResult,
  ShippingWebhookEvent,
  UnifiedShipmentStatus,
  Address,
} from '@open-mercato/core/modules/shipping_carriers/lib/adapter'
import { inpostRequest, resolveOrganizationId } from '../client'
import { mapInpostStatus, mapServiceCodeToInpost } from '../status-map'
import { verifyInpostWebhook } from '../webhook-handler'

type InpostShipmentResponse = {
  id: string
  tracking_number?: string
  label?: string
  scheduled_delivery_end?: string
  [key: string]: unknown
}

type InpostTrackingResponse = {
  tracking_number: string
  status: string
  tracking_details?: Array<{
    status: string
    datetime: string
    [key: string]: unknown
  }>
  [key: string]: unknown
}

function buildReceiverAddress(destination: Address): Record<string, unknown> {
  return {
    country_code: destination.countryCode,
    zip_code: destination.postalCode,
    city: destination.city,
    street: destination.line1,
    ...(destination.line2 ? { building_number: destination.line2 } : {}),
  }
}

function buildSenderAddress(origin: Address): Record<string, unknown> {
  return {
    country_code: origin.countryCode,
    zip_code: origin.postalCode,
    city: origin.city,
    street: origin.line1,
    ...(origin.line2 ? { building_number: origin.line2 } : {}),
  }
}

function buildParcelDimensions(input: CreateShipmentInput): Record<string, unknown> {
  const pkg = input.packages[0]
  if (!pkg) return { template: 'SMALL' }
  return {
    length: pkg.lengthCm,
    width: pkg.widthCm,
    height: pkg.heightCm,
    weight: pkg.weightKg * 1000,
  }
}

export const inpostAdapterV1: ShippingAdapter = {
  providerKey: 'inpost',

  async calculateRates(_input) {
    const rates: ShippingRate[] = [
      {
        serviceCode: 'locker_standard',
        serviceName: 'InPost Locker Standard (Paczkomat)',
        amount: 999,
        currencyCode: 'PLN',
        estimatedDays: 2,
        guaranteedDelivery: false,
      },
      {
        serviceCode: 'locker_express',
        serviceName: 'InPost Locker Express (Paczkomat)',
        amount: 1499,
        currencyCode: 'PLN',
        estimatedDays: 1,
        guaranteedDelivery: false,
      },
      {
        serviceCode: 'courier_standard',
        serviceName: 'InPost Courier Standard',
        amount: 1299,
        currencyCode: 'PLN',
        estimatedDays: 2,
        guaranteedDelivery: false,
      },
      {
        serviceCode: 'courier_c2c',
        serviceName: 'InPost Courier C2C',
        amount: 1099,
        currencyCode: 'PLN',
        estimatedDays: 3,
        guaranteedDelivery: false,
      },
    ]
    return rates
  },

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const orgId = resolveOrganizationId(input.credentials)
    const inpostServiceCode = mapServiceCodeToInpost(input.serviceCode)

    const body: Record<string, unknown> = {
      receiver: buildReceiverAddress(input.destination),
      sender: buildSenderAddress(input.origin),
      parcels: [buildParcelDimensions(input)],
      service: inpostServiceCode,
      reference: input.orderId,
    }

    const shipment = await inpostRequest<InpostShipmentResponse>(
      input.credentials,
      `/v1/organizations/${orgId}/shipments`,
      { method: 'POST', body },
    )

    const labelData = typeof shipment.label === 'string' ? shipment.label : undefined
    const estimatedDelivery = shipment.scheduled_delivery_end
      ? new Date(shipment.scheduled_delivery_end)
      : undefined

    return {
      shipmentId: String(shipment.id),
      trackingNumber: shipment.tracking_number ?? String(shipment.id),
      ...(labelData ? { labelData } : {}),
      ...(estimatedDelivery ? { estimatedDelivery } : {}),
    }
  },

  async getTracking(input): Promise<TrackingResult> {
    const trackingNumber = input.trackingNumber ?? input.shipmentId
    if (!trackingNumber) {
      throw new Error('trackingNumber or shipmentId is required for InPost tracking')
    }

    const response = await inpostRequest<InpostTrackingResponse>(
      input.credentials,
      `/v1/tracking/${encodeURIComponent(trackingNumber)}`,
    )

    const status = mapInpostStatus(response.status)
    const events = (response.tracking_details ?? []).map((detail) => ({
      status: mapInpostStatus(detail.status) as UnifiedShipmentStatus,
      occurredAt: detail.datetime,
    }))

    return {
      trackingNumber: response.tracking_number ?? trackingNumber,
      status,
      events,
    }
  },

  async cancelShipment(input): Promise<{ status: UnifiedShipmentStatus }> {
    const orgId = resolveOrganizationId(input.credentials)

    await inpostRequest<void>(
      input.credentials,
      `/v1/organizations/${orgId}/shipments/${encodeURIComponent(input.shipmentId)}`,
      { method: 'DELETE' },
    )

    return { status: 'cancelled' }
  },

  async verifyWebhook(input): Promise<ShippingWebhookEvent> {
    return verifyInpostWebhook(input)
  },

  mapStatus(carrierStatus: string): UnifiedShipmentStatus {
    return mapInpostStatus(carrierStatus)
  },
}
