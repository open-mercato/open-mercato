export const OTEL_EXPORT_INTEGRATION_ID = 'agent_orchestrator_otel_export'
export const OTEL_EXPORT_HEALTH_CHECK_SERVICE = 'agentOrchestratorOtelExportHealthCheck'

export const OTEL_EXPORT_DESTINATION_ERRORS = {
  deploymentUnconfigured: 'deployment_unconfigured',
  integrationUnconfigured: 'integration_unconfigured',
  integrationDisabled: 'integration_disabled',
  tenantEndpointsDenied: 'tenant_endpoints_denied',
  endpointBlocked: 'endpoint_blocked',
} as const
