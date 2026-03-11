import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CredentialsService } from '../../integrations/lib/credentials-service'
import { CarrierShipment } from '../data/entities'
import { emitShippingEvent } from '../events'
import { getShippingAdapter } from './adapter-registry'

export function createShippingCarrierService(deps: {
  em: EntityManager
  integrationCredentialsService: CredentialsService
}) {
  const { em, integrationCredentialsService } = deps

  async function findShipmentOrThrow(
    shipmentId: string,
    scope: { organizationId: string; tenantId: string },
  ): Promise<CarrierShipment> {
    const shipment = await findOneWithDecryption(
      em,
      CarrierShipment,
      {
        id: shipmentId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    if (!shipment) {
      throw new Error('Shipment not found')
    }
    return shipment
  }

  async function resolveAdapter(providerKey: string, scope: { organizationId: string; tenantId: string }) {
    const adapter = getShippingAdapter(providerKey)
    if (!adapter) throw new Error(`No shipping adapter registered for provider: ${providerKey}`)
    const credentials = await integrationCredentialsService.resolve(`carrier_${providerKey}`, scope) ?? {}
    return { adapter, credentials }
  }

  return {
    async calculateRates(input: {
      providerKey: string
      origin: { countryCode: string; postalCode: string; city: string; line1: string; line2?: string }
      destination: { countryCode: string; postalCode: string; city: string; line1: string; line2?: string }
      packages: Array<{ weightKg: number; lengthCm: number; widthCm: number; heightCm: number }>
      organizationId: string
      tenantId: string
    }) {
      const { adapter, credentials } = await resolveAdapter(input.providerKey, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      })
      return adapter.calculateRates({
        origin: input.origin,
        destination: input.destination,
        packages: input.packages,
        credentials,
      })
    },

    async createShipment(input: {
      providerKey: string
      orderId: string
      origin: { countryCode: string; postalCode: string; city: string; line1: string; line2?: string }
      destination: { countryCode: string; postalCode: string; city: string; line1: string; line2?: string }
      packages: Array<{ weightKg: number; lengthCm: number; widthCm: number; heightCm: number }>
      serviceCode: string
      labelFormat?: 'pdf' | 'zpl' | 'png'
      organizationId: string
      tenantId: string
    }) {
      const { adapter, credentials } = await resolveAdapter(input.providerKey, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      })
      const created = await adapter.createShipment({
        orderId: input.orderId,
        origin: input.origin,
        destination: input.destination,
        packages: input.packages,
        serviceCode: input.serviceCode,
        credentials,
        labelFormat: input.labelFormat,
      })
      const shipment = em.create(CarrierShipment, {
        orderId: input.orderId,
        providerKey: input.providerKey,
        carrierShipmentId: created.shipmentId,
        trackingNumber: created.trackingNumber,
        unifiedStatus: 'label_created',
        labelUrl: created.labelUrl ?? null,
        labelData: created.labelData ?? null,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      })
      await em.persistAndFlush(shipment)
      await emitShippingEvent('shipping_carriers.shipment.created', {
        shipmentId: shipment.id,
        orderId: input.orderId,
        providerKey: input.providerKey,
        trackingNumber: created.trackingNumber,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      })
      return shipment
    },

    async getTracking(input: {
      providerKey: string
      shipmentId?: string
      trackingNumber?: string
      organizationId: string
      tenantId: string
    }) {
      const { adapter, credentials } = await resolveAdapter(input.providerKey, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      })
      const shipment = input.shipmentId
        ? await findOneWithDecryption(
          em,
          CarrierShipment,
          {
            id: input.shipmentId,
            organizationId: input.organizationId,
            tenantId: input.tenantId,
            deletedAt: null,
          },
          undefined,
          {
            organizationId: input.organizationId,
            tenantId: input.tenantId,
          },
        )
        : null
      const tracking = await adapter.getTracking({
        shipmentId: shipment?.carrierShipmentId ?? input.shipmentId,
        trackingNumber: input.trackingNumber,
        credentials,
      })
      if (shipment) {
        shipment.unifiedStatus = tracking.status
        shipment.trackingEvents = tracking.events
        shipment.lastPolledAt = new Date()
        await em.flush()
      }
      return tracking
    },

    async cancelShipment(input: {
      providerKey: string
      shipmentId: string
      reason?: string
      organizationId: string
      tenantId: string
    }) {
      const scope = { organizationId: input.organizationId, tenantId: input.tenantId }
      const shipment = await findShipmentOrThrow(input.shipmentId, scope)
      const { adapter, credentials } = await resolveAdapter(input.providerKey, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      })
      const result = await adapter.cancelShipment({
        shipmentId: shipment.carrierShipmentId,
        reason: input.reason,
        credentials,
      })
      shipment.unifiedStatus = result.status
      await em.flush()
      await emitShippingEvent('shipping_carriers.shipment.cancelled', {
        shipmentId: shipment.id,
        providerKey: input.providerKey,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      })
      return result
    },

    async findShipmentByCarrierId(
      providerKey: string,
      carrierShipmentId: string,
      scope: { organizationId: string; tenantId: string },
    ) {
      return findOneWithDecryption(
        em,
        CarrierShipment,
        {
          providerKey,
          carrierShipmentId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
    },
  }
}

export type ShippingCarrierService = ReturnType<typeof createShippingCarrierService>
