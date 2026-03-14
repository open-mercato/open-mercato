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
import { mapInpostStatus, mapServiceCodeToInpost, isLockerService } from '../status-map'
import { verifyInpostWebhook } from '../webhook-handler'
import { inpostErrors } from '../errors'

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

type InpostContactAddress = {
  address: {
    street: string
    building_number?: string
    city: string
    post_code: string
    country_code: string
  }
  company_name?: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
}

function buildContactAddress(
  addr: Address,
  contact: { companyName?: string; firstName?: string; lastName?: string; email?: string; phone?: string },
): InpostContactAddress {
  return {
    address: {
      street: addr.line1,
      ...(addr.line2 ? { building_number: addr.line2 } : {}),
      city: addr.city,
      post_code: addr.postalCode,
      country_code: addr.countryCode,
    },
    ...(contact.companyName ? { company_name: contact.companyName } : {}),
    ...(contact.firstName ? { first_name: contact.firstName } : {}),
    ...(contact.lastName ? { last_name: contact.lastName } : {}),
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.phone ? { phone: contact.phone } : {}),
  }
}

function buildSenderAddress(
  origin: Address,
  credentials: Record<string, unknown>,
): InpostContactAddress {
  return buildContactAddress(origin, {
    companyName: typeof credentials.senderCompanyName === 'string' ? credentials.senderCompanyName : undefined,
    firstName: typeof credentials.senderFirstName === 'string' ? credentials.senderFirstName : undefined,
    lastName: typeof credentials.senderLastName === 'string' ? credentials.senderLastName : undefined,
    email: typeof credentials.senderEmail === 'string' ? credentials.senderEmail : undefined,
    phone: typeof credentials.senderPhone === 'string' ? credentials.senderPhone : undefined,
  })
}

function buildReceiverAddress(
  destination: Address,
  credentials: Record<string, unknown>,
): InpostContactAddress {
  return buildContactAddress(destination, {
    companyName: typeof credentials.receiverCompanyName === 'string' ? credentials.receiverCompanyName : undefined,
    firstName: typeof credentials.receiverFirstName === 'string' ? credentials.receiverFirstName : undefined,
    lastName: typeof credentials.receiverLastName === 'string' ? credentials.receiverLastName : undefined,
    email: typeof credentials.receiverEmail === 'string' ? credentials.receiverEmail : undefined,
    phone: typeof credentials.receiverPhone === 'string' ? credentials.receiverPhone : undefined,
  })
}

type InpostParcel =
  | { template: string }
  | {
      dimensions: { length: string; width: string; height: string; unit: 'mm' }
      weight: { amount: string; unit: 'kg' }
    }

function buildParcel(input: CreateShipmentInput): InpostParcel {
  const pkg = input.packages[0]
  if (!pkg) {
    return { template: 'small' }
  }
  if (isLockerService(input.serviceCode)) {
    return { template: 'small' }
  }
  return {
    dimensions: {
      length: String(Math.round(pkg.lengthCm * 10)),
      width: String(Math.round(pkg.widthCm * 10)),
      height: String(Math.round(pkg.heightCm * 10)),
      unit: 'mm',
    },
    weight: {
      amount: String(pkg.weightKg),
      unit: 'kg',
    },
  }
}

function resolveTargetPoint(credentials: Record<string, unknown>): string | undefined {
  const point = credentials.targetPoint
  return typeof point === 'string' && point.trim().length > 0 ? point.trim() : undefined
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
        serviceCode: 'locker_economy',
        serviceName: 'InPost Locker Economy (Paczkomat)',
        amount: 799,
        currencyCode: 'PLN',
        estimatedDays: 3,
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

    const targetPoint = resolveTargetPoint(input.credentials)
    const customAttributes = targetPoint ? { target_point: targetPoint } : undefined

    const body: Record<string, unknown> = {
      receiver: buildReceiverAddress(input.destination, input.credentials),
      sender: buildSenderAddress(input.origin, input.credentials),
      parcels: [buildParcel(input)],
      service: inpostServiceCode,
      reference: input.orderId,
      ...(customAttributes ? { custom_attributes: customAttributes } : {}),
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
      throw inpostErrors.missingTrackingIdentifier()
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
