import { z } from 'zod'

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
