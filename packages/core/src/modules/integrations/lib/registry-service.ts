import {
  getAllBundles,
  getAllIntegrations,
  getBundle,
  getIntegration,
  type ApiVersionDefinition,
  type IntegrationBundle,
  type IntegrationDefinition,
} from '@open-mercato/shared/modules/integrations/types'

export type IntegrationDetail = {
  integration: IntegrationDefinition
  bundle?: IntegrationBundle
  selectedApiVersion?: string
}

export function listIntegrationRegistry(): {
  integrations: IntegrationDefinition[]
  bundles: IntegrationBundle[]
} {
  return {
    integrations: getAllIntegrations(),
    bundles: getAllBundles(),
  }
}

export function getIntegrationDetail(integrationId: string): IntegrationDetail | null {
  const integration = getIntegration(integrationId)
  if (!integration) return null
  const bundle = integration.bundleId ? getBundle(integration.bundleId) : undefined
  return {
    integration,
    bundle,
  }
}

export function resolveDefaultApiVersion(versions: ApiVersionDefinition[] | undefined): string | undefined {
  if (!versions?.length) return undefined
  const explicitDefault = versions.find((version) => version.default)
  if (explicitDefault) return explicitDefault.id
  return versions[0]?.id
}
