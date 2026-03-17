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
import { inpostRequest, inpostRequestRaw, resolveOrganizationId } from '../client'
import { mapInpostStatus, mapServiceCodeToInpost, isLockerService } from '../status-map'
import { verifyInpostWebhook } from '../webhook-handler'
import { inpostErrors } from '../errors'

type InpostShipmentResponse = {
  id: string | number
  status?: string
  tracking_number?: string
  label?: string
  scheduled_delivery_end?: string
  offers?: Array<{ id: number | string; status: string; [key: string]: unknown }>
  parcels?: Array<{ tracking_number?: string; [key: string]: unknown }>
  [key: string]: unknown
}

type InpostBuyResponse = {
  id: string | number
  status?: string
  tracking_number?: string
  parcels?: Array<{ tracking_number?: string; [key: string]: unknown }>
  [key: string]: unknown
}

type InpostTrackingResponse = {
  // The live sandbox returns camelCase for top-level fields on this endpoint.
  trackingNumber: string
  status: string
  trackingDetails?: Array<{
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

// Template thresholds are defined by InPost in mm (height of the parcel).
// Input dimensions are in cm so we multiply by 10 before comparing.
//   small  : height ≤ 80 mm
//   medium : height 81 – 190 mm
//   large  : height 191 – 410 mm
//   xlarge : height > 410 mm  (courier_c2c only — not available for locker services)
function selectLockerTemplate(heightCm: number, allowXlarge: boolean): string {
  const heightMm = Math.round(heightCm * 10)
  return match({ heightMm, allowXlarge })
    .with({ heightMm: P.number.lte(80) }, () => 'small')
    .with({ heightMm: P.number.lte(190) }, () => 'medium')
    .with({ heightMm: P.number.lte(410) }, () => 'large')
    .with({ allowXlarge: true }, () => 'xlarge')
    .otherwise(() => 'large')
}

const INPOST_SERVICES: ReadonlyArray<{ serviceCode: string; inpostCode: string; serviceName: string; kind: ServiceKind }> = [
  { serviceCode: 'locker_standard', inpostCode: 'inpost_locker_standard', serviceName: 'InPost Locker Standard (Paczkomat)', kind: 'locker' },
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
  const kind = INPOST_SERVICES.find((s) => s.serviceCode === input.serviceCode)?.kind

  return match([pkg, kind] as const)
    .with([P.nullish, P._], () => ({ template: 'small' }))
    .with([P._, 'locker'], ([p]) => ({ template: selectLockerTemplate(p!.heightCm, false) }))
    .with([P._, 'courier_c2c'], ([p]) => ({ template: selectLockerTemplate(p!.heightCm, true) }))
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

type InpostLabelFormat = 'Pdf' | 'Zpl'

function resolveInpostLabelFormat(labelFormat: CreateShipmentInput['labelFormat']): InpostLabelFormat {
  return match(labelFormat)
    .with('zpl', () => 'Zpl' as const)
    .otherwise(() => 'Pdf' as const)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Poll shipment until status reaches 'confirmed' or max retries are exhausted.
// InPost processes buy transactions asynchronously — the buy response arrives before
// the transaction settles, so a single re-fetch is not always sufficient.
async function pollUntilConfirmed(
  credentials: Record<string, unknown>,
  shipmentId: string,
  maxRetries = 8,
  retryDelayMs = 1000,
): Promise<InpostShipmentResponse> {
  let last = await inpostRequest<InpostShipmentResponse>(
    credentials,
    `/v1/shipments/${encodeURIComponent(shipmentId)}`,
  )
  for (let attempt = 1; attempt < maxRetries && last.status !== 'confirmed'; attempt++) {
    await sleep(retryDelayMs)
    last = await inpostRequest<InpostShipmentResponse>(
      credentials,
      `/v1/shipments/${encodeURIComponent(shipmentId)}`,
    )
  }
  return last
}

async function fetchLabel(
  credentials: Record<string, unknown>,
  shipmentId: string,
  labelFormat: CreateShipmentInput['labelFormat'],
): Promise<string | undefined> {
  const format = resolveInpostLabelFormat(labelFormat)
  try {
    const buffer = await inpostRequestRaw(
      credentials,
      `/v1/shipments/${encodeURIComponent(shipmentId)}/label`,
      { format, type: 'A6' },
    )
    return arrayBufferToBase64(buffer)
  } catch {
    return undefined
  }
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
    // (e.g. org not contracted for couriers → missing_trucker_id, etc.).
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

    // InPost requires reference to be at least 3 characters (max 100).
    // Pad short orderId values with leading zeros to meet the minimum.
    const rawReference = input.orderId
    const reference = rawReference.length >= 3 ? rawReference : rawReference.padStart(3, '0')

    const body: Record<string, unknown> = {
      receiver: buildReceiverAddress(input.destination, input.credentials),
      sender: buildSenderAddress(input.origin, input.credentials),
      parcels: [buildParcel(input)],
      service: inpostServiceCode,
      reference,
      ...(customAttributes ? { custom_attributes: customAttributes } : {}),
    }

    const shipment = await inpostRequest<InpostShipmentResponse>(
      input.credentials,
      `/v1/organizations/${orgId}/shipments`,
      { method: 'POST', body },
    )

    const shipmentId = String(shipment.id)

    // InPost populates offers asynchronously after creation — the POST response
    // always returns offers: []. A single GET re-fetch (which adds enough latency)
    // resolves within ~500ms on the sandbox and returns the selected offer.
    const refetched = await inpostRequest<InpostShipmentResponse>(
      input.credentials,
      `/v1/shipments/${encodeURIComponent(shipmentId)}`,
    )

    // After creation InPost populates offers asynchronously. The re-fetched response
    // contains one offer with status "available" (pre-buy), "selected", or "bought".
    // Pick the first usable offer, or fall back to selected_offer if set.
    const offerFromArray = (refetched.offers ?? []).find(
      (o) => o.status === 'available' || o.status === 'selected' || o.status === 'bought',
    )
    const selectedOffer = offerFromArray
      ?? (refetched.selected_offer as { id: number | string; status: string } | null | undefined)
      ?? undefined
    const offerId = selectedOffer?.id

    const bought = offerId !== undefined
      ? await inpostRequest<InpostBuyResponse>(
          input.credentials,
          `/v1/shipments/${encodeURIComponent(shipmentId)}/buy`,
          { method: 'POST', body: { offer_id: offerId } },
        )
      : undefined

    // The buy transaction is also processed asynchronously — the buy response returns the
    // shipment with tracking_number: null and transactions: []. Poll with retries until
    // status reaches "confirmed" and the real tracking number is available.
    const confirmed = bought !== undefined
      ? await pollUntilConfirmed(input.credentials, shipmentId)
      : undefined

    // Tracking number may appear at shipment level or on the first parcel after confirmation.
    // Use minLength(1) to treat empty strings the same as null/undefined.
    const nonEmptyString = P.string.minLength(1)
    const trackingNumber = match([
      confirmed?.tracking_number,
      confirmed?.parcels?.[0]?.tracking_number,
      bought?.tracking_number,
      bought?.parcels?.[0]?.tracking_number,
      shipment.tracking_number,
    ] as const)
      .with([nonEmptyString, P._, P._, P._, P._], ([t]) => t)
      .with([P._, nonEmptyString, P._, P._, P._], ([, t]) => t)
      .with([P._, P._, nonEmptyString, P._, P._], ([, , t]) => t)
      .with([P._, P._, P._, nonEmptyString, P._], ([, , , t]) => t)
      .with([P._, P._, P._, P._, nonEmptyString], ([, , , , t]) => t)
      .otherwise(() => shipmentId)

    const fetchedLabelData = offerId !== undefined
      ? await fetchLabel(input.credentials, shipmentId, input.labelFormat)
      : undefined

    const labelData = match([fetchedLabelData, confirmed?.label ?? refetched.label ?? shipment.label] as const)
      .with([nonEmptyString, P._], ([l]) => l)
      .with([P._, P.string], ([, l]) => l)
      .otherwise(() => undefined)

    const estimatedDelivery = match(confirmed?.scheduled_delivery_end ?? refetched.scheduled_delivery_end)
      .with(P.string, (s) => new Date(s))
      .otherwise(() => undefined)

    return {
      shipmentId,
      trackingNumber,
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
    const events = (response.trackingDetails ?? []).map((detail) => ({
      status: mapInpostStatus(detail.status) as UnifiedShipmentStatus,
      occurredAt: detail.datetime,
    }))

    return {
      trackingNumber: response.trackingNumber ?? trackingNumber,
      status,
      events,
    }
  },

  async cancelShipment(input): Promise<{ status: UnifiedShipmentStatus }> {
    // InPost ShipX API supports cancellation via DELETE /v1/shipments/:id.
    // The API returns 204 No Content on success. Cancellation is only permitted
    // for shipments in 'created' or 'offers_prepared' status; attempting to cancel
    // a shipment in any other status results in an 'invalid_action' error from the API
    // which will surface as an inpostErrors.apiError throw from inpostRequest.
    await inpostRequest<void>(
      input.credentials,
      `/v1/shipments/${encodeURIComponent(input.shipmentId)}`,
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
