import { z } from 'zod'

export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/

export const toggleCreateSchema = z.object({
  identifier: z.string().min(1).regex(
    IDENTIFIER_PATTERN,
    'identifier must start with a lowercase letter and contain only lowercase letters, numbers, and underscores',
  ),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  defaultState: z.boolean().default(false),
  failMode: z.enum(['fail_open', 'fail_closed']).default('fail_closed'),
})

export const toggleCreateSchemaList = z.array(toggleCreateSchema)

export const toggleUpdateSchema = z
  .object({
    id: z.string().uuid(),
  })
  .merge(toggleCreateSchema.partial())

export const changeOverrideStateBaseSchema = z.object({
  toggleId: z.string().uuid(),
  state: z.enum(['enabled', 'disabled', 'inherit']),
})


export const processedChangeOverrideStateSchema = changeOverrideStateBaseSchema.extend({
  tenantId: z.string().uuid(),
})

export const getToggleOverrideQuerySchema = z.object({
  toggleId: z.string().uuid(),
  tenantId: z.string().uuid().optional(),
  state: z.enum(['enabled', 'disabled', 'inherit']).optional(),
})

export const overrideListQuerySchema = z
  .object({
    category: z.string().optional(),
    name: z.string().optional(),
    identifier: z.string().optional(),
    defaultState: z.enum(['enabled', 'disabled']).optional(),
    overrideState: z.enum(['enabled', 'disabled', 'inherit']).optional(),
    sortField: z.enum(['identifier', 'name', 'category', 'defaultState', 'overrideState']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().min(1).optional().default(1),
    pageSize: z.coerce.number().min(1).max(100).optional().default(25),
  })
  .passthrough()

export type ToggleCreateInput = z.infer<typeof toggleCreateSchema>
export type ToggleUpdateInput = z.infer<typeof toggleUpdateSchema>
export type ChangeOverrideStateBaseInput = z.infer<typeof changeOverrideStateBaseSchema>
export type ProcessedChangeOverrideStateInput = z.infer<typeof processedChangeOverrideStateSchema>
export type GetToggleOverrideQuery = z.infer<typeof getToggleOverrideQuerySchema>
