import { z } from 'zod'

/**
 * Webhooks Module - Zod Validators
 */

// Delivery type enum
export const webhookDeliveryTypeSchema = z.enum(['http', 'sqs', 'sns'])
export type WebhookDeliveryType = z.infer<typeof webhookDeliveryTypeSchema>

// Retry backoff enum
export const retryBackoffSchema = z.enum(['linear', 'exponential'])
export type RetryBackoff = z.infer<typeof retryBackoffSchema>

// Retry config schema
export const retryConfigSchema = z.object({
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryBackoff: retryBackoffSchema.default('exponential'),
  retryDelay: z.number().int().min(1000).max(3600000).default(1000), // 1s to 1h
})
export type WebhookRetryConfig = z.infer<typeof retryConfigSchema>

// HTTP delivery config schema
export const httpConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['POST', 'PUT']).optional().default('POST'),
  headers: z.record(z.string(), z.string()).optional(),
})
export type HttpWebhookConfig = z.infer<typeof httpConfigSchema>

// SQS delivery config schema
export const sqsConfigSchema = z.object({
  queueUrl: z.string().url(),
  region: z.string().min(1),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  messageGroupId: z.string().optional(),
})
export type SqsWebhookConfig = z.infer<typeof sqsConfigSchema>

// SNS delivery config schema
export const snsConfigSchema = z.object({
  topicArn: z.string().regex(/^arn:aws:sns:[a-z0-9-]+:\d+:.+$/, 'Invalid SNS topic ARN format'),
  region: z.string().min(1),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
})
export type SnsWebhookConfig = z.infer<typeof snsConfigSchema>

// Event type validation (format: entity.action)
export const webhookEventSchema = z.string().regex(
  /^[a-z_]+\.[a-z_]+$/,
  'Event must be in format: entity.action (e.g., contact.created)'
)

// Base webhook fields (shared between create and update)
const webhookBaseSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  deliveryType: webhookDeliveryTypeSchema,
  config: z.record(z.string(), z.any()),
  events: z.array(webhookEventSchema).min(1),
  active: z.boolean().optional().default(true),
  retryConfig: retryConfigSchema.optional().default({
    maxRetries: 3,
    retryBackoff: 'exponential',
    retryDelay: 1000,
  }),
  timeout: z.number().int().min(1000).max(60000).optional().default(10000),
})

// Create webhook schema with config validation
export const createWebhookSchema = webhookBaseSchema.superRefine((data, ctx) => {
  // Validate config based on deliveryType
  const configSchemas: Record<string, z.ZodType<any>> = {
    http: httpConfigSchema,
    sqs: sqsConfigSchema,
    sns: snsConfigSchema,
  }

  const schema = configSchemas[data.deliveryType]
  if (schema) {
    const result = schema.safeParse(data.config)
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', ...issue.path],
          message: issue.message,
        })
      })
    }
  }
})

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>

// Update webhook schema - id required, other fields optional
export const updateWebhookSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
    deliveryType: webhookDeliveryTypeSchema.optional(),
    config: z.record(z.string(), z.any()).optional(),
    events: z.array(webhookEventSchema).min(1).optional(),
    active: z.boolean().optional(),
    retryConfig: retryConfigSchema.optional(),
    timeout: z.number().int().min(1000).max(60000).optional(),
  })
  .superRefine((data, ctx) => {
    // Only validate config if both deliveryType and config are provided
    if (data.deliveryType && data.config) {
      const configSchemas: Record<string, z.ZodType<any>> = {
        http: httpConfigSchema,
        sqs: sqsConfigSchema,
        sns: snsConfigSchema,
      }

      const schema = configSchemas[data.deliveryType]
      if (schema) {
        const result = schema.safeParse(data.config)
        if (!result.success) {
          result.error.issues.forEach((issue) => {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['config', ...issue.path],
              message: issue.message,
            })
          })
        }
      }
    }
  })

export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>

// Query/Filter schema for listing webhooks
export const webhookFilterSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  id: z.string().uuid().optional(),
  search: z.string().optional(),
  deliveryType: webhookDeliveryTypeSchema.optional(),
  active: z
    .string()
    .optional()
    .transform((val) => {
      if (val === 'true') return true
      if (val === 'false') return false
      return undefined
    }),
  // Note: event filter removed - QueryEngine doesn't support $contains for array fields
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})

export type WebhookFilter = z.infer<typeof webhookFilterSchema>
