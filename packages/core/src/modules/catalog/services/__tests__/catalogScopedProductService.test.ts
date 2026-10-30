import type { EntityManager } from '@mikro-orm/postgresql'
import { matchesScope, type AssortmentScope, type EffectiveAssortmentScope, type ScopedProduct } from '@open-mercato/shared/lib/catalog-visibility'
import {
  buildProductScopeKeys,
  computeProductScopeKeys,
  PRODUCT_SCOPE_CATEGORY_PREFIX,
  PRODUCT_SCOPE_TAG_PREFIX,
} from '../../lib/productScopeKeys'
import { createFakeKysely, type RecordedQuery } from '../../lib/__tests__/fakeKysely'
import { DefaultCatalogScopedProductService } from '../catalogScopedProductService'

/**
 * Property-based equivalence check (50-100+ randomized fixtures, mulberry32-seeded — same
 * house style as `lib/__tests__/buildPriceRowFilter.property.test.ts`).
 *
 * `loadScopedProducts` is a thin, batched composition over two already-shipped mechanisms:
 * `productScopeKeys.ts`'s `buildProductScopeKeys`/`computeProductScopeKeys` (the ancestor-expanded
 * `cat:`/`tag:` keys) and `@open-mercato/shared/lib/catalog-visibility`'s `matchesScope` (the
 * buyer-visibility predicate those keys feed). This test generates many randomized
 * product/category/tag/scope fixtures and asserts the service's `{ categoryIds, tagIds, isActive }`
 * output stays consistent with both mechanisms computed directly from the same raw fixture data,
 * across every generated case — not just one or two hand-picked ones.
 */

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = 20261014
const ITERATIONS = 80
const SCOPES_PER_PRODUCT = 3

const TENANT = 'tenant-1'
const OTHER_TENANT = 'tenant-2'
const ORG = 'org-1'
const OTHER_ORG = 'org-2'
const scope = { tenantId: TENANT, organizationId: ORG }

type ProductKind = 'active' | 'inactive' | 'deleted' | 'other_tenant' | 'absent'
const KINDS: ProductKind[] = ['active', 'inactive', 'deleted', 'other_tenant', 'absent']

type CategoryFixture = { categoryId: string; ancestorIds: string[] }
type ProductFixture = {
  id: string
  kind: ProductKind
  categories: CategoryFixture[]
  tagIds: string[]
}

type MockProductRow = { id: string; tenantId: string; organizationId: string; isActive: boolean; deletedAt: Date | null }

let mockProductStore: MockProductRow[] = []

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(
    async (
      _em: unknown,
      _entity: unknown,
      where: { id: { $in: string[] }; tenantId: string; organizationId: string; deletedAt: null },
    ) => {
      const ids = new Set(where.id.$in)
      return mockProductStore.filter(
        (row) =>
          ids.has(row.id) &&
          row.tenantId === where.tenantId &&
          row.organizationId === where.organizationId &&
          row.deletedAt === null,
      )
    },
  ),
}))

function pick<T>(rng: () => number, options: readonly T[]): T {
  return options[Math.floor(rng() * options.length)]
}

function sampleSubset<T>(rng: () => number, pool: readonly T[], probability = 0.5): T[] {
  return pool.filter(() => rng() < probability)
}

function randomCategory(rng: () => number, index: number): CategoryFixture {
  const ancestorCount = Math.floor(rng() * 3)
  return {
    categoryId: `cat-${index}`,
    ancestorIds: Array.from({ length: ancestorCount }, (_, a) => `anc-${index}-${a}`),
  }
}

function randomProductFixture(rng: () => number, index: number): ProductFixture {
  const kind = pick(rng, KINDS)
  const categoryCount = Math.floor(rng() * 4)
  const categories = Array.from({ length: categoryCount }, () => randomCategory(rng, Math.floor(rng() * 1000)))
  const tagCount = Math.floor(rng() * 3)
  const tagIds = Array.from({ length: tagCount }, () => `tag-${Math.floor(rng() * 1000)}`)
  return { id: `product-${index}`, kind, categories, tagIds }
}

function respondFromFixtures(fixtures: ProductFixture[]) {
  const categoryRows: Array<{ product_id: string; category_id: string; ancestor_ids: unknown }> = []
  const tagRows: Array<{ product_id: string; tag_id: string }> = []
  for (const fixture of fixtures) {
    for (const category of fixture.categories) {
      categoryRows.push({ product_id: fixture.id, category_id: category.categoryId, ancestor_ids: category.ancestorIds })
    }
    for (const tagId of fixture.tagIds) {
      tagRows.push({ product_id: fixture.id, tag_id: tagId })
    }
  }
  return (query: RecordedQuery) => {
    if (query.sql.includes('catalog_product_category_assignments')) return categoryRows
    if (query.sql.includes('catalog_product_tag_assignments')) return tagRows
    return []
  }
}

function splitKeys(keys: string[]): { categoryIds: string[]; tagIds: string[] } {
  const categoryIds: string[] = []
  const tagIds: string[] = []
  for (const key of keys) {
    if (key.startsWith(PRODUCT_SCOPE_CATEGORY_PREFIX)) categoryIds.push(key.slice(PRODUCT_SCOPE_CATEGORY_PREFIX.length))
    else if (key.startsWith(PRODUCT_SCOPE_TAG_PREFIX)) tagIds.push(key.slice(PRODUCT_SCOPE_TAG_PREFIX.length))
  }
  return { categoryIds, tagIds }
}

function asSet(values: string[]): Set<string> {
  return new Set(values)
}

function setsEqual(left: string[], right: string[]): boolean {
  const a = asSet(left)
  const b = asSet(right)
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

function randomAssortmentScope(rng: () => number, categoryPool: string[], tagPool: string[], productId: string): AssortmentScope {
  const out: AssortmentScope = {}
  if (categoryPool.length && rng() < 0.6) out.categoryIds = sampleSubset(rng, categoryPool)
  if (tagPool.length && rng() < 0.4) out.tagIds = sampleSubset(rng, tagPool)
  if (categoryPool.length && rng() < 0.2) out.excludeCategoryIds = sampleSubset(rng, categoryPool)
  if (tagPool.length && rng() < 0.2) out.excludeTagIds = sampleSubset(rng, tagPool)
  if (rng() < 0.1) out.excludeProductIds = [productId]
  return out
}

function randomEffectiveScope(
  rng: () => number,
  categoryPool: string[],
  tagPool: string[],
  productId: string,
): EffectiveAssortmentScope {
  const mode = rng()
  if (mode < 0.15) return null
  if (mode < 0.25) return []
  const count = 1 + Math.floor(rng() * 2)
  return Array.from({ length: count }, () => randomAssortmentScope(rng, categoryPool, tagPool, productId))
}

describe('DefaultCatalogScopedProductService.loadScopedProducts (property-based)', () => {
  it(`stays consistent with buildProductScopeKeys/computeProductScopeKeys and matchesScope over ${ITERATIONS} randomized batches`, async () => {
    const rng = mulberry32(SEED)
    const service = new DefaultCatalogScopedProductService()
    let foundCount = 0
    let missingCount = 0
    let matchedScopeCount = 0

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const batchSize = 2 + Math.floor(rng() * 3)
      const fixtures = Array.from({ length: batchSize }, (_, i) => randomProductFixture(rng, iteration * 10 + i))

      mockProductStore = fixtures
        .filter((fixture) => fixture.kind !== 'absent')
        .map((fixture) => ({
          id: fixture.id,
          tenantId: fixture.kind === 'other_tenant' ? OTHER_TENANT : TENANT,
          organizationId: fixture.kind === 'other_tenant' ? OTHER_ORG : ORG,
          isActive: fixture.kind === 'inactive' ? false : fixture.kind === 'active' ? true : rng() < 0.5,
          deletedAt: fixture.kind === 'deleted' ? new Date('2024-01-01T00:00:00Z') : null,
        }))

      const fake = createFakeKysely(respondFromFixtures(fixtures))
      const em = { getKysely: () => fake.db } as unknown as EntityManager

      const ids = fixtures.map((fixture) => fixture.id)
      const result = await service.loadScopedProducts(em, ids, scope)

      expect(Array.from(result.keys()).sort()).toEqual(ids.slice().sort())

      const categoryPool = fixtures.flatMap((fixture) => [
        ...fixture.categories.map((category) => category.categoryId),
        ...fixture.categories.flatMap((category) => category.ancestorIds),
      ])
      const tagPool = fixtures.flatMap((fixture) => fixture.tagIds)

      for (const fixture of fixtures) {
        const record = result.get(fixture.id)

        if (fixture.kind === 'deleted' || fixture.kind === 'other_tenant' || fixture.kind === 'absent') {
          expect(record).toBeNull()
          missingCount += 1
          continue
        }

        foundCount += 1
        expect(record).not.toBeNull()
        if (!record) continue

        const storeRow = mockProductStore.find((row) => row.id === fixture.id)
        expect(record.isActive).toBe(storeRow?.isActive)

        const expectedKeysFromBuild = buildProductScopeKeys({ categories: fixture.categories, tagIds: fixture.tagIds })
        const expectedFromCompute = (await computeProductScopeKeys(fake.db, [fixture.id], scope)).get(fixture.id) ?? []
        expect(expectedFromCompute).toEqual(expectedKeysFromBuild)

        const { categoryIds: expectedCategoryIds, tagIds: expectedTagIds } = splitKeys(expectedKeysFromBuild)
        expect(setsEqual(record.categoryIds, expectedCategoryIds)).toBe(true)
        expect(setsEqual(record.tagIds, expectedTagIds)).toBe(true)

        const fromService: ScopedProduct = { id: fixture.id, categoryIds: record.categoryIds, tagIds: record.tagIds }
        const fromDirect: ScopedProduct = { id: fixture.id, categoryIds: expectedCategoryIds, tagIds: expectedTagIds }

        for (let s = 0; s < SCOPES_PER_PRODUCT; s += 1) {
          const effectiveScope = randomEffectiveScope(rng, categoryPool, tagPool, fixture.id)
          const serviceMatch = matchesScope(fromService, effectiveScope)
          const directMatch = matchesScope(fromDirect, effectiveScope)
          expect(serviceMatch).toBe(directMatch)
          if (serviceMatch) matchedScopeCount += 1
        }
      }
    }

    // A generation scheme that never produced a found product, a missing product, or a
    // positive scope match would make the equivalence checks above vacuously true.
    expect(foundCount).toBeGreaterThan(0)
    expect(missingCount).toBeGreaterThan(0)
    expect(matchedScopeCount).toBeGreaterThan(0)
  })
})
