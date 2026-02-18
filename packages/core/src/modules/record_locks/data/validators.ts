import { z } from 'zod'
import { recordLockSettingsSchema } from '../lib/config'

export const recordLockResourceSchema = z.object({
  resourceKind: z.string().trim().min(1),
  resourceId: z.string().trim().min(1),
})

export const recordLockAcquireSchema = recordLockResourceSchema

export const recordLockHeartbeatSchema = recordLockResourceSchema.extend({
  token: z.string().trim().min(1),
})

export const recordLockReleaseReasonSchema = z.enum(['saved', 'cancelled', 'unmount', 'conflict_resolved'])
export const recordLockReleaseResolutionSchema = z.enum(['accept_incoming'])

export const recordLockReleaseSchema = recordLockResourceSchema.extend({
  token: z.string().trim().min(1).optional(),
  reason: recordLockReleaseReasonSchema.optional(),
  conflictId: z.string().uuid().optional(),
  resolution: recordLockReleaseResolutionSchema.optional(),
}).superRefine((value, ctx) => {
  const reason = value.reason ?? 'cancelled'
  const isConflictResolved = reason === 'conflict_resolved'

  if (!isConflictResolved && !value.token) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['token'],
      message: 'token is required unless reason is conflict_resolved',
    })
  }

  if (!isConflictResolved) return

  if (!value.conflictId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['conflictId'],
      message: 'conflictId is required when reason is conflict_resolved',
    })
  }

  if (!value.resolution) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resolution'],
      message: 'resolution is required when reason is conflict_resolved',
    })
  }
})

export const recordLockForceReleaseSchema = recordLockResourceSchema.extend({
  reason: z.string().trim().min(1).max(120).optional(),
})

export const recordLockMutationResolutionSchema = z.enum(['normal', 'accept_mine', 'merged'])

export const recordLockMutationHeaderSchema = z.object({
  resourceKind: z.string().trim().min(1),
  resourceId: z.string().trim().min(1),
  token: z.string().trim().min(1).optional(),
  baseLogId: z.string().uuid().optional(),
  resolution: recordLockMutationResolutionSchema.default('normal'),
  conflictId: z.string().uuid().optional(),
})

export const recordLockSettingsResponseSchema = z.object({
  settings: recordLockSettingsSchema,
})

export const recordLockSettingsUpsertSchema = recordLockSettingsSchema

export const recordLockApiLockSchema = z.object({
  id: z.string().uuid(),
  resourceKind: z.string(),
  resourceId: z.string(),
  token: z.string().nullable(),
  strategy: z.enum(['optimistic', 'pessimistic']),
  status: z.enum(['active', 'released', 'expired', 'force_released']),
  lockedByUserId: z.string().uuid(),
  baseActionLogId: z.string().uuid().nullable(),
  lockedAt: z.string(),
  lastHeartbeatAt: z.string(),
  expiresAt: z.string(),
})

export const recordLockAcquireResponseSchema = z.object({
  ok: z.literal(true),
  enabled: z.boolean(),
  resourceEnabled: z.boolean(),
  strategy: z.enum(['optimistic', 'pessimistic']),
  allowForceUnlock: z.boolean(),
  heartbeatSeconds: z.number().int().positive(),
  acquired: z.boolean(),
  latestActionLogId: z.string().uuid().nullable(),
  lock: recordLockApiLockSchema.nullable(),
})

export const recordLockHeartbeatResponseSchema = z.object({
  ok: z.literal(true),
  expiresAt: z.string().nullable(),
})

export const recordLockReleaseResponseSchema = z.object({
  ok: z.literal(true),
  released: z.boolean(),
  conflictResolved: z.boolean(),
})

export const recordLockForceReleaseResponseSchema = z.object({
  ok: z.literal(true),
  released: z.boolean(),
  lock: recordLockApiLockSchema.nullable(),
})

export const recordLockErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  allowForceUnlock: z.boolean().optional(),
  lock: recordLockApiLockSchema.nullable().optional(),
  conflict: z.object({
    id: z.string().uuid(),
    resourceKind: z.string(),
    resourceId: z.string(),
    baseActionLogId: z.string().uuid().nullable(),
    incomingActionLogId: z.string().uuid().nullable(),
    resolutionOptions: z.array(z.enum(['accept_mine'])).default(['accept_mine']),
    changes: z.array(
      z.object({
        field: z.string().min(1),
        displayValue: z.unknown().nullable(),
        baseValue: z.unknown().nullable().optional(),
        incomingValue: z.unknown().nullable(),
        mineValue: z.unknown().nullable(),
      }),
    ).default([]),
  }).optional(),
})

export type RecordLockAcquireInput = z.infer<typeof recordLockAcquireSchema>
export type RecordLockHeartbeatInput = z.infer<typeof recordLockHeartbeatSchema>
export type RecordLockReleaseInput = z.infer<typeof recordLockReleaseSchema>
export type RecordLockForceReleaseInput = z.infer<typeof recordLockForceReleaseSchema>
export type RecordLockSettingsInput = z.infer<typeof recordLockSettingsUpsertSchema>
export type RecordLockMutationHeaders = z.infer<typeof recordLockMutationHeaderSchema>
