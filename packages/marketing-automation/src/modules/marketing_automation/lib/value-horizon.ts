import type { AwilixContainer } from 'awilix'
import { DEFAULT_VALUE_HORIZON_YEARS } from './engine/rfm.js'

/** The module config key the projection horizon lives under, per tenant. */
export const VALUE_HORIZON_CONFIG_NAME = 'valueHorizonYears'

type ModuleConfigLike = {
  getValue<T = unknown>(
    moduleId: string,
    name: string,
    options?: { defaultValue?: T | null; scope?: { tenantId?: string | null; organizationId?: string | null } },
  ): Promise<T | null>
}

/** Ten years of projection from a year of history is astrology, not a forecast. */
const MAX_HORIZON_YEARS = 5

/**
 * How many years a value projection looks ahead, per tenant.
 *
 * Configurable because the honest horizon depends on what is sold — a coffee subscription can project further
 * than a mattress shop — and bounded because a projection is only ever as good as the cadence behind it.
 *
 * Resolved defensively, like the tier ladder: a missing config service is a fallback, never a failure, and the
 * scope goes inside the OPTIONS object because that is the service's actual signature (passed positionally it
 * is silently dropped and every tenant reads the instance-wide value).
 */
export async function loadValueHorizonYears(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
): Promise<number> {
  let service: ModuleConfigLike | null = null
  try {
    service = container.resolve<ModuleConfigLike>('moduleConfigService')
  } catch {
    return DEFAULT_VALUE_HORIZON_YEARS
  }
  try {
    const value = await service.getValue<unknown>('marketing_automation', VALUE_HORIZON_CONFIG_NAME, { scope })
    const years = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(years) || years <= 0) return DEFAULT_VALUE_HORIZON_YEARS
    return Math.min(Math.round(years * 10) / 10, MAX_HORIZON_YEARS)
  } catch {
    return DEFAULT_VALUE_HORIZON_YEARS
  }
}
