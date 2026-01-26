import { z } from 'zod'

export const notificationStatusSchema = z.enum(['unread', 'read', 'actioned', 'dismissed'])
export const notificationSeveritySchema = z.enum(['info', 'warning', 'success', 'error'])

export const notificationActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  labelKey: z.string().optional(),
  variant: z.enum(['default', 'secondary', 'destructive', 'outline', 'ghost']).optional(),
  icon: z.string().optional(),
  commandId: z.string().optional(),
  href: z.string().optional(),
  confirmRequired: z.boolean().optional(),
  confirmMessage: z.string().optional(),
})

export const createNotificationSchema = z.object({
  recipientUserId: z.string().uuid(),
  type: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  body: z.string().max(2000).optional(),
  icon: z.string().max(100).optional(),
  severity: notificationSeveritySchema.optional().default('info'),
  actions: z.array(notificationActionSchema).optional(),
  primaryActionId: z.string().optional(),
  sourceModule: z.string().optional(),
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().uuid().optional(),
  linkHref: z.string().optional(),
  groupKey: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
})

export const createBatchNotificationSchema = z.object({
  recipientUserIds: z.array(z.string().uuid()).min(1).max(1000),
  type: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  body: z.string().max(2000).optional(),
  icon: z.string().max(100).optional(),
  severity: notificationSeveritySchema.optional().default('info'),
  actions: z.array(notificationActionSchema).optional(),
  primaryActionId: z.string().optional(),
  sourceModule: z.string().optional(),
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().uuid().optional(),
  linkHref: z.string().optional(),
  groupKey: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
})

export const createRoleNotificationSchema = z.object({
  roleId: z.string().uuid(),
  type: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  body: z.string().max(2000).optional(),
  icon: z.string().max(100).optional(),
  severity: notificationSeveritySchema.optional().default('info'),
  actions: z.array(notificationActionSchema).optional(),
  primaryActionId: z.string().optional(),
  sourceModule: z.string().optional(),
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().uuid().optional(),
  linkHref: z.string().optional(),
  groupKey: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
})

export const createFeatureNotificationSchema = z.object({
  requiredFeature: z.string().min(1).max(100),
  type: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  body: z.string().max(2000).optional(),
  icon: z.string().max(100).optional(),
  severity: notificationSeveritySchema.optional().default('info'),
  actions: z.array(notificationActionSchema).optional(),
  primaryActionId: z.string().optional(),
  sourceModule: z.string().optional(),
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().uuid().optional(),
  linkHref: z.string().optional(),
  groupKey: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
})

export const listNotificationsSchema = z.object({
  status: z.union([notificationStatusSchema, z.array(notificationStatusSchema)]).optional(),
  type: z.string().optional(),
  severity: notificationSeveritySchema.optional(),
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().uuid().optional(),
  since: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export const executeActionSchema = z.object({
  actionId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
})

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>
export type CreateBatchNotificationInput = z.infer<typeof createBatchNotificationSchema>
export type CreateRoleNotificationInput = z.infer<typeof createRoleNotificationSchema>
export type CreateFeatureNotificationInput = z.infer<typeof createFeatureNotificationSchema>
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>
export type ExecuteActionInput = z.infer<typeof executeActionSchema>
