import type { APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'

const MOCK_ORIGIN = {
  countryCode: 'US',
  postalCode: '10001',
  city: 'New York',
  line1: '123 Sender St',
}

const MOCK_DESTINATION = {
  countryCode: 'US',
  postalCode: '90210',
  city: 'Beverly Hills',
  line1: '456 Receiver Ave',
}

const MOCK_PACKAGE = {
  weightKg: 2.5,
  lengthCm: 30,
  widthCm: 20,
  heightCm: 15,
}

export function defaultOrigin() {
  return { ...MOCK_ORIGIN }
}

export function defaultDestination() {
  return { ...MOCK_DESTINATION }
}

export function defaultPackage() {
  return { ...MOCK_PACKAGE }
}

export async function calculateRates(
  request: APIRequestContext,
  token: string,
  overrides?: {
    providerKey?: string
    origin?: typeof MOCK_ORIGIN
    destination?: typeof MOCK_DESTINATION
    packages?: Array<typeof MOCK_PACKAGE>
  },
): Promise<{
  rates: Array<{
    serviceCode: string
    serviceName: string
    amount: number
    currencyCode: string
    estimatedDays?: number
    guaranteedDelivery?: boolean
  }>
}> {
  const response = await apiRequest(request, 'POST', '/api/shipping-carriers/rates', {
    token,
    data: {
      providerKey: overrides?.providerKey ?? 'mock_carrier',
      origin: overrides?.origin ?? MOCK_ORIGIN,
      destination: overrides?.destination ?? MOCK_DESTINATION,
      packages: overrides?.packages ?? [MOCK_PACKAGE],
    },
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to calculate rates: ${response.status()} ${body}`)
  }
  return response.json()
}

export async function createShipment(
  request: APIRequestContext,
  token: string,
  overrides?: {
    providerKey?: string
    orderId?: string
    origin?: typeof MOCK_ORIGIN
    destination?: typeof MOCK_DESTINATION
    packages?: Array<typeof MOCK_PACKAGE>
    serviceCode?: string
    labelFormat?: 'pdf' | 'zpl' | 'png'
  },
): Promise<{
  shipmentId: string
  carrierShipmentId: string
  trackingNumber: string
  status: string
  labelUrl?: string
}> {
  const response = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
    token,
    data: {
      providerKey: overrides?.providerKey ?? 'mock_carrier',
      orderId: overrides?.orderId ?? crypto.randomUUID(),
      origin: overrides?.origin ?? MOCK_ORIGIN,
      destination: overrides?.destination ?? MOCK_DESTINATION,
      packages: overrides?.packages ?? [MOCK_PACKAGE],
      serviceCode: overrides?.serviceCode ?? 'standard',
      labelFormat: overrides?.labelFormat,
    },
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to create shipment: ${response.status()} ${body}`)
  }
  return response.json()
}

export async function getTracking(
  request: APIRequestContext,
  token: string,
  params: {
    providerKey?: string
    shipmentId?: string
    trackingNumber?: string
  },
): Promise<{
  trackingNumber: string
  status: string
  events: Array<{ status: string; occurredAt: string; location?: string }>
}> {
  const query = new URLSearchParams()
  query.set('providerKey', params.providerKey ?? 'mock_carrier')
  if (params.shipmentId) query.set('shipmentId', params.shipmentId)
  if (params.trackingNumber) query.set('trackingNumber', params.trackingNumber)

  const response = await apiRequest(request, 'GET', `/api/shipping-carriers/tracking?${query.toString()}`, {
    token,
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to get tracking: ${response.status()} ${body}`)
  }
  return response.json()
}

export async function cancelShipment(
  request: APIRequestContext,
  token: string,
  shipmentId: string,
  overrides?: {
    providerKey?: string
    reason?: string
  },
): Promise<{ status: string }> {
  const response = await apiRequest(request, 'POST', '/api/shipping-carriers/cancel', {
    token,
    data: {
      providerKey: overrides?.providerKey ?? 'mock_carrier',
      shipmentId,
      reason: overrides?.reason,
    },
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to cancel shipment: ${response.status()} ${body}`)
  }
  return response.json()
}

export async function sendWebhook(
  request: APIRequestContext,
  providerKey: string,
  payload: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  const response = await request.post(
    `${process.env.BASE_URL?.trim() || 'http://localhost:3000'}/api/shipping-carriers/webhook/${providerKey}`,
    {
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      data: payload,
    },
  )
  return response
}
