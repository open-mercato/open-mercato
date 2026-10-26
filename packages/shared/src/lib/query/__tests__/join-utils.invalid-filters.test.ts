import { normalizeFilters } from '../join-utils'
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
