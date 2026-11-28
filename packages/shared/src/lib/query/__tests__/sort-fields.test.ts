import { sortRowsInMemory } from '../encrypted-sort'
import { SortDir } from '../types'

test('plaintext sorting uses fallback dates and keeps the same id tiebreak in both directions', () => {
  const earlier = new Date('2000-01-01T00:00:00Z')
  const middle = new Date('2010-01-01T00:00:00Z')
  const later = new Date('2020-01-01T00:00:00Z')
  const rows = [
    { id: 'placed', placed_at: later, valid_until: earlier, created_at: earlier },
    { id: 'created', placed_at: null, valid_until: null, created_at: middle },
    { id: 'validity', placed_at: null, valid_until: earlier, created_at: later },
    { id: 'earliest', placed_at: earlier, valid_until: null, created_at: later },
  ]
  const sort = { field: 'placed_at', fallbackFields: ['valid_until', 'created_at'] }

  expect(sortRowsInMemory(rows, [{ ...sort, dir: SortDir.Asc }]).map(({ id }) => id)).toEqual([
    'earliest', 'validity', 'created', 'placed',
  ])
  expect(sortRowsInMemory(rows, [{ ...sort, dir: SortDir.Desc }]).map(({ id }) => id)).toEqual([
    'placed', 'created', 'earliest', 'validity',
  ])
})
