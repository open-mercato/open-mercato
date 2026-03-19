import type {
  ShippingAdapter,
  Address,
  PackageInfo,
  ShippingRate,
  CreateShipmentInput,
  CreateShipmentResult,
  TrackingResult,
  ShippingWebhookEvent,
  UnifiedShipmentStatus,
} from '@open-mercato/core/modules/shipping_carriers/lib/adapter'

type StoredShipment = {
  shipmentId: string
  trackingNumber: string
  status: UnifiedShipmentStatus
  origin: Address
  destination: Address
  packages: PackageInfo[]
  serviceCode: string
  events: Array<{ status: UnifiedShipmentStatus; occurredAt: string; location?: string }>
}

const shipmentStore = new Map<string, StoredShipment>()

export const mockShippingAdapter: ShippingAdapter = {
  providerKey: 'mock_carrier',

  async calculateRates(input: {
    origin: Address
    destination: Address
    packages: PackageInfo[]
    credentials: Record<string, unknown>
  }): Promise<ShippingRate[]> {
    const totalWeight = input.packages.reduce((sum, pkg) => sum + pkg.weightKg, 0)
    return [
      {
        serviceCode: 'standard',
        serviceName: 'Mock Standard Shipping',
        amount: 5.99 + totalWeight * 0.5,
        currencyCode: 'USD',
        estimatedDays: 5,
        guaranteedDelivery: false,
      },
      {
        serviceCode: 'express',
        serviceName: 'Mock Express Shipping',
        amount: 12.99 + totalWeight * 1.0,
        currencyCode: 'USD',
        estimatedDays: 2,
        guaranteedDelivery: true,
      },
    ]
  },

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const shipmentId = `mock_shp_${crypto.randomUUID().slice(0, 8)}`
    const trackingNumber = `MOCK${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`

    const now = new Date().toISOString()
    shipmentStore.set(shipmentId, {
      shipmentId,
      trackingNumber,
      status: 'label_created',
      origin: input.origin,
      destination: input.destination,
      packages: input.packages,
      serviceCode: input.serviceCode,
      events: [{ status: 'label_created', occurredAt: now, location: input.origin.city }],
    })

    const estimatedDelivery = new Date()
    estimatedDelivery.setDate(estimatedDelivery.getDate() + (input.serviceCode === 'express' ? 2 : 5))

    return {
      shipmentId,
      trackingNumber,
      labelUrl: `https://mock-carrier.test/labels/${shipmentId}.pdf`,
      estimatedDelivery,
    }
  },

  async getTracking(input: {
    shipmentId?: string
    trackingNumber?: string
    credentials: Record<string, unknown>
  }): Promise<TrackingResult> {
    const shipment = input.shipmentId
      ? shipmentStore.get(input.shipmentId)
      : Array.from(shipmentStore.values()).find((s) => s.trackingNumber === input.trackingNumber)

    if (!shipment) {
      throw new Error(`Mock shipment not found: ${input.shipmentId ?? input.trackingNumber}`)
    }

    return {
      trackingNumber: shipment.trackingNumber,
      status: shipment.status,
      events: shipment.events,
    }
  },

  async cancelShipment(input: {
    shipmentId: string
    reason?: string
    credentials: Record<string, unknown>
  }): Promise<{ status: UnifiedShipmentStatus }> {
    const shipment = shipmentStore.get(input.shipmentId)
    if (!shipment) {
      throw new Error(`Mock shipment not found: ${input.shipmentId}`)
    }

    shipment.status = 'cancelled'
    shipment.events.push({
      status: 'cancelled',
      occurredAt: new Date().toISOString(),
      location: shipment.origin.city,
    })

    return { status: 'cancelled' }
  },

  async verifyWebhook(input: {
    rawBody: string | Buffer
    headers: Record<string, string | string[] | undefined>
    credentials: Record<string, unknown>
  }): Promise<ShippingWebhookEvent> {
    const body = typeof input.rawBody === 'string'
      ? JSON.parse(input.rawBody)
      : JSON.parse(input.rawBody.toString('utf-8'))

    return {
      eventType: body.type ?? 'mock_carrier.event',
      eventId: body.id ?? crypto.randomUUID(),
      data: body.data ?? {},
      idempotencyKey: body.id ?? crypto.randomUUID(),
      timestamp: new Date(),
    }
  },

  mapStatus(carrierStatus: string): UnifiedShipmentStatus {
    const map: Record<string, UnifiedShipmentStatus> = {
      label_created: 'label_created',
      picked_up: 'picked_up',
      in_transit: 'in_transit',
      out_for_delivery: 'out_for_delivery',
      delivered: 'delivered',
      failed_delivery: 'failed_delivery',
      returned: 'returned',
      cancelled: 'cancelled',
    }
    return map[carrierStatus] ?? 'unknown'
  },
}
