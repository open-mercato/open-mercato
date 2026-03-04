/**
 * Integration type definitions.
 *
 * Provides the `IntegrationDefinition` contract for registered integrations
 * and the `ExternalIdEnrichment` shape that enrichers attach to entity records.
 */

/**
 * Definition for a registered integration module.
 * Integration modules should register themselves with the integration registry
 * so the platform can discover metadata, build deep links, etc.
 */
export interface IntegrationDefinition {
  /** Unique integration identifier, e.g. 'sync_shopify', 'gateway_stripe' */
  id: string

  /** Human-readable name */
  title: string

  /** Optional short description shown in integration UIs */
  description?: string

  /** Optional category, e.g. payment, shipping, communication */
  category?: string

  /** Optional hub module id, e.g. payment_gateways */
  hub?: string

  /** Optional provider key used by category hubs */
  providerKey?: string

  /** Optional icon identifier for rendering */
  icon?: string

  /** Optional documentation URL for setup/integration guides */
  docsUrl?: string

  /** Optional npm package name owning this integration */
  package?: string

  /** Optional integration version */
  version?: string

  /** Optional integration author */
  author?: string

  /** Optional integration license */
  license?: string

  /** Optional searchable tag list */
  tags?: string[]

  /** Optional API versions exposed by this integration */
  apiVersions?: IntegrationApiVersion[]

  /** Optional credential schema for dynamic forms */
  credentials?: IntegrationCredentialsSchema

  /** Build a URL to the record in the external system. Used in detail page badges. */
  buildExternalUrl?: (externalId: string) => string
}

export interface IntegrationApiVersion {
  id: string
  label: string
  status?: 'stable' | 'deprecated' | 'beta' | 'alpha'
  default?: boolean
  deprecatedAt?: string
  sunsetAt?: string
  migrationGuide?: string
  changelog?: string
}

export interface IntegrationCredentialsSchema {
  fields: IntegrationCredentialField[]
}

export interface IntegrationCredentialField {
  key: string
  label: string
  type: 'text' | 'secret' | 'number' | 'boolean' | 'select' | 'textarea' | 'url'
  required?: boolean
  placeholder?: string
  description?: string
  options?: Array<{ value: string; label: string }>
}

/**
 * Shape of the `_integrations` namespace added by the external ID enricher.
 * Keyed by integration ID.
 */
export interface ExternalIdEnrichment {
  _integrations: Record<string, ExternalIdMapping>
}

export interface ExternalIdMapping {
  externalId: string
  externalUrl?: string
  lastSyncedAt?: string
  syncStatus: 'synced' | 'pending' | 'error' | 'not_synced'
}

// --- Integration Registry ---

const integrationRegistry = new Map<string, IntegrationDefinition>()

/**
 * Register an integration definition. Called at module bootstrap.
 */
export function registerIntegration(definition: IntegrationDefinition): void {
  integrationRegistry.set(definition.id, definition)
}

/**
 * Register multiple integration definitions at once.
 */
export function registerIntegrations(definitions: IntegrationDefinition[]): void {
  for (const definition of definitions) {
    integrationRegistry.set(definition.id, definition)
  }
}

/**
 * Get a registered integration by ID.
 */
export function getIntegration(integrationId: string): IntegrationDefinition | undefined {
  return integrationRegistry.get(integrationId)
}

/**
 * Get all registered integrations.
 */
export function getAllIntegrations(): IntegrationDefinition[] {
  return Array.from(integrationRegistry.values())
}

/**
 * Get the title of a registered integration, falling back to the ID.
 */
export function getIntegrationTitle(integrationId: string): string {
  return integrationRegistry.get(integrationId)?.title ?? integrationId
}
