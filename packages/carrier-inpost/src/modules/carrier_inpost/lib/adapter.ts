import type { ShippingAdapter, UnifiedShipmentStatus } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'

const statusMap: Record<string, UnifiedShipmentStatus> = {
  created: 'label_created',
  collected: 'picked_up',
  transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  failed: 'failed_delivery',
  returned: 'returned',
  cancelled: 'cancelled',
}

const trackingStore = new Map<string, {
  trackingNumber: string
  status: UnifiedShipmentStatus
  events: Array<{ status: UnifiedShipmentStatus; occurredAt: string; location?: string }>
}>()

export const inpostAdapter: ShippingAdapter = {
  providerKey: 'inpost',

  async calculateRates() {
    return [
      {
        serviceCode: 'locker_standard',
        serviceName: 'InPost Locker Standard',
        amount: 12.5,
        currencyCode: 'PLN',
        estimatedDays: 1,
      },
    ]
  },

  async createShipment(input) {
    const carrierShipmentId = `inp_shp_${crypto.randomUUID().slice(0, 10)}`
    const trackingNumber = `INP${Math.floor(Math.random() * 1_000_000_000)}`
    trackingStore.set(carrierShipmentId, {
      trackingNumber,
      status: 'label_created',
      events: [{ status: 'label_created', occurredAt: new Date().toISOString(), location: input.origin.city }],
    })
    return {
      shipmentId: carrierShipmentId,
      trackingNumber,
      labelUrl: `https://inpost.example/labels/${carrierShipmentId}.pdf`,
    }
  },

  async getTracking(input) {
    const key = input.shipmentId ?? ''
    const existing = trackingStore.get(key)
    if (!existing) {
      return {
        trackingNumber: input.trackingNumber ?? 'UNKNOWN',
        status: 'unknown',
        events: [],
      }
    }
    return {
      trackingNumber: existing.trackingNumber,
      status: existing.status,
      events: existing.events,
    }
  },

  async cancelShipment(input) {
    const existing = trackingStore.get(input.shipmentId)
    if (existing) {
      existing.status = 'cancelled'
      existing.events.push({ status: 'cancelled', occurredAt: new Date().toISOString() })
    }
    return { status: 'cancelled' }
  },

  async verifyWebhook(input) {
    const raw = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf-8')
    const body = JSON.parse(raw) as Record<string, unknown>
    return {
      eventType: typeof body.type === 'string' ? body.type : 'inpost.status.changed',
      eventId: typeof body.id === 'string' ? body.id : crypto.randomUUID(),
      idempotencyKey: typeof body.id === 'string' ? body.id : crypto.randomUUID(),
      data: body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {},
      timestamp: new Date(),
    }
  },

  mapStatus(carrierStatus: string): UnifiedShipmentStatus {
    return statusMap[carrierStatus] ?? 'unknown'
  },
}
