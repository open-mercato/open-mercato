import { normalizeTierThresholds } from './engine/tiers.js'
import type { TierThreshold } from './engine/tiers.js'
import type { AwilixContainer } from 'awilix'

/** The module config key the ladder lives under, per tenant. */
export const TIER_CONFIG_NAME = 'loyaltyTiers'

type ModuleConfigLike = {
  getValue<T = unknown>(
    moduleId: string,
    name: string,
    options?: { defaultValue?: T | null; scope?: { tenantId?: string | null; organizationId?: string | null } },
  ): Promise<T | null>
}

/**
 * Reads the tenant's tier ladder, falling back to the defaults.
 *
 * `moduleConfigService` is resolved defensively: it is a core service, but this module must keep
 * working in a process that does not register it — a worker, a test, a trimmed installation — and a
 * missing ladder is a fallback, never a failure.
 */
export async function loadTierThresholds(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
): Promise<TierThreshold[]> {
  let service: ModuleConfigLike | null = null
  try {
    service = container.resolve<ModuleConfigLike>('moduleConfigService')
  } catch {
    return normalizeTierThresholds(null)
  }
  try {
    /**
     * The scope goes inside an OPTIONS object, which is the service's actual signature.
     *
     * Passed positionally — as this did until it was caught by a settings round-trip test — the scope is
     * silently dropped, the lookup falls back to the instance-wide record, and a tenant's configured
     * ladder never applies. It fails quietly, because the defaults are a legitimate answer.
     */
    const value = await service.getValue<unknown>('marketing_automation', TIER_CONFIG_NAME, { scope })
    return normalizeTierThresholds(value)
  } catch {
    return normalizeTierThresholds(null)
  }
}
