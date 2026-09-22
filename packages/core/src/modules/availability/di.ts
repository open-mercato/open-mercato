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

    for (const item of query.items) {
      const resolved = await service.resolve(em, {
        tenantId: query.tenantId,
        organizationId: query.organizationId,
        storeId: query.storeId ?? null,
        productId: item.catalogProductId,
        variantId: item.catalogVariantId ?? null,
      })
      overrides[availabilityItemKey(item)] = {
        isStockManaged: resolved.isStockManaged.value,
        isActive: resolved.isActive.value,
        preorderReleaseAt: resolved.preorderReleaseAt.value ? resolved.preorderReleaseAt.value.toISOString() : null,
        policySourceId:
          resolved.preorderReleaseAt.policySourceId
          ?? resolved.isActive.policySourceId
          ?? resolved.isStockManaged.policySourceId
          ?? null,
      }
    }

    return overrides
  })
}
