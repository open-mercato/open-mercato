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

  /** Optional icon identifier for rendering */
  icon?: string

  /** Build a URL to the record in the external system. Used in detail page badges. */
  buildExternalUrl?: (externalId: string) => string
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
