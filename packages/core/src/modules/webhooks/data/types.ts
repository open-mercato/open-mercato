import type { WebhookConfig, WebhookRetryConfig, WebhookDeliveryType } from './entities'

// Typed union of all available webhook events
export type WebhookEventType =
  | 'deal.created'
  | 'deal.updated'
  | 'deal.deleted'
// Add more events as needed

// Payload for 'webhooks.trigger' event bus event
export interface WebhookTriggerPayload<T = unknown> {
  event: WebhookEventType
  tenantId: string
  data: T
}

// Standard Webhooks delivery payload structure
export interface WebhookDeliveryPayload<T = unknown> {
  type: WebhookEventType
  timestamp: string // ISO 8601
  id: string // Delivery ID (msg_xxx)
  tenantId: string
  data: {
    object: T
    previous?: T // For update events
  }
}

// BullMQ job data structure
export interface WebhookQueueJob {
  webhookId: string
  deliveryId: string
  event: WebhookEventType
  tenantId: string
  timestamp: number
  payload: WebhookDeliveryPayload
  webhook: {
    deliveryType: WebhookDeliveryType
    config: WebhookConfig
    secret: string
    retryConfig: WebhookRetryConfig
    timeout: number
  }
}
