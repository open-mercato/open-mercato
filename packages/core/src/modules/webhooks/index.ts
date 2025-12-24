import type { ModuleInfo } from '@/modules/registry'

export const metadata: ModuleInfo = {
  name: 'webhooks',
  title: 'Webhooks',
  version: '0.1.0',
  description: 'Configure webhook endpoints for event delivery.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  requires: ['auth'],
}

export { features } from './acl'

// Export entities
export { Webhook, WebhookDelivery } from './data/entities'
export type {
  WebhookDeliveryType,
  WebhookDeliveryStatus,
  RetryBackoff,
  WebhookRetryConfig,
  HttpWebhookConfig,
  SqsWebhookConfig,
  SnsWebhookConfig,
  WebhookConfig,
} from './data/entities'

// Export types
export type {
  WebhookEventType,
  WebhookTriggerPayload,
  WebhookDeliveryPayload,
  WebhookQueueJob,
} from './data/types'

// Export services
export { getWebhookQueue } from './services/webhookQueue'
export { generateDeliveryId, triggerWebhooksForEvent } from './services/triggerWebhooks'

// Export DI registration
export { register } from './di'
