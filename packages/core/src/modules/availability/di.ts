import { asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { setCatalogOnlyPolicyLookup, availabilityItemKey } from '@open-mercato/shared/lib/availability'
import type { CatalogOnlyPolicyOverride } from '@open-mercato/shared/lib/availability'
import { AvailabilityPolicy } from './data/entities'
import { createPolicyResolutionService } from './lib/policyResolution'

export function register(container: AppContainer) {
  container.register({
    AvailabilityPolicy: asValue(AvailabilityPolicy),
    policyResolutionService: {
      resolve: (c) => createPolicyResolutionService(c),
    },
  })

  // Wires the shared catalog-only fallback's optional policy hook (decision 2,
  // PLAN.md § Key design decisions) — closure captures the boot container, the
  // same technique `wms/di.ts` uses for its own provider registration.
  setCatalogOnlyPolicyLookup(async (query) => {
    const em = (container.resolve('em') as EntityManager).fork()
    const service = createPolicyResolutionService(container)
    const overrides: Record<string, CatalogOnlyPolicyOverride | null> = {}

    // Batched (R4): one resolveMany() call for the whole item set, not one
    // resolve() per item — the same discipline wms's provider follows.
    const resolved = await service.resolveMany(
      em,
      query.items.map((item) => ({
        tenantId: query.tenantId,
        organizationId: query.organizationId,
        storeId: query.storeId ?? null,
        productId: item.catalogProductId,
        variantId: item.catalogVariantId ?? null,
      })),
    )

    query.items.forEach((item, index) => {
      const policy = resolved[index]
      overrides[availabilityItemKey(item)] = {
        isStockManaged: policy.isStockManaged.value,
        isActive: policy.isActive.value,
        preorderReleaseAt: policy.preorderReleaseAt.value ? policy.preorderReleaseAt.value.toISOString() : null,
        policySourceId:
          policy.preorderReleaseAt.policySourceId
          ?? policy.isActive.policySourceId
          ?? policy.isStockManaged.policySourceId
          ?? null,
      }
    })

    return overrides
  })
}
