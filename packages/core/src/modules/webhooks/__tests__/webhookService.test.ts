import { generateWebhookSecret, DEFAULT_RETRY_CONFIG, DEFAULT_TIMEOUT } from '../services/webhookService'
import {
  createWebhookSchema,
  updateWebhookSchema,
  webhookFilterSchema,
  httpConfigSchema,
  sqsConfigSchema,
  snsConfigSchema,
} from '../data/validators'

describe('webhooks - webhookService', () => {
  describe('generateWebhookSecret', () => {
    it('should generate a secret with whsec_ prefix', () => {
      const secret = generateWebhookSecret()
      expect(secret).toMatch(/^whsec_/)
    })

    it('should generate secrets of sufficient length', () => {
      const secret = generateWebhookSecret()
      // "whsec_" (6 chars) + 43 chars (32 bytes base64url)
      expect(secret.length).toBeGreaterThanOrEqual(49)
    })

    it('should generate unique secrets on each call', () => {
      const secret1 = generateWebhookSecret()
      const secret2 = generateWebhookSecret()
      expect(secret1).not.toBe(secret2)
    })
  })

  describe('DEFAULT_RETRY_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_RETRY_CONFIG).toEqual({
        maxRetries: 3,
        retryBackoff: 'exponential',
        retryDelay: 1000,
      })
    })
  })

  describe('DEFAULT_TIMEOUT', () => {
    it('should be 10000ms', () => {
      expect(DEFAULT_TIMEOUT).toBe(10000)
    })
  })
})

describe('webhooks - validators', () => {
  describe('httpConfigSchema', () => {
    it('should validate valid HTTP config', () => {
      const config = {
        url: 'https://example.com/webhook',
        method: 'POST',
        headers: { 'X-Custom': 'value' },
      }
      const result = httpConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
    })

    it('should reject invalid URL', () => {
      const config = {
        url: 'not-a-url',
      }
      const result = httpConfigSchema.safeParse(config)
      expect(result.success).toBe(false)
    })

    it('should allow optional method and headers', () => {
      const config = {
        url: 'https://example.com/webhook',
      }
      const result = httpConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
    })
  })

  describe('sqsConfigSchema', () => {
    it('should validate valid SQS config', () => {
      const config = {
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue',
        region: 'us-east-1',
      }
      const result = sqsConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
    })

    it('should reject missing region', () => {
      const config = {
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue',
      }
      const result = sqsConfigSchema.safeParse(config)
      expect(result.success).toBe(false)
    })
  })

  describe('snsConfigSchema', () => {
    it('should validate valid SNS config', () => {
      const config = {
        topicArn: 'arn:aws:sns:us-east-1:123456789:my-topic',
        region: 'us-east-1',
      }
      const result = snsConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
    })

    it('should reject invalid ARN format', () => {
      const config = {
        topicArn: 'invalid-arn',
        region: 'us-east-1',
      }
      const result = snsConfigSchema.safeParse(config)
      expect(result.success).toBe(false)
    })
  })

  describe('createWebhookSchema', () => {
    it('should validate a complete HTTP webhook', () => {
      const webhook = {
        name: 'Test Webhook',
        deliveryType: 'http',
        config: {
          url: 'https://example.com/webhook',
        },
        events: ['contact.created', 'contact.updated'],
      }
      const result = createWebhookSchema.safeParse(webhook)
      expect(result.success).toBe(true)
    })

    it('should reject webhook without events', () => {
      const webhook = {
        name: 'Test Webhook',
        deliveryType: 'http',
        config: {
          url: 'https://example.com/webhook',
        },
        events: [],
      }
      const result = createWebhookSchema.safeParse(webhook)
      expect(result.success).toBe(false)
    })

    it('should reject webhook with invalid event format', () => {
      const webhook = {
        name: 'Test Webhook',
        deliveryType: 'http',
        config: {
          url: 'https://example.com/webhook',
        },
        events: ['invalid-event-format'],
      }
      const result = createWebhookSchema.safeParse(webhook)
      expect(result.success).toBe(false)
    })

    it('should validate config based on deliveryType', () => {
      const webhook = {
        name: 'Test Webhook',
        deliveryType: 'http',
        config: {
          queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/queue', // SQS config, not HTTP
          region: 'us-east-1',
        },
        events: ['contact.created'],
      }
      const result = createWebhookSchema.safeParse(webhook)
      // Should fail because HTTP config requires 'url' field
      expect(result.success).toBe(false)
    })

    it('should apply default values', () => {
      const webhook = {
        name: 'Test Webhook',
        deliveryType: 'http',
        config: {
          url: 'https://example.com/webhook',
        },
        events: ['contact.created'],
      }
      const result = createWebhookSchema.safeParse(webhook)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.active).toBe(true)
        expect(result.data.timeout).toBe(10000)
        expect(result.data.retryConfig).toEqual({
          maxRetries: 3,
          retryBackoff: 'exponential',
          retryDelay: 1000,
        })
      }
    })
  })

  describe('updateWebhookSchema', () => {
    it('should allow partial updates', () => {
      const update = {
        name: 'Updated Name',
      }
      const result = updateWebhookSchema.safeParse(update)
      expect(result.success).toBe(true)
    })

    it('should validate config if both deliveryType and config are provided', () => {
      const update = {
        deliveryType: 'http' as const,
        config: {
          url: 'https://example.com/webhook',
        },
      }
      const result = updateWebhookSchema.safeParse(update)
      expect(result.success).toBe(true)
    })
  })

  describe('webhookFilterSchema', () => {
    it('should apply default pagination values', () => {
      const result = webhookFilterSchema.safeParse({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.page).toBe(1)
        expect(result.data.pageSize).toBe(50)
        expect(result.data.sortDir).toBe('desc')
      }
    })

    it('should parse active as boolean', () => {
      const result = webhookFilterSchema.safeParse({ active: 'true' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.active).toBe(true)
      }
    })

    it('should validate deliveryType filter', () => {
      const result = webhookFilterSchema.safeParse({ deliveryType: 'http' })
      expect(result.success).toBe(true)

      const invalidResult = webhookFilterSchema.safeParse({ deliveryType: 'invalid' })
      expect(invalidResult.success).toBe(false)
    })
  })
})
