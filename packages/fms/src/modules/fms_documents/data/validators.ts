import { z } from 'zod'

export const documentCategorySchema = z.enum([
  'offer',
  'invoice',
  'customs',
  'bill_of_lading',
  'other',
])

const preprocessEmptyString = (val: unknown) => (val === '' ? null : val)

export const createDocumentSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1, 'Name is required').max(255),
  category: z
    .preprocess(
      (val) => (val === '' || val === null || val === undefined ? 'other' : val),
      documentCategorySchema
    )
    .default('other'),
  description: z.preprocess(preprocessEmptyString, z.string().max(1000).nullable().optional()),
  relatedEntityId: z.preprocess(preprocessEmptyString, z.string().uuid().nullable().optional()),
  relatedEntityType: z.preprocess(preprocessEmptyString, z.string().nullable().optional()),
  createdBy: z.preprocess(preprocessEmptyString, z.string().uuid().nullable().optional()),
})

export const updateDocumentSchema = createDocumentSchema
  .partial()
  .omit({ organizationId: true, tenantId: true, createdBy: true })
  .extend({
    updatedBy: z.preprocess(preprocessEmptyString, z.string().uuid().nullable().optional()),
  })

export const documentFilterSchema = z.object({
  category: documentCategorySchema.optional(),
  relatedEntityId: z.string().uuid().optional(),
  relatedEntityType: z.string().optional(),
  search: z.string().optional(),
  includeDeleted: z.coerce.boolean().optional(),
})

export const documentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(50),
  sortField: z.string().optional().default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
  category: documentCategorySchema.optional(),
  search: z.string().optional(),
  relatedEntityId: z.string().uuid().optional(),
  relatedEntityType: z.string().optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
})

export const uploadDocumentSchema = z.object({
  name: z.string().min(1).max(255),
  category: z
    .preprocess(
      (val) => (val === '' || val === null || val === undefined ? 'other' : val),
      documentCategorySchema
    )
    .default('other'),
  description: z.preprocess(preprocessEmptyString, z.string().max(1000).nullable().optional()),
  relatedEntityId: z.preprocess(preprocessEmptyString, z.string().uuid().nullable().optional()),
  relatedEntityType: z.preprocess(preprocessEmptyString, z.string().nullable().optional()),
})
