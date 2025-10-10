import { z } from 'zod'

export const dashboardWidgetIdSchema = z.string().min(1)

export const dashboardLayoutItemSchema = z.object({
  id: z.string().uuid(),
  widgetId: dashboardWidgetIdSchema,
  order: z.number().int().min(0),
  size: z.enum(['sm', 'md', 'lg']).optional(),
  settings: z.unknown().optional(),
})

export const dashboardLayoutSchema = z.object({
  items: z.array(dashboardLayoutItemSchema),
})

export const dashboardLayoutItemPatchSchema = z.object({
  id: z.string().uuid(),
  size: z.enum(['sm', 'md', 'lg']).optional(),
  settings: z.unknown().optional(),
})

export const roleWidgetSettingsSchema = z.object({
  roleId: z.string().uuid(),
  tenantId: z.string().uuid().optional().nullable(),
  organizationId: z.string().uuid().optional().nullable(),
  widgetIds: z.array(dashboardWidgetIdSchema),
})

export const userWidgetSettingsSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid().optional().nullable(),
  organizationId: z.string().uuid().optional().nullable(),
  mode: z.enum(['inherit', 'override']).default('inherit'),
  widgetIds: z.array(dashboardWidgetIdSchema),
})

export type DashboardLayoutPayload = z.infer<typeof dashboardLayoutSchema>
export type DashboardLayoutItemPayload = z.infer<typeof dashboardLayoutItemSchema>
export type DashboardLayoutItemPatchPayload = z.infer<typeof dashboardLayoutItemPatchSchema>
export type RoleWidgetSettingsPayload = z.infer<typeof roleWidgetSettingsSchema>
export type UserWidgetSettingsPayload = z.infer<typeof userWidgetSettingsSchema>
