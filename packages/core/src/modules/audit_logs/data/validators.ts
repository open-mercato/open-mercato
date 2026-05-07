import { z } from 'zod'

export const uuid = z.string().uuid()

export const baseScopeSchema = z.object({
  tenantId: uuid.nullish(),
  organizationId: uuid.nullish(),
  actorUserId: uuid.nullish(),
})

const recordLike = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.null(),
]).optional()

export const actionLogCreateSchema = baseScopeSchema.extend({
  commandId: z.string().min(1),
  actionLabel: z.string().min(1).optional(),
  resourceKind: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  parentResourceKind: z.string().min(1).optional().nullable(),
  parentResourceId: z.string().min(1).optional().nullable(),
  executionState: z.enum(['done', 'undone', 'failed']).optional(),
  undoToken: z.string().min(1).optional(),
  commandPayload: z.unknown().optional(),
  snapshotBefore: z.unknown().optional(),
  snapshotAfter: z.unknown().optional(),
  relatedResourceKind: z.string().min(1).optional().nullable(),
  relatedResourceId: z.string().min(1).optional().nullable(),
  changes: recordLike,
  context: recordLike,
})

export const actionLogListSchema = z.object({
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
  actorUserId: uuid.optional(),
  actorUserIds: z.array(uuid).optional(),
  undoableOnly: z.boolean().optional(),
  resourceKind: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  includeRelated: z.boolean().optional(),
  actionType: z.enum(['create', 'edit', 'delete', 'assign']).optional(),
  actionTypes: z.array(z.enum(['create', 'edit', 'delete', 'assign'])).optional(),
  fieldName: z.string().min(1).optional(),
  fieldNames: z.array(z.string().min(1)).optional(),
  sortField: z.enum(['createdAt', 'user', 'action', 'field', 'source']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().min(0).optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(200).default(50),
  before: z.date().optional(),
  after: z.date().optional(),
})

export const accessLogCreateSchema = baseScopeSchema.extend({
  resourceKind: z.string().min(1),
  resourceId: z.string().min(1),
  accessType: z.string().min(1),
  fields: z.array(z.string().min(1)).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
})

export const accessLogListSchema = z.object({
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
  actorUserId: uuid.optional(),
  resourceKind: z.string().optional(),
  accessType: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(200).default(50),
  before: z.date().optional(),
  after: z.date().optional(),
})

export type ActionLogCreateInput = z.infer<typeof actionLogCreateSchema>
export type ActionLogListQuery = z.infer<typeof actionLogListSchema>
export type AccessLogCreateInput = z.infer<typeof accessLogCreateSchema>
export type AccessLogListQuery = z.infer<typeof accessLogListSchema>
