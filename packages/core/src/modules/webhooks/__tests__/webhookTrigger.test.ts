import { generateDeliveryId } from '../subscribers/webhook-trigger'
import type { WebhookTriggerPayload, WebhookQueueJob, WebhookDeliveryPayload } from '../data/types'

describe('webhooks - trigger', () => {
  describe('generateDeliveryId', () => {
    it('should generate an ID with msg_ prefix', () => {
      const id = generateDeliveryId()
      expect(id).toMatch(/^msg_/)
    })

    it('should generate unique IDs on each call', () => {
      const id1 = generateDeliveryId()
      const id2 = generateDeliveryId()
      expect(id1).not.toBe(id2)
    })

    it('should generate IDs of consistent length', () => {
      const id = generateDeliveryId()
      // "msg_" (4 chars) + 22 chars (16 bytes base64url)
      expect(id.length).toBeGreaterThanOrEqual(26)
    })

    it('should generate URL-safe IDs', () => {
      const id = generateDeliveryId()
      // base64url should not contain + or /
      expect(id).not.toMatch(/[+/=]/)
    })
  })

  describe('WebhookTriggerPayload', () => {
    it('should accept valid payload', () => {
      const payload: WebhookTriggerPayload = {
        event: 'deal.created',
        tenantId: 'tenant-123',
        data: {
          id: 'deal-123',
          status: 'open',
        },
      }
      expect(payload.event).toBe('deal.created')
      expect(payload.tenantId).toBe('tenant-123')
      expect(payload.data).toBeDefined()
    })

    it('should accept all valid event types', () => {
      const events: Array<WebhookTriggerPayload['event']> = ['deal.created', 'deal.updated', 'deal.deleted']
      events.forEach(event => {
        const payload: WebhookTriggerPayload = {
          event,
          tenantId: 'tenant-123',
          data: {},
        }
        expect(payload.event).toBe(event)
      })
    })
  })

  describe('WebhookDeliveryPayload', () => {
    it('should have correct structure', () => {
      const payload: WebhookDeliveryPayload = {
        type: 'deal.created',
        timestamp: new Date().toISOString(),
        id: 'msg_abc123',
        tenantId: 'tenant-123',
        data: { object: { id: 'deal-123' } },
      }
      expect(payload.type).toBe('deal.created')
      expect(payload.id).toMatch(/^msg_/)
      expect(payload.data.object).toBeDefined()
    })

    it('should support previous object for update events', () => {
      const payload: WebhookDeliveryPayload<{ id: string; status: string }> = {
        type: 'deal.updated',
        timestamp: new Date().toISOString(),
        id: 'msg_abc123',
        tenantId: 'tenant-123',
        data: {
          object: { id: 'deal-123', status: 'won' },
          previous: { id: 'deal-123', status: 'open' },
        },
      }
      expect(payload.data.previous).toBeDefined()
      expect(payload.data.previous?.status).toBe('open')
    })
  })

  describe('WebhookQueueJob structure', () => {
    it('should contain all required fields for worker', () => {
      const job: WebhookQueueJob = {
        webhookId: 'webhook-123',
        deliveryId: 'msg_abc123',
        event: 'deal.created',
        tenantId: 'tenant-123',
        timestamp: Math.floor(Date.now() / 1000),
        payload: {
          type: 'deal.created',
          timestamp: new Date().toISOString(),
          id: 'msg_abc123',
          tenantId: 'tenant-123',
          data: { object: { id: 'deal-123' } },
        },
        webhook: {
          deliveryType: 'http',
          config: { url: 'https://example.com/webhook' },
          secret: 'whsec_test',
          retryConfig: { maxRetries: 3, retryBackoff: 'exponential', retryDelay: 1000 },
          timeout: 10000,
        },
      }

      expect(job.webhookId).toBeDefined()
      expect(job.deliveryId).toMatch(/^msg_/)
      expect(job.webhook.secret).toMatch(/^whsec_/)
      expect(job.webhook.deliveryType).toBe('http')
    })

    it('should support SQS delivery type', () => {
      const job: WebhookQueueJob = {
        webhookId: 'webhook-123',
        deliveryId: 'msg_abc123',
        event: 'deal.created',
        tenantId: 'tenant-123',
        timestamp: Math.floor(Date.now() / 1000),
        payload: {
          type: 'deal.created',
          timestamp: new Date().toISOString(),
          id: 'msg_abc123',
          tenantId: 'tenant-123',
          data: { object: { id: 'deal-123' } },
        },
        webhook: {
          deliveryType: 'sqs',
          config: { queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/queue', region: 'us-east-1' },
          secret: 'whsec_test',
          retryConfig: { maxRetries: 3, retryBackoff: 'exponential', retryDelay: 1000 },
          timeout: 10000,
        },
      }

      expect(job.webhook.deliveryType).toBe('sqs')
    })

    it('should support SNS delivery type', () => {
      const job: WebhookQueueJob = {
        webhookId: 'webhook-123',
        deliveryId: 'msg_abc123',
        event: 'deal.created',
        tenantId: 'tenant-123',
        timestamp: Math.floor(Date.now() / 1000),
        payload: {
          type: 'deal.created',
          timestamp: new Date().toISOString(),
          id: 'msg_abc123',
          tenantId: 'tenant-123',
          data: { object: { id: 'deal-123' } },
        },
        webhook: {
          deliveryType: 'sns',
          config: { topicArn: 'arn:aws:sns:us-east-1:123:topic', region: 'us-east-1' },
          secret: 'whsec_test',
          retryConfig: { maxRetries: 3, retryBackoff: 'exponential', retryDelay: 1000 },
          timeout: 10000,
        },
      }

      expect(job.webhook.deliveryType).toBe('sns')
    })
  })
})
