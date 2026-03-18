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

export const customerCaptureFieldConfigSchema = z.object({
  visible: z.boolean().default(true),
  required: z.boolean().default(false),
})

export const customerCaptureFieldsSchema = z.object({
  firstName: customerCaptureFieldConfigSchema.optional(),
  lastName: customerCaptureFieldConfigSchema.optional(),
  phone: customerCaptureFieldConfigSchema.optional(),
  companyName: customerCaptureFieldConfigSchema.optional(),
}).optional()

export const customFormFieldSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  type: z.enum(['text', 'textarea', 'select', 'checkbox']),
  required: z.boolean().default(false),
  placeholder: z.string().max(200).optional(),
  hint: z.string().max(500).optional(),
  options: z.array(z.object({
    label: z.string().min(1),
    value: z.string().min(1),
  })).optional(),
})

export const customFormFieldsSchema = z.array(customFormFieldSchema).max(20).optional()

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
  providerInput: z.record(z.string(), z.unknown()).optional(),
  paymentLink: z.object({
    enabled: z.boolean().default(false),
    linkMode: z.enum(['single', 'multi']).default('single').optional(),
    maxUses: z.number().int().positive().optional(),
    templateId: z.string().uuid().optional(),
    title: z.string().trim().max(160).optional(),
    description: z.string().trim().max(500).optional(),
    password: z.string().min(4).max(128).optional(),
    token: z.string().trim().min(3).max(80).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    customFieldsetCode: z.string().trim().max(100).optional(),
    customerCapture: z.object({
      enabled: z.boolean().default(false),
      companyRequired: z.boolean().default(false).optional(),
      termsRequired: z.boolean().default(false).optional(),
      termsMarkdown: z.string().trim().max(20000).optional(),
      fields: customerCaptureFieldsSchema,
      customFormFields: customFormFieldsSchema,
    }).optional(),
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

export const paymentLinkUnlockSchema = z.object({
  password: z.string().min(1).max(128),
})

export type PaymentLinkUnlockPayload = z.infer<typeof paymentLinkUnlockSchema>

export const listPaymentLinksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  providerKey: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
})

export type ListPaymentLinksQuery = z.infer<typeof listPaymentLinksQuerySchema>
