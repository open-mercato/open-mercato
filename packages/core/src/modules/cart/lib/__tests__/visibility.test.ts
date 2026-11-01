// Step 4.4 — fake-container orchestration coverage for `evaluateCartVisibility` (same
// spirit as `promotions/lib/__tests__/promotions-service.test.ts`'s hand-built `resolve(name)`
// fake container): no real database, a fake `catalogScopedProductService` this file fully
// controls. Proves the wiring and the §6a.3/variant-derives-product contracts this function
// owns — not `matchesScope`'s own algebra (already covered by
// `@open-mercato/shared/lib/catalog-visibility`'s tests) and not any later call site
// (Steps 4.5/4.6's job).

import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  CatalogScopedProductService,
  ScopedProductRecord,
} from '@open-mercato/core/modules/catalog/services/catalogScopedProductService'
import {
  cartVisibilityKey,
  evaluateCartVisibility,
  isUnavailable,
  isVisible,
  type CartVisibilityContainer,
} from '../visibility'

const TENANT_SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

function fakeEm(): EntityManager {
  return {} as unknown as EntityManager
}

function fakeCatalogScopedProductService(
  records: Map<string, ScopedProductRecord | null>,
): CatalogScopedProductService {
  return {
    async loadScopedProducts(_em, ids) {
      const result = new Map<string, ScopedProductRecord | null>()
      for (const id of ids) result.set(id, records.has(id) ? records.get(id)! : null)
      return result
    },
  }
}

function fakeContainer(service: CatalogScopedProductService): CartVisibilityContainer {
  return {
    resolve: <T>(name: string): T => {
      if (name === 'catalogScopedProductService') return service as unknown as T
      throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
    },
  }
}

function product(id: string, categoryIds: string[] = [], tagIds: string[] = []): ScopedProductRecord {
  return { id, categoryIds, tagIds, isActive: true }
}

describe('evaluateCartVisibility', () => {
  it('is visible when scope is unrestricted (null)', async () => {
    const service = fakeCatalogScopedProductService(new Map([['prod-1', product('prod-1', ['cat-a'])]]))
    const result = await evaluateCartVisibility({
      lines: [{ productId: 'prod-1', variantId: null }],
      scope: null,
      tenantScope: TENANT_SCOPE,
      em: fakeEm(),
      container: fakeContainer(service),
    })

    const outcome = result.get(cartVisibilityKey({ productId: 'prod-1', variantId: null }))
    expect(outcome).toBe('visible')
    expect(isVisible(outcome!)).toBe(true)
  })

  it('is unavailable when the scope excludes the product category', async () => {
    const service = fakeCatalogScopedProductService(new Map([['prod-1', product('prod-1', ['cat-wholesale'])]]))
    const result = await evaluateCartVisibility({
      lines: [{ productId: 'prod-1', variantId: null }],
      scope: [{ categoryIds: ['cat-retail'] }],
      tenantScope: TENANT_SCOPE,
      em: fakeEm(),
      container: fakeContainer(service),
    })

    const outcome = result.get(cartVisibilityKey({ productId: 'prod-1', variantId: null }))
    expect(outcome).toBe('unavailable')
    expect(isUnavailable(outcome!)).toBe(true)
  })

  it('collapses a restricted product and a nonexistent product to the IDENTICAL outcome (§6a.3 — no enumeration oracle)', async () => {
    const service = fakeCatalogScopedProductService(
      new Map([['prod-restricted', product('prod-restricted', ['cat-wholesale'])]]),
      // 'prod-missing' is deliberately absent from the map so the fake resolves it to `null`,
      // exactly as `loadScopedProducts` does for a product that is missing, soft-deleted, or
      // belongs to another tenant/organization.
    )
    const scope = [{ categoryIds: ['cat-retail'] }]

    const result = await evaluateCartVisibility({
      lines: [
        { productId: 'prod-restricted', variantId: null },
        { productId: 'prod-missing', variantId: null },
      ],
      scope,
      tenantScope: TENANT_SCOPE,
      em: fakeEm(),
      container: fakeContainer(service),
    })

    const restrictedOutcome = result.get(cartVisibilityKey({ productId: 'prod-restricted', variantId: null }))
    const missingOutcome = result.get(cartVisibilityKey({ productId: 'prod-missing', variantId: null }))

    expect(restrictedOutcome).toBe('unavailable')
    expect(missingOutcome).toBe('unavailable')
    // Not just "both falsy" — the actual return values are the same string, proving the
    // two code paths (found-but-non-matching vs. null record) are indistinguishable to a caller.
    expect(restrictedOutcome).toBe(missingOutcome)
  })

  it('never changes outcome based on variantId — visibility is the parent product\'s alone', async () => {
    const service = fakeCatalogScopedProductService(new Map([['prod-1', product('prod-1', ['cat-wholesale'])]]))
    const scope = [{ categoryIds: ['cat-retail'] }]

    const withoutVariant = await evaluateCartVisibility({
      lines: [{ productId: 'prod-1', variantId: null }],
      scope,
      tenantScope: TENANT_SCOPE,
      em: fakeEm(),
      container: fakeContainer(service),
    })
    const withVariant = await evaluateCartVisibility({
      lines: [{ productId: 'prod-1', variantId: 'variant-xyz' }],
      scope,
      tenantScope: TENANT_SCOPE,
      em: fakeEm(),
      container: fakeContainer(service),
    })

    expect(withoutVariant.get(cartVisibilityKey({ productId: 'prod-1', variantId: null }))).toBe('unavailable')
    expect(withVariant.get(cartVisibilityKey({ productId: 'prod-1', variantId: 'variant-xyz' }))).toBe('unavailable')
  })

  it('resolves a batch of several lines correctly per-line, not just for n=1', async () => {
    const service = fakeCatalogScopedProductService(
      new Map([
        ['prod-visible', product('prod-visible', ['cat-retail'])],
        ['prod-hidden', product('prod-hidden', ['cat-wholesale'])],
      ]),
    )
    const scope = [{ categoryIds: ['cat-retail'] }]

    const result = await evaluateCartVisibility({
      lines: [
        { productId: 'prod-visible', variantId: null },
        { productId: 'prod-hidden', variantId: null },
        { productId: 'prod-missing', variantId: null },
      ],
      scope,
      tenantScope: TENANT_SCOPE,
      em: fakeEm(),
      container: fakeContainer(service),
    })

    expect(result.get(cartVisibilityKey({ productId: 'prod-visible', variantId: null }))).toBe('visible')
    expect(result.get(cartVisibilityKey({ productId: 'prod-hidden', variantId: null }))).toBe('unavailable')
    expect(result.get(cartVisibilityKey({ productId: 'prod-missing', variantId: null }))).toBe('unavailable')
  })

  it('treats every product as visible when enforcement is off (scope undefined), without resolving the catalog service', async () => {
    let resolveCalls = 0
    const container: CartVisibilityContainer = {
      resolve: <T>(name: string): T => {
        resolveCalls += 1
        throw new Error(`[internal] unexpected DI resolve in test: ${name}`)
      },
    }

    const result = await evaluateCartVisibility({
      lines: [
        { productId: 'prod-1', variantId: null },
        { productId: 'prod-2', variantId: 'variant-1' },
      ],
      scope: undefined,
      tenantScope: TENANT_SCOPE,
      em: fakeEm(),
      container,
    })

    expect(result.get(cartVisibilityKey({ productId: 'prod-1', variantId: null }))).toBe('visible')
    expect(result.get(cartVisibilityKey({ productId: 'prod-2', variantId: 'variant-1' }))).toBe('visible')
    expect(resolveCalls).toBe(0)
  })

  it('returns an empty result for an empty batch', async () => {
    const service = fakeCatalogScopedProductService(new Map())
    const result = await evaluateCartVisibility({
      lines: [],
      scope: null,
      tenantScope: TENANT_SCOPE,
      em: fakeEm(),
      container: fakeContainer(service),
    })
    expect(result.size).toBe(0)
  })
})
