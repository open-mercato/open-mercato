import { PRODUCTION_TOGGLE_ID } from './productionToggleId.js'

export { PRODUCTION_TOGGLE_ID }

type BoolConfigResult = { ok: boolean; value?: unknown }

type FeatureTogglesServiceLike = {
  getBoolConfig: (identifier: string, tenantId: string) => Promise<BoolConfigResult>
}

/**
 * Server-side gate for the production module surface.
 *
 * FAIL-CLOSED, unlike the sales-channels toggle: the module is an optional
 * vertical that is OFF by default (spec § Architecture — feature toggle is the
 * rollout switch). It becomes visible only when the `production_enabled`
 * toggle explicitly resolves to `true` for the tenant. Missing toggle row,
 * missing feature_toggles service, or any resolution failure ⇒ disabled.
 */
export async function isProductionEnabledForTenant(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false
  try {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    const service = container.resolve('featureTogglesService') as FeatureTogglesServiceLike
    const result = await service.getBoolConfig(PRODUCTION_TOGGLE_ID, tenantId)
    return result.ok === true && result.value === true
  } catch {
    return false
  }
}
