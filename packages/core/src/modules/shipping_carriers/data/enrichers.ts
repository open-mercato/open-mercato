import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CarrierShipment } from './entities'

type SalesShipmentRecord = Record<string, unknown> & { id?: string; shipmentId?: string; orderId?: string }

const salesShipmentCarrierEnricher: ResponseEnricher<SalesShipmentRecord, Record<string, unknown>> = {
  id: 'shipping_carriers.sales-shipment-carrier',
  targetEntity: 'sales.shipment',
  priority: 40,
  timeout: 2000,
  async enrichOne(record, context) {
    const orderId = typeof record.orderId === 'string' ? record.orderId : null
    if (!orderId) return record
    const em = context.em as EntityManager
    const scope = { organizationId: context.organizationId, tenantId: context.tenantId }
    const shipment = await findOneWithDecryption(
      em,
      CarrierShipment,
      {
        orderId,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        deletedAt: null,
      },
      { orderBy: { createdAt: 'desc' } },
      scope,
    )
    if (!shipment) return record
    return {
      ...record,
      _carrier: {
        shipmentId: shipment.id,
        providerKey: shipment.providerKey,
        trackingNumber: shipment.trackingNumber,
        status: shipment.unifiedStatus,
      },
    }
  },
  async enrichMany(records, context) {
    const orderIds = Array.from(new Set(
      records
        .map((record) => (typeof record.orderId === 'string' ? record.orderId : null))
        .filter((value): value is string => Boolean(value)),
    ))
    if (!orderIds.length) return records

    const em = context.em as EntityManager
    const scope = { organizationId: context.organizationId, tenantId: context.tenantId }
    const shipments = await findWithDecryption(
      em,
      CarrierShipment,
      {
        orderId: { $in: orderIds },
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        deletedAt: null,
      },
      { orderBy: { createdAt: 'desc' } },
      scope,
    )

    const latestByOrderId = new Map<string, CarrierShipment>()
    for (const shipment of shipments) {
      if (!latestByOrderId.has(shipment.orderId)) {
        latestByOrderId.set(shipment.orderId, shipment)
      }
    }

    return records.map((record) => {
      const orderId = typeof record.orderId === 'string' ? record.orderId : null
      if (!orderId) return record
      const shipment = latestByOrderId.get(orderId)
      if (!shipment) return record
      return {
        ...record,
        _carrier: {
          shipmentId: shipment.id,
          providerKey: shipment.providerKey,
          trackingNumber: shipment.trackingNumber,
          status: shipment.unifiedStatus,
        },
      }
    })
  },
}

export const enrichers: ResponseEnricher[] = [salesShipmentCarrierEnricher]
