import { z } from 'zod'

export const aggregateFunctionSchema = z.enum(['count', 'sum', 'avg', 'min', 'max'])
export const dateGranularitySchema = z.enum(['day', 'week', 'month', 'quarter', 'year'])
export const dateRangePresetSchema = z.enum([
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
])

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

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

const isoDateSchema = z.string().regex(ISO_DATE_PATTERN).refine((value) => isoDateToUtcMs(value) !== null)

const presetDateRangeSchema = z.object({
  field: z.string().min(1),
  preset: dateRangePresetSchema,
})

const customDateRangeSchema = z
  .object({
    field: z.string().min(1),
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .superRefine((range, ctx) => {
    const from = isoDateToUtcMs(range.from)
    const to = isoDateToUtcMs(range.to)
    if (from === null || to === null) return
    if (from > to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'Date range start must be before end' })
      return
    }
    const daysInclusive = Math.floor((to - from) / DAY_MS) + 1
    if (daysInclusive > 366) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Date range must not exceed 366 days' })
    }
  })

export const filterOperatorSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'is_null',
  'is_not_null',
])

export const widgetDataRequestSchema = z.object({
  entityType: z.string().min(1),
  metric: z.object({
    field: z.string().min(1),
    aggregate: aggregateFunctionSchema,
  }),
  groupBy: z
    .object({
      field: z.string().min(1),
      granularity: dateGranularitySchema.optional(),
      limit: z.number().int().min(1).max(100).optional(),
      resolveLabels: z.boolean().optional(),
    })
    .optional(),
  filters: z
    .array(
      z.object({
        field: z.string().min(1),
        operator: filterOperatorSchema,
        value: z.unknown().optional(),
      }),
    )
    .optional(),
  dateRange: z.union([presetDateRangeSchema, customDateRangeSchema]).optional(),
  comparison: z
    .object({
      type: z.enum(['previous_period', 'previous_year']),
    })
    .optional(),
})

export const widgetDataItemSchema = z.object({
  groupKey: z.unknown(),
  groupLabel: z.string().optional(),
  value: z.number().nullable(),
})

export const widgetDataResponseSchema = z.object({
  value: z.number().nullable(),
  data: z.array(widgetDataItemSchema),
  comparison: z
    .object({
      value: z.number().nullable(),
      change: z.number(),
      direction: z.enum(['up', 'down', 'unchanged']),
    })
    .optional(),
  metadata: z.object({
    fetchedAt: z.string(),
    recordCount: z.number(),
  }),
})
