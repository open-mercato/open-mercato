import { z } from 'zod'

const brandingSchema = z.object({
  logoUrl: z.string().trim().url().max(2000).optional().nullable(),
  brandName: z.string().trim().max(200).optional().nullable(),
  securitySubtitle: z.string().trim().max(200).optional().nullable(),
  accentColor: z.string().trim().regex(/^#([0-9a-fA-F]{3,8})$/).optional().nullable(),
  customCss: z.string().trim().max(10000).optional().nullable(),
}).strict().optional().nullable()

const customerCaptureSchema = z.object({
  enabled: z.boolean().default(false),
  companyRequired: z.boolean().optional().default(false),
  termsRequired: z.boolean().optional().default(false),
  termsMarkdown: z.string().trim().max(20000).optional().nullable(),
}).strict().optional().nullable()

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
