import { generateDeliveryId } from '../services/triggerWebhooks'
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
        event: 'catalog.product.created',
        tenantId: 'tenant-123',
        data: {
          id: 'product-123',
          title: 'Test Product',
        },
      }
      expect(payload.event).toBe('catalog.product.created')
      expect(payload.tenantId).toBe('tenant-123')
      expect(payload.data).toBeDefined()
    })

    it('should accept all valid event types', () => {
      const events: Array<WebhookTriggerPayload['event']> = ['catalog.product.created', 'catalog.product.updated', 'catalog.product.deleted']
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
        type: 'catalog.product.created',
        timestamp: new Date().toISOString(),
        id: 'msg_abc123',
        tenantId: 'tenant-123',
        data: { object: { id: 'product-123' } },
      }
      expect(payload.type).toBe('catalog.product.created')
      expect(payload.id).toMatch(/^msg_/)
      expect(payload.data.object).toBeDefined()
    })

    it('should support previous object for update events', () => {
      const payload: WebhookDeliveryPayload<{ id: string; title: string }> = {
        type: 'catalog.product.updated',
        timestamp: new Date().toISOString(),
        id: 'msg_abc123',
        tenantId: 'tenant-123',
        data: {
          object: { id: 'product-123', title: 'Updated Product' },
          previous: { id: 'product-123', title: 'Original Product' },
        },
      }
      expect(payload.data.previous).toBeDefined()
      expect(payload.data.previous?.title).toBe('Original Product')
    })
  })

  describe('WebhookQueueJob structure', () => {
    it('should contain all required fields for worker', () => {
      const job: WebhookQueueJob = {
        webhookId: 'webhook-123',
        deliveryId: 'msg_abc123',
        event: 'catalog.product.created',
        tenantId: 'tenant-123',
        timestamp: Math.floor(Date.now() / 1000),
        payload: {
          type: 'catalog.product.created',
          timestamp: new Date().toISOString(),
          id: 'msg_abc123',
          tenantId: 'tenant-123',
          data: { object: { id: 'product-123' } },
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
        event: 'catalog.product.created',
        tenantId: 'tenant-123',
        timestamp: Math.floor(Date.now() / 1000),
        payload: {
          type: 'catalog.product.created',
          timestamp: new Date().toISOString(),
          id: 'msg_abc123',
          tenantId: 'tenant-123',
          data: { object: { id: 'product-123' } },
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
        event: 'catalog.product.created',
        tenantId: 'tenant-123',
        timestamp: Math.floor(Date.now() / 1000),
        payload: {
          type: 'catalog.product.created',
          timestamp: new Date().toISOString(),
          id: 'msg_abc123',
          tenantId: 'tenant-123',
          data: { object: { id: 'product-123' } },
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
