import { z } from 'zod'

export const MAX_DASHBOARD_LAYOUT_ITEMS = 100
export const MAX_DASHBOARD_WIDGET_ASSIGNMENTS = 200

export const dashboardWidgetIdSchema = z.string().min(1)

export const dashboardLayoutItemSchema = z.object({
  id: z.string().uuid(),
  widgetId: dashboardWidgetIdSchema,
  order: z.number().int().min(0),
  priority: z.number().int().min(0).optional(),
  size: z.enum(['sm', 'md', 'lg']).optional(),
  settings: z.unknown().optional(),
})

export const dashboardLayoutSchema = z.object({
  items: z.array(dashboardLayoutItemSchema).max(MAX_DASHBOARD_LAYOUT_ITEMS),
})

export const dashboardLayoutItemPatchSchema = z.object({
  id: z.string().uuid(),
  size: z.enum(['sm', 'md', 'lg']).optional(),
  settings: z.unknown().optional(),
})

export const roleWidgetSettingsSchema = z.object({
  roleId: z.string().uuid(),
  widgetIds: z.array(dashboardWidgetIdSchema).max(MAX_DASHBOARD_WIDGET_ASSIGNMENTS),
})

export const userWidgetSettingsSchema = z.object({
  userId: z.string().uuid(),
  mode: z.enum(['inherit', 'override']).default('inherit'),
  widgetIds: z.array(dashboardWidgetIdSchema).max(MAX_DASHBOARD_WIDGET_ASSIGNMENTS),
})

export type DashboardLayoutPayload = z.infer<typeof dashboardLayoutSchema>
export type DashboardLayoutItemPayload = z.infer<typeof dashboardLayoutItemSchema>
export type DashboardLayoutItemPatchPayload = z.infer<typeof dashboardLayoutItemPatchSchema>
export type RoleWidgetSettingsPayload = z.infer<typeof roleWidgetSettingsSchema>
export type UserWidgetSettingsPayload = z.infer<typeof userWidgetSettingsSchema>
