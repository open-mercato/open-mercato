import { match, P } from 'ts-pattern'
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

type InpostCalculateResult = {
  id: string
  calculated_charge_amount: string | null
  [key: string]: unknown
}

type ServiceKind = 'locker' | 'courier_c2c' | 'courier'

const INPOST_SERVICES: ReadonlyArray<{ serviceCode: string; inpostCode: string; serviceName: string; kind: ServiceKind }> = [
  { serviceCode: 'locker_standard', inpostCode: 'inpost_locker_standard', serviceName: 'InPost Locker Standard (Paczkomat)', kind: 'locker' },
  { serviceCode: 'locker_economy', inpostCode: 'inpost_locker_economy', serviceName: 'InPost Locker Economy (Paczkomat)', kind: 'locker' },
  { serviceCode: 'courier_standard', inpostCode: 'inpost_courier_standard', serviceName: 'InPost Courier Standard', kind: 'courier' },
  { serviceCode: 'courier_c2c', inpostCode: 'inpost_courier_c2c', serviceName: 'InPost Courier C2C', kind: 'courier_c2c' },
]

// Placeholder locker point used only for rate calculation — InPost requires target_point
// in the calculate payload even though the actual delivery point is chosen at checkout.
const CALCULATE_PLACEHOLDER_LOCKER_POINT = 'KRA010'

function stringOrUndefined(value: unknown): string | undefined {
  return match(value)
    .with(P.string, (s) => s)
    .otherwise(() => undefined)
}

function buildContactAddress(
  addr: Address,
  contact: { companyName?: string; firstName?: string; lastName?: string; email?: string; phone?: string },
): InpostContactAddress {
  return {
    address: {
      street: addr.line1,
      building_number: addr.line2 ?? '1',
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
    companyName: stringOrUndefined(credentials.senderCompanyName),
    firstName: stringOrUndefined(credentials.senderFirstName),
    lastName: stringOrUndefined(credentials.senderLastName),
    email: stringOrUndefined(credentials.senderEmail),
    phone: stringOrUndefined(credentials.senderPhone),
  })
}

function buildReceiverAddress(
  destination: Address,
  credentials: Record<string, unknown>,
): InpostContactAddress {
  return buildContactAddress(destination, {
    companyName: stringOrUndefined(credentials.receiverCompanyName),
    firstName: stringOrUndefined(credentials.receiverFirstName),
    lastName: stringOrUndefined(credentials.receiverLastName),
    email: stringOrUndefined(credentials.receiverEmail),
    phone: stringOrUndefined(credentials.receiverPhone),
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
  return match([pkg, isLockerService(input.serviceCode)] as const)
    .with([P.nullish, P._], () => ({ template: 'small' }))
    .with([P._, true], () => ({ template: 'small' }))
    .otherwise(([p]) => ({
      dimensions: {
        length: String(Math.round(p!.lengthCm * 10)),
        width: String(Math.round(p!.widthCm * 10)),
        height: String(Math.round(p!.heightCm * 10)),
        unit: 'mm' as const,
      },
      weight: {
        amount: String(p!.weightKg),
        unit: 'kg' as const,
      },
    }))
}

function resolveTargetPoint(credentials: Record<string, unknown>): string | undefined {
  const point = credentials.targetPoint
  return typeof point === 'string' && point.trim().length > 0 ? point.trim() : undefined
}

function buildCalculateParcel(pkg: { weightKg: number; lengthCm: number; widthCm: number; heightCm: number } | undefined) {
  if (!pkg) return { template: 'small' }
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

export const inpostAdapterV1: ShippingAdapter = {
  providerKey: 'inpost',

  async calculateRates(input) {
    const orgId = resolveOrganizationId(input.credentials)
    const parcel = buildCalculateParcel(input.packages[0])

    // Each service has different required fields for the calculate endpoint.
    // We send one request per service and silently skip services that return errors
    // (e.g. org not contracted for couriers → missing_trucker_id, locker_economy
    // needing commercial_product_identifier, etc.).
    const settled = await Promise.allSettled(
      INPOST_SERVICES.map(async ({ serviceCode, inpostCode, serviceName, kind }) => {
        const lockerPoint = match(kind)
          .with('locker', () => CALCULATE_PLACEHOLDER_LOCKER_POINT)
          .otherwise(() => undefined)

        const customAttributes = match(kind)
          .with('locker', () => ({ target_point: CALCULATE_PLACEHOLDER_LOCKER_POINT }))
          .with('courier_c2c', () => ({ sending_method: 'dispatch_order' }))
          .otherwise(() => undefined)

        // All services require receiver.phone; locker services also require email.
        // Contact details must be supplied via credentials (from stored integration
        // credentials or request-level overrides merged by the shipping service).
        const receiverPhone = stringOrUndefined(input.credentials.receiverPhone)
        const receiverEmail = stringOrUndefined(input.credentials.receiverEmail)

        const baseAddress = {
          street: input.destination.line1,
          building_number: input.destination.line2 ?? '1',
          city: input.destination.city,
          post_code: input.destination.postalCode,
          country_code: input.destination.countryCode,
        }
        const receiver = match(kind)
          .with('locker', () => ({
            address: baseAddress,
            email: receiverEmail,
            phone: receiverPhone,
          }))
          .otherwise(() => ({
            address: baseAddress,
            phone: receiverPhone,
          }))

        const shipmentPayload: Record<string, unknown> = {
          id: serviceCode,
          receiver,
          parcels: [parcel],
          service: inpostCode,
          ...(customAttributes ? { custom_attributes: customAttributes } : {}),
        }

        const results = await inpostRequest<InpostCalculateResult[]>(
          input.credentials,
          `/v1/organizations/${orgId}/shipments/calculate`,
          { method: 'POST', body: { shipments: [shipmentPayload] } },
        )

        return { serviceCode, serviceName, result: results[0] ?? null }
      }),
    )

    const rates: ShippingRate[] = []
    for (const outcome of settled) {
      if (outcome.status === 'rejected') continue
      const { serviceCode, serviceName, result } = outcome.value
      const chargeAmount = result?.calculated_charge_amount
      if (typeof chargeAmount !== 'string' || chargeAmount === null) continue
      const amount = Math.round(parseFloat(chargeAmount) * 100)
      if (!Number.isFinite(amount) || amount <= 0) continue
      rates.push({ serviceCode, serviceName, amount, currencyCode: 'PLN' })
    }

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

    const labelData = match(shipment.label)
      .with(P.string, (s) => s)
      .otherwise(() => undefined)

    const estimatedDelivery = match(shipment.scheduled_delivery_end)
      .with(P.string, (s) => new Date(s))
      .otherwise(() => undefined)

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
