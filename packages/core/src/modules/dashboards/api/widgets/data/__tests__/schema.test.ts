/**
 * @jest-environment node
 */
import { widgetDataRequestSchema } from '../schema'

const baseRequest = {
  entityType: 'sales:order',
  metric: { field: 'id', aggregate: 'count' as const },
}

function parseWithFilter(filter: Record<string, unknown>) {
  return widgetDataRequestSchema.safeParse({ ...baseRequest, filters: [filter] })
}

describe('widgetDataRequestSchema — set filter null members', () => {
  /**
   * A null member makes the rendered `IN` / `NOT IN` predicate evaluate to SQL NULL for every row,
   * so the aggregation would silently return zero rows instead of failing. `undefined` cannot be
   * expressed in JSON, so `{"value": null}` is the shape a real client sends — it must be rejected
   * at the boundary rather than reinterpreted as the empty set.
   */
  it.each(['in', 'not_in'] as const)('rejects a null value for %s', (operator) => {
    const result = parseWithFilter({ field: 'status', operator, value: null })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['filters', 0, 'value'])
  })

  it.each(['in', 'not_in'] as const)('rejects an array containing null for %s', (operator) => {
    const result = parseWithFilter({ field: 'status', operator, value: [null] })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['filters', 0, 'value'])
  })

  it('rejects a null member mixed with valid members', () => {
    const result = parseWithFilter({ field: 'status', operator: 'not_in', value: ['completed', null, 'shipped'] })
    expect(result.success).toBe(false)
  })

  it('accepts an omitted value, which is the documented empty-set path', () => {
    expect(parseWithFilter({ field: 'status', operator: 'in' }).success).toBe(true)
    expect(parseWithFilter({ field: 'status', operator: 'not_in', value: [] }).success).toBe(true)
  })

  it('accepts set filters whose members are all non-null', () => {
    expect(parseWithFilter({ field: 'status', operator: 'in', value: ['completed', 'shipped'] }).success).toBe(true)
    expect(parseWithFilter({ field: 'status', operator: 'in', value: 'completed' }).success).toBe(true)
    expect(parseWithFilter({ field: 'grandTotal', operator: 'not_in', value: [0, 1] }).success).toBe(true)
  })

  /**
   * `is_null` / `is_not_null` build their predicate from the operator alone and never read the
   * value, so a caller sending an explicit `null` there is valid input today. The guard is
   * operator-scoped rather than blanket so those callers keep working.
   */
  it.each(['is_null', 'is_not_null'] as const)('accepts an explicit null value for %s', (operator) => {
    expect(parseWithFilter({ field: 'status', operator, value: null }).success).toBe(true)
  })
})
