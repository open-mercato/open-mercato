import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'shipping_carriers.shipment.created', label: 'Shipment Created', category: 'lifecycle', entity: 'shipment' },
  { id: 'shipping_carriers.shipment.status_changed', label: 'Shipment Status Changed', category: 'lifecycle', entity: 'shipment' },
  { id: 'shipping_carriers.shipment.delivered', label: 'Shipment Delivered', category: 'lifecycle', entity: 'shipment' },
  { id: 'shipping_carriers.shipment.returned', label: 'Shipment Returned', category: 'lifecycle', entity: 'shipment' },
  { id: 'shipping_carriers.shipment.cancelled', label: 'Shipment Cancelled', category: 'lifecycle', entity: 'shipment' },
  { id: 'shipping_carriers.webhook.received', label: 'Shipping Webhook Received', category: 'system', excludeFromTriggers: true },
  { id: 'shipping_carriers.webhook.failed', label: 'Shipping Webhook Failed', category: 'system', excludeFromTriggers: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'shipping_carriers', events })
export const emitShippingEvent = eventsConfig.emit
export type ShippingEventId = typeof events[number]['id']
export default eventsConfig
