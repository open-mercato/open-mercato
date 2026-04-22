import { z } from 'zod'

export const webhookCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional().nullable(),
  url: z.string().url(),
  subscribedEvents: z.array(z.string().min(1)).min(1),
  httpMethod: z.enum(['POST', 'PUT', 'PATCH'] as const).default('POST'),
  customHeaders: z.record(z.string(), z.string()).optional().nullable(),
  deliveryStrategy: z.literal('http').default('http'),
  strategyConfig: z.record(z.string(), z.unknown()).optional().nullable(),
  maxRetries: z.number().int().min(0).max(30).default(10),
  timeoutMs: z.number().int().min(1000).max(60000).default(15000),
  rateLimitPerMinute: z.number().int().min(0).max(10000).default(0),
  autoDisableThreshold: z.number().int().min(0).max(1000).default(100),
  integrationId: z.string().optional().nullable(),
})

export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>

export const webhookUpdateSchema = webhookCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
})

export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>

export const webhookListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
  isActive: z.string().optional(),
})

export const webhookDeliveryQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  webhookId: z.string().uuid().optional(),
  eventType: z.string().optional(),
  status: z.enum(['pending', 'sending', 'delivered', 'failed', 'expired'] as const).optional(),
})
