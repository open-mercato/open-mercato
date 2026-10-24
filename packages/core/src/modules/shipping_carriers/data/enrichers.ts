import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CarrierShipment } from './entities'

type SalesShipmentRecord = Record<string, unknown> & { id?: string; orderId?: unknown; order_id?: unknown }

function readOrderId(record: SalesShipmentRecord): string | null {
  const orderId = record.orderId ?? record.order_id
  return typeof orderId === 'string' && orderId.length > 0 ? orderId : null
}

function toCarrierRef(shipment: CarrierShipment) {
  return {
    shipmentId: shipment.id,
    providerKey: shipment.providerKey,
    trackingNumber: shipment.trackingNumber,
    status: shipment.unifiedStatus,
  }
}

export const salesShipmentCarrierEnricher: ResponseEnricher<SalesShipmentRecord, Record<string, unknown>> = {
  id: 'shipping_carriers.sales-shipment-carrier',
  targetEntity: 'sales.shipment',
  priority: 40,
  timeout: 2000,
  async enrichOne(record, context) {
    const orderId = readOrderId(record)
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
    return { ...record, _carrier: toCarrierRef(shipment) }
  },
  async enrichMany(records, context) {
    const orderIds = Array.from(new Set(
      records
        .map(readOrderId)
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
      const orderId = readOrderId(record)
      if (!orderId) return record
      const shipment = latestByOrderId.get(orderId)
      if (!shipment) return record
      return { ...record, _carrier: toCarrierRef(shipment) }
    })
  },
}

export const enrichers: ResponseEnricher[] = [salesShipmentCarrierEnricher]
