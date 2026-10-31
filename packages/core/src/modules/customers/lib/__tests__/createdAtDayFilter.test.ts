import type { AdvancedFilterTree, FilterRule } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { compileTreeToWhere } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { expandCreatedAtDayRules } from '../createdAtDayFilter'

function treeOf(...children: AdvancedFilterTree['root']['children']): AdvancedFilterTree {
  return { root: { id: 'root', type: 'group', combinator: 'and', children } }
}

function rule(field: string, operator: FilterRule['operator'], value: unknown): FilterRule {
  return { id: `${field}-${operator}`, type: 'rule', field, operator, value }
}

function compile(input: FilterRule, timeZone: string): Record<string, unknown> | null {
  return compileTreeToWhere(expandCreatedAtDayRules(treeOf(input), timeZone))
}

function calendarDayIn(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant))
}

function matches(where: Record<string, unknown> | null, instant: string): boolean {
  const bounds = (where?.created_at ?? {}) as Record<string, string>
  const at = Date.parse(instant)
  if (bounds.$gte !== undefined && !(at >= Date.parse(bounds.$gte))) return false
  if (bounds.$gt !== undefined && !(at > Date.parse(bounds.$gt))) return false
  if (bounds.$lte !== undefined && !(at <= Date.parse(bounds.$lte))) return false
  if (bounds.$lt !== undefined && !(at < Date.parse(bounds.$lt))) return false
  return true
}

describe('expandCreatedAtDayRules', () => {
  describe('in UTC (list APIs receiving bare dates)', () => {
    it('turns "is <day>" into the whole UTC day', () => {
      expect(compile(rule('created_at', 'is', '2026-09-01'), 'UTC')).toEqual({
        created_at: { $gte: '2026-09-01T00:00:00.000Z', $lte: '2026-09-01T23:59:59.999Z' },
      })
    })

    it('keeps the whole end day in a between range', () => {
      expect(compile(rule('created_at', 'between', ['2026-09-01', '2026-09-30']), 'UTC')).toEqual({
        created_at: { $gte: '2026-09-01T00:00:00.000Z', $lte: '2026-09-30T23:59:59.999Z' },
      })
    })

    it('makes "is after <day>" exclude that day', () => {
      expect(compile(rule('created_at', 'is_after', '2026-09-01'), 'UTC')).toEqual({
        created_at: { $gt: '2026-09-01T23:59:59.999Z' },
      })
    })

    it('makes "is before <day>" stop at the start of that day', () => {
      expect(compile(rule('created_at', 'is_before', '2026-09-01'), 'UTC')).toEqual({
        created_at: { $lt: '2026-09-01T00:00:00.000Z' },
      })
    })
  })

  describe('in the reader time zone (list pages)', () => {
    it('shifts the day bounds to Europe/Warsaw', () => {
      expect(compile(rule('created_at', 'is', '2026-01-17'), 'Europe/Warsaw')).toEqual({
        created_at: { $gte: '2026-01-16T23:00:00.000Z', $lte: '2026-01-17T22:59:59.999Z' },
      })
    })

    it('shifts the day bounds to America/Los_Angeles across a DST change', () => {
      expect(compile(rule('created_at', 'between', ['2026-03-07', '2026-03-08']), 'America/Los_Angeles')).toEqual({
        created_at: { $gte: '2026-03-07T08:00:00.000Z', $lte: '2026-03-09T06:59:59.999Z' },
      })
    })

    it.each([
      ['Europe/Warsaw', '2026-01-16T23:30:00.000Z'],
      ['America/New_York', '2026-01-17T03:30:00.000Z'],
      ['Asia/Tokyo', '2026-01-16T15:30:00.000Z'],
    ])('matches a record near midnight on the day it is displayed in %s', (timeZone, createdAt) => {
      const displayedDay = calendarDayIn(createdAt, timeZone)
      const where = compile(rule('created_at', 'is', displayedDay), timeZone)
      expect(matches(where, createdAt)).toBe(true)

      const utcDay = calendarDayIn(createdAt, 'UTC')
      expect(utcDay).not.toBe(displayedDay)
      expect(matches(compile(rule('created_at', 'is', utcDay), timeZone), createdAt)).toBe(false)
    })
  })

  it('does not touch values that already carry a time', () => {
    const input = rule('created_at', 'is', '2026-09-01T10:00:00Z')
    expect(expandCreatedAtDayRules(treeOf(input), 'UTC').root.children[0]).toEqual(input)
  })

  it('does not touch other date fields', () => {
    const input = rule('next_interaction_at', 'is', '2026-09-01')
    expect(expandCreatedAtDayRules(treeOf(input), 'Europe/Warsaw').root.children[0]).toEqual(input)
  })

  it('rewrites created_at rules inside nested groups', () => {
    const tree = treeOf({
      id: 'nested',
      type: 'group',
      combinator: 'or',
      children: [rule('created_at', 'is', '2026-09-01'), rule('display_name', 'contains', 'acme')],
    })
    const nested = expandCreatedAtDayRules(tree, 'UTC').root.children[0]
    expect(nested.type).toBe('group')
    if (nested.type !== 'group') return
    expect(nested.children[0]).toMatchObject({
      operator: 'between',
      value: ['2026-09-01T00:00:00.000Z', '2026-09-01T23:59:59.999Z'],
    })
    expect(nested.children[1]).toEqual(rule('display_name', 'contains', 'acme'))
  })

  it('passes null through', () => {
    expect(expandCreatedAtDayRules(null, 'UTC')).toBeNull()
  })
})
