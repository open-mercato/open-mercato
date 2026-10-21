import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { whatsappCredentialsSchema, resolveGraphUrl } from './credentials'

export type HealthCheckStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthCheckResult {
  status: HealthCheckStatus
  message?: string
  details?: Record<string, unknown>
}

export const channelWhatsAppHealthCheck = {
  async check(
    credentials: Record<string, unknown> | null,
    _scope: IntegrationScope,
  ): Promise<HealthCheckResult> {
    const parsed = whatsappCredentialsSchema.safeParse(credentials ?? {})
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return {
        status: 'unhealthy',
        message: `WhatsApp credentials invalid: ${first?.message ?? 'unknown validation error'}`,
        details: { reason: 'invalid_credentials' },
      }
    }
    try {
      const response = await fetch(resolveGraphUrl(parsed.data, parsed.data.phoneNumberId), {
        headers: { Authorization: `Bearer ${parsed.data.accessToken}` },
      })
      if (response.status === 401) {
        return {
          status: 'unhealthy',
          message: 'WhatsApp rejected the access token (401)',
          details: { reason: 'requires_reauth', status: 401 },
        }
      }
      if (!response.ok) {
        return {
          status: 'unhealthy',
          message: `WhatsApp probe failed with status ${response.status}`,
          details: { reason: 'probe_failed', status: response.status },
        }
      }
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
      return {
        status: 'healthy',
        message: 'WhatsApp phone number reachable',
        details: {
          displayPhoneNumber: typeof body.display_phone_number === 'string' ? body.display_phone_number : null,
          verifiedName: typeof body.verified_name === 'string' ? body.verified_name : null,
          qualityRating: typeof body.quality_rating === 'string' ? body.quality_rating : null,
        },
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'WhatsApp probe failed',
        details: { reason: 'probe_failed' },
      }
    }
  },
}
