/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type RawBuilder,
} from 'kysely'
import { compileTreeToWhere, makeRuleTree, makeMultiRuleTree } from '../advanced-filter-tree'
import { buildMultiValueRuleFilter, convertAdvancedFilterToWhere } from '../advanced-filter'
import { normalizeFilters, type NormalizedFilter } from '../join-utils'
import { mergeAdvancedFilters } from '../../crud/advanced-filter-integration'
import { BasicQueryEngine } from '../engine'
import type { FilterOp } from '../types'

const db = new Kysely<Record<string, never>>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
})

type EngineInternals = {
  buildColumnOpExpression: (eb: unknown, column: string, op: string, value: unknown) => RawBuilder<boolean>
  buildIndexDocOpExpression: (eb: unknown, opts: {
    entity: string
    field: string
    op: FilterOp
    value: unknown
    recordIdColumn: string
    tenantId?: string | null
    withDeleted: boolean
  }) => RawBuilder<boolean>
}

const engine = new BasicQueryEngine({} as EntityManager, () => db) as unknown as EngineInternals

function leaves(filters: NormalizedFilter[]): Array<{ field: string; op: FilterOp; value: unknown }> {
  return filters.map(({ field, op, value }) => ({ field, op, value }))
}

function compileColumnLeaves(filters: NormalizedFilter[]) {
  return db
    .selectFrom('customers as b' as never)
    .select('b.id' as never)
    .where((eb) => eb.and(filters.map((filter) => engine.buildColumnOpExpression(eb, `b.${filter.field}`, filter.op, filter.value))))
    .compile()
}

describe('tags operators — tree compiler (compileTreeToWhere)', () => {
  it('reproduces #7459: has_all_of no longer normalizes to an empty filter list', () => {
    const where = compileTreeToWhere(makeRuleTree({ field: 'tags', operator: 'has_all_of', value: ['vip', 'eu'] }))
    expect(normalizeFilters(where ?? undefined)).not.toEqual([])
    expect(leaves(normalizeFilters(where ?? undefined))).toEqual([
      { field: 'tags', op: 'overlap', value: ['vip'] },
      { field: 'tags', op: 'overlap', value: ['eu'] },
    ])
  })

  it('compiles has_any_of to a single overlap leaf', () => {
    const where = compileTreeToWhere(makeRuleTree({ field: 'tags', operator: 'has_any_of', value: ['vip', 'eu'] }))
    expect(where).toEqual({ tags: { $overlap: ['vip', 'eu'] } })
    expect(leaves(normalizeFilters(where ?? undefined))).toEqual([{ field: 'tags', op: 'overlap', value: ['vip', 'eu'] }])
  })

  it('compiles has_none_of to a single noverlap leaf', () => {
    const where = compileTreeToWhere(makeRuleTree({ field: 'tags', operator: 'has_none_of', value: ['vip'] }))
    expect(where).toEqual({ tags: { $noverlap: ['vip'] } })
    expect(leaves(normalizeFilters(where ?? undefined))).toEqual([{ field: 'tags', op: 'noverlap', value: ['vip'] }])
  })

  it('compiles a single-value has_all_of without a $and wrapper', () => {
    expect(compileTreeToWhere(makeRuleTree({ field: 'tags', operator: 'has_all_of', value: ['vip'] })))
      .toEqual({ tags: { $overlap: ['vip'] } })
  })

  it('drops blank values and skips a rule whose list is empty', () => {
    expect(compileTreeToWhere(makeRuleTree({ field: 'tags', operator: 'has_any_of', value: ['  ', 'vip'] })))
      .toEqual({ tags: { $overlap: ['vip'] } })
    expect(compileTreeToWhere(makeRuleTree({ field: 'tags', operator: 'has_all_of', value: [] }))).toBeNull()
  })

  it('keeps has_all_of AND-ed inside an OR group, never widening the disjunct', () => {
    const where = compileTreeToWhere(makeMultiRuleTree([
      { field: 'tags', operator: 'has_all_of', value: ['vip', 'eu'] },
      { field: 'status', operator: 'is', value: 'lead' },
    ], 'or'))
    const normalized = normalizeFilters(where ?? undefined)
    const groups = new Map<string, Array<{ field: string; op: FilterOp; value: unknown }>>()
    for (const filter of normalized) {
      const key = filter.orGroup ?? 'none'
      groups.set(key, [...(groups.get(key) ?? []), { field: filter.field, op: filter.op, value: filter.value }])
    }
    expect(Array.from(groups.values())).toEqual(expect.arrayContaining([
      [{ field: 'tags', op: 'overlap', value: ['vip'] }, { field: 'tags', op: 'overlap', value: ['eu'] }],
      [{ field: 'status', op: 'eq', value: 'lead' }],
    ]))
  })
})

describe('tags operators — flat compiler (convertAdvancedFilterToWhere)', () => {
  const state = (operator: 'has_any_of' | 'has_all_of' | 'has_none_of', value: unknown) => ({
    logic: 'and' as const,
    conditions: [{ id: '1', field: 'tags', operator, value }],
  })

  it('emits array-aware operators the query engines keep', () => {
    expect(convertAdvancedFilterToWhere(state('has_any_of', ['vip']))).toEqual({ tags: { $overlap: ['vip'] } })
    expect(convertAdvancedFilterToWhere(state('has_none_of', ['vip']))).toEqual({ tags: { $noverlap: ['vip'] } })
    expect(convertAdvancedFilterToWhere(state('has_all_of', ['vip', 'eu']))).toEqual({
      $and: [{ tags: { $overlap: ['vip'] } }, { tags: { $overlap: ['eu'] } }],
    })
    for (const operator of ['has_any_of', 'has_all_of', 'has_none_of'] as const) {
      expect(normalizeFilters(convertAdvancedFilterToWhere(state(operator, ['vip', 'eu'])))).not.toEqual([])
    }
  })

  it('concatenates $and clauses when two has_all_of conditions are AND-joined', () => {
    const where = convertAdvancedFilterToWhere({
      logic: 'and',
      conditions: [
        { id: '1', field: 'tags', operator: 'has_all_of', value: ['vip', 'eu'] },
        { id: '2', field: 'labels', operator: 'has_all_of', value: ['a', 'b'], join: 'and' },
      ],
    })
    expect(leaves(normalizeFilters(where)).map((leaf) => `${leaf.field}:${String(leaf.value)}`)).toEqual([
      'tags:vip', 'tags:eu', 'labels:a', 'labels:b',
    ])
  })
})

describe('tags operators — mergeAdvancedFilters', () => {
  it('keeps the route $and clauses when the advanced filter also emits $and', () => {
    const merged = mergeAdvancedFilters(
      { $and: [{ organization_id: { $eq: 'org-1' } }] },
      {
        'filter[logic]': 'and',
        'filter[conditions][0][field]': 'tags',
        'filter[conditions][0][op]': 'has_all_of',
        'filter[conditions][0][value]': JSON.stringify(['vip', 'eu']),
      },
    )
    expect(leaves(normalizeFilters(merged))).toEqual([
      { field: 'organization_id', op: 'eq', value: 'org-1' },
      { field: 'tags', op: 'overlap', value: ['vip'] },
      { field: 'tags', op: 'overlap', value: ['eu'] },
    ])
  })
})

describe('tags operators — buildMultiValueRuleFilter', () => {
  it('returns null for an empty list or missing field', () => {
    expect(buildMultiValueRuleFilter('tags', 'has_any_of', [])).toBeNull()
    expect(buildMultiValueRuleFilter('', 'has_any_of', ['vip'])).toBeNull()
  })
})

describe('tags operators — engine SQL', () => {
  it('compiles array-column has_any_of / has_all_of / has_none_of to && and not &&', () => {
    const anyOf = compileColumnLeaves(normalizeFilters(compileTreeToWhere(makeRuleTree({ field: 'tags', operator: 'has_any_of', value: ['vip', 'eu'] })) ?? undefined))
    expect(anyOf.sql).toContain('"b"."tags" && $1')
    expect(anyOf.parameters).toEqual([['vip', 'eu']])

    const allOf = compileColumnLeaves(normalizeFilters(compileTreeToWhere(makeRuleTree({ field: 'tags', operator: 'has_all_of', value: ['vip', 'eu'] })) ?? undefined))
    expect(allOf.sql).toContain('"b"."tags" && $1 and "b"."tags" && $2')
    expect(allOf.parameters).toEqual([['vip'], ['eu']])

    const noneOf = compileColumnLeaves(normalizeFilters(compileTreeToWhere(makeRuleTree({ field: 'tags', operator: 'has_none_of', value: ['vip'] })) ?? undefined))
    expect(noneOf.sql).toContain('not ("b"."tags" && $1)')
    expect(noneOf.sql).not.toContain(' in ')
  })

  it('compiles index-document has_all_of to one jsonb ?| per value', () => {
    const normalized = normalizeFilters(compileTreeToWhere(makeRuleTree({ field: 'tags', operator: 'has_all_of', value: ['vip', 'eu'] })) ?? undefined)
    const compiled = db
      .selectFrom('customers as b' as never)
      .select('b.id' as never)
      .where((eb) => eb.and(normalized.map((filter) => engine.buildIndexDocOpExpression(eb, {
        entity: 'customers:customer_entity',
        field: filter.field,
        op: filter.op,
        value: filter.value,
        recordIdColumn: 'b.id',
        tenantId: 'tenant-1',
        withDeleted: false,
      }))))
      .compile()
    expect(compiled.sql.match(/\("ei_\d+"\."doc" -> 'tags'\) \?\| \$\d+::text\[\]/g)).toHaveLength(2)
    expect(compiled.parameters).toEqual(expect.arrayContaining([['vip'], ['eu']]))
  })
})
