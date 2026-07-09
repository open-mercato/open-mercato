import type { PhoneCallProviderAdapter } from '@open-mercato/shared/modules/phone_calls/provider'
import type {
  FetchPhoneCallInput,
  FetchPhoneCallsInput,
  NormalizedPhoneCall,
  NormalizedPhoneCallBatch,
  ProviderValidationResult,
  ValidatePhoneCallProviderInput,
} from '@open-mercato/shared/modules/phone_calls/types'
import { TillioApiError } from './errors'
import { createTillioClient } from './client'
import { ENV_PROBE_TENANT_DOMAIN, environmentSchema } from './environment'

export const tillioAdapter: PhoneCallProviderAdapter = {
  providerKey: 'tillio',
  displayName: 'Tillio',

  async validateConnection(input: ValidatePhoneCallProviderInput): Promise<ProviderValidationResult> {
    const parsed = environmentSchema.safeParse(input.credentials)
    if (!parsed.success || !parsed.data.tenantSystemId) {
      return { ok: false, message: 'Tillio environment is not configured.' }
    }
    try {
      const client = createTillioClient({
        apiUrl: parsed.data.apiUrl,
        apiKey: parsed.data.apiKey,
        tenantSystemId: parsed.data.tenantSystemId,
      })
      await client.getPlugins(ENV_PROBE_TENANT_DOMAIN)
      return { ok: true }
    } catch (err) {
      const message = err instanceof TillioApiError || err instanceof Error ? err.message : 'Validation failed'
      return { ok: false, message }
    }
  },

  async fetchCall(_input: FetchPhoneCallInput): Promise<NormalizedPhoneCall | null> {
    throw new Error('tillio.fetchCall is implemented in step 3b.')
  },

  async fetchCalls(_input: FetchPhoneCallsInput): Promise<NormalizedPhoneCallBatch> {
    throw new Error('tillio.fetchCalls is implemented in step 3b.')
  },
}
