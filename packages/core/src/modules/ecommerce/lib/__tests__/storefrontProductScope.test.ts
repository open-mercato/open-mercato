import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type RawBuilder,
  type SelectQueryBuilder,
} from 'kysely'
import {
  intersectScopes,
  matchesScope,
  unionScopes,
  type AssortmentScope,
  type EffectiveAssortmentScope,
  type ScopedProduct,
} from '@open-mercato/shared/lib/catalog-visibility'
import {
  mulberry32,
  randomAssortmentScope,
  randomProduct,
  randomSource,
} from '@open-mercato/shared/lib/catalog-visibility/__tests__/testFixtures'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { normalizeFilters, type NormalizedFilter } from '@open-mercato/shared/lib/query/join-utils'
import type { FilterOp, Where } from '@open-mercato/shared/lib/query/types'
import { buildProductScopeKeys } from '@open-mercato/core/modules/catalog/lib/productScopeKeys'
import { HybridQueryEngine } from '@open-mercato/core/modules/query_index/lib/engine'
import {
  buildAssortmentScopeFilter,
  buildStorefrontProductScope,
  buildStorefrontSearchIndexDocFilter,
  composeStorefrontProductFilters,
  type StorefrontProductScopeContext,
} from '../storefrontProductScope'
import { evaluateIndexDocFilter } from './indexDocFilterEvaluator'

const TENANT_ID = 'tenant-1'
const ORGANIZATION_ID = 'org-1'

const CATEGORY_ANCESTORS: Record<string, string[]> = {
  c1: [],
  c2: ['c1'],
  c3: ['c1'],
  c4: ['c2', 'c1'],
  c5: [],
}

type ProductRow = {
  id: string
  tenant_id: string
  organization_id: string
  deleted_at: Date | null
  is_active: boolean
  doc: Record<string, unknown>
}

type GeneratedProduct = { row: ProductRow; matcherInput: ScopedProduct }

function makeContext(assortmentScope: EffectiveAssortmentScope): StorefrontProductScopeContext {
  return { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, buyer: { assortmentScope } }
}

function expandWithAncestors(categoryIds: string[]): string[] {
  const expanded = new Set<string>()
  for (const categoryId of categoryIds) {
    expanded.add(categoryId)
    for (const ancestorId of CATEGORY_ANCESTORS[categoryId] ?? []) expanded.add(ancestorId)
  }
  return Array.from(expanded)
}

function buildProduct(assigned: ScopedProduct, overrides: Partial<ProductRow> = {}): GeneratedProduct {
  const scopeKeys = buildProductScopeKeys({
    categories: assigned.categoryIds.map((categoryId) => ({
      categoryId,
      ancestorIds: CATEGORY_ANCESTORS[categoryId] ?? [],
    })),
    tagIds: assigned.tagIds,
  })
  return {
    row: {
      id: assigned.id,
      tenant_id: TENANT_ID,
      organization_id: ORGANIZATION_ID,
      deleted_at: null,
      is_active: true,
      doc: { scope_keys: scopeKeys },
      ...overrides,
    },
    matcherInput: { id: assigned.id, categoryIds: expandWithAncestors(assigned.categoryIds), tagIds: assigned.tagIds },
  }
}

const BASE_COLUMNS = new Set(['id', 'tenant_id', 'organization_id', 'deleted_at', 'is_active'])

function readBaseColumn(row: ProductRow, field: string): unknown {
  switch (field) {
    case 'id': return row.id
    case 'tenant_id': return row.tenant_id
    case 'organization_id': return row.organization_id
    case 'deleted_at': return row.deleted_at
    case 'is_active': return row.is_active
    default: throw new Error(`[internal] unexpected base column ${field}`)
  }
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [String(value)]
}

function evaluateLeaf(row: ProductRow, filter: NormalizedFilter): boolean {
  if (BASE_COLUMNS.has(filter.field)) {
    const actual = readBaseColumn(row, filter.field)
    if (filter.op === 'eq') return filter.value === null ? actual === null : actual === filter.value
    if (filter.op === 'nin') return !asStringList(filter.value).includes(String(actual))
    throw new Error(`[internal] interpreter does not support ${filter.op} on ${filter.field}`)
  }
  const docValue = row.doc[filter.field]
  const isArray = Array.isArray(docValue)
  const present = isArray ? new Set(docValue.map((entry) => String(entry))) : new Set<string>()
  switch (filter.op) {
    case 'exists':
      return filter.value ? docValue !== undefined && docValue !== null : docValue === undefined || docValue === null
    case 'overlap':
      return isArray && asStringList(filter.value).some((key) => present.has(key))
    case 'noverlap':
      return isArray && !asStringList(filter.value).some((key) => present.has(key))
    default:
      throw new Error(`[internal] interpreter does not support ${filter.op} on ${filter.field}`)
  }
}

function evaluateNormalized(row: ProductRow, filters: NormalizedFilter[]): boolean {
  const regular = filters.filter((filter) => !filter.orGroup)
  if (!regular.every((filter) => evaluateLeaf(row, filter))) return false
  const groups = new Map<string, NormalizedFilter[]>()
  for (const filter of filters) {
    if (!filter.orGroup) continue
    const group = groups.get(filter.orGroup) ?? []
    group.push(filter)
    groups.set(filter.orGroup, group)
  }
  if (groups.size === 0) return true
  return Array.from(groups.values()).some((group) => group.every((filter) => evaluateLeaf(row, filter)))
}

function isVisible(row: ProductRow, filters: Where): boolean {
  return evaluateNormalized(row, normalizeFilters(filters))
}

function randomNestedScope(rng: () => number, depth: number): AssortmentScope {
  const scope = randomAssortmentScope(rng)
  if (depth > 0 && rng() < 0.5) {
    scope.allOf = [randomNestedScope(rng, depth - 1)]
    if (rng() < 0.3) scope.allOf.push(randomNestedScope(rng, depth - 1))
  }
  return scope
}

function randomEffectiveScope(rng: () => number): EffectiveAssortmentScope {
  const roll = rng()
  if (roll < 0.05) return null
  if (roll < 0.1) return []
  const sourceCount = 1 + Math.floor(rng() * 3)
  const sources = Array.from({ length: sourceCount }, () => randomSource(rng))
  let scope = unionScopes(sources)
  if (rng() < 0.5) {
    const channel = rng() < 0.2 ? null : randomAssortmentScope(rng)
    scope = intersectScopes(channel, scope)
  }
  if (scope !== null && rng() < 0.25) {
    scope = scope.map((branch) => ({ ...branch, allOf: [...(branch.allOf ?? []), randomNestedScope(rng, 2)] }))
  }
  return scope
}

describe('buildStorefrontProductScope — equivalence with matchesScope', () => {
  it('admits exactly the products matchesScope admits (seeded, 2500 scopes x 8 products)', () => {
    const rng = mulberry32(0x5c09e)
    let evaluated = 0
    let visibleCount = 0
    for (let scopeCase = 0; scopeCase < 2500; scopeCase += 1) {
      const effective = randomEffectiveScope(rng)
      const { filters } = buildStorefrontProductScope(makeContext(effective))
      const normalized = normalizeFilters(filters)
      expect(normalized.length).toBeGreaterThan(0)
      for (let productIndex = 0; productIndex < 8; productIndex += 1) {
        const product = buildProduct(randomProduct(rng, productIndex))
        const expected = matchesScope(product.matcherInput, effective)
        const actual = evaluateNormalized(product.row, normalized)
        if (actual !== expected) {
          throw new Error(
            `[internal] divergence for scope ${JSON.stringify(effective)} and product ${JSON.stringify(product.matcherInput)}: sql=${actual} matchesScope=${expected}`,
          )
        }
        evaluated += 1
        if (actual) visibleCount += 1
      }
    }
    expect(evaluated).toBe(20000)
    expect(visibleCount).toBeGreaterThan(0)
    expect(visibleCount).toBeLessThan(evaluated)
  })
})

describe('buildStorefrontProductScope — invariant', () => {
  const indexed = buildProduct({ id: 'p1', categoryIds: ['c1'], tagIds: ['t1'] })

  it('always scopes tenant, organization, soft delete and active flag', () => {
    const scope = buildStorefrontProductScope(makeContext(null))
    expect(scope).toEqual({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      withDeleted: false,
      filters: { tenant_id: TENANT_ID, organization_id: ORGANIZATION_ID, deleted_at: null, is_active: true },
    })
    expect(isVisible(indexed.row, scope.filters)).toBe(true)
    expect(isVisible({ ...indexed.row, tenant_id: 'tenant-2' }, scope.filters)).toBe(false)
    expect(isVisible({ ...indexed.row, organization_id: 'org-2' }, scope.filters)).toBe(false)
    expect(isVisible({ ...indexed.row, deleted_at: new Date() }, scope.filters)).toBe(false)
    expect(isVisible({ ...indexed.row, is_active: false }, scope.filters)).toBe(false)
  })

  it('keeps the invariant when restricted, too', () => {
    const { filters } = buildStorefrontProductScope(makeContext([{ categoryIds: ['c1'] }]))
    expect(isVisible(indexed.row, filters)).toBe(true)
    expect(isVisible({ ...indexed.row, is_active: false }, filters)).toBe(false)
    expect(isVisible({ ...indexed.row, tenant_id: 'tenant-2' }, filters)).toBe(false)
  })

  it('throws when the context has no tenant or organization', () => {
    expect(() => buildStorefrontProductScope({ ...makeContext(null), tenantId: '' })).toThrow('[internal]')
    expect(() => buildStorefrontProductScope({ ...makeContext(null), organizationId: '' })).toThrow('[internal]')
  })

  it('composes endpoint filters with AND so they can never replace an invariant clause', () => {
    const scope = buildStorefrontProductScope(makeContext([{ tagIds: ['t1'] }]))
    expect(composeStorefrontProductFilters(scope, null)).toBe(scope.filters)
    expect(composeStorefrontProductFilters(scope, {})).toBe(scope.filters)
    const hostile = composeStorefrontProductFilters(scope, { tenant_id: 'tenant-2', is_active: false })
    expect(isVisible(indexed.row, hostile)).toBe(false)
    expect(isVisible({ ...indexed.row, tenant_id: 'tenant-2', is_active: false }, hostile)).toBe(false)
    const narrowing = composeStorefrontProductFilters(scope, { id: { $nin: ['p1'] } })
    expect(isVisible(indexed.row, narrowing)).toBe(false)
  })
})

describe('buildStorefrontProductScope — scope translation', () => {
  const missingKeys = buildProduct({ id: 'p1', categoryIds: ['c1'], tagIds: [] }, { doc: {} })
  const nullKeys = buildProduct({ id: 'p1', categoryIds: ['c1'], tagIds: [] }, { doc: { scope_keys: null } })

  it('emits no scope predicate for an unrestricted buyer, so unindexed products stay visible', () => {
    expect(buildAssortmentScopeFilter(null)).toBeNull()
    const { filters } = buildStorefrontProductScope(makeContext(null))
    expect(isVisible(missingKeys.row, filters)).toBe(true)
    expect(isVisible(nullKeys.row, filters)).toBe(true)
  })

  it('compiles deny-all to an empty overlap, never to an empty $or the normalizer would drop', () => {
    expect(buildAssortmentScopeFilter([])).toEqual({ scope_keys: { $overlap: [] } })
    const { filters } = buildStorefrontProductScope(makeContext([]))
    const product = buildProduct({ id: 'p1', categoryIds: ['c1', 'c2'], tagIds: ['t1'] })
    expect(isVisible(product.row, filters)).toBe(false)
    expect(normalizeFilters(filters)).toContainEqual(expect.objectContaining({ field: 'scope_keys', op: 'overlap', value: [] }))
  })

  it.each<[string, EffectiveAssortmentScope]>([
    ['an unconditional branch', [{}]],
    ['an exclude-products-only branch', [{ excludeProductIds: ['p9'] }]],
    ['an exclude-categories-only branch', [{ excludeCategoryIds: ['c5'] }]],
    ['a category branch', [{ categoryIds: ['c1'] }]],
    ['several branches', [{ categoryIds: ['c1'] }, { tagIds: ['t1'] }, {}]],
  ])('fails closed on products whose scope_keys are missing or null under %s', (_label, effective) => {
    const { filters } = buildStorefrontProductScope(makeContext(effective))
    expect(isVisible(missingKeys.row, filters)).toBe(false)
    expect(isVisible(nullKeys.row, filters)).toBe(false)
    const indexedProduct = buildProduct({ id: 'p1', categoryIds: ['c1'], tagIds: ['t1'] })
    expect(isVisible(indexedProduct.row, filters)).toBe(matchesScope(indexedProduct.matcherInput, effective))
  })

  it('grants descendants of a granted category through the ancestor-expanded scope_keys', () => {
    const { filters } = buildStorefrontProductScope(makeContext([{ categoryIds: ['c1'] }]))
    expect(isVisible(buildProduct({ id: 'p1', categoryIds: ['c4'], tagIds: [] }).row, filters)).toBe(true)
    expect(isVisible(buildProduct({ id: 'p2', categoryIds: ['c5'], tagIds: [] }).row, filters)).toBe(false)
    const excluding = buildStorefrontProductScope(makeContext([{ excludeCategoryIds: ['c2'] }])).filters
    expect(isVisible(buildProduct({ id: 'p1', categoryIds: ['c4'], tagIds: [] }).row, excluding)).toBe(false)
    expect(isVisible(buildProduct({ id: 'p1', categoryIds: ['c3'], tagIds: [] }).row, excluding)).toBe(true)
  })

  it('ANDs allOf entries recursively and ORs branches', () => {
    const effective: EffectiveAssortmentScope = [
      { categoryIds: ['c2'], allOf: [{ tagIds: ['t1'], allOf: [{ excludeProductIds: ['p2'] }] }] },
      { tagIds: ['t5'] },
    ]
    const { filters } = buildStorefrontProductScope(makeContext(effective))
    const cases: ScopedProduct[] = [
      { id: 'p1', categoryIds: ['c2'], tagIds: ['t1'] },
      { id: 'p2', categoryIds: ['c2'], tagIds: ['t1'] },
      { id: 'p1', categoryIds: ['c2'], tagIds: [] },
      { id: 'p2', categoryIds: [], tagIds: ['t5'] },
    ]
    expect(cases.map((product) => isVisible(buildProduct(product).row, filters))).toEqual([true, false, false, true])
  })

  it('absorbs implied branches so lifting shared clauses never narrows the OR', () => {
    const effective: EffectiveAssortmentScope = [
      { categoryIds: ['c1'] },
      { categoryIds: ['c1'], tagIds: ['t1'] },
      { categoryIds: ['c1'] },
    ]
    expect(buildAssortmentScopeFilter(effective)).toEqual({
      $and: [{ scope_keys: { $exists: true } }, { scope_keys: { $overlap: ['cat:c1'] } }],
    })
    const { filters } = buildStorefrontProductScope(makeContext(effective))
    expect(isVisible(buildProduct({ id: 'p1', categoryIds: ['c1'], tagIds: [] }).row, filters)).toBe(true)
  })

  it('merges category and tag exclusions into one noverlap and product exclusions into one nin', () => {
    expect(buildAssortmentScopeFilter([
      { excludeCategoryIds: ['c2'], excludeTagIds: ['t3'], excludeProductIds: ['p2'], allOf: [{ excludeProductIds: ['p1'] }] },
    ])).toEqual({
      $and: [
        { scope_keys: { $exists: true } },
        { scope_keys: { $noverlap: ['cat:c2', 'tag:t3'] } },
        { id: { $nin: ['p1', 'p2'] } },
      ],
    })
  })
})

function makeCompilingDb(): Kysely<Record<string, Record<string, unknown>>> {
  return new Kysely({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
}

type Builder = SelectQueryBuilder<Record<string, Record<string, unknown>>, string, Record<string, unknown>>

type HybridInternals = {
  applyIndexDocFilterFromAlias: (q: Builder, alias: string, entityType: string, key: string, op: FilterOp, value: unknown, recordIdColumn: string) => Builder
  buildIndexDocFilterExpression: (eb: unknown, alias: string, entity: string, key: string, op: FilterOp, value: unknown, recordIdColumn: string) => RawBuilder<boolean>
}

describe('buildStorefrontProductScope — compiled SQL shape', () => {
  const db = makeCompilingDb()
  const em = { getKysely: () => db } as unknown as EntityManager
  const engine = new HybridQueryEngine(em, new BasicQueryEngine(em, () => db)) as unknown as HybridInternals
  const entity = 'catalog:catalog_product'

  function base(): Builder {
    return db.selectFrom('catalog_products as b').leftJoin('entity_indexes as ei', 'ei.entity_id', 'b.id').select('b.id') as unknown as Builder
  }

  const effective: EffectiveAssortmentScope = [
    { categoryIds: ['c1'], excludeTagIds: ['t9'] },
    { tagIds: ['t1'] },
  ]
  const scopeLeaves = normalizeFilters(buildStorefrontProductScope(makeContext(effective)).filters)
    .filter((filter) => filter.field === 'scope_keys')

  it('targets the GIN-indexed (doc -> \'scope_keys\') expression with ?| on the ungrouped path', () => {
    const overlapLeaves = scopeLeaves.filter((filter) => filter.op === 'overlap')
    expect(overlapLeaves.length).toBeGreaterThan(0)
    for (const leaf of overlapLeaves) {
      const compiled = engine.applyIndexDocFilterFromAlias(base(), 'ei', entity, leaf.field, leaf.op, leaf.value, 'b.id').compile()
      expect(compiled.sql).toContain(`("ei"."doc" -> 'scope_keys') ?| $1::text[]`)
    }
  })

  it('keeps the same expression inside OR groups and negates it for exclusions', () => {
    const grouped = scopeLeaves.filter((filter) => filter.orGroup)
    expect(grouped.map((filter) => filter.op).sort()).toEqual(['noverlap', 'overlap', 'overlap'])
    const compiled = base()
      .where((eb) => eb.or(grouped.map((leaf) =>
        engine.buildIndexDocFilterExpression(eb, 'ei', entity, leaf.field, leaf.op, leaf.value, 'b.id'),
      )))
      .compile()
    expect(compiled.sql.match(/\("ei"\."doc" -> 'scope_keys'\) \?\| \$\d+::text\[\]/g)?.length).toBe(3)
    expect(compiled.sql).toContain(`not (("ei"."doc" -> 'scope_keys') ?| $`)
    expect(compiled.sql).not.toContain('->>')
  })
})

describe('buildStorefrontSearchIndexDocFilter — the listing scope as a search-strategy predicate', () => {
  function searchVisible(row: ProductRow, effective: EffectiveAssortmentScope): boolean {
    return evaluateIndexDocFilter(
      { id: row.id, doc: { ...row.doc, is_active: row.is_active } },
      buildStorefrontSearchIndexDocFilter(makeContext(effective)),
    )
  }

  it('admits exactly what the listing scope admits (seeded, 2500 scopes x 8 products)', () => {
    const rng = mulberry32(0x5ea4c)
    let evaluated = 0
    let visibleCount = 0
    for (let scopeCase = 0; scopeCase < 2500; scopeCase += 1) {
      const effective = randomEffectiveScope(rng)
      const { filters } = buildStorefrontProductScope(makeContext(effective))
      for (let productIndex = 0; productIndex < 8; productIndex += 1) {
        const product = buildProduct(randomProduct(rng, productIndex), rng() < 0.15 ? { is_active: false } : {})
        const expected = isVisible(product.row, filters)
        const actual = searchVisible(product.row, effective)
        if (actual !== expected) {
          throw new Error(
            `[internal] divergence for scope ${JSON.stringify(effective)} and product ${JSON.stringify(product.row)}: search=${actual} listing=${expected}`,
          )
        }
        evaluated += 1
        if (actual) visibleCount += 1
      }
    }
    expect(evaluated).toBe(20000)
    expect(visibleCount).toBeGreaterThan(0)
    expect(visibleCount).toBeLessThan(evaluated)
  })

  it('keeps only the active condition for an unrestricted buyer, so unindexed products stay findable', () => {
    expect(buildStorefrontSearchIndexDocFilter(makeContext(null))).toEqual({
      anyOf: [[{ op: 'eq', key: 'is_active', value: true }]],
    })
  })

  it('compiles deny-all to an empty disjunction, which matches nothing', () => {
    expect(buildStorefrontSearchIndexDocFilter(makeContext([]))).toEqual({ anyOf: [] })
  })

  it('mirrors the listing leaves branch by branch: exists, overlap, merged noverlap and record exclusions', () => {
    const filter = buildStorefrontSearchIndexDocFilter(
      makeContext([
        { categoryIds: ['c2'], excludeTagIds: ['t9'], excludeCategoryIds: ['c4'], excludeProductIds: ['p-x'] },
        { tagIds: ['t1'] },
        { tagIds: ['t1'], categoryIds: ['c1'] },
      ]),
    )
    expect(filter.anyOf).toEqual([
      [
        { op: 'eq', key: 'is_active', value: true },
        { op: 'exists', key: 'scope_keys' },
        { op: 'overlap', key: 'scope_keys', values: ['cat:c2'] },
        { op: 'noverlap', key: 'scope_keys', values: ['cat:c4', 'tag:t9'] },
        { op: 'recordIdNotIn', values: ['p-x'] },
      ],
      [
        { op: 'eq', key: 'is_active', value: true },
        { op: 'exists', key: 'scope_keys' },
        { op: 'overlap', key: 'scope_keys', values: ['tag:t1'] },
      ],
    ])
  })
})
