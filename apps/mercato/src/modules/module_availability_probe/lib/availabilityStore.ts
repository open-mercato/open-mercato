import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { TenantModuleAvailabilityProvider } from '@open-mercato/shared/security/tenantModuleAvailability'

export const PROBE_MODULE_ID = 'module_availability_probe'
export const PROBE_FEATURE_ID = `${PROBE_MODULE_ID}.ping`

type ProbeCache = Pick<CacheStrategy, 'get' | 'set' | 'delete'>

function buildFlagKey(tenantId: string): string {
  return `${PROBE_MODULE_ID}:unavailable:${tenantId}`
}

export function isProbeEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_TEST_MODE, false)
}

export async function setProbeModuleAvailability(
  cache: ProbeCache,
  tenantId: string,
  available: boolean,
): Promise<void> {
  await runWithCacheTenant(tenantId, async () => {
    if (available) {
      await cache.delete(buildFlagKey(tenantId))
      return
    }
    await cache.set(buildFlagKey(tenantId), { unavailable: true })
  })
}

export function createProbeAvailabilityProvider(
  resolveCache: () => ProbeCache | null,
): TenantModuleAvailabilityProvider {
  return {
    governedModuleIds: [PROBE_MODULE_ID],
    async getUnavailableModuleIds({ tenantId }) {
      const cache = resolveCache()
      if (!cache) return []
      const flag = await runWithCacheTenant(tenantId, () => cache.get(buildFlagKey(tenantId)))
      return flag ? [PROBE_MODULE_ID] : []
    },
  }
}
