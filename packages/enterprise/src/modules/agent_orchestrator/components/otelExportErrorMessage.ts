import type { useT } from '@open-mercato/shared/lib/i18n/context'
import { OTLP_ERROR_CODES } from '../lib/trace/otel/otlpHttpClient'
import {
  isOtelExportDestinationErrorCode,
  type OtelExportDestinationErrorCode,
} from '../lib/trace/otel/exportSettingsForm'

type Translate = ReturnType<typeof useT>

const HTTP_ERROR_CODE = /^http_(\d{3})$/

export function destinationErrorMessage(
  code: OtelExportDestinationErrorCode,
  t: ReturnType<typeof useT>,
): string {
  switch (code) {
    case 'integration_unconfigured':
      return t(
        'agent_orchestrator.settings.otelExport.test.destination.integrationUnconfigured',
        'The integration has no valid endpoint for this organization. Configure it first.',
      )
    case 'integration_disabled':
      return t(
        'agent_orchestrator.settings.otelExport.test.destination.integrationDisabled',
        'The integration is disabled for this organization. Enable it first.',
      )
    case 'tenant_endpoints_denied':
      return t(
        'agent_orchestrator.settings.otelExport.test.destination.tenantEndpointsDenied',
        'This installation does not allow sending traces to tenant endpoints.',
      )
    case 'endpoint_blocked':
      return t(
        'agent_orchestrator.settings.otelExport.test.destination.endpointBlocked',
        'The integration endpoint is not allowed: it must be a public HTTPS address.',
      )
    case 'deployment_unconfigured':
      return t(
        'agent_orchestrator.settings.otelExport.test.destination.deploymentUnconfigured',
        'The operator has not configured a usable endpoint for this installation.',
      )
  }
}

export function describeOtelDeliveryError(code: string, t: Translate): string {
  if (isOtelExportDestinationErrorCode(code)) return destinationErrorMessage(code, t)
  const httpMatch = HTTP_ERROR_CODE.exec(code)
  if (httpMatch) {
    return t('agent_orchestrator.settings.otelExport.errors.http', 'the backend answered HTTP {status}', {
      status: httpMatch[1],
    })
  }
  switch (code) {
    case OTLP_ERROR_CODES.timeout:
      return t('agent_orchestrator.settings.otelExport.errors.timeout', 'the backend did not answer in time')
    case OTLP_ERROR_CODES.network:
      return t('agent_orchestrator.settings.otelExport.errors.network', 'the backend could not be reached')
    case OTLP_ERROR_CODES.invalidEndpoint:
      return t('agent_orchestrator.settings.otelExport.errors.invalidEndpoint', 'the endpoint address is not valid')
    case OTLP_ERROR_CODES.encoding:
      return t('agent_orchestrator.settings.otelExport.errors.encoding', 'the trace could not be encoded')
    case 'unexpected':
      return t('agent_orchestrator.settings.otelExport.errors.unexpected', 'an unexpected error stopped the export')
    default:
      return t('agent_orchestrator.settings.otelExport.errors.unknown', 'unknown error')
  }
}
