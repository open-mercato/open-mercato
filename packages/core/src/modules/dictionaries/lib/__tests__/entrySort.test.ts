import { sortDictionaryEntries } from '../entrySort'

const items = [
  { id: '3', value: 'gamma', label: 'Gamma', createdAt: '2026-01-03T00:00:00.000Z' },
  { id: '1', value: 'alpha', label: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: '2', value: 'beta', label: 'Beta', createdAt: '2026-01-02T00:00:00.000Z' },
]

describe('sortDictionaryEntries', () => {
  it('defaults to label ascending', () => {
    expect(sortDictionaryEntries(items).map((item) => item.id)).toEqual(['1', '2', '3'])
  })

  it('sorts by configured mode', () => {
    expect(sortDictionaryEntries(items, 'label_desc').map((item) => item.id)).toEqual(['3', '2', '1'])
    expect(sortDictionaryEntries(items, 'value_asc').map((item) => item.id)).toEqual(['1', '2', '3'])
    expect(sortDictionaryEntries(items, 'created_at_desc').map((item) => item.id)).toEqual(['3', '2', '1'])
  })

  it('uses id as deterministic tie-breaker', () => {
    const tied = [
      { id: 'b', value: 'same', label: 'Same', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a', value: 'same', label: 'Same', createdAt: '2026-01-01T00:00:00.000Z' },
    ]

    expect(sortDictionaryEntries(tied, 'label_asc').map((item) => item.id)).toEqual(['a', 'b'])
  })
})
