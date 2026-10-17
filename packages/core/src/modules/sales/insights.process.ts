import { defineProcessConfig, type ProcessFieldDescriptor } from '@open-mercato/shared/modules/insights/process'
import { E } from '#generated/entities.ids.generated'
import { SALES_RESOURCE_KIND_ORDER, SALES_RESOURCE_KIND_QUOTE } from './commands/shared'
import { SALES_STATUS_VALUE_REFERENCE_KINDS } from './lib/explain/statusValueResolvers'

export const SALES_ORDER_PROCESS_KEY = 'sales.order'
export const SALES_QUOTE_PROCESS_KEY = 'sales.quote'
export const SALES_QUOTE_CONVERT_COMMAND_ID = 'sales.quotes.convert_to_order'

type SalesDocumentRoot = 'order' | 'quote'

function documentStatusField(
  root: SalesDocumentRoot,
  key: 'status' | 'fulfillmentStatus' | 'paymentStatus',
  labelKey: string,
  referenceKind: string,
): ProcessFieldDescriptor {
  return {
    key,
    labelKey,
    valueKind: 'dictionary',
    snapshotPaths: [`${root}.${key}`],
    changeKeys: [key, `${root}.${key}`],
    referenceKind,
  }
}

function childStatusField(labelKey: string, referenceKind: string): ProcessFieldDescriptor {
  return {
    key: 'status',
    labelKey,
    valueKind: 'dictionary',
    snapshotPaths: ['status'],
    changeKeys: ['status'],
    referenceKind,
  }
}

/**
 * Process X-Ray: the order and quote lifecycles. Status values are the sales status
 * dictionary values (`order.status`, `quote.status`; the update command records them as
 * flat change keys, other writers as deep ones). Payments and shipments are milestones of
 * their order through the audit row's parent resource (`parent_resource_kind = sales.order`).
 * A quote converted to an order is logged once, on the order, with the quote as "before":
 * the order case starts there (`created` + its initial status) and the quote case ends with
 * the `converted` exit. Not observed, because those writers record no audit row of the
 * document: order status changes made as a side effect of payment/shipment commands (they
 * appear through the milestones instead) and quote status changes made by
 * `sales.quotes.send` / `sales.quotes.accept`. Status values are labelled in X-Ray through the
 * sales status value resolvers (`lib/explain/statusValueResolvers.ts`).
 */
export const processConfig = defineProcessConfig({
  version: 1,
  processes: [
    {
      processKey: SALES_ORDER_PROCESS_KEY,
      labelKey: 'sales.insights.process.order',
      resourceKind: SALES_RESOURCE_KIND_ORDER,
      logResourceKinds: [SALES_RESOURCE_KIND_ORDER],
      entityId: E.sales.sales_order,
      requiredFeatures: ['sales.orders.view'],
      stageFields: [
        documentStatusField('order', 'status', 'sales.insights.fields.status', SALES_STATUS_VALUE_REFERENCE_KINDS.orderStatus),
        documentStatusField('order', 'fulfillmentStatus', 'sales.insights.process.fields.fulfillmentStatus', SALES_STATUS_VALUE_REFERENCE_KINDS.fulfillmentStatus),
        documentStatusField('order', 'paymentStatus', 'sales.insights.process.fields.paymentStatus', SALES_STATUS_VALUE_REFERENCE_KINDS.paymentStatus),
      ],
      milestones: [
        {
          key: 'payment',
          labelKey: 'sales.insights.process.milestones.payment',
          resourceKind: 'sales.payment',
          logResourceKinds: ['sales.payment'],
          parentResourceKinds: [SALES_RESOURCE_KIND_ORDER],
          entityId: E.sales.sales_payment,
          lifecycle: ['created', 'deleted'],
          fields: [childStatusField('sales.insights.process.milestones.paymentStatus', SALES_STATUS_VALUE_REFERENCE_KINDS.paymentStatus)],
        },
        {
          key: 'shipment',
          labelKey: 'sales.insights.process.milestones.shipment',
          resourceKind: 'sales.shipment',
          logResourceKinds: ['sales.shipment'],
          parentResourceKinds: [SALES_RESOURCE_KIND_ORDER],
          entityId: E.sales.sales_shipment,
          lifecycle: ['created', 'deleted'],
          fields: [childStatusField('sales.insights.process.milestones.shipmentStatus', SALES_STATUS_VALUE_REFERENCE_KINDS.shipmentStatus)],
        },
      ],
      endStates: [{ field: 'status', values: ['fulfilled', 'canceled', 'rejected'] }],
    },
    {
      processKey: SALES_QUOTE_PROCESS_KEY,
      labelKey: 'sales.insights.process.quote',
      resourceKind: SALES_RESOURCE_KIND_QUOTE,
      logResourceKinds: [SALES_RESOURCE_KIND_QUOTE],
      entityId: E.sales.sales_quote,
      requiredFeatures: ['sales.quotes.view'],
      stageFields: [documentStatusField('quote', 'status', 'sales.insights.fields.status', SALES_STATUS_VALUE_REFERENCE_KINDS.quoteStatus)],
      exits: [
        {
          key: 'converted',
          labelKey: 'sales.insights.process.exits.converted',
          commandIds: [SALES_QUOTE_CONVERT_COMMAND_ID],
          logResourceKinds: [SALES_RESOURCE_KIND_ORDER],
          caseIdPaths: ['quote.id'],
        },
      ],
      endStates: [{ field: 'status', values: ['canceled', 'rejected'] }],
    },
  ],
})

export default processConfig
