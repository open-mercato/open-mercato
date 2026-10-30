import type { AwilixContainer } from 'awilix'
import type { WinnerMetric } from './analytics/split-results.js'

/** The module config key the winner metric lives under, per tenant. */
export const WINNER_METRIC_CONFIG_NAME = 'splitWinnerMetric'

/**
 * Clicks, because it is available on every campaign.
 *
 * Revenue is the better question and the default is still clicks: a shop whose orders are not attributable to a
 * click — a phone order, a marketplace, anything the storefront does not carry — would never conclude a test on
 * revenue, and a test that never concludes is worse than one concluded on a proxy.
 */
export const DEFAULT_WINNER_METRIC: WinnerMetric = 'clicks'

type ModuleConfigLike = {
  getValue<T = unknown>(
    moduleId: string,
    name: string,
    options?: { defaultValue?: T | null; scope?: { tenantId?: string | null; organizationId?: string | null } },
  ): Promise<T | null>
}

/**
 * Which question an A/B winner answers, per tenant.
 *
 * One setting for BOTH the suggestion on the results screen and the unattended promotion, on purpose. Two
 * settings would let a tenant be shown a click winner and have a revenue winner applied behind their back, and
 * the whole value of the suggestion is that it is the decision the automation would make.
 *
 * Resolved defensively, like every config read in this module: a missing service or an unrecognised stored value
 * is the default, never a failure, and the scope goes inside the OPTIONS object because that is the service's
 * actual signature (passed positionally it is silently dropped and every tenant reads the instance-wide value).
 */
export async function loadWinnerMetric(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
): Promise<WinnerMetric> {
  let service: ModuleConfigLike | null = null
  try {
    service = container.resolve<ModuleConfigLike>('moduleConfigService')
  } catch {
    return DEFAULT_WINNER_METRIC
  }
  try {
    const value = await service.getValue<unknown>('marketing_automation', WINNER_METRIC_CONFIG_NAME, { scope })
    return value === 'revenue' ? 'revenue' : DEFAULT_WINNER_METRIC
  } catch {
    return DEFAULT_WINNER_METRIC
  }
}
