/**
 * Availability provider registry — module-level singleton that collects
 * registered providers and dispatches `resolveAvailability()` to the
 * per-tenant selected one, falling back safely to the built-in
 * `catalog-only` provider.
 *
 * Mirrors `packages/shared/src/lib/ai/llm-provider-registry.ts`.
 *
 * @see ./types
 * @see .ai/specs/2026-08-14-availability-contract.md §4.1a
 */

import type { AvailabilityProvider, AvailabilityQuery, AvailabilityResult } from './types'

export const AVAILABILITY_CATALOG_ONLY_PROVIDER_ID = 'catalog-only'

/** Public interface of the registry. Exposed as a singleton via {@link availabilityProviderRegistry}. */
export interface AvailabilityProviderRegistry {
  /**
   * Registers or replaces a provider. Registration is idempotent — calling
   * with the same id replaces the existing entry. Never order-dependent.
   */
  register(provider: AvailabilityProvider): void

  /** Returns the provider with the given id, or null when not registered. */
  get(id: string): AvailabilityProvider | null

  /** Returns all registered providers in registration order. */
  list(): readonly AvailabilityProvider[]

  /** Removes all registered providers. Intended for test isolation. */
  reset(): void
}

class AvailabilityProviderRegistryImpl implements AvailabilityProviderRegistry {
  // Preserves registration order via Map iteration semantics.
  private readonly providers = new Map<string, AvailabilityProvider>()

  register(provider: AvailabilityProvider): void {
    if (!provider || typeof provider.id !== 'string' || provider.id.length === 0) {
      throw new Error('[internal] AvailabilityProviderRegistry: provider must have a non-empty id')
    }
    // Idempotent: replace existing by id.
    this.providers.set(provider.id, provider)
  }

  get(id: string): AvailabilityProvider | null {
    return this.providers.get(id) ?? null
  }

  list(): readonly AvailabilityProvider[] {
    return Array.from(this.providers.values())
  }

  reset(): void {
    this.providers.clear()
  }
}

/** Process-level singleton instance of the registry. */
export const availabilityProviderRegistry: AvailabilityProviderRegistry = new AvailabilityProviderRegistryImpl()

export type AvailabilityProviderSelection = 'auto' | 'catalog-only' | (string & {})

/**
 * Narrow port for per-tenant provider selection — declared locally so this
 * package stays dependency-free. A caller with DI access (an `availability`
 * module route, a future `ecommerce`/`cart`/`checkout` consumer) passes in
 * its resolved `ModuleConfigService` instance; omitting it always resolves
 * `'auto'`.
 */
export interface AvailabilityModuleConfigReader {
  getValue<T = unknown>(
    moduleId: string,
    name: string,
    options?: { defaultValue?: T | null; scope?: { tenantId?: string | null; organizationId?: string | null } },
  ): Promise<T | null>
}

export interface ResolveAvailabilityOptions {
  /** `ModuleConfigService('availability', 'selectedProvider')` reader. See {@link AvailabilityModuleConfigReader}. */
  moduleConfig?: AvailabilityModuleConfigReader
}

function resolveAutoProvider(): AvailabilityProvider | null {
  // 'auto' = "the highest-precedence registered provider" — the first
  // non-catalog-only registrant, in registration order.
  for (const provider of availabilityProviderRegistry.list()) {
    if (provider.id !== AVAILABILITY_CATALOG_ONLY_PROVIDER_ID) return provider
  }
  return availabilityProviderRegistry.get(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID)
}

/**
 * The entry point every read-side consumer calls. Advisory only — see §4.1:
 * `resolveAvailability()` is never a stock guarantee, `reserveAvailability()`
 * (the `availability` module, not shipped by this contract) is.
 */
export async function resolveAvailability(
  query: AvailabilityQuery,
  options?: ResolveAvailabilityOptions,
): Promise<AvailabilityResult> {
  const selection = options?.moduleConfig
    ? await options.moduleConfig.getValue<AvailabilityProviderSelection>('availability', 'selectedProvider', {
        defaultValue: 'auto',
        scope: { tenantId: query.tenantId },
      })
    : 'auto'

  const provider =
    !selection || selection === 'auto'
      ? resolveAutoProvider()
      : availabilityProviderRegistry.get(selection) ?? availabilityProviderRegistry.get(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID)

  const resolved = provider ?? availabilityProviderRegistry.get(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID)
  if (!resolved) {
    throw new Error('[internal] No availability provider registered, including the built-in catalog-only fallback')
  }
  return resolved.getAvailability(query)
}
