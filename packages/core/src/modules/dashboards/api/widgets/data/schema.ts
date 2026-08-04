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

const setFilterOperators = new Set<z.infer<typeof filterOperatorSchema>>(['in', 'not_in'])

function containsNullMember(value: unknown): boolean {
  return Array.isArray(value) ? value.some((member) => member === null) : value === null
}

/**
 * `in` / `not_in` render one SQL placeholder per member, so a `null` member turns the whole
 * `IN` / `NOT IN` predicate into SQL NULL for every row: the aggregation would return zero rows
 * with no error, which on a dashboard reads as a legitimate zero rather than a failure.
 *
 * `undefined` is not expressible in JSON, so `{"value": null}` is how a client naturally sends
 * "no value". It is rejected here rather than reinterpreted, keeping the failure loud and at the
 * boundary; the documented empty-set path is reached by omitting the `value` key entirely.
 */
const widgetDataFilterSchema = z
  .object({
    field: z.string().min(1),
    operator: filterOperatorSchema,
    value: z.unknown().optional(),
  })
  .superRefine((filter, ctx) => {
    if (!setFilterOperators.has(filter.operator)) return
    if (!containsNullMember(filter.value)) return
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Set filters (in, not_in) reject null members; omit "value" to select an empty set.',
    })
  })

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
  filters: z.array(widgetDataFilterSchema).optional(),
  dateRange: z
    .object({
      field: z.string().min(1),
      preset: dateRangePresetSchema,
    })
    .optional(),
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
    currency: z.string().nullable().optional(),
  }),
})
