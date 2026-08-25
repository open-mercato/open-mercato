import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { TillioApiError } from './errors'
import { createTillioClient } from './client'
import {
  ENV_PROBE_TENANT_DOMAIN,
  environmentSchema,
  generateTenantSystemId,
  readTenantSystemId,
  saveTenantSystemId,
  type TillioIdentityStore,
} from './environment'

export type CredentialsServiceLike = TillioIdentityStore

type HealthResult = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  message?: string
  details?: Record<string, unknown>
}

export function createTillioEnvironmentHealthCheck(deps: { credentialsService: CredentialsServiceLike }) {
  return {
    async check(credentials: Record<string, unknown> | null, scope: IntegrationScope): Promise<HealthResult> {
      const parsed = environmentSchema.safeParse(credentials ?? {})
      if (!parsed.success) {
        return { status: 'unhealthy', message: 'Environment is not configured (set the Tillio API URL and API key).' }
      }

      // Writes on first run: the client sends this id as X-System/X-Tenant and refuses to build
      // without one, so the probe below cannot run before it exists. A subscriber on
      // `integrations.credentials.updated` would leave a window where Check reports "not configured".
      let tenantSystemId = await readTenantSystemId(deps.credentialsService, scope)
      if (!tenantSystemId) {
        // Adopts an identity still sitting in the legacy record before minting a new one:
        // a fresh id would change X-System/X-Tenant and invalidate every operator token.
        tenantSystemId = parsed.data.tenantSystemId ?? generateTenantSystemId()
        try {
          await saveTenantSystemId(deps.credentialsService, scope, tenantSystemId)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to persist the environment identity'
          return { status: 'unhealthy', message }
        }
      }

      try {
        const client = createTillioClient({ apiUrl: parsed.data.apiUrl, apiKey: parsed.data.apiKey, tenantSystemId })
        // No dedicated ping endpoint, so listing plugins stands in for one: read-only and over the
        // same auth path a real call takes. The probe domain is a throwaway — no operator exists yet.
        await client.getPlugins(ENV_PROBE_TENANT_DOMAIN)
        return { status: 'healthy', message: 'Tillio environment connected.' }
      } catch (err) {
        const message = err instanceof TillioApiError || err instanceof Error ? err.message : 'Environment check failed'
        return { status: 'unhealthy', message }
      }
    },
  }
}
