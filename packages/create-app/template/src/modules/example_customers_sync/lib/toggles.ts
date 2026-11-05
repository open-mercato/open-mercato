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

export const exampleCustomersSyncFeatureIds = {
  enabled: 'example.customers_sync.enabled',
  bidirectional: 'example.customers_sync.bidirectional',
} as const

export type ExampleCustomersSyncFlags = {
  enabled: boolean
  bidirectional: boolean
}

async function resolveBooleanFeature(
  service: FeatureToggleServiceLike | null,
  tenantId: string | null | undefined,
  identifier: string,
  fallback: boolean,
): Promise<boolean> {
  if (!service || !tenantId) return fallback
  try {
    const result = await service.getBoolConfig(identifier, tenantId)
    if (result.ok && typeof result.value === 'boolean') return result.value
  } catch {
    /* service unavailable or misconfigured — fall back to default */
    return fallback
  }
  return fallback
}

function resolveFeatureToggleService(container: ContainerLike): FeatureToggleServiceLike | null {
  try {
    return container.resolve('featureTogglesService') as FeatureToggleServiceLike
  } catch {
    /* service not registered — module may be disabled or DI not yet wired */
    return null
  }
}

export async function resolveExampleCustomersSyncFlags(
  container: ContainerLike,
  tenantId: string | null | undefined,
): Promise<ExampleCustomersSyncFlags> {
  const service = resolveFeatureToggleService(container)
  return {
    enabled: await resolveBooleanFeature(service, tenantId, exampleCustomersSyncFeatureIds.enabled, false),
    bidirectional: await resolveBooleanFeature(service, tenantId, exampleCustomersSyncFeatureIds.bidirectional, false),
  }
}
