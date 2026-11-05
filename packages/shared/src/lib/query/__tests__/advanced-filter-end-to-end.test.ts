/**
 * End-to-end Phase 1-5 verification of the user's reported AND/OR scenarios.
 *
 * Pipeline exercised:
 *   AdvancedFilterTree
 *   -> compileTreeToWhere (advanced-filter-tree.ts)
 *   -> mergeAdvancedFilterTree (advanced-filter-integration.ts)
 *   -> normalizeFilters with DNF expansion + common-clause lift (join-utils.ts)
 *
 * The user's bug: with seed people Daniel Cho & Naomi Harris,
 *   - "Name contains Daniel OR Name contains Naomi" should return both;
 *   - "Name contains Daniel AND Name contains Harris" should return Daniel Harris (or none if absent),
 *     NOT Naomi Harris alone.
 *
 * We verify the math by inspecting the normalized filter shape that the engine
 * would issue. Each test asserts on which row(s) match.
 */
/** @jest-environment node */
import { compileTreeToWhere, type AdvancedFilterTree, type FilterRule, type FilterGroup } from '../advanced-filter-tree'
import { mergeAdvancedFilterTree } from '../../crud/advanced-filter-integration'
import { normalizeFilters } from '../join-utils'
import type { FilterOp } from '../types'

type Row = { id: string; display_name: string; status?: string; kind: 'person' }
const people: Row[] = [
  { id: '1', display_name: 'Daniel Cho', kind: 'person' },
  { id: '2', display_name: 'Naomi Harris', kind: 'person', status: 'Lead' },
  { id: '3', display_name: 'Daniel Harris', kind: 'person' },
  { id: '4', display_name: 'Naomi Cho', kind: 'person' },
]

type Predicate = (row: Row) => boolean

function leafToPredicate(field: string, op: FilterOp, value: unknown): Predicate {
  return (row: Row) => {
    const cell = (row as Record<string, unknown>)[field]
    if (op === 'eq') return cell === value
    if (op === 'ne') return cell !== value
    if (op === 'ilike' && typeof cell === 'string' && typeof value === 'string') {
      // Convert SQL ilike pattern (% wildcards) to regex
      const pattern = value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')
      return new RegExp(`^${pattern}$`, 'i').test(cell)
    }
    if (op === 'in' && Array.isArray(value)) return value.includes(cell)
    if (op === 'exists') return value === true ? cell != null : cell == null
    return false
  }
}

/**
 * Take normalized filter output (regular base filters + orGroup-tagged disjuncts)
 * and produce a single predicate. Mirrors the engine's eb.and([...]) and eb.or([...]).
 */
function buildPredicate(filters: ReturnType<typeof normalizeFilters>): Predicate {
  const regular: Predicate[] = []
  const groups = new Map<string, Predicate[]>()
  for (const f of filters) {
    const pred = leafToPredicate(String(f.field), f.op, f.value)
    if (f.orGroup) {
      const list = groups.get(f.orGroup) ?? []
      list.push(pred)
      groups.set(f.orGroup, list)
    } else {
      regular.push(pred)
    }
  }
  return (row: Row) => {
    for (const p of regular) if (!p(row)) return false
    if (groups.size === 0) return true
    for (const [, preds] of groups) {
      if (preds.every((p) => p(row))) return true
    }
    return false
  }
}

function evaluate(routeFilters: Record<string, unknown>, tree: AdvancedFilterTree): Row[] {
  const merged = mergeAdvancedFilterTree(routeFilters, tree)
  const normalized = normalizeFilters(merged)
  const pred = buildPredicate(normalized)
  return people.filter(pred)
}

const rule = (field: string, op: FilterRule['operator'], value: string): FilterRule => ({
  id: `${field}:${value}`, type: 'rule', field, operator: op, value,
})
const group = (combinator: 'and' | 'or', children: Array<FilterRule | FilterGroup>): FilterGroup => ({
  id: combinator, type: 'group', combinator, children,
})

describe('Advanced filter — end-to-end user bug scenarios', () => {
  const baseRouteFilters: Record<string, unknown> = { kind: { $eq: 'person' } }

  test('"Name contains Daniel" -> 2 rows', () => {
    const tree: AdvancedFilterTree = { root: group('and', [rule('display_name', 'contains', 'Daniel')]) }
    expect(evaluate(baseRouteFilters, tree).map((r) => r.display_name).sort()).toEqual(['Daniel Cho', 'Daniel Harris'])
  })

  test('"Name contains Daniel AND Name contains Harris" -> 1 row (Daniel Harris) — Bug A fixed', () => {
    const tree: AdvancedFilterTree = {
      root: group('and', [
        rule('display_name', 'contains', 'Daniel'),
        rule('display_name', 'contains', 'Harris'),
      ]),
    }
    expect(evaluate(baseRouteFilters, tree).map((r) => r.display_name)).toEqual(['Daniel Harris'])
  })

  test('"Name contains Daniel OR Name contains Naomi" -> 4 rows', () => {
    const tree: AdvancedFilterTree = {
      root: group('or', [
        rule('display_name', 'contains', 'Daniel'),
        rule('display_name', 'contains', 'Naomi'),
      ]),
    }
    expect(evaluate(baseRouteFilters, tree).map((r) => r.display_name).sort()).toEqual([
      'Daniel Cho', 'Daniel Harris', 'Naomi Cho', 'Naomi Harris',
    ])
  })

  test('"(Daniel OR Naomi) AND Harris" -> 2 rows', () => {
    const tree: AdvancedFilterTree = {
      root: group('and', [
        group('or', [
          rule('display_name', 'contains', 'Daniel'),
          rule('display_name', 'contains', 'Naomi'),
        ]),
        rule('display_name', 'contains', 'Harris'),
      ]),
    }
    expect(evaluate(baseRouteFilters, tree).map((r) => r.display_name).sort()).toEqual([
      'Daniel Harris', 'Naomi Harris',
    ])
  })

  test('"Daniel OR (Naomi AND Harris)" -> 3 rows (precedence-distinct from above)', () => {
    const tree: AdvancedFilterTree = {
      root: group('or', [
        rule('display_name', 'contains', 'Daniel'),
        group('and', [
          rule('display_name', 'contains', 'Naomi'),
          rule('display_name', 'contains', 'Harris'),
        ]),
      ]),
    }
    expect(evaluate(baseRouteFilters, tree).map((r) => r.display_name).sort()).toEqual([
      'Daniel Cho', 'Daniel Harris', 'Naomi Harris',
    ])
  })

  test('mixed-field: "(status is Lead) OR (Name contains Cho)" -> 3 rows (Naomi Harris by status, Daniel/Naomi Cho by name)', () => {
    const tree: AdvancedFilterTree = {
      root: group('or', [
        rule('status', 'is', 'Lead'),
        rule('display_name', 'contains', 'Cho'),
      ]),
    }
    expect(evaluate(baseRouteFilters, tree).map((r) => r.display_name).sort()).toEqual([
      'Daniel Cho', 'Naomi Cho', 'Naomi Harris',
    ])
  })

  test('empty tree returns route filters only (all persons)', () => {
    const tree: AdvancedFilterTree = { root: group('and', []) }
    expect(evaluate(baseRouteFilters, tree)).toHaveLength(4)
  })

  test('depth-3 tree: "(Daniel AND (Cho OR Harris)) OR (Naomi AND Cho)" -> 3 rows', () => {
    const tree: AdvancedFilterTree = {
      root: group('or', [
        group('and', [
          rule('display_name', 'contains', 'Daniel'),
          group('or', [
            rule('display_name', 'contains', 'Cho'),
            rule('display_name', 'contains', 'Harris'),
          ]),
        ]),
        group('and', [
          rule('display_name', 'contains', 'Naomi'),
          rule('display_name', 'contains', 'Cho'),
        ]),
      ]),
    }
    expect(evaluate(baseRouteFilters, tree).map((r) => r.display_name).sort()).toEqual([
      'Daniel Cho', 'Daniel Harris', 'Naomi Cho',
    ])
  })
})

describe('Advanced filter — long chains and high-cardinality combinations', () => {
  // Add 6 more rows to exercise long ORs.
  const more: Row[] = [
    { id: '5', display_name: 'Lena Ortiz', kind: 'person' },
    { id: '6', display_name: 'Mia Johnson', kind: 'person' },
    { id: '7', display_name: 'Taylor Brooks', kind: 'person' },
    { id: '8', display_name: 'Arjun Patel', kind: 'person' },
  ]
  const everyone = [...people, ...more]
  function evalAll(routeFilters: Record<string, unknown>, tree: AdvancedFilterTree): Row[] {
    const merged = mergeAdvancedFilterTree(routeFilters, tree)
    const normalized = normalizeFilters(merged)
    const pred = buildPredicate(normalized)
    return everyone.filter(pred)
  }
  const c = (v: string): FilterRule => rule('display_name', 'contains', v)

  test('6-way OR matches all six people', () => {
    const t: AdvancedFilterTree = { root: group('or', ['Daniel', 'Naomi', 'Lena', 'Mia', 'Taylor', 'Arjun'].map(c)) }
    expect(evalAll({}, t).map((r) => r.display_name).sort()).toEqual([
      'Arjun Patel', 'Daniel Cho', 'Daniel Harris', 'Lena Ortiz', 'Mia Johnson', 'Naomi Cho', 'Naomi Harris', 'Taylor Brooks',
    ])
  })

  test('5-way AND impossible for distinct names returns empty', () => {
    const t: AdvancedFilterTree = { root: group('and', ['Daniel', 'Naomi', 'Lena', 'Mia', 'Taylor'].map(c)) }
    expect(evalAll({}, t)).toHaveLength(0)
  })

  test('4-way AND that one row satisfies', () => {
    const t: AdvancedFilterTree = { root: group('and', ['Daniel', 'Cho', 'Dan', 'Daniel'].map(c)) }
    expect(evalAll({}, t).map((r) => r.display_name)).toEqual(['Daniel Cho'])
  })

  test('Two OR groups ANDed: (A OR B) AND (C OR D)', () => {
    const t: AdvancedFilterTree = {
      root: group('and', [
        group('or', [c('Daniel'), c('Naomi')]),
        group('or', [c('Cho'), c('Harris')]),
      ]),
    }
    expect(evalAll({}, t).map((r) => r.display_name).sort()).toEqual(['Daniel Cho', 'Daniel Harris', 'Naomi Cho', 'Naomi Harris'])
  })

  test('Three OR groups ANDed: (A OR B) AND (C OR D) AND (E OR F)', () => {
    const t: AdvancedFilterTree = {
      root: group('and', [
        group('or', [c('Daniel'), c('Naomi')]),
        group('or', [c('Cho'), c('Harris')]),
        group('or', [c('Lena'), c('Mia')]),
      ]),
    }
    expect(evalAll({}, t)).toHaveLength(0)
  })

  test('Depth-3 mixed (Daniel OR (Naomi AND Harris)) OR Lena', () => {
    const t: AdvancedFilterTree = {
      root: group('or', [
        c('Daniel'),
        group('and', [c('Naomi'), c('Harris')]),
        c('Lena'),
      ]),
    }
    expect(evalAll({}, t).map((r) => r.display_name).sort()).toEqual(['Daniel Cho', 'Daniel Harris', 'Lena Ortiz', 'Naomi Harris'])
  })

  test('Depth-3 deeper: ((Daniel AND Cho) OR Naomi) AND (Cho OR Harris)', () => {
    const t: AdvancedFilterTree = {
      root: group('and', [
        group('or', [
          group('and', [c('Daniel'), c('Cho')]),
          c('Naomi'),
        ]),
        group('or', [c('Cho'), c('Harris')]),
      ]),
    }
    expect(evalAll({}, t).map((r) => r.display_name).sort()).toEqual(['Daniel Cho', 'Naomi Cho', 'Naomi Harris'])
  })

  test('10-way OR with mixed hits and misses (de-dup verified)', () => {
    const t: AdvancedFilterTree = {
      root: group('or', ['Daniel', 'Naomi', 'Lena', 'XXX', 'YYY', 'Mia', 'Taylor', 'Arjun', 'ZZZ', 'Patel'].map(c)),
    }
    expect(evalAll({}, t).map((r) => r.display_name).sort()).toEqual([
      'Arjun Patel', 'Daniel Cho', 'Daniel Harris', 'Lena Ortiz', 'Mia Johnson', 'Naomi Cho', 'Naomi Harris', 'Taylor Brooks',
    ])
  })

  test('Wide AND clause: (10-way OR over names) AND a single rule', () => {
    const t: AdvancedFilterTree = {
      root: group('and', [
        group('or', ['Daniel', 'Naomi', 'Lena', 'Mia', 'Taylor', 'Arjun', 'Sara', 'John', 'Bob', 'Tom'].map(c)),
        c('Cho'),
      ]),
    }
    expect(evalAll({}, t).map((r) => r.display_name).sort()).toEqual(['Daniel Cho', 'Naomi Cho'])
  })

  test('4-level nested: ((Daniel OR Naomi) AND Cho) OR ((Lena OR Mia) AND Ortiz)', () => {
    const t: AdvancedFilterTree = {
      root: group('or', [
        group('and', [group('or', [c('Daniel'), c('Naomi')]), c('Cho')]),
        group('and', [group('or', [c('Lena'), c('Mia')]), c('Ortiz')]),
      ]),
    }
    expect(evalAll({}, t).map((r) => r.display_name).sort()).toEqual(['Daniel Cho', 'Lena Ortiz', 'Naomi Cho'])
  })

  test('AND of 5 OR-pairs produces a large DNF (32 disjuncts) and still resolves correctly', () => {
    const t: AdvancedFilterTree = {
      root: group('and', [
        group('or', [c('Daniel'), c('Naomi')]),
        group('or', [c('Cho'), c('Harris')]),
        group('or', [c('Cho'), c('Harris')]),
        group('or', [c('Daniel'), c('Naomi')]),
        group('or', [c('Cho'), c('Harris')]),
      ]),
    }
    // logically reduces to (Daniel OR Naomi) AND (Cho OR Harris) - 4 rows
    expect(evalAll({}, t).map((r) => r.display_name).sort()).toEqual(['Daniel Cho', 'Daniel Harris', 'Naomi Cho', 'Naomi Harris'])
  })

  test('Same value repeated in OR — collapses to a single match', () => {
    const t: AdvancedFilterTree = { root: group('or', [c('Daniel'), c('Daniel')]) }
    expect(evalAll({}, t).map((r) => r.display_name).sort()).toEqual(['Daniel Cho', 'Daniel Harris'])
  })

  test('Width cap: 15 OR alternatives — accepted', () => {
    const t: AdvancedFilterTree = {
      root: group('or', ['Daniel','Naomi','Lena','Mia','Taylor','Arjun','Cho','Harris','Ortiz','Johnson','Brooks','Patel','Dan','Nao','Len'].map(c)),
    }
    expect(evalAll({}, t).map((r) => r.display_name).length).toBe(8) // all 8 distinct rows
  })
})

describe('Advanced filter — math vs old buggy algorithm', () => {
  // Compare current algorithm output to what the buggy old algorithm would produce
  // for the user's specific bug cases. This documents the regression contract.
  test('Old AND collision would return Naomi Harris; new tree returns Daniel Harris', () => {
    const tree: AdvancedFilterTree = {
      root: group('and', [
        rule('display_name', 'contains', 'Daniel'),
        rule('display_name', 'contains', 'Harris'),
      ]),
    }
    const got = evaluate({}, tree).map((r) => r.display_name)
    expect(got).toEqual(['Daniel Harris'])
    expect(got).not.toContain('Naomi Harris')
  })

  test('Standard SQL precedence: A OR (B AND C) is NOT (A OR B) AND C', () => {
    // Demonstrate the design's claim about precedence: these two trees give
    // different result sets, so the model preserves the user's intent.
    const A_or_BC: AdvancedFilterTree = {
      root: group('or', [
        rule('display_name', 'contains', 'Daniel'),
        group('and', [
          rule('display_name', 'contains', 'Naomi'),
          rule('display_name', 'contains', 'Harris'),
        ]),
      ]),
    }
    const AB_or_then_C: AdvancedFilterTree = {
      root: group('and', [
        group('or', [
          rule('display_name', 'contains', 'Daniel'),
          rule('display_name', 'contains', 'Naomi'),
        ]),
        rule('display_name', 'contains', 'Harris'),
      ]),
    }
    const a = evaluate({}, A_or_BC).map((r) => r.display_name).sort()
    const b = evaluate({}, AB_or_then_C).map((r) => r.display_name).sort()
    expect(a).not.toEqual(b)
    expect(a).toEqual(['Daniel Cho', 'Daniel Harris', 'Naomi Harris'])
    expect(b).toEqual(['Daniel Harris', 'Naomi Harris'])
  })
})
