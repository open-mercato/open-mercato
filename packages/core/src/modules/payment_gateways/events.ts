import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'payment_gateways.session.created', label: 'Payment Session Created', category: 'lifecycle', entity: 'session' },
  { id: 'payment_gateways.session.expired', label: 'Payment Session Expired', category: 'lifecycle', entity: 'session' },
  { id: 'payment_gateways.payment.authorized', label: 'Payment Authorized', category: 'lifecycle', entity: 'payment' },
  { id: 'payment_gateways.payment.captured', label: 'Payment Captured', category: 'lifecycle', entity: 'payment' },
  { id: 'payment_gateways.payment.failed', label: 'Payment Failed', category: 'lifecycle', entity: 'payment' },
  { id: 'payment_gateways.payment.refunded', label: 'Payment Refunded', category: 'lifecycle', entity: 'payment' },
  { id: 'payment_gateways.payment.cancelled', label: 'Payment Cancelled', category: 'lifecycle', entity: 'payment' },
  { id: 'payment_gateways.webhook.received', label: 'Webhook Received', category: 'system', entity: 'webhook', excludeFromTriggers: true },
  { id: 'payment_gateways.webhook.failed', label: 'Webhook Processing Failed', category: 'system', entity: 'webhook', excludeFromTriggers: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'payment_gateways', events })
export const emitPaymentGatewayEvent = eventsConfig.emit
export default eventsConfig
