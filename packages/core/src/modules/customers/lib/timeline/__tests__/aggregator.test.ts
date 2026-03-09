/* eslint-disable @typescript-eslint/no-require-imports */
import { aggregateTimeline } from '../aggregator'
import type { AggregateOptions } from '../aggregator'
import type { TimelineEntry, TimelineEntryKind } from '../types'

function makeEntry(overrides: Partial<TimelineEntry> & { id: string; occurredAt: string }): TimelineEntry {
  return {
    kind: 'deal_created',
    actor: { id: 'user-1', label: 'Test User' },
    summary: `Entry ${overrides.id}`,
    detail: null,
    changes: null,
    ...overrides,
  }
}

const defaultOptions: AggregateOptions = {
  limit: 50,
  before: null,
  types: null,
}

describe('aggregateTimeline', () => {
  describe('merging and sorting', () => {
    it('merges entries from multiple sources into descending order by occurredAt', () => {
      const source1: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-01T10:00:00Z' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-03T10:00:00Z' }),
      ]
      const source2: TimelineEntry[] = [
        makeEntry({ id: 'c', occurredAt: '2026-03-02T10:00:00Z' }),
        makeEntry({ id: 'd', occurredAt: '2026-03-04T10:00:00Z' }),
      ]

      const result = aggregateTimeline([source1, source2], defaultOptions)

      expect(result.items.map((e) => e.id)).toEqual(['d', 'b', 'c', 'a'])
    })

    it('handles entries with identical timestamps by preserving stable order', () => {
      const source1: TimelineEntry[] = [
        makeEntry({ id: 'x', occurredAt: '2026-03-01T12:00:00Z' }),
      ]
      const source2: TimelineEntry[] = [
        makeEntry({ id: 'y', occurredAt: '2026-03-01T12:00:00Z' }),
      ]

      const result = aggregateTimeline([source1, source2], defaultOptions)

      expect(result.items).toHaveLength(2)
      expect(result.items.map((e) => e.id)).toContain('x')
      expect(result.items.map((e) => e.id)).toContain('y')
    })

    it('merges three or more sources correctly', () => {
      const source1: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-01-01T00:00:00Z' }),
      ]
      const source2: TimelineEntry[] = [
        makeEntry({ id: 'b', occurredAt: '2026-03-01T00:00:00Z' }),
      ]
      const source3: TimelineEntry[] = [
        makeEntry({ id: 'c', occurredAt: '2026-02-01T00:00:00Z' }),
      ]

      const result = aggregateTimeline([source1, source2, source3], defaultOptions)

      expect(result.items.map((e) => e.id)).toEqual(['b', 'c', 'a'])
    })
  })

  describe('type filtering', () => {
    it('returns only entries matching the types set', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-03T10:00:00Z', kind: 'deal_created' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-02T10:00:00Z', kind: 'comment_added' }),
        makeEntry({ id: 'c', occurredAt: '2026-03-01T10:00:00Z', kind: 'email_sent' }),
      ]

      const result = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        types: new Set<TimelineEntryKind>(['deal_created', 'email_sent']),
      })

      expect(result.items.map((e) => e.id)).toEqual(['a', 'c'])
    })

    it('returns all entries when types is null', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-02T10:00:00Z', kind: 'deal_created' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-01T10:00:00Z', kind: 'comment_added' }),
      ]

      const result = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        types: null,
      })

      expect(result.items).toHaveLength(2)
    })

    it('returns all entries when types set is empty', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-02T10:00:00Z', kind: 'deal_created' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-01T10:00:00Z', kind: 'stage_changed' }),
      ]

      const result = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        types: new Set<TimelineEntryKind>(),
      })

      expect(result.items).toHaveLength(2)
    })

    it('returns empty items when no entries match the filter', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-01T10:00:00Z', kind: 'deal_created' }),
      ]

      const result = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        types: new Set<TimelineEntryKind>(['file_uploaded']),
      })

      expect(result.items).toEqual([])
    })

    it('filters across multiple sources', () => {
      const source1: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-03T10:00:00Z', kind: 'deal_created' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-02T10:00:00Z', kind: 'email_sent' }),
      ]
      const source2: TimelineEntry[] = [
        makeEntry({ id: 'c', occurredAt: '2026-03-01T10:00:00Z', kind: 'deal_created' }),
        makeEntry({ id: 'd', occurredAt: '2026-02-28T10:00:00Z', kind: 'activity_logged' }),
      ]

      const result = aggregateTimeline([source1, source2], {
        ...defaultOptions,
        types: new Set<TimelineEntryKind>(['deal_created']),
      })

      expect(result.items.map((e) => e.id)).toEqual(['a', 'c'])
    })
  })

  describe('before cursor filtering', () => {
    it('returns only entries before the given timestamp', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-05T10:00:00Z' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-03T10:00:00Z' }),
        makeEntry({ id: 'c', occurredAt: '2026-03-01T10:00:00Z' }),
      ]

      const result = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        before: '2026-03-04T00:00:00Z',
      })

      expect(result.items.map((e) => e.id)).toEqual(['b', 'c'])
    })

    it('excludes entries with the exact before timestamp', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-03T10:00:00Z' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-02T10:00:00Z' }),
      ]

      const result = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        before: '2026-03-03T10:00:00Z',
      })

      expect(result.items.map((e) => e.id)).toEqual(['b'])
    })

    it('returns all entries when before is null', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-02T10:00:00Z' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-01T10:00:00Z' }),
      ]

      const result = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        before: null,
      })

      expect(result.items).toHaveLength(2)
    })

    it('ignores invalid before date string and returns all entries', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-02T10:00:00Z' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-01T10:00:00Z' }),
      ]

      const result = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        before: 'not-a-valid-date',
      })

      expect(result.items).toHaveLength(2)
      expect(result.items.map((e) => e.id)).toEqual(['a', 'b'])
    })

    it('combines type filtering with before cursor', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-05T10:00:00Z', kind: 'deal_created' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-04T10:00:00Z', kind: 'comment_added' }),
        makeEntry({ id: 'c', occurredAt: '2026-03-03T10:00:00Z', kind: 'deal_created' }),
        makeEntry({ id: 'd', occurredAt: '2026-03-02T10:00:00Z', kind: 'comment_added' }),
      ]

      const result = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        before: '2026-03-04T12:00:00Z',
        types: new Set<TimelineEntryKind>(['deal_created']),
      })

      expect(result.items.map((e) => e.id)).toEqual(['c'])
    })
  })

  describe('deduplication', () => {
    it('removes duplicate entries with the same id from different sources', () => {
      const source1: TimelineEntry[] = [
        makeEntry({ id: 'dup-1', occurredAt: '2026-03-02T10:00:00Z', summary: 'Source 1' }),
      ]
      const source2: TimelineEntry[] = [
        makeEntry({ id: 'dup-1', occurredAt: '2026-03-02T10:00:00Z', summary: 'Source 2' }),
      ]

      const result = aggregateTimeline([source1, source2], defaultOptions)

      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('dup-1')
    })

    it('keeps the first occurrence when duplicates exist', () => {
      const source1: TimelineEntry[] = [
        makeEntry({ id: 'dup', occurredAt: '2026-03-02T10:00:00Z', summary: 'First' }),
      ]
      const source2: TimelineEntry[] = [
        makeEntry({ id: 'dup', occurredAt: '2026-03-02T10:00:00Z', summary: 'Second' }),
      ]

      const result = aggregateTimeline([source1, source2], defaultOptions)

      expect(result.items[0].summary).toBe('First')
    })

    it('deduplicates across three sources', () => {
      const source1: TimelineEntry[] = [
        makeEntry({ id: 'shared', occurredAt: '2026-03-03T10:00:00Z' }),
        makeEntry({ id: 'unique-1', occurredAt: '2026-03-02T10:00:00Z' }),
      ]
      const source2: TimelineEntry[] = [
        makeEntry({ id: 'shared', occurredAt: '2026-03-03T10:00:00Z' }),
        makeEntry({ id: 'unique-2', occurredAt: '2026-03-01T10:00:00Z' }),
      ]
      const source3: TimelineEntry[] = [
        makeEntry({ id: 'shared', occurredAt: '2026-03-03T10:00:00Z' }),
      ]

      const result = aggregateTimeline([source1, source2, source3], defaultOptions)

      expect(result.items).toHaveLength(3)
      expect(result.items.map((e) => e.id)).toEqual(['shared', 'unique-1', 'unique-2'])
    })
  })

  describe('limit and pagination', () => {
    it('limits results to the specified count', () => {
      const entries: TimelineEntry[] = Array.from({ length: 10 }, (_, i) =>
        makeEntry({ id: `entry-${i}`, occurredAt: `2026-03-${String(i + 1).padStart(2, '0')}T10:00:00Z` }),
      )

      const result = aggregateTimeline([[...entries]], { ...defaultOptions, limit: 3 })

      expect(result.items).toHaveLength(3)
    })

    it('returns nextCursor when more items exist beyond the limit', () => {
      const entries: TimelineEntry[] = Array.from({ length: 5 }, (_, i) =>
        makeEntry({ id: `entry-${i}`, occurredAt: `2026-03-${String(i + 1).padStart(2, '0')}T10:00:00Z` }),
      )

      const result = aggregateTimeline([[...entries]], { ...defaultOptions, limit: 3 })

      expect(result.nextCursor).not.toBeNull()
      expect(result.nextCursor).toBe(result.items[result.items.length - 1].occurredAt)
    })

    it('returns null nextCursor when all items fit within the limit', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-02T10:00:00Z' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-01T10:00:00Z' }),
      ]

      const result = aggregateTimeline([[...entries]], { ...defaultOptions, limit: 5 })

      expect(result.nextCursor).toBeNull()
    })

    it('returns null nextCursor when items exactly equal the limit with no extras', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-03T10:00:00Z' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-02T10:00:00Z' }),
        makeEntry({ id: 'c', occurredAt: '2026-03-01T10:00:00Z' }),
      ]

      const result = aggregateTimeline([[...entries]], { ...defaultOptions, limit: 3 })

      expect(result.items).toHaveLength(3)
      expect(result.nextCursor).toBeNull()
    })

    it('returns nextCursor set to the occurredAt of the last returned item', () => {
      const entries: TimelineEntry[] = Array.from({ length: 6 }, (_, i) =>
        makeEntry({ id: `e-${i}`, occurredAt: `2026-03-${String(i + 1).padStart(2, '0')}T10:00:00Z` }),
      )

      const result = aggregateTimeline([[...entries]], { ...defaultOptions, limit: 4 })

      expect(result.nextCursor).toBe('2026-03-03T10:00:00Z')
      expect(result.items).toHaveLength(4)
      expect(result.items.map((e) => e.id)).toEqual(['e-5', 'e-4', 'e-3', 'e-2'])
    })

    it('supports cursor-based pagination across multiple pages', () => {
      const entries: TimelineEntry[] = Array.from({ length: 5 }, (_, i) =>
        makeEntry({ id: `p-${i}`, occurredAt: `2026-03-${String(i + 1).padStart(2, '0')}T10:00:00Z` }),
      )

      const page1 = aggregateTimeline([[...entries]], { ...defaultOptions, limit: 2 })
      expect(page1.items.map((e) => e.id)).toEqual(['p-4', 'p-3'])
      expect(page1.nextCursor).not.toBeNull()

      const page2 = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        limit: 2,
        before: page1.nextCursor,
      })
      expect(page2.items.map((e) => e.id)).toEqual(['p-2', 'p-1'])
      expect(page2.nextCursor).not.toBeNull()

      const page3 = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        limit: 2,
        before: page2.nextCursor,
      })
      expect(page3.items.map((e) => e.id)).toEqual(['p-0'])
      expect(page3.nextCursor).toBeNull()
    })

    it('deduplication is applied before limiting', () => {
      const source1: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-03T10:00:00Z' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-02T10:00:00Z' }),
      ]
      const source2: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-03T10:00:00Z' }),
        makeEntry({ id: 'c', occurredAt: '2026-03-01T10:00:00Z' }),
      ]

      const result = aggregateTimeline([source1, source2], { ...defaultOptions, limit: 2 })

      expect(result.items).toHaveLength(2)
      expect(result.items.map((e) => e.id)).toEqual(['a', 'b'])
      expect(result.nextCursor).toBe('2026-03-02T10:00:00Z')
    })
  })

  describe('edge cases', () => {
    it('returns empty items and null cursor for empty sources array', () => {
      const result = aggregateTimeline([], defaultOptions)

      expect(result.items).toEqual([])
      expect(result.nextCursor).toBeNull()
    })

    it('returns empty items and null cursor when all sources are empty arrays', () => {
      const result = aggregateTimeline([[], [], []], defaultOptions)

      expect(result.items).toEqual([])
      expect(result.nextCursor).toBeNull()
    })

    it('handles a single source with one entry', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'solo', occurredAt: '2026-03-01T10:00:00Z' }),
      ]

      const result = aggregateTimeline([entries], defaultOptions)

      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('solo')
      expect(result.nextCursor).toBeNull()
    })

    it('handles a single source with multiple entries', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-01T10:00:00Z' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-03T10:00:00Z' }),
        makeEntry({ id: 'c', occurredAt: '2026-03-02T10:00:00Z' }),
      ]

      const result = aggregateTimeline([entries], defaultOptions)

      expect(result.items.map((e) => e.id)).toEqual(['b', 'c', 'a'])
    })

    it('handles limit of 1', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-02T10:00:00Z' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-01T10:00:00Z' }),
      ]

      const result = aggregateTimeline([[...entries]], { ...defaultOptions, limit: 1 })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('a')
      expect(result.nextCursor).toBe('2026-03-02T10:00:00Z')
    })

    it('preserves all entry fields in the output', () => {
      const entry = makeEntry({
        id: 'full',
        occurredAt: '2026-03-01T10:00:00Z',
        kind: 'stage_changed',
        actor: { id: 'user-42', label: 'Jane Doe' },
        summary: 'Stage moved to Negotiation',
        detail: { previousStage: 'Qualification', newStage: 'Negotiation' },
        changes: [{ field: 'stage', label: 'Stage', from: 'Qualification', to: 'Negotiation' }],
      })

      const result = aggregateTimeline([[entry]], defaultOptions)

      expect(result.items[0]).toEqual(entry)
    })

    it('handles entries with null actor id', () => {
      const entry = makeEntry({
        id: 'sys',
        occurredAt: '2026-03-01T10:00:00Z',
        actor: { id: null, label: 'System' },
      })

      const result = aggregateTimeline([[entry]], defaultOptions)

      expect(result.items[0].actor.id).toBeNull()
      expect(result.items[0].actor.label).toBe('System')
    })

    it('handles a large number of entries efficiently', () => {
      const entries: TimelineEntry[] = Array.from({ length: 1000 }, (_, i) =>
        makeEntry({
          id: `large-${i}`,
          occurredAt: new Date(2026, 0, 1, 0, 0, 0, i).toISOString(),
        }),
      )

      const result = aggregateTimeline([[...entries]], { ...defaultOptions, limit: 10 })

      expect(result.items).toHaveLength(10)
      expect(result.nextCursor).not.toBeNull()
    })

    it('before filter with all entries filtered out returns empty and null cursor', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-02T10:00:00Z' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-01T10:00:00Z' }),
      ]

      const result = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        before: '2026-01-01T00:00:00Z',
      })

      expect(result.items).toEqual([])
      expect(result.nextCursor).toBeNull()
    })

    it('type filter combined with before cursor that eliminates all entries', () => {
      const entries: TimelineEntry[] = [
        makeEntry({ id: 'a', occurredAt: '2026-03-05T10:00:00Z', kind: 'deal_created' }),
        makeEntry({ id: 'b', occurredAt: '2026-03-03T10:00:00Z', kind: 'comment_added' }),
      ]

      const result = aggregateTimeline([[...entries]], {
        ...defaultOptions,
        before: '2026-03-04T00:00:00Z',
        types: new Set<TimelineEntryKind>(['deal_created']),
      })

      expect(result.items).toEqual([])
      expect(result.nextCursor).toBeNull()
    })
  })
})
