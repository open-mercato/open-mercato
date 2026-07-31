import { z } from 'zod'
import { assertStaticallySafeWebhookUrl, UnsafeWebhookUrlError } from '../lib/url-safety'
import { isReservedWebhookCustomHeader } from '../lib/custom-headers'

const safeWebhookUrl = z.string().url().superRefine((value, ctx) => {
  try {
    assertStaticallySafeWebhookUrl(value)
  } catch (error) {
    const message = error instanceof UnsafeWebhookUrlError
      ? error.message
      : 'Webhook URL is not allowed'
    ctx.addIssue({ code: z.ZodIssueCode.custom, message })
  }
})

const webhookCustomHeaders = z.record(z.string(), z.string()).superRefine((value, ctx) => {
  for (const name of Object.keys(value)) {
    if (isReservedWebhookCustomHeader(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Header "${name}" is reserved for webhook signing and cannot be overridden`,
        path: [name],
      })
    }
  }
})

export const webhookCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional().nullable(),
  url: safeWebhookUrl,
  subscribedEvents: z.array(z.string().min(1)).min(1),
  httpMethod: z.enum(['POST', 'PUT', 'PATCH'] as const).default('POST'),
  customHeaders: webhookCustomHeaders.optional().nullable(),
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
