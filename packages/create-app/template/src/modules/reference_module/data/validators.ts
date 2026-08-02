import { z } from 'zod'

export const referenceTaskStatuses = ['todo', 'in_progress', 'done'] as const
export const referenceTaskLinkTargetKinds = ['customer', 'catalog_product', 'sales_document'] as const

export const referenceScopeSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export const referenceTaskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).nullable().optional(),
  status: z.enum(referenceTaskStatuses).default('todo'),
  priority: z.number().int().min(0).max(5).default(0),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  isActive: z.boolean().default(true),
  customFields: z.record(z.string(), z.unknown()).optional(),
})

export const referenceTaskUpdateSchema = referenceTaskCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: '[internal] An update must contain at least one field' },
)

export const referenceTaskLinkCreateSchema = z.object({
  targetKind: z.enum(referenceTaskLinkTargetKinds),
  targetId: z.string().uuid(),
}).strict()

export const referenceTaskUndoPayloadSchema = z.object({
  operation: z.enum(['create', 'update', 'delete', 'restore', 'link_create', 'link_delete']),
  values: z.record(z.string(), z.unknown()),
}).strict()

export type ReferenceScope = z.infer<typeof referenceScopeSchema>
export type ReferenceTaskCreateInput = z.infer<typeof referenceTaskCreateSchema>
export type ReferenceTaskUpdateInput = z.infer<typeof referenceTaskUpdateSchema>
export type ReferenceTaskLinkCreateInput = z.infer<typeof referenceTaskLinkCreateSchema>
export type ReferenceTaskUndoPayload = z.infer<typeof referenceTaskUndoPayloadSchema>
