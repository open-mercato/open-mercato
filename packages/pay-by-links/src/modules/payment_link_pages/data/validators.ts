import { z } from 'zod'

const brandingSchema = z.object({
  logoUrl: z.string().trim().max(2000).optional().nullable(),
  brandName: z.string().trim().max(200).optional().nullable(),
  securitySubtitle: z.string().trim().max(200).optional().nullable(),
  accentColor: z.string().trim().regex(/^#([0-9a-fA-F]{3,8})$/).optional().nullable(),
  customCss: z.string().trim().max(10000).optional().nullable(),
}).strict().optional().nullable()

export const customerHandlingModeSchema = z.enum(['no_customer', 'create_new', 'verify_and_merge']).default('no_customer')

export const customerCaptureFieldConfigSchema = z.object({
  visible: z.boolean().default(true),
  required: z.boolean().default(false),
})

const customerCaptureSchema = z.object({
  enabled: z.boolean().default(false),
  companyRequired: z.boolean().optional().default(false),
  termsRequired: z.boolean().optional().default(false),
  termsMarkdown: z.string().trim().max(20000).optional().nullable(),
  customerHandlingMode: customerHandlingModeSchema.optional(),
  fields: z.object({
    firstName: customerCaptureFieldConfigSchema.optional(),
    lastName: customerCaptureFieldConfigSchema.optional(),
    phone: customerCaptureFieldConfigSchema.optional(),
    companyName: customerCaptureFieldConfigSchema.optional(),
    address: z.object({
      visible: z.boolean().default(false),
      required: z.boolean().default(false),
      format: z.enum(['line_first', 'street_first']).default('line_first'),
    }).optional(),
  }).optional(),
}).optional().nullable()

export const templateCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
  branding: brandingSchema,
  defaultTitle: z.string().trim().max(160).optional().nullable(),
  defaultDescription: z.string().trim().max(500).optional().nullable(),
  customFields: z.record(z.string(), z.unknown()).optional().nullable(),
  customFieldsetCode: z.string().trim().max(100).optional().nullable(),
  customerCapture: customerCaptureSchema,
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
}).strict()

export const templateUpdateSchema = templateCreateSchema.partial().strict()

export const templateListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
}).passthrough()

export type TemplateCreateInput = z.infer<typeof templateCreateSchema>
export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>

// ── Payment Link Validators (moved from payment_gateways) ─────────────────

export const customerCaptureFieldsSchema = z.object({
  firstName: customerCaptureFieldConfigSchema.optional(),
  lastName: customerCaptureFieldConfigSchema.optional(),
  phone: customerCaptureFieldConfigSchema.optional(),
  companyName: customerCaptureFieldConfigSchema.optional(),
  address: z.object({
    visible: z.boolean().default(false),
    required: z.boolean().default(false),
    format: z.enum(['line_first', 'street_first']).default('line_first'),
  }).optional(),
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

export const paymentLinkInputSchema = z.object({
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
    customerHandlingMode: customerHandlingModeSchema.optional(),
    fields: customerCaptureFieldsSchema,
    customFormFields: customFormFieldsSchema,
  }).optional(),
})

export type PaymentLinkInput = z.infer<typeof paymentLinkInputSchema>
