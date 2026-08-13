/**
 * "Can we reach the ElevenLabs API with this tenant's key?"
 *
 * Registered in `di.ts` under the exact name `integration.ts` declares in
 * `healthCheck.service`; a mismatch there makes the hub's `container.resolve`
 * throw and the integration report permanently unhealthy.
 *
 * The probe asks the conversations endpoint for one id and classifies by status
 * code, which answers the credential question without needing an endpoint this
 * package does not otherwise use:
 *
 *   401 / 403          the key was rejected            → unhealthy
 *   2xx / 404 / 4xx    ElevenLabs authenticated us     → healthy
 *   5xx / network      the provider or the path is out → unhealthy
 *
 * A 404 is a HEALTHY answer: the sentinel conversation does not exist, and being
 * told so proves the credential passed. The core health service supplies the
 * decrypted credentials and never invokes this when none are stored, so the
 * "unconfigured" case is not ours to handle.
 */

import {
  probeConversationsEndpoint,
  type ElevenLabsFetch,
} from './api'
import { listConfiguredProfileNames } from './credentials'

type HealthCheckStatus = 'healthy' | 'degraded' | 'unhealthy'

type HealthCheckResult = {
  status: HealthCheckStatus
  message?: string
  details?: Record<string, unknown>
}

/**
 * A syntactically valid id that cannot belong to a real conversation. Its only
 * job is to give the endpoint something to reject.
 */
const HEALTH_PROBE_CONVERSATION_ID = 'om_health_probe'

export function createElevenLabsVoiceHealthCheck(deps?: {
  fetchImpl?: ElevenLabsFetch
  baseUrl?: string
}): { check(credentials: Record<string, unknown> | null): Promise<HealthCheckResult> } {
  const fetchImpl: ElevenLabsFetch = deps?.fetchImpl ?? ((url, init) => fetch(url, init))

  return {
    async check(credentials) {
      const apiKey = typeof credentials?.apiKey === 'string' ? credentials.apiKey.trim() : ''
      if (!apiKey) {
        return {
          status: 'unhealthy',
          message: 'No ElevenLabs API key is configured for this tenant.',
          details: { reason: 'missing_api_key' },
        }
      }

      try {
        const { status } = await probeConversationsEndpoint({
          apiKey,
          conversationId: HEALTH_PROBE_CONVERSATION_ID,
          fetchImpl,
          baseUrl: deps?.baseUrl,
        })

        if (status === 401 || status === 403) {
          return {
            status: 'unhealthy',
            message: 'ElevenLabs rejected the configured API key.',
            details: { httpStatus: status },
          }
        }
        if (status >= 500) {
          return {
            status: 'unhealthy',
            message: `ElevenLabs returned HTTP ${status}.`,
            details: { httpStatus: status },
          }
        }
        return {
          status: 'healthy',
          message:
            `ElevenLabs accepted the configured API key. The probe asks for a conversation id that ` +
            `cannot exist, so HTTP ${status} is the expected answer — a rejected key would return 401.`,
          details: {
            // Labelled, not bare: a raw `404` beside a green badge reads as a
            // fault and has been mistaken for one. The probe is a deliberate
            // miss, so the status is evidence the credential worked.
            probeResult: `HTTP ${status} (expected — the probe requests a non-existent conversation)`,
            // Echoing the non-secret configuration back makes a
            // "healthy but nothing works" report diagnosable at a glance.
            agentId: typeof credentials?.agentId === 'string' ? credentials.agentId : null,
            agentPhoneNumberId:
              typeof credentials?.agentPhoneNumberId === 'string' ? credentials.agentPhoneNumberId : null,
            // The names an agent may declare. The commonest profile failure is
            // an agent naming one this tenant never configured, and that failure
            // is invisible here otherwise: the key authenticates fine, the call
            // still never happens. `listConfiguredProfileNames` never throws, so
            // a malformed document reads as an empty list rather than an
            // exception inside a health probe.
            profiles: listConfiguredProfileNames(credentials ?? null),
          },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return {
          status: 'unhealthy',
          message: `ElevenLabs connection failed: ${message}`,
          details: { error: message },
        }
      }
    },
  }
}

export const elevenLabsVoiceHealthCheck = createElevenLabsVoiceHealthCheck()
