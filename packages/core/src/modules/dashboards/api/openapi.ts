import { z } from 'zod'
import {
  dashboardLayoutSchema,
  dashboardLayoutItemPatchSchema,
  dashboardWidgetIdSchema,
  roleWidgetSettingsSchema,
  userWidgetSettingsSchema,
} from '../data/validators'

export const dashboardsTag = 'Dashboards'

export const dashboardsErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const dashboardsOkSchema = z.object({
  ok: z.literal(true),
})

const nullableUuid = z.string().uuid().nullable()

export const dashboardWidgetSummarySchema = z.object({
  id: dashboardWidgetIdSchema,
  title: z.string(),
  description: z.string().nullable(),
  defaultSize: z.enum(['sm', 'md', 'lg']),
  defaultEnabled: z.boolean(),
  defaultSettings: z.unknown().nullable(),
  features: z.array(z.string()),
  moduleId: z.string(),
  icon: z.string().nullable(),
  loaderKey: z.string(),
  supportsRefresh: z.boolean(),
})

export const dashboardContextSchema = z.object({
  userId: z.string().uuid(),
  tenantId: nullableUuid,
  organizationId: nullableUuid,
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  userLabel: z.string(),
})

export const dashboardLayoutStateSchema = z.object({
  layout: dashboardLayoutSchema,
  allowedWidgetIds: z.array(dashboardWidgetIdSchema),
  canConfigure: z.boolean(),
  context: dashboardContextSchema,
  widgets: z.array(dashboardWidgetSummarySchema),
})

export const dashboardLayoutItemUpdateSchema = dashboardLayoutItemPatchSchema.omit({ id: true })

export const dashboardRoleWidgetsResponseSchema = z.object({
  widgetIds: z.array(dashboardWidgetIdSchema),
  hasCustom: z.boolean(),
  scope: z.object({
    tenantId: nullableUuid,
    organizationId: nullableUuid,
  }),
})

export const dashboardRoleWidgetsUpdateResponseSchema = z.object({
  ok: z.literal(true),
  widgetIds: z.array(dashboardWidgetIdSchema),
})

export const dashboardUserWidgetsResponseSchema = z.object({
  mode: z.enum(['inherit', 'override']),
  widgetIds: z.array(dashboardWidgetIdSchema),
  hasCustom: z.boolean(),
  effectiveWidgetIds: z.array(dashboardWidgetIdSchema),
  scope: z.object({
    tenantId: nullableUuid,
    organizationId: nullableUuid,
  }),
})

export const dashboardUserWidgetsUpdateResponseSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(['inherit', 'override']),
  widgetIds: z.array(dashboardWidgetIdSchema),
})

export const dashboardWidgetCatalogSchema = z.object({
  items: z.array(dashboardWidgetSummarySchema),
})

export { roleWidgetSettingsSchema as dashboardRoleWidgetSettingsSchema, userWidgetSettingsSchema as dashboardUserWidgetSettingsSchema }

