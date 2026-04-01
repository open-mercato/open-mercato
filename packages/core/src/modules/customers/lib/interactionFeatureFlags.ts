type ContainerLike = {
  resolve: (name: string) => unknown
}

type FeatureToggleResult = {
  ok: boolean
  value?: boolean
}

type FeatureToggleServiceLike = {
  getBoolConfig: (identifier: string, tenantId: string) => Promise<FeatureToggleResult>
}

export const customerInteractionFeatureIds = {
  unified: 'customers.interactions.unified',
  legacyAdapters: 'customers.interactions.legacy-adapters',
  externalSync: 'customers.interactions.external-sync',
} as const

const customerInteractionFeatureAliases: Record<keyof typeof customerInteractionFeatureIds, string[]> = {
  unified: ['customers_interactions_unified'],
  legacyAdapters: ['customers_interactions_legacy_adapters'],
  externalSync: ['customers_interactions_external_sync'],
}

export type CustomerInteractionFeatureFlags = {
  unified: boolean
  legacyAdapters: boolean
  externalSync: boolean
}

const defaultCustomerInteractionFeatureFlags: CustomerInteractionFeatureFlags = {
  unified: false,
  legacyAdapters: true,
  externalSync: false,
}

async function resolveBooleanFeature(
  service: FeatureToggleServiceLike | null,
  tenantId: string | null | undefined,
  identifiers: string[],
  fallback: boolean,
): Promise<boolean> {
  if (!service || !tenantId) return fallback

  for (const identifier of identifiers) {
    try {
      const result = await service.getBoolConfig(identifier, tenantId)
      if (result.ok && typeof result.value === 'boolean') {
        return result.value
      }
    } catch {
      continue
    }
  }

  return fallback
}

function resolveFeatureToggleService(container: ContainerLike): FeatureToggleServiceLike | null {
  try {
    return container.resolve('featureTogglesService') as FeatureToggleServiceLike
  } catch (err) {
    console.warn('[customers.interactionFeatureFlags] Feature toggle service unavailable, using defaults', err)
    return null
  }
}

export async function resolveCustomerInteractionFeatureFlags(
  container: ContainerLike,
  tenantId: string | null | undefined,
): Promise<CustomerInteractionFeatureFlags> {
  const service = resolveFeatureToggleService(container)

  return {
    unified: await resolveBooleanFeature(
      service,
      tenantId,
      [customerInteractionFeatureIds.unified, ...customerInteractionFeatureAliases.unified],
      defaultCustomerInteractionFeatureFlags.unified,
    ),
    legacyAdapters: await resolveBooleanFeature(
      service,
      tenantId,
      [customerInteractionFeatureIds.legacyAdapters, ...customerInteractionFeatureAliases.legacyAdapters],
      defaultCustomerInteractionFeatureFlags.legacyAdapters,
    ),
    externalSync: await resolveBooleanFeature(
      service,
      tenantId,
      [customerInteractionFeatureIds.externalSync, ...customerInteractionFeatureAliases.externalSync],
      defaultCustomerInteractionFeatureFlags.externalSync,
    ),
  }
}
