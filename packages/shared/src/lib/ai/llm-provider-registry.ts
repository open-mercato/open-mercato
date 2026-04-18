/**
 * LLM Provider registry — module-level singleton that collects registered
 * adapters and exposes lookup by id, configured-state filtering, and a
 * "first configured" resolver used by the routing layer.
 *
 * @see ./llm-provider.ts
 * @see .ai/specs/2026-04-14-llm-provider-ports-and-adapters.md
 */

import type { EnvLookup, LlmProvider } from './llm-provider'

/**
 * Options for {@link LlmProviderRegistry.resolveFirstConfigured}.
 */
export interface ResolveFirstConfiguredOptions {
  /** Optional environment lookup. Defaults to `process.env`. */
  env?: EnvLookup
  /**
   * Optional priority order by provider id. Providers not listed here are
   * checked after the listed ones, in registration order. When omitted,
   * the registry uses the registration order (first registered wins).
   */
  order?: readonly string[]
}

/**
 * Public interface of the registry. Exposed as a singleton via
 * {@link llmProviderRegistry}.
 */
export interface LlmProviderRegistry {
  /**
   * Registers or replaces a provider. Registration is idempotent — calling
   * with the same id replaces the existing entry. This supports Next.js
   * hot-reload and downstream apps that re-register their own providers.
   */
  register(provider: LlmProvider): void

  /** Returns the provider with the given id, or null when not registered. */
  get(id: string): LlmProvider | null

  /** Returns all registered providers in registration order. */
  list(): readonly LlmProvider[]

  /**
   * Returns only providers whose {@link LlmProvider.isConfigured} returns
   * true for the given environment.
   */
  listConfigured(env?: EnvLookup): readonly LlmProvider[]

  /**
   * Returns the first provider that is configured in the given environment,
   * honoring the optional `order` argument. Returns null when no provider
   * has credentials available.
   */
  resolveFirstConfigured(
    options?: ResolveFirstConfiguredOptions,
  ): LlmProvider | null

  /** Removes all registered providers. Intended for test isolation. */
  reset(): void
}

class LlmProviderRegistryImpl implements LlmProviderRegistry {
  // Preserves registration order via Map iteration semantics.
  private readonly providers = new Map<string, LlmProvider>()

  register(provider: LlmProvider): void {
    if (!provider || typeof provider.id !== 'string' || provider.id.length === 0) {
      throw new Error('[LlmProviderRegistry] Provider must have a non-empty id')
    }
    // Idempotent: replace existing by id.
    this.providers.set(provider.id, provider)
  }

  get(id: string): LlmProvider | null {
    return this.providers.get(id) ?? null
  }

  list(): readonly LlmProvider[] {
    return Array.from(this.providers.values())
  }

  listConfigured(env?: EnvLookup): readonly LlmProvider[] {
    const lookup = env ?? process.env
    return this.list().filter((provider) => provider.isConfigured(lookup))
  }

  resolveFirstConfigured(
    options?: ResolveFirstConfiguredOptions,
  ): LlmProvider | null {
    const env = options?.env ?? process.env
    const order = options?.order

    if (order && order.length > 0) {
      // Walk the explicit order first.
      for (const id of order) {
        const provider = this.providers.get(id)
        if (provider && provider.isConfigured(env)) {
          return provider
        }
      }
      // Then fall back to the registration order for anything not listed.
      const listed = new Set(order)
      for (const provider of this.providers.values()) {
        if (listed.has(provider.id)) continue
        if (provider.isConfigured(env)) {
          return provider
        }
      }
      return null
    }

    // Default: walk registration order.
    for (const provider of this.providers.values()) {
      if (provider.isConfigured(env)) {
        return provider
      }
    }
    return null
  }

  reset(): void {
    this.providers.clear()
  }
}

/**
 * Process-level singleton instance of the registry.
 *
 * Populated at module load by {@link registerBuiltInLlmProviders} in
 * `bootstrap.ts`. Downstream applications may call `.register()` directly
 * to add custom presets at their own bootstrap time, for example:
 *
 * ```ts
 * import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
 * llmProviderRegistry.register(myCustomProvider)
 * ```
 */
export const llmProviderRegistry: LlmProviderRegistry = new LlmProviderRegistryImpl()
