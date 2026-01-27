import { z } from 'zod'
import { createCrudOpenApiFactory, createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { listNotificationsSchema, createNotificationSchema, executeActionSchema } from '../data/validators'

export const buildNotificationsCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Notifications',
})

export const notificationItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  titleKey: z.string().nullable().optional(),
  bodyKey: z.string().nullable().optional(),
  titleVariables: z.record(z.string()).nullable().optional(),
  bodyVariables: z.record(z.string()).nullable().optional(),
  icon: z.string().nullable().optional(),
  severity: z.string(),
  status: z.string(),
  actions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    labelKey: z.string().optional(),
    variant: z.string().optional(),
    icon: z.string().optional(),
  })),
  primaryActionId: z.string().optional(),
  sourceModule: z.string().nullable().optional(),
  sourceEntityType: z.string().nullable().optional(),
  sourceEntityId: z.string().uuid().nullable().optional(),
  linkHref: z.string().nullable().optional(),
  createdAt: z.string(),
  readAt: z.string().nullable().optional(),
  actionTaken: z.string().nullable().optional(),
})

export const okResponseSchema = z.object({
  ok: z.boolean(),
})

export const unreadCountResponseSchema = z.object({
  unreadCount: z.number(),
})

export const actionResultResponseSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  href: z.string().optional(),
})

export { createPagedListResponseSchema, listNotificationsSchema, createNotificationSchema, executeActionSchema }
