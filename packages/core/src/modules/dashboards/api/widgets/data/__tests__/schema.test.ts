/**
 * @jest-environment node
 */
import { MAX_SET_FILTER_VALUES, filterOperatorSchema, widgetDataRequestSchema } from '../schema'

function buildRequest(filters: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    entityType: 'sales:orders',
    metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
    filters,
  }
}

function buildMembers(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `status-${index}`)
}

describe('widget data set filter bounds (#4852)', () => {
  test.each(['in', 'not_in'] as const)('accepts a %s filter carrying exactly the maximum member count', (operator) => {
    const parsed = widgetDataRequestSchema.safeParse(
      buildRequest([{ field: 'status', operator, value: buildMembers(MAX_SET_FILTER_VALUES) }]),
    )

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.filters?.[0]?.value).toHaveLength(MAX_SET_FILTER_VALUES)
  })

  test.each(['in', 'not_in'] as const)('rejects a %s filter one member over the maximum', (operator) => {
    const parsed = widgetDataRequestSchema.safeParse(
      buildRequest([{ field: 'status', operator, value: buildMembers(MAX_SET_FILTER_VALUES + 1) }]),
    )

    expect(parsed.success).toBe(false)
    // The caller has to be able to tell which filter was refused, so the issue must carry the
    // filter's index and the `value` key rather than pointing at `filters` as a whole.
    const issue = parsed.success ? undefined : parsed.error.issues[0]
    expect(issue?.path).toEqual(['filters', 0, 'value'])
    expect(issue?.code).toBe('too_big')
    expect(issue).toMatchObject({ maximum: MAX_SET_FILTER_VALUES })
  })

  test('names the offending filter when it is not the first one', () => {
    const parsed = widgetDataRequestSchema.safeParse(
      buildRequest([
        { field: 'status', operator: 'eq', value: 'open' },
        { field: 'channel', operator: 'in', value: buildMembers(MAX_SET_FILTER_VALUES + 1) },
      ]),
    )

    expect(parsed.success).toBe(false)
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path)).toEqual([
      ['filters', 1, 'value'],
    ])
  })

  test('rejects an empty member list, which would render as an invalid `IN ()` predicate', () => {
    const parsed = widgetDataRequestSchema.safeParse(buildRequest([{ field: 'status', operator: 'in', value: [] }]))

    expect(parsed.success).toBe(false)
    expect(parsed.success ? undefined : parsed.error.issues[0]?.code).toBe('too_small')
  })

  test('rejects a set filter whose value is not an array at all', () => {
    const parsed = widgetDataRequestSchema.safeParse(buildRequest([{ field: 'status', operator: 'in', value: 'open' }]))

    expect(parsed.success).toBe(false)
    expect(parsed.success ? undefined : parsed.error.issues[0]?.path).toEqual(['filters', 0, 'value'])
  })

  test('rejects a set filter with a missing value', () => {
    const parsed = widgetDataRequestSchema.safeParse(buildRequest([{ field: 'status', operator: 'in' }]))

    expect(parsed.success).toBe(false)
  })

  test.each([[null], [{ id: 'open' }], [['open']]])('rejects the non-primitive member %p', (member) => {
    const parsed = widgetDataRequestSchema.safeParse(
      buildRequest([{ field: 'status', operator: 'in', value: ['open', member] }]),
    )

    expect(parsed.success).toBe(false)
    expect(parsed.success ? undefined : parsed.error.issues[0]?.path).toEqual(['filters', 0, 'value', 1])
  })

  test('accepts the primitive member types a set filter is allowed to compare against', () => {
    const parsed = widgetDataRequestSchema.safeParse(
      buildRequest([{ field: 'status', operator: 'in', value: ['open', 7, true] }]),
    )

    expect(parsed.success).toBe(true)
  })
})

describe('widget data scalar filters are unaffected by the set bound', () => {
  test.each(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const)('keeps %s accepting a bare scalar value', (operator) => {
    const parsed = widgetDataRequestSchema.safeParse(buildRequest([{ field: 'status', operator, value: 'open' }]))

    expect(parsed.success).toBe(true)
  })

  test.each(['is_null', 'is_not_null'] as const)('keeps %s valid without a value', (operator) => {
    const parsed = widgetDataRequestSchema.safeParse(buildRequest([{ field: 'closureOutcome', operator }]))

    expect(parsed.success).toBe(true)
  })

  test('does not apply the member bound to a scalar operator', () => {
    const parsed = widgetDataRequestSchema.safeParse(
      buildRequest([{ field: 'status', operator: 'eq', value: buildMembers(MAX_SET_FILTER_VALUES + 1) }]),
    )

    expect(parsed.success).toBe(true)
  })

  test('still rejects an unknown operator', () => {
    const parsed = widgetDataRequestSchema.safeParse(buildRequest([{ field: 'status', operator: 'like', value: 'a%' }]))

    expect(parsed.success).toBe(false)
  })
})

describe('filterOperatorSchema', () => {
  // The exported enum is derived from the scalar and set groups now; this pins the full set so
  // splitting the groups cannot quietly drop or rename an operator third parties already send.
  test('still accepts every supported operator', () => {
    expect(filterOperatorSchema.options.slice().sort()).toEqual(
      ['eq', 'gt', 'gte', 'in', 'is_not_null', 'is_null', 'lt', 'lte', 'neq', 'not_in'].sort(),
    )
  })
})
