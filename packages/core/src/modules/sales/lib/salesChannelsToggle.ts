import { SALES_CHANNELS_TOGGLE_ID } from './salesChannelsToggleId'

export { SALES_CHANNELS_TOGGLE_ID }

type BoolConfigResult = { ok: boolean; value?: unknown }

type FeatureTogglesServiceLike = {
  getBoolConfig: (identifier: string, tenantId: string) => Promise<BoolConfigResult>
}

// Server-side counterpart of useSalesChannelsEnabled with the same fail-open
// contract: channels stay enabled unless the toggle explicitly resolves to
// false. The DI container and feature_toggles service are optional peers, so
// they are loaded lazily and any failure keeps channels visible.
export async function isSalesChannelsEnabledForTenant(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return true
  try {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    const service = container.resolve('featureTogglesService') as FeatureTogglesServiceLike
    const result = await service.getBoolConfig(SALES_CHANNELS_TOGGLE_ID, tenantId)
    return !(result.ok === true && result.value === false)
  } catch {
    return true
  }
}
