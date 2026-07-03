import { z } from 'zod'

export const dashboardWidgetIdSchema = z.string().min(1)
export const dashboardWidgetSizeSchema = z.enum(['sm', 'md', 'lg', 'full'])
export const dashboardDateRangeCompareSchema = z.enum(['previous_period', 'previous_year', 'none'])
export const dashboardDateRangePresetSchema = z.enum([
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'custom',
])

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isoDateToUtcMs(value: string): number | null {
  if (!ISO_DATE_PATTERN.test(value)) return null
  const [yearPart, monthPart, dayPart] = value.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  const day = Number(dayPart)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date.getTime()
}

export const dashboardLayoutItemSchema = z.object({
  id: z.string().uuid(),
  widgetId: dashboardWidgetIdSchema,
  order: z.number().int().min(0),
  priority: z.number().int().min(0).optional(),
  size: dashboardWidgetSizeSchema.optional(),
  settings: z.unknown().optional(),
})

export const dashboardLayoutPreferencesSchema = z.object({
  dateRange: z
    .object({
      preset: dashboardDateRangePresetSchema,
      from: z.string().optional(),
      to: z.string().optional(),
      compare: dashboardDateRangeCompareSchema,
    })
    .superRefine((dateRange, ctx) => {
      if (dateRange.preset !== 'custom') return

      const from = dateRange.from ? isoDateToUtcMs(dateRange.from) : null
      const to = dateRange.to ? isoDateToUtcMs(dateRange.to) : null

      if (from === null) {
        ctx.addIssue({ code: 'custom', path: ['from'], message: 'Invalid custom date range start' })
      }
      if (to === null) {
        ctx.addIssue({ code: 'custom', path: ['to'], message: 'Invalid custom date range end' })
      }
      if (from !== null && to !== null && from > to) {
        ctx.addIssue({ code: 'custom', path: ['from'], message: 'Custom date range start must be before end' })
      }
    })
    .optional(),
})

export const dashboardLayoutPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  items: z.array(dashboardLayoutItemSchema),
  preferences: dashboardLayoutPreferencesSchema.optional(),
})

export const dashboardLayoutSchema = z.object({
  items: z.array(dashboardLayoutItemSchema),
  preferences: dashboardLayoutPreferencesSchema.optional(),
  presets: z.array(dashboardLayoutPresetSchema).max(12).optional(),
  activePresetId: z.string().min(1).optional(),
})

export const dashboardLayoutItemPatchSchema = z.object({
  id: z.string().uuid(),
  size: dashboardWidgetSizeSchema.optional(),
  settings: z.unknown().optional(),
})

export const roleWidgetSettingsSchema = z.object({
  roleId: z.string().uuid(),
  widgetIds: z.array(dashboardWidgetIdSchema),
})

export const userWidgetSettingsSchema = z.object({
  userId: z.string().uuid(),
  mode: z.enum(['inherit', 'override']).default('inherit'),
  widgetIds: z.array(dashboardWidgetIdSchema),
})

export type DashboardLayoutPayload = z.infer<typeof dashboardLayoutSchema>
export type DashboardLayoutPresetPayload = z.infer<typeof dashboardLayoutPresetSchema>
export type DashboardLayoutItemPayload = z.infer<typeof dashboardLayoutItemSchema>
export type DashboardLayoutItemPatchPayload = z.infer<typeof dashboardLayoutItemPatchSchema>
export type DashboardLayoutPreferencesPayload = z.infer<typeof dashboardLayoutPreferencesSchema>
export type RoleWidgetSettingsPayload = z.infer<typeof roleWidgetSettingsSchema>
export type UserWidgetSettingsPayload = z.infer<typeof userWidgetSettingsSchema>
