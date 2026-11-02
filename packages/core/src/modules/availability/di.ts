import { asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { setCatalogOnlyPolicyLookup, availabilityItemKey } from '@open-mercato/shared/lib/availability'
import type {
  AvailabilityDependencyResolver,
  AvailabilityProviderContext,
  AvailabilityQuery,
  CatalogOnlyPolicyOverride,
} from '@open-mercato/shared/lib/availability'
import { AvailabilityPolicy } from './data/entities'
import { createPolicyResolutionService } from './lib/policyResolution'

async function createDefaultContainer(): Promise<AvailabilityDependencyResolver> {
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  return createRequestContainer()
}

async function catalogOnlyPolicyLookup(
  query: AvailabilityQuery,
  context?: AvailabilityProviderContext,
): Promise<Record<string, CatalogOnlyPolicyOverride | null>> {
  const container = context?.container ?? (await createDefaultContainer())
  const em = container.resolve<EntityManager>('em').fork()
  const service = createPolicyResolutionService(container)
  const overrides: Record<string, CatalogOnlyPolicyOverride | null> = {}

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
      minOrderQuantity: policy.minOrderQuantity.value,
      maxOrderQuantity: policy.maxOrderQuantity.value,
      quantityIncrement: policy.quantityIncrement.value,
      policySourceId:
        policy.preorderReleaseAt.policySourceId
        ?? policy.isActive.policySourceId
        ?? policy.isStockManaged.policySourceId
        ?? null,
    }
  })

  return overrides
}

export function register(container: AppContainer) {
  container.register({
    AvailabilityPolicy: asValue(AvailabilityPolicy),
    policyResolutionService: {
      resolve: (c) => createPolicyResolutionService(c),
    },
  })

  setCatalogOnlyPolicyLookup(catalogOnlyPolicyLookup)
}
