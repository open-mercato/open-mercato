const findOneMock = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneMock(...args),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { findCatalogTargetIssue } from '../catalogTarget'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_PRODUCT_ID = '44444444-4444-4444-8444-444444444444'
const VARIANT_ID = '55555555-5555-4555-8555-555555555555'

class CatalogProductStub {}
class CatalogProductVariantStub {}

const em = {} as EntityManager

function makeContainer(registered: Record<string, unknown>) {
  return {
    resolve: <R = unknown>(name: string): R => {
      if (name in registered) return registered[name] as R
      throw new Error(`not registered: ${name}`)
    },
  }
}

const catalogContainer = makeContainer({
  CatalogProduct: CatalogProductStub,
  CatalogProductVariant: CatalogProductVariantStub,
})

function stubCatalog(rows: { product?: object | null; variant?: object | null }) {
  findOneMock.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === CatalogProductStub) return rows.product ?? null
    if (entity === CatalogProductVariantStub) return rows.variant ?? null
    return null
  })
}

const target = { tenantId: TENANT_ID, organizationId: ORG_ID, productId: PRODUCT_ID, variantId: VARIANT_ID }

describe('findCatalogTargetIssue', () => {
  beforeEach(() => findOneMock.mockReset())

  it('accepts a live product with its own variant', async () => {
    stubCatalog({ product: { id: PRODUCT_ID }, variant: { id: VARIANT_ID, product: { id: PRODUCT_ID } } })

    await expect(findCatalogTargetIssue(em, catalogContainer, target)).resolves.toBeNull()
    expect(findOneMock).toHaveBeenCalledWith(
      em,
      CatalogProductVariantStub,
      { id: VARIANT_ID, organizationId: ORG_ID, tenantId: TENANT_ID, deletedAt: null },
      undefined,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  it('reports a missing product', async () => {
    stubCatalog({ product: null })

    await expect(findCatalogTargetIssue(em, catalogContainer, target)).resolves.toBe('productNotFound')
  })

  it('reports an unknown variant', async () => {
    stubCatalog({ product: { id: PRODUCT_ID }, variant: null })

    await expect(findCatalogTargetIssue(em, catalogContainer, target)).resolves.toBe('variantNotFound')
  })

  it('reports a variant of another product', async () => {
    stubCatalog({ product: { id: PRODUCT_ID }, variant: { id: VARIANT_ID, product: { id: OTHER_PRODUCT_ID } } })

    await expect(findCatalogTargetIssue(em, catalogContainer, target)).resolves.toBe('variantProductMismatch')
  })

  it('reads a variant product stored as a bare id', async () => {
    stubCatalog({ product: { id: PRODUCT_ID }, variant: { id: VARIANT_ID, product: OTHER_PRODUCT_ID } })

    await expect(findCatalogTargetIssue(em, catalogContainer, target)).resolves.toBe('variantProductMismatch')
  })

  it('skips the product lookup when asked, but still checks the variant', async () => {
    stubCatalog({ product: null, variant: { id: VARIANT_ID, product: { id: OTHER_PRODUCT_ID } } })

    await expect(findCatalogTargetIssue(em, catalogContainer, target, { checkProduct: false })).resolves.toBe(
      'variantProductMismatch',
    )
    expect(findOneMock).not.toHaveBeenCalledWith(em, CatalogProductStub, expect.anything(), undefined, expect.anything())
  })

  it('reports nothing when catalog is not installed', async () => {
    await expect(findCatalogTargetIssue(em, makeContainer({}), target)).resolves.toBeNull()
    expect(findOneMock).not.toHaveBeenCalled()
  })
})
