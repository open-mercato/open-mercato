import { z } from 'zod'

export const uuid = z.string().uuid()

export const baseScopeSchema = z.object({
  tenantId: uuid.nullish(),
  organizationId: uuid.nullish(),
  actorUserId: uuid.nullish(),
})

export const actionLogCreateSchema = baseScopeSchema.extend({
  commandId: z.string().min(1),
  actionLabel: z.string().min(1).optional(),
  resourceKind: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  executionState: z.enum(['done', 'undone', 'failed']).optional(),
  undoToken: z.string().min(1).optional(),
  commandPayload: z.unknown().optional(),
  snapshotBefore: z.unknown().optional(),
  snapshotAfter: z.unknown().optional(),
  changes: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
})

export const actionLogListSchema = z.object({
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
  actorUserId: uuid.optional(),
  undoableOnly: z.boolean().optional(),
  limit: z.number().int().positive().max(200).default(50),
  before: z.date().optional(),
  after: z.date().optional(),
})

export const accessLogCreateSchema = baseScopeSchema.extend({
  resourceKind: z.string().min(1),
  resourceId: z.string().min(1),
  accessType: z.string().min(1),
  fields: z.array(z.string().min(1)).optional(),
  context: z.record(z.unknown()).optional(),
})

export const accessLogListSchema = z.object({
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
  actorUserId: uuid.optional(),
  resourceKind: z.string().optional(),
  accessType: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
  before: z.date().optional(),
  after: z.date().optional(),
})

export type ActionLogCreateInput = z.infer<typeof actionLogCreateSchema>
export type ActionLogListQuery = z.infer<typeof actionLogListSchema>
export type AccessLogCreateInput = z.infer<typeof accessLogCreateSchema>
export type AccessLogListQuery = z.infer<typeof accessLogListSchema>
