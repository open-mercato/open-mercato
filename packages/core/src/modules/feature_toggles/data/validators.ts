import { z } from 'zod'

export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/

export const toggleTypeSchema = z.enum(['boolean', 'string', 'number', 'json'])

export const toggleCreateSchema = z.object({
  identifier: z.string().min(1).regex(
    IDENTIFIER_PATTERN,
    'identifier must start with a lowercase letter and contain only lowercase letters, numbers, and underscores',
  ),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),

  type: toggleTypeSchema,
  defaultValue: z.any().nullable().optional(),
})

export const toggleCreateSchemaList = z.array(toggleCreateSchema)

export const toggleUpdateSchema = z
  .object({
    id: z.string().uuid(),
  })
  .merge(toggleCreateSchema.partial())

export const changeOverrideStateBaseSchema = z.object({
  toggleId: z.string().uuid(),
  isOverride: z.boolean(),
  overrideValue: z.any().optional(),
})


export const processedChangeOverrideStateSchema = changeOverrideStateBaseSchema.extend({
  tenantId: z.string().uuid(),
})

export const featureToggleOverrideResponseSchema = z.object({
  id: z.string().uuid(),
  value: z.any().optional(),
  tenantName: z.string(),
  tenantId: z.string().uuid(),
  toggleType: toggleTypeSchema,
})

export type FeatureToggleOverrideResponse = z.infer<typeof featureToggleOverrideResponseSchema>

export const featureToggleOverrideWithValueSchema = featureToggleOverrideResponseSchema
export type FeatureToggleOverrideWithValue = FeatureToggleOverrideResponse

export const getToggleOverrideQuerySchema = z.object({
  toggleId: z.string().uuid(),
  tenantId: z.string().uuid().optional(),
})

export const overrideListQuerySchema = z
  .object({
    category: z.string().optional(),
    name: z.string().optional(),
    identifier: z.string().optional(),
    sortField: z.enum(['identifier', 'name', 'category']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().min(1).optional().default(1),
    pageSize: z.coerce.number().min(1).max(100).optional().default(25),
  })
  .passthrough()

export const featureToggleSchema = z.object({
  id: z.string().uuid().optional(),
  identifier: z.string().min(1).regex(
    IDENTIFIER_PATTERN,
    'identifier must start with a lowercase letter and contain only lowercase letters, numbers, and underscores',
  ),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),

  type: z.enum(['boolean', 'string', 'number', 'json']),
  defaultValue: z.any().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const overrideListResponseSchema = z.object({
  id: z.string().uuid(),
  toggleId: z.string().uuid(),
  tenantName: z.string(),
  tenantId: z.string().uuid(),
  identifier: z.string(),
  name: z.string(),
  category: z.string(),
  isOverride: z.boolean(),
});

export type OverrideListResponse = z.infer<typeof overrideListResponseSchema>

export type ToggleCreateInput = z.infer<typeof toggleCreateSchema>
export type ToggleUpdateInput = z.infer<typeof toggleUpdateSchema>
export type ChangeOverrideStateBaseInput = z.infer<typeof changeOverrideStateBaseSchema>
export type ProcessedChangeOverrideStateInput = z.infer<typeof processedChangeOverrideStateSchema>
export type GetToggleOverrideQuery = z.infer<typeof getToggleOverrideQuerySchema>
export type GetOverridesQuery = z.infer<typeof overrideListQuerySchema>
export type FeatureToggle = z.infer<typeof featureToggleSchema>
