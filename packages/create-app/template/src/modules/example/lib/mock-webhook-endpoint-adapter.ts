import type { WebhookEndpointAdapter } from '@open-mercato/webhooks/modules/webhooks/lib/adapter-registry'

function parseJsonBody(body: string): Record<string, unknown> {
  const parsed = JSON.parse(body) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid mock webhook payload')
  }
  return parsed as Record<string, unknown>
}

export const mockWebhookEndpointAdapter: WebhookEndpointAdapter = {
  providerKey: 'mock_inbound',
  subscribedEvents: ['*'],
  async verifyWebhook(input) {
    if (input.headers['x-mock-webhook-signature'] !== 'valid') {
      throw new Error('Invalid mock webhook signature')
    }

    const payload = parseJsonBody(input.body)
    const eventType = typeof payload.type === 'string' && payload.type.trim().length > 0
      ? payload.type
      : 'mock.inbound.received'

    return {
      eventType,
      payload,
    }
  },
  async processInbound() {
    return
  },
}

export default mockWebhookEndpointAdapter
