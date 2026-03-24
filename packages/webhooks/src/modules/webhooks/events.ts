import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'webhooks.webhook.created', label: 'Webhook Created', entity: 'webhook', category: 'crud' as const },
  { id: 'webhooks.webhook.updated', label: 'Webhook Updated', entity: 'webhook', category: 'crud' as const },
  { id: 'webhooks.webhook.deleted', label: 'Webhook Deleted', entity: 'webhook', category: 'crud' as const },
  { id: 'webhooks.delivery.enqueued', label: 'Webhook Delivery Enqueued', entity: 'delivery', category: 'lifecycle' as const },
  { id: 'webhooks.delivery.succeeded', label: 'Webhook Delivery Succeeded', entity: 'delivery', category: 'lifecycle' as const, clientBroadcast: true },
  { id: 'webhooks.delivery.failed', label: 'Webhook Delivery Failed', entity: 'delivery', category: 'lifecycle' as const, clientBroadcast: true },
  { id: 'webhooks.delivery.exhausted', label: 'Webhook Delivery Retries Exhausted', entity: 'delivery', category: 'lifecycle' as const, clientBroadcast: true },
  { id: 'webhooks.webhook.disabled', label: 'Webhook Auto-Disabled', entity: 'webhook', category: 'lifecycle' as const, clientBroadcast: true },
  { id: 'webhooks.inbound.received', label: 'Inbound Webhook Received', entity: 'inbound', category: 'custom' as const },
  { id: 'webhooks.secret.rotated', label: 'Webhook Secret Rotated', entity: 'webhook', category: 'lifecycle' as const },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'webhooks', events })
export const emitWebhooksEvent = eventsConfig.emit
export type WebhooksEventId = typeof events[number]['id']
export default eventsConfig
