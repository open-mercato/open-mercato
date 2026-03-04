import { z } from 'zod'
import { registerIntegration } from '@open-mercato/shared/modules/integrations/types'
import { registerShippingProvider } from '@open-mercato/core/modules/sales/lib/providers/registry'
import type {
  ShippingAdapter,
  ShippingRate,
  UnifiedShipmentStatus,
} from '@open-mercato/core/modules/shipping_carriers/lib/adapter'
import { registerShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import { integration } from '../integration'

const inpostSettingsSchema = z.object({
  apiKey: z.string().trim().optional(),
  organizationId: z.string().trim().optional(),
})

function mapInpostStatus(status: string): UnifiedShipmentStatus {
  switch (status) {
    case 'created':
      return 'label_created'
    case 'picked_up':
      return 'picked_up'
    case 'in_transit':
      return 'in_transit'
    case 'out_for_delivery':
      return 'out_for_delivery'
    case 'delivered':
      return 'delivered'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'unknown'
  }
}

const inpostAdapter: ShippingAdapter = {
  providerKey: 'inpost',

  async calculateRates() {
    const rates: ShippingRate[] = [
      {
        serviceCode: 'locker_standard',
        serviceName: 'InPost Locker Standard',
        amount: 12.5,
        currencyCode: 'PLN',
        estimatedDays: 1,
      },
    ]
    return rates
  },

  async createShipment() {
    const timestamp = Date.now()
    return {
      shipmentId: `inpost-shp-${timestamp}`,
      trackingNumber: `INP${timestamp}`,
      status: 'label_created',
      labelUrl: `https://example.com/inpost/labels/${timestamp}.pdf`,
    }
  },

  async getTracking(input) {
    return {
      trackingNumber: input.trackingNumber,
      status: 'in_transit',
      events: [
        {
          status: 'picked_up',
          occurredAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          location: 'Warsaw',
        },
        {
          status: 'in_transit',
          occurredAt: new Date().toISOString(),
          location: 'Krakow Hub',
        },
      ],
    }
  },

  async cancelShipment() {
    return { status: 'cancelled' }
  },

  async verifyWebhook(input) {
    const data = JSON.parse(
      typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8'),
    ) as Record<string, unknown>

    return {
      eventType: typeof data.eventType === 'string' ? data.eventType : 'shipment.updated',
      eventId: typeof data.eventId === 'string' ? data.eventId : `evt-${Date.now()}`,
      shipmentId: typeof data.shipmentId === 'string' ? data.shipmentId : undefined,
      trackingNumber: typeof data.trackingNumber === 'string' ? data.trackingNumber : undefined,
      status: mapInpostStatus(typeof data.status === 'string' ? data.status : 'unknown'),
      payload: data,
    }
  },

  mapStatus: mapInpostStatus,
}

let initialized = false

export function registerCarrierInpostModule(): void {
  if (initialized) return
  initialized = true

  registerIntegration(integration)

  registerShippingProvider({
    key: 'inpost',
    label: 'InPost',
    description: 'InPost locker and courier services',
    settings: {
      fields: [
        { key: 'apiKey', label: 'API key', type: 'secret', required: false },
        { key: 'organizationId', label: 'Organization ID', type: 'text', required: false },
      ],
      schema: inpostSettingsSchema,
    },
    calculate: () => ({ adjustments: [] }),
  })

  registerShippingAdapter(inpostAdapter)
}

registerCarrierInpostModule()
