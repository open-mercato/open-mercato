import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CarrierShipment } from './entities'

type SalesShipmentRecord = Record<string, unknown> & { id?: string; shipmentId?: string; orderId?: string }

const salesShipmentCarrierEnricher: ResponseEnricher<SalesShipmentRecord, Record<string, unknown>> = {
  id: 'shipping_carriers.sales-shipment-carrier',
  targetEntity: 'sales.shipment',
  priority: 40,
  timeout: 2000,
  async enrichOne(record, context) {
    const em = context.em as EntityManager
    const orderId = typeof record.orderId === 'string' ? record.orderId : null
    if (!orderId) return record
    const shipment = await em.findOne(CarrierShipment, {
      orderId,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    }, { orderBy: { createdAt: 'desc' } })
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
}

export const enrichers: ResponseEnricher[] = [salesShipmentCarrierEnricher]
