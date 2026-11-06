import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import {
  otelExportIntegrationCredentialsSchema,
  type OtelExportIntegrationCredentials,
} from '../../../data/validators'
import { parseOtlpHeadersStrict } from './exportSettings'
import { sendOtelTestSpan, type OtelTestSpanDestination } from './sendTestSpan'

export { OTEL_EXPORT_HEALTH_CHECK_SERVICE, OTEL_EXPORT_INTEGRATION_ID } from './exportIntegrationIds'

export type OtelExportIntegrationCredentialsParsed = {
  endpoint: string
  headers: Record<string, string>
  protocol: OtelExportIntegrationCredentials['protocol']
}

export type ParsedOtelExportIntegrationCredentials =
  | { ok: true; credentials: OtelExportIntegrationCredentialsParsed }
  | { ok: false; field: string | null }

/**
 * Validates stored integration credentials and parses the `headers` secret
 * strictly (a malformed pair, an invalid header name or CR/LF in a value
 * rejects the whole list). The failure result names the offending field only,
 * never its value.
 */
export function parseOtelExportIntegrationCredentials(raw: Record<string, unknown> | null): ParsedOtelExportIntegrationCredentials {
  const parsed = otelExportIntegrationCredentialsSchema.safeParse(raw ?? {})
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    return { ok: false, field: typeof field === 'string' ? field : null }
  }
  const headers = parseOtlpHeadersStrict(parsed.data.headers ?? null)
  if (headers === null) return { ok: false, field: 'headers' }
  return {
    ok: true,
    credentials: {
      endpoint: parsed.data.endpoint,
      headers,
      protocol: parsed.data.protocol,
    },
  }
}

export type OtelExportHealthDestinationResult = OtelTestSpanDestination | { error: string }

/**
 * Turns validated integration credentials into the destination the health
 * check may send to, or an error code when sending is not allowed.
 */
export type OtelExportHealthDestinationResolver = (input: {
  credentials: OtelExportIntegrationCredentialsParsed
  scope: IntegrationScope
}) => Promise<OtelExportHealthDestinationResult>

export const OTEL_EXPORT_DESTINATION_NOT_ACTIVE = 'destination_not_active'

export const resolveInactiveOtelExportHealthDestination: OtelExportHealthDestinationResolver = async () => ({
  error: OTEL_EXPORT_DESTINATION_NOT_ACTIVE,
})

export type OtelExportHealthCheckResult = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  message?: string
  details?: Record<string, unknown>
}

/**
 * Integration health check for `agent_orchestrator_otel_export`. Sends the
 * synthetic `om.export.test` span to the destination the resolver vets; the
 * result never carries the endpoint URL or header values.
 */
export function createOtelExportHealthCheck(deps: { resolveDestination: OtelExportHealthDestinationResolver }) {
  return {
    async check(credentials: Record<string, unknown> | null, scope: IntegrationScope): Promise<OtelExportHealthCheckResult> {
      const parsed = parseOtelExportIntegrationCredentials(credentials)
      if (!parsed.ok) {
        return {
          status: 'unhealthy',
          message: 'OTLP export credentials are invalid',
          details: { reason: 'invalid_credentials', field: parsed.field },
        }
      }
      const destination = await deps.resolveDestination({ credentials: parsed.credentials, scope })
      if ('error' in destination) {
        return {
          status: 'degraded',
          message: 'OTLP export destination is not available',
          details: { reason: destination.error },
        }
      }
      const result = await sendOtelTestSpan(destination, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (result.ok) {
        return {
          status: 'healthy',
          message: 'OTLP collector accepted the test span',
          details: { httpStatus: result.httpStatus, latencyMs: result.latencyMs },
        }
      }
      return {
        status: 'unhealthy',
        message: 'OTLP collector rejected the test span',
        details: { reason: result.errorCode, httpStatus: result.httpStatus, latencyMs: result.latencyMs },
      }
    },
  }
}

export type OtelExportHealthCheck = ReturnType<typeof createOtelExportHealthCheck>
