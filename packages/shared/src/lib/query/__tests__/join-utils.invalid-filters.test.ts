import { normalizeFilters, partitionFilters } from '../join-utils'
import type { Filter, QueryOptions } from '../types'

describe('QueryEngine filter validation (#7831)', () => {
  test.each([
    { $or: [] },
    { $and: [{ status: 'open' }, { $or: [] }] },
    { $or: [{ status: 'open' }, { $or: [] }] },
  ])('rejects an empty OR anywhere in %j', (filters) => {
    expect(() => normalizeFilters(filters)).toThrow(TypeError)
  })

  test.each([
    { status: { $unsupported: 'open' } },
    { status: { unsupported: 'open' } },
    { status: { $eq: 'open', $unsupported: 'closed' } },
    { $and: [{ status: 'open' }, { id: { $unsupported: 'id' } }] },
    { $or: [{ status: 'open' }, { id: { $unsupported: 'id' } }] },
  ])('rejects unsupported field operators in %j', (filters) => {
    expect(() => normalizeFilters(filters)).toThrow(TypeError)
  })

  test('rejects unsupported operators in array filters', () => {
    const filters = [{ field: 'status', op: 'unsupported', value: 'open' }] as unknown as Filter[]
    expect(() => normalizeFilters(filters)).toThrow(TypeError)
  })

  test.each<QueryOptions['filters']>([undefined, {}, [], { $and: [] }])(
    'preserves unconstrained filters: %j',
    (filters) => {
      expect(normalizeFilters(filters)).toEqual([])
    },
  )

  test('preserves supported prefixed and unprefixed operators', () => {
    expect(normalizeFilters({ status: { $eq: 'open', ne: 'closed' } })).toEqual([
      { field: 'status', op: 'eq', value: 'open' },
      { field: 'status', op: 'ne', value: 'closed' },
    ])
  })

  test('preserves array filter metadata and custom field aliases', () => {
    const filters: Array<Filter & { orGroup: string }> = [
      { field: 'cf_status', op: 'eq', value: 'open', orGroup: 'scope' },
    ]
    expect(normalizeFilters(filters)).toEqual([
      { field: 'cf:status', op: 'eq', value: 'open', orGroup: 'scope' },
    ])
  })
})


describe('narrow negated ILIKE validation (#7996)', () => {
  test.each([
    { display_name: { $not: null } },
    { display_name: { $not: [] } },
    { display_name: { $not: '%text%' } },
    { display_name: { $not: {} } },
    { display_name: { $not: { $like: '%text%' } } },
    { display_name: { $not: { $ilike: 42 } } },
    { display_name: { $not: { $ilike: '%text%', $eq: 'other' } } },
    { $not: { $ilike: '%text%' } },
    { display_name: { $not_ilike: null } },
  ])('rejects malformed or unsupported negative forms: %j', (filters) => {
    expect(() => normalizeFilters(filters)).toThrow(TypeError)
  })

  test('validates direct normalized negative patterns without losing metadata', () => {
    expect(() => normalizeFilters([{ field: 'display_name', op: 'not_ilike', value: null }])).toThrow(TypeError)
    expect(normalizeFilters([{ field: 'cf_labels', op: 'not_ilike', value: '%x%', orGroup: 'branch' }])).toEqual([
      { field: 'cf:labels', op: 'not_ilike', value: '%x%', orGroup: 'branch' },
    ])
  })
})

test('base-qualified negative filters retain their original OR metadata', () => {
  const filters = normalizeFilters({ $or: [{ 'base.secret': { $not: { $ilike: '%Daniel%' } } }, { id: 'record-1' }] })
  const { baseFilters } = partitionFilters('users', filters, new Map())
  expect(baseFilters).toEqual([
    { field: 'secret', op: 'not_ilike', value: '%Daniel%', orGroup: 'or_0', qualified: 'users.secret' },
    { field: 'id', op: 'eq', value: 'record-1', orGroup: 'or_1' },
  ])
})
