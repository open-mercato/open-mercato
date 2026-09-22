import type { EntityManager } from '@mikro-orm/postgresql'
import { createPolicyResolutionService, resolveIsStockManagedModuleDefault } from '../policyResolution'
import type { PolicyResolutionScope } from '../policyResolution'
import { AvailabilityPolicy } from '../../data/entities'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const PRODUCT = 'product-1'
const VARIANT = 'variant-1'
const STORE = 'store-1'

function row(overrides: Record<string, unknown>) {
  return {
    id: overrides.id ?? 'row-id',
    tenantId: TENANT,
    organizationId: ORG,
    storeId: null,
    productId: null,
    variantId: null,
    isStockManaged: false,
    allowBackorder: false,
    backorderLeadTimeDays: null,
    preorderReleaseAt: null,
    lowStockThreshold: null,
    minOrderQuantity: null,
    maxOrderQuantity: null,
    quantityIncrement: null,
    hideWhenOutOfStock: false,
    isActive: true,
    ...overrides,
  }
}

function makeEm(
  candidates: unknown[],
  findOneResult: unknown = null,
  profileRows: unknown[] = [],
): { em: EntityManager; findOne: jest.Mock; find: jest.Mock } {
  const find = jest.fn().mockImplementation(async (entityClass: unknown) => {
    // AvailabilityPolicy candidate pool vs the batched ProductInventoryProfile lookup —
    // distinguished by entity class, mirroring how resolveMany() calls em.find twice.
    return entityClass === AvailabilityPolicy ? candidates : profileRows
  })
  const findOne = jest.fn().mockResolvedValue(findOneResult)
  const em = { find, findOne } as unknown as EntityManager
  return { em, findOne, find }
}

function makeContainer(withProfileEntity = true) {
  return {
    resolve: <T,>(name: string): T => {
      if (name === 'ProductInventoryProfile' && withProfileEntity) return class {} as unknown as T
      throw new Error(`not registered: ${name}`)
    },
  }
}

const scope: PolicyResolutionScope = {
  tenantId: TENANT,
  organizationId: ORG,
  storeId: STORE,
  productId: PRODUCT,
  variantId: VARIANT,
}

describe('policy resolution chain', () => {
  it('resolves from the variant+store level when it exists (level 1)', async () => {
    const { em } = makeEm([
      row({ id: 'variant-store', variantId: VARIANT, storeId: STORE, allowBackorder: true, backorderLeadTimeDays: 3 }),
      row({ id: 'variant-only', variantId: VARIANT, storeId: null, allowBackorder: false }),
    ])
    const service = createPolicyResolutionService(makeContainer(false))
    const result = await service.resolve(em, scope)
    expect(result.allowBackorder).toEqual({ value: true, policySourceId: 'variant-store' })
    expect(result.backorderLeadTimeDays).toEqual({ value: 3, policySourceId: 'variant-store' })
  })

  it('falls back to variant (all stores) when no variant+store row exists (level 2)', async () => {
    const { em } = makeEm([row({ id: 'variant-only', variantId: VARIANT, storeId: null, isActive: false })])
    const service = createPolicyResolutionService(makeContainer(false))
    const result = await service.resolve(em, scope)
    expect(result.isActive).toEqual({ value: false, policySourceId: 'variant-only' })
  })

  it('falls back to product+store when no variant-level row exists (level 3)', async () => {
    const { em } = makeEm([row({ id: 'product-store', productId: PRODUCT, variantId: null, storeId: STORE, hideWhenOutOfStock: true })])
    const service = createPolicyResolutionService(makeContainer(false))
    const result = await service.resolve(em, scope)
    expect(result.hideWhenOutOfStock).toEqual({ value: true, policySourceId: 'product-store' })
  })

  it('falls back to product (all stores) when no product+store row exists (level 4)', async () => {
    const { em } = makeEm([row({ id: 'product-only', productId: PRODUCT, variantId: null, storeId: null, lowStockThreshold: 5 })])
    const service = createPolicyResolutionService(makeContainer(false))
    const result = await service.resolve(em, scope)
    expect(result.lowStockThreshold).toEqual({ value: 5, policySourceId: 'product-only' })
  })

  it('falls back to the store default row when no product-level row exists (level 5)', async () => {
    const { em } = makeEm([row({ id: 'store-default', productId: null, variantId: null, storeId: STORE, minOrderQuantity: 2 })])
    const service = createPolicyResolutionService(makeContainer(false))
    const result = await service.resolve(em, scope)
    expect(result.minOrderQuantity).toEqual({ value: 2, policySourceId: 'store-default' })
  })

  it('falls back to the org-wide default row (store_id null) when the query names a store but no store-specific default exists', async () => {
    const { em } = makeEm([row({ id: 'org-default', productId: null, variantId: null, storeId: null, minOrderQuantity: 4 })])
    const service = createPolicyResolutionService(makeContainer(false))
    const result = await service.resolve(em, scope)
    // scope.storeId = STORE, but the only row is the org-wide default (store_id null,
    // which §5.1 defines as "applies to all stores") — it must still decide, not the
    // hardcoded module default.
    expect(result.minOrderQuantity).toEqual({ value: 4, policySourceId: 'org-default' })
  })

  it('prefers a store-specific default row over the org-wide default row', async () => {
    const { em } = makeEm([
      row({ id: 'store-default', productId: null, variantId: null, storeId: STORE, minOrderQuantity: 2 }),
      row({ id: 'org-default', productId: null, variantId: null, storeId: null, minOrderQuantity: 4 }),
    ])
    const service = createPolicyResolutionService(makeContainer(false))
    const result = await service.resolve(em, scope)
    expect(result.minOrderQuantity).toEqual({ value: 2, policySourceId: 'store-default' })
  })

  it('falls back to the module default when no row matches at all (level 6)', async () => {
    const { em } = makeEm([])
    const service = createPolicyResolutionService(makeContainer(false))
    const result = await service.resolve(em, scope)
    expect(result.allowBackorder).toEqual({ value: false, policySourceId: null })
    expect(result.isActive).toEqual({ value: true, policySourceId: null })
    expect(result.isStockManaged).toEqual({ value: false, policySourceId: null })
    expect(result.maxOrderQuantity).toEqual({ value: null, policySourceId: null })
  })

  it('cascades a nullable field past a more specific row that leaves it null', async () => {
    const { em } = makeEm([
      row({ id: 'variant-store', variantId: VARIANT, storeId: STORE, maxOrderQuantity: null }),
      row({ id: 'product-only', productId: PRODUCT, variantId: null, storeId: null, maxOrderQuantity: 50 }),
    ])
    const service = createPolicyResolutionService(makeContainer(false))
    const result = await service.resolve(em, scope)
    expect(result.maxOrderQuantity).toEqual({ value: 50, policySourceId: 'product-only' })
  })

  it('does NOT cascade a boolean field past the most specific existing row', async () => {
    const { em } = makeEm([
      row({ id: 'variant-store', variantId: VARIANT, storeId: STORE, allowBackorder: false }),
      row({ id: 'product-only', productId: PRODUCT, variantId: null, storeId: null, allowBackorder: true }),
    ])
    const service = createPolicyResolutionService(makeContainer(false))
    const result = await service.resolve(em, scope)
    // The most specific row's own (false) value decides — never falls through to the product row's true.
    expect(result.allowBackorder).toEqual({ value: false, policySourceId: 'variant-store' })
  })

  it('module default for is_stock_managed is true when wms is enabled and a profile exists', async () => {
    const { em, find } = makeEm([], null, [{ catalogProductId: PRODUCT, catalogVariantId: VARIANT }])
    const service = createPolicyResolutionService(makeContainer(true))
    const result = await service.resolve(em, scope)
    expect(result.isStockManaged).toEqual({ value: true, policySourceId: null })
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('module default for is_stock_managed is false when wms is disabled (no ProductInventoryProfile DI key)', async () => {
    const { em } = makeEm([], null, [{ catalogProductId: PRODUCT, catalogVariantId: VARIANT }])
    const service = createPolicyResolutionService(makeContainer(false))
    const result = await service.resolve(em, scope)
    expect(result.isStockManaged).toEqual({ value: false, policySourceId: null })
  })

  it('module default for is_stock_managed is false when wms is enabled but no profile exists', async () => {
    const { em } = makeEm([], null, [])
    const service = createPolicyResolutionService(makeContainer(true))
    const result = await service.resolve(em, scope)
    expect(result.isStockManaged).toEqual({ value: false, policySourceId: null })
  })
})

describe('resolveIsStockManagedModuleDefault', () => {
  it('returns false when the ProductInventoryProfile DI key is unregistered', async () => {
    const { em } = makeEm([])
    const result = await resolveIsStockManagedModuleDefault(em, makeContainer(false), {
      tenantId: TENANT,
      organizationId: ORG,
      productId: PRODUCT,
      variantId: VARIANT,
    })
    expect(result).toBe(false)
  })
})

describe('resolveMany (batched — R4)', () => {
  it('issues exactly one AvailabilityPolicy query and one profile query regardless of scope count', async () => {
    const scopes: PolicyResolutionScope[] = Array.from({ length: 200 }, (_, i) => ({
      tenantId: TENANT,
      organizationId: ORG,
      productId: `product-${i}`,
      variantId: `variant-${i}`,
      storeId: STORE,
    }))
    const { em, find } = makeEm([], null, [])
    const service = createPolicyResolutionService(makeContainer(true))
    const results = await service.resolveMany(em, scopes)
    expect(results).toHaveLength(200)
    // One call for the AvailabilityPolicy candidate pool, one for the batched profile-existence check.
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('resolves each scope independently from the shared candidate pool', async () => {
    const { em } = makeEm([
      row({ id: 'variant-store', variantId: VARIANT, storeId: STORE, allowBackorder: true, backorderLeadTimeDays: 2 }),
    ])
    const service = createPolicyResolutionService(makeContainer(false))
    const other = { ...scope, productId: 'other-product', variantId: 'other-variant' }
    const [first, second] = await service.resolveMany(em, [scope, other])
    expect(first.allowBackorder).toEqual({ value: true, policySourceId: 'variant-store' })
    expect(second.allowBackorder).toEqual({ value: false, policySourceId: null })
  })
})
