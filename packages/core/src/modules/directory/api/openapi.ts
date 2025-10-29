import { z } from 'zod'

export const directoryTag = 'Directory'

export const directoryErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const directoryOkSchema = z.object({
  ok: z.literal(true),
})

export const directoryIdSchema = z.string().uuid()

export const tenantListItemSchema = z
  .object({
    id: directoryIdSchema,
    name: z.string(),
    isActive: z.boolean(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough()

export const tenantListResponseSchema = z.object({
  items: z.array(tenantListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(1),
})

export const organizationNodeSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      id: directoryIdSchema,
      name: z.string(),
      parentId: directoryIdSchema.nullable(),
      parentName: z.string().nullable().optional(),
      tenantId: directoryIdSchema.nullable(),
      rootId: directoryIdSchema.nullable().optional(),
      depth: z.number().int().nonnegative().optional(),
      treePath: z.string().nullable().optional(),
      pathLabel: z.string().optional(),
      ancestorIds: z.array(directoryIdSchema).optional(),
      childIds: z.array(directoryIdSchema).optional(),
      descendantIds: z.array(directoryIdSchema).optional(),
      childrenCount: z.number().int().nonnegative().optional(),
      descendantsCount: z.number().int().nonnegative().optional(),
      isActive: z.boolean().optional(),
      children: z.array(organizationNodeSchema).optional(),
    })
    .passthrough(),
)

export const organizationListResponseSchema = z.object({
  items: z.array(organizationNodeSchema),
  total: z.number().int().nonnegative().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).optional(),
  totalPages: z.number().int().min(1).optional(),
  error: z.string().optional(),
})

export const organizationSwitcherNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: directoryIdSchema,
    name: z.string(),
    depth: z.number().int().nonnegative(),
    selectable: z.boolean(),
    children: z.array(organizationSwitcherNodeSchema),
  }),
)

export const organizationSwitcherResponseSchema = z.object({
  items: z.array(organizationSwitcherNodeSchema),
  selectedId: directoryIdSchema.nullable(),
  canManage: z.boolean(),
})

