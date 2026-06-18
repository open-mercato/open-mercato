import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CredentialsService } from '../../integrations/lib/credentials-service'
import { CarrierShipment, type CarrierShipmentIdempotencyKey } from '../data/entities'
import { emitShippingEvent } from '../events'
import { getShippingAdapter } from './adapter-registry'
import type { UnifiedShipmentStatus } from './adapter'
import {
  claimShipmentIdempotency,
  computeShipmentRequestHash,
  findShipmentIdempotencyClaim,
  releaseShipmentIdempotency,
  resolveShipmentIdempotency,
  ShipmentIdempotencyConflictError,
} from './shipment-idempotency'
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
      idempotencyKey?: string
      organizationId: string
      tenantId: string
    }) {
      const scope = { organizationId: input.organizationId, tenantId: input.tenantId }
      let claim: CarrierShipmentIdempotencyKey | null = null
      if (input.idempotencyKey) {
        const { idempotencyKey: _idempotencyKey, ...fingerprint } = input
        const requestHash = computeShipmentRequestHash(fingerprint)
        const existing = await findShipmentIdempotencyClaim(em, input.idempotencyKey, input.providerKey, scope)
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ShipmentIdempotencyConflictError(input.idempotencyKey)
          }
          if (existing.shipmentId) {
            return findShipmentOrThrow(existing.shipmentId, scope)
          }
          // Claim exists but the original request has not resolved yet (concurrent in-flight).
          throw new ShipmentIdempotencyConflictError(input.idempotencyKey)
        }
        claim = await claimShipmentIdempotency(em, input.idempotencyKey, input.providerKey, requestHash, scope)
        if (!claim) {
          // Lost the claim race with a concurrent request creating the same shipment.
          throw new ShipmentIdempotencyConflictError(input.idempotencyKey)
        }
      }
      let carrierShipmentCreated = false
      try {
        const { adapter, credentials } = await resolveAdapter(input.providerKey, scope)
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
        carrierShipmentCreated = true
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
        await em.persist(shipment).flush()
        if (claim) {
          await resolveShipmentIdempotency(em, claim, shipment.id)
        }
        await emitShippingEvent('shipping_carriers.shipment.created', {
          shipmentId: shipment.id,
          orderId: input.orderId,
          providerKey: input.providerKey,
          trackingNumber: created.trackingNumber,
          organizationId: input.organizationId,
          tenantId: input.tenantId,
        })
        return shipment
      } catch (error: unknown) {
        // Release the claim only when the carrier was NOT successfully called, so a retry can
        // proceed. If the carrier already created the shipment, keep the claim so a retry does
        // not produce a duplicate upstream shipment.
        if (claim && !carrierShipmentCreated && input.idempotencyKey && !(error instanceof ShipmentIdempotencyConflictError)) {
          await releaseShipmentIdempotency(em, input.idempotencyKey, input.providerKey, scope).catch(() => {})
        }
        throw error
      }
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
