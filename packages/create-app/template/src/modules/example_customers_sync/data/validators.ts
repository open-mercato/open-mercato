import { z } from 'zod'

export const mappingListQuerySchema = z.object({
  interactionId: z.string().uuid().optional(),
  todoId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
})

export const reconcileSchema = z.object({
  organizationId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
  cursor: z.string().optional(),
})

export type MappingListQuery = z.infer<typeof mappingListQuerySchema>
export type ReconcileInput = z.infer<typeof reconcileSchema>
