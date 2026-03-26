import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CredentialsService } from '../../integrations/lib/credentials-service'
import { CarrierShipment } from '../data/entities'
import { emitShippingEvent } from '../events'
import { getShippingAdapter } from './adapter-registry'
import type { UnifiedShipmentStatus } from './adapter'
import { isValidShippingTransition, ShipmentCancelNotAllowedError } from './status-sync'

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
      receiverPhone?: string
      receiverEmail?: string
      organizationId: string
      tenantId: string
    }) {
      const { adapter, credentials } = await resolveAdapter(input.providerKey, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      })
      const mergedCredentials = {
        ...credentials,
        ...(input.receiverPhone !== undefined ? { receiverPhone: input.receiverPhone } : {}),
        ...(input.receiverEmail !== undefined ? { receiverEmail: input.receiverEmail } : {}),
      }
      return adapter.calculateRates({
        origin: input.origin,
        destination: input.destination,
        packages: input.packages,
        credentials: mergedCredentials,
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
      senderPhone?: string
      senderEmail?: string
      receiverPhone?: string
      receiverEmail?: string
      targetPoint?: string
      c2cSendingMethod?: string
      organizationId: string
      tenantId: string
    }) {
      const { adapter, credentials } = await resolveAdapter(input.providerKey, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      })
      const mergedCredentials = {
        ...credentials,
        ...(input.senderPhone !== undefined ? { senderPhone: input.senderPhone } : {}),
        ...(input.senderEmail !== undefined ? { senderEmail: input.senderEmail } : {}),
        ...(input.receiverPhone !== undefined ? { receiverPhone: input.receiverPhone } : {}),
        ...(input.receiverEmail !== undefined ? { receiverEmail: input.receiverEmail } : {}),
        ...(input.targetPoint !== undefined ? { targetPoint: input.targetPoint } : {}),
        ...(input.c2cSendingMethod !== undefined ? { c2cSendingMethod: input.c2cSendingMethod } : {}),
      }
      const created = await adapter.createShipment({
        orderId: input.orderId,
        origin: input.origin,
        destination: input.destination,
        packages: input.packages,
        serviceCode: input.serviceCode,
        credentials: mergedCredentials,
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
        trackingNumber: input.trackingNumber ?? shipment?.trackingNumber,
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
      if (!isValidShippingTransition(shipment.unifiedStatus as UnifiedShipmentStatus, 'cancelled')) {
        throw new ShipmentCancelNotAllowedError(shipment.unifiedStatus)
      }
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

    async searchDropOffPoints(input: {
      providerKey: string
      query?: string
      type?: string
      postCode?: string
      organizationId: string
      tenantId: string
    }) {
      const { adapter, credentials } = await resolveAdapter(input.providerKey, {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
      })
      if (!adapter.searchDropOffPoints) {
        throw new Error(`Provider ${input.providerKey} does not support drop-off point search`)
      }
      return adapter.searchDropOffPoints({
        query: input.query,
        type: input.type,
        postCode: input.postCode,
        credentials,
      })
    },
  }
}

export type ShippingCarrierService = ReturnType<typeof createShippingCarrierService>
