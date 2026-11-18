/** @jest-environment node */
import { z } from 'zod'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
} from '@open-mercato/core/modules/catalog/data/entities'
import { ProductUse } from '../data/entities'
import { FakeEm } from './support/fakeEm'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const CATEGORY = '70000000-0000-4000-8000-000000000001'
const CHILD = '70000000-0000-4000-8000-000000000002'
const OTHER_CATEGORY = '70000000-0000-4000-8000-000000000003'
const route = { em: null as FakeEm | null }

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}))
jest.mock('../api/routeContext', () => ({
  resolveStaffContext: jest.fn(async () => ({ em: route.em, tenantId: scope.tenantId, organizationId: scope.organizationId })),
  handleRouteError: jest.fn(async (err: unknown) => {
    throw err
  }),
}))

import { GET } from '../api/catalog-options/route'
import { listProductsForCategory, listUnitCategories, resolveUnitProduct } from '../lib/productUse'

function productId(index: number): string {
  return `71000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function respondEligibleProducts(em: FakeEm, sql: string, params: unknown[]): unknown[] {
  if (!sql.includes('from catalog_products p')) return []
  const categoryCount = (/a\.category_id in \(([^)]*)\)/.exec(sql)?.[1].match(/\?/g) ?? []).length
  const categoryIds = params.slice(4, 4 + categoryCount)
  const term = sql.includes('ilike') ? String(params[4 + categoryCount]).toLowerCase() : null
  const limit = Number(params[params.length - 1])
  const assigned = new Set(
    em
      .rows(CatalogProductCategoryAssignment)
      .filter((row) => row.organizationId === params[2] && row.tenantId === params[3] && categoryIds.includes(row.category))
      .map((row) => row.product),
  )
  return em
    .rows(CatalogProduct)
    .filter((row) => row.organizationId === params[0] && row.tenantId === params[1] && !row.deletedAt && assigned.has(row.id))
    .filter((row) => term === null || String(row.title).toLowerCase().includes(term))
    .sort((left, right) => String(left.title).localeCompare(String(right.title)) || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map((row) => ({ id: row.id }))
}

function seed(productCount: number): FakeEm {
  const em = new FakeEm()
  em.respond = (sql, params) => respondEligibleProducts(em, sql, params)
  em.seed(CatalogProductCategory, { id: CATEGORY, ...scope, name: 'Offices', depth: 0, parentId: null, treePath: 'a', descendantIds: [CHILD], deletedAt: null } as never)
  em.seed(CatalogProductCategory, { id: CHILD, ...scope, name: 'Private offices', depth: 1, parentId: CATEGORY, treePath: 'a.b', descendantIds: [], deletedAt: null } as never)
  em.seed(CatalogProductCategory, { id: OTHER_CATEGORY, ...scope, name: 'Desks', depth: 0, parentId: null, treePath: 'c', descendantIds: [], deletedAt: null } as never)
  for (let index = 1; index <= productCount; index += 1) {
    const id = productId(index)
    em.seed(CatalogProduct, { id, ...scope, title: `Office ${String(index).padStart(3, '0')}`, deletedAt: null } as never)
    em.seed(CatalogProductCategoryAssignment, { id: `assignment-${index}`, ...scope, product: id, category: index % 2 ? CATEGORY : CHILD } as never)
  }
  em.seed(ProductUse, { id: 'use-1', ...scope, catalogProductId: productId(1), use: 'leasable', billingUnit: 'month' } as never)
  em.seed(CatalogProduct, { id: productId(999), ...scope, title: 'Desk', deletedAt: null } as never)
  em.seed(CatalogProductCategoryAssignment, { id: 'assignment-desk', ...scope, product: productId(999), category: OTHER_CATEGORY } as never)
  return em
}

describe('catalog options', () => {
  it('pages the products of a category subtree in SQL and reports more', async () => {
    const em = seed(5)
    const page = await listProductsForCategory(em as never, scope, CATEGORY, { limit: 2 })
    expect(page.products.map((product) => product.title)).toEqual(['Office 001', 'Office 002'])
    expect(page.products[0]).toMatchObject({ use: 'leasable', billingUnit: 'month' })
    expect(page.hasMore).toBe(true)
    const [query] = em.executed
    expect(query.params.slice(4, 6)).toEqual([CATEGORY, CHILD])
    expect(query.params[query.params.length - 1]).toBe(3)
  })

  it('caps the product limit at 100', async () => {
    const em = seed(120)
    const page = await listProductsForCategory(em as never, scope, CATEGORY, { limit: 500 })
    expect(page.products).toHaveLength(100)
    expect(page.hasMore).toBe(true)
  })

  it('filters products by search', async () => {
    const em = seed(12)
    const page = await listProductsForCategory(em as never, scope, CATEGORY, { search: 'office 01' })
    expect(page.products.map((product) => product.title)).toEqual(['Office 010', 'Office 011', 'Office 012'])
    expect(page.hasMore).toBe(false)
    expect(em.executed[0].sql).toContain('ilike')
    expect(em.executed[0].params).toContain('office 01')
  })

  it('keeps the current product when it is outside the page, but only when it is in the category', async () => {
    const em = seed(5)
    const included = await listProductsForCategory(em as never, scope, CATEGORY, { limit: 2, includeProductId: productId(5) })
    expect(included.products.map((product) => product.id)).toEqual([productId(1), productId(2), productId(5)])
    const foreign = await listProductsForCategory(em as never, scope, CATEGORY, { limit: 2, includeProductId: productId(999) })
    expect(foreign.products.map((product) => product.id)).toEqual([productId(1), productId(2)])
  })

  it('caps the category list and keeps the current category', async () => {
    const em = seed(0)
    const page = await listUnitCategories(em as never, scope, { limit: 1, includeCategoryId: OTHER_CATEGORY })
    expect(page.categories.map((category) => category.id)).toEqual([CATEGORY, OTHER_CATEGORY])
    expect(page.hasMore).toBe(true)
  })

  it('checks that a unit product is in the category subtree without listing the subtree', async () => {
    const em = seed(3)
    await expect(resolveUnitProduct(em as never, scope, { catalogCategoryId: CATEGORY, catalogProductId: productId(1) })).resolves.toMatchObject({
      catalogProductId: productId(1),
      use: 'leasable',
    })
    await expect(resolveUnitProduct(em as never, scope, { catalogCategoryId: CATEGORY, catalogProductId: productId(999) })).rejects.toMatchObject({
      status: 422,
    })
  })
})

describe('GET /api/property_management/catalog-options', () => {
  it('passes search and limit through and reports whether more exist', async () => {
    route.em = seed(4)
    const response = (await GET(
      new Request(`http://localhost/api/property_management/catalog-options?categoryId=${CATEGORY}&search=office&limit=3`),
    )) as unknown as { body: { products: unknown[]; categories: unknown[]; hasMoreProducts: boolean; hasMoreCategories: boolean } }
    expect(response.body.products).toHaveLength(3)
    expect(response.body.hasMoreProducts).toBe(true)
    expect(response.body.categories).toHaveLength(3)
    expect(response.body.hasMoreCategories).toBe(false)
  })

  it('refuses a limit above 100', async () => {
    route.em = seed(1)
    await expect(GET(new Request('http://localhost/api/property_management/catalog-options?limit=101'))).rejects.toBeInstanceOf(z.ZodError)
  })
})
