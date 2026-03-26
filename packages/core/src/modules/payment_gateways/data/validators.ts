import { z } from 'zod'

const unifiedPaymentStatusSchema = z.enum([
  'pending',
  'authorized',
  'captured',
  'partially_captured',
  'refunded',
  'partially_refunded',
  'cancelled',
  'failed',
  'expired',
  'unknown',
])

export const createSessionSchema = z.object({
  providerKey: z.string().min(1),
  paymentMethodId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  amount: z.number().positive(),
  currencyCode: z.string().min(3).max(3),
  captureMethod: z.enum(['automatic', 'manual']).default('automatic'),
  description: z.string().max(500).optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  presentation: z.object({
    mode: z.enum(['auto', 'embedded', 'redirect']).optional(),
    rendererKey: z.string().min(1).optional(),
    rendererSettings: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
})

export type CreateSessionPayload = z.infer<typeof createSessionSchema>

export const captureSchema = z.object({
  transactionId: z.string().uuid(),
  amount: z.number().positive().optional(),
})

export type CapturePayload = z.infer<typeof captureSchema>

export const refundSchema = z.object({
  transactionId: z.string().uuid(),
  amount: z.number().positive().optional(),
  reason: z.string().max(200).optional(),
})

export type RefundPayload = z.infer<typeof refundSchema>

export const cancelSchema = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().max(200).optional(),
})

export type CancelPayload = z.infer<typeof cancelSchema>

export const getStatusSchema = z.object({
  transactionId: z.string().uuid(),
})

export type GetStatusPayload = z.infer<typeof getStatusSchema>

export const listTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  providerKey: z.string().trim().min(1).max(100).optional(),
  status: unifiedPaymentStatusSchema.optional(),
})

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>
