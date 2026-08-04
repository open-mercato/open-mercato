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

const comparisonFilterOperators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const
const setFilterOperators = ['in', 'not_in'] as const
const nullFilterOperators = ['is_null', 'is_not_null'] as const
const scalarFilterOperators = [...comparisonFilterOperators, ...nullFilterOperators] as const

const scalarFilterOperatorSchema = z.enum(scalarFilterOperators)
const setFilterOperatorSchema = z.enum(setFilterOperators)

export const filterOperatorSchema = z.enum([
  ...comparisonFilterOperators,
  ...setFilterOperators,
  ...nullFilterOperators,
])

/**
 * Upper bound on how many members an `in` / `not_in` widget-data filter may carry (#4852).
 *
 * Every member becomes one placeholder plus one bound parameter in the aggregation's WHERE
 * clause, so the cost of a set filter is proportional to its length. The bound lives here
 * rather than in the SQL builder because `buildWhereClause` can only truncate the list —
 * silently returning an answer to a different question than the caller asked — or throw from
 * deep inside query construction; validating here yields a 400 that names the offending
 * filter and is published in the route's OpenAPI schema.
 *
 * 200 is deliberately generous for a dashboard filter: the widest grouping a widget can render
 * is capped at 100 buckets (`groupBy.limit`), and a batch carries at most 50 requests, so even
 * a fully saturated batch stays an order of magnitude below PostgreSQL's per-statement limit
 * of 65535 bound parameters. Raising it later is a one-line change to this constant.
 */
export const MAX_SET_FILTER_VALUES = 200

// `IN` / `NOT IN` compare against literals; a null member never matches either way, which is
// what the dedicated `is_null` / `is_not_null` operators are for.
const setFilterMemberSchema = z.union([z.string(), z.number(), z.boolean()])

const setFilterValueSchema = z.array(setFilterMemberSchema).max(MAX_SET_FILTER_VALUES)

const widgetDataFilterSchema = z.discriminatedUnion('operator', [
  z.object({
    field: z.string().min(1),
    operator: setFilterOperatorSchema,
    value: setFilterValueSchema,
  }),
  z.object({
    field: z.string().min(1),
    operator: scalarFilterOperatorSchema,
    value: z.unknown().optional(),
  }),
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
