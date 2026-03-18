export type IntegrationScope = {
  organizationId: string
  tenantId: string
}

export type IntegrationCategory =
  | 'payment'
  | 'shipping'
  | 'data_sync'
  | 'communication'
  | 'webhook'
  | 'storage'
  | 'other'

export type IntegrationHubId =
  | 'payment_gateways'
  | 'shipping_carriers'
  | 'data_sync'
  | 'communication_channels'
  | 'webhook_endpoints'
  | 'storage_hubs'
  | string

export type CredentialFieldType =
  | 'text'
  | 'secret'
  | 'select'
  | 'boolean'
  | 'url'
  | 'oauth'
  | 'ssh_keypair'

export interface CredentialFieldOption {
  value: string
  label: string
}

export interface CredentialFieldVisibleWhen {
  field: string
  equals: string | number | boolean
}

export interface IntegrationCredentialWebhookHelp {
  kind: 'webhook_setup'
  title: string
  summary: string
  endpointPath: string
  dashboardPathLabel: string
  steps: string[]
  events?: string[]
  localDevelopment?: {
    tunnelCommand: string
    publicUrlExample: string
    note?: string
  }
}

export interface IntegrationCredentialFieldBase {
  key: string
  label: string
  required?: boolean
  placeholder?: string
  helpText?: string
  helpDetails?: IntegrationCredentialWebhookHelp
  visibleWhen?: CredentialFieldVisibleWhen
}

export interface IntegrationCredentialFieldText extends IntegrationCredentialFieldBase {
  type: Extract<CredentialFieldType, 'text' | 'secret' | 'url'>
}

export interface IntegrationCredentialFieldBoolean extends IntegrationCredentialFieldBase {
  type: Extract<CredentialFieldType, 'boolean'>
}

export interface IntegrationCredentialFieldSelect extends IntegrationCredentialFieldBase {
  type: Extract<CredentialFieldType, 'select'>
  options: CredentialFieldOption[]
}

export interface IntegrationCredentialFieldOauth extends IntegrationCredentialFieldBase {
  type: Extract<CredentialFieldType, 'oauth'>
  authUrl?: string
  tokenUrl?: string
  scopes?: string[]
  clientIdField?: string
  clientSecretField?: string
}

export interface IntegrationCredentialFieldSshKeypair extends IntegrationCredentialFieldBase {
  type: Extract<CredentialFieldType, 'ssh_keypair'>
  algorithm?: 'ed25519' | 'rsa'
  rsaBits?: 2048 | 3072 | 4096
}

export type IntegrationCredentialField =
  | IntegrationCredentialFieldText
  | IntegrationCredentialFieldBoolean
  | IntegrationCredentialFieldSelect
  | IntegrationCredentialFieldOauth
  | IntegrationCredentialFieldSshKeypair

export interface IntegrationCredentialsSchema {
  fields: IntegrationCredentialField[]
}

export interface IntegrationHealthCheckConfig {
  service: string
}

export interface ApiVersionDefinition {
  id: string
  label: string
  status: 'stable' | 'deprecated' | 'experimental'
  default?: boolean
  changelog?: string
  deprecatedAt?: string
  sunsetAt?: string
  migrationGuide?: string
}

export interface IntegrationBundle {
  id: string
  title: string
  description: string
  icon?: string
  package?: string
  version?: string
  author?: string
  credentials: IntegrationCredentialsSchema
  healthCheck?: IntegrationHealthCheckConfig
}

export interface IntegrationDetailPageConfig {
  /**
   * UMES widget spot rendered on the integration detail page.
   * Widgets registered here can render inline blocks, grouped panels,
   * or additional tabs via `placement.kind`.
   */
  widgetSpotId?: string
}

export interface IntegrationDefinition {
  id: string
  title: string
  icon?: string
  buildExternalUrl?: (externalId: string) => string
  bundleId?: string
  apiVersions?: ApiVersionDefinition[]
  description?: string
  category?: IntegrationCategory | string
  hub?: IntegrationHubId
  providerKey?: string
  docsUrl?: string
  package?: string
  version?: string
  author?: string
  company?: string
  license?: string
  tags?: string[]
  detailPage?: IntegrationDetailPageConfig
  credentials?: IntegrationCredentialsSchema
  healthCheck?: IntegrationHealthCheckConfig
}

export interface ExternalIdEnrichment {
  _integrations: Record<string, ExternalIdMapping>
}

export interface ExternalIdMapping {
  externalId: string
  externalUrl?: string
  lastSyncedAt?: string
  syncStatus: 'synced' | 'pending' | 'error' | 'not_synced'
}

const integrationRegistry = new Map<string, IntegrationDefinition>()
const integrationBundleRegistry = new Map<string, IntegrationBundle>()

export function registerIntegration(definition: IntegrationDefinition): void {
  integrationRegistry.set(definition.id, definition)
}

export function registerIntegrations(definitions: IntegrationDefinition[]): void {
  for (const definition of definitions) {
    integrationRegistry.set(definition.id, definition)
  }
}

export function registerBundle(bundle: IntegrationBundle): void {
  integrationBundleRegistry.set(bundle.id, bundle)
}

export function registerBundles(bundles: IntegrationBundle[]): void {
  for (const bundle of bundles) {
    integrationBundleRegistry.set(bundle.id, bundle)
  }
}

export function clearRegisteredIntegrations(): void {
  integrationRegistry.clear()
  integrationBundleRegistry.clear()
}

export function getIntegration(integrationId: string): IntegrationDefinition | undefined {
  return integrationRegistry.get(integrationId)
}

export function getAllIntegrations(): IntegrationDefinition[] {
  return Array.from(integrationRegistry.values())
}

export function getBundle(bundleId: string): IntegrationBundle | undefined {
  return integrationBundleRegistry.get(bundleId)
}

export function getAllBundles(): IntegrationBundle[] {
  return Array.from(integrationBundleRegistry.values())
}

export function getBundleIntegrations(bundleId: string): IntegrationDefinition[] {
  return Array.from(integrationRegistry.values()).filter((integration) => integration.bundleId === bundleId)
}

export function resolveIntegrationCredentialsSchema(integrationId: string): IntegrationCredentialsSchema | undefined {
  const definition = integrationRegistry.get(integrationId)
  if (!definition) return undefined

  if (definition.credentials && definition.credentials.fields.length > 0) {
    return definition.credentials
  }

  if (!definition.bundleId) return definition.credentials
  return integrationBundleRegistry.get(definition.bundleId)?.credentials
}

export function getIntegrationTitle(integrationId: string): string {
  return integrationRegistry.get(integrationId)?.title ?? integrationId
}

export const LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID = 'integrations.detail:tabs'

export function buildIntegrationDetailWidgetSpotId(integrationId: string): string {
  return `integrations.detail:${integrationId}`
}
