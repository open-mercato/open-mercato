import type { LookupFn } from '@open-mercato/web-research'
import type { OtelExportSettings } from '../../../data/validators'
import {
  isOtelExportDeploymentEndpointUsable,
  resolveOtelExportDeployment,
  resolveOtelExportWireProtocol,
  type OtelExportContainer,
  type OtelExportDeploymentConfig,
  type OtelExportProtocol,
} from './exportSettings'
import {
  parseOtelExportIntegrationCredentials,
  type OtelExportHealthDestinationResolver,
  type OtelExportIntegrationCredentialsParsed,
} from './exportIntegration'
import { OTEL_EXPORT_DESTINATION_ERRORS, OTEL_EXPORT_INTEGRATION_ID } from './exportIntegrationIds'
import { vetTenantOtlpEndpoint } from './tenantEndpoint'

type EnvLike = Record<string, string | undefined>

export { OTEL_EXPORT_DESTINATION_ERRORS }

export type OtelExportDestinationError =
  (typeof OTEL_EXPORT_DESTINATION_ERRORS)[keyof typeof OTEL_EXPORT_DESTINATION_ERRORS]

/**
 * Where one export goes. Never logged or returned to API callers: the endpoint
 * and header values stay server-side. `pinnedAddresses` is set for tenant
 * endpoints so the connection only reaches the vetted IPs.
 */
export type OtelExportDestination = {
  endpoint: string
  headers: Record<string, string>
  protocol: OtelExportProtocol
  pinnedAddresses?: string[]
  source: 'deployment' | 'integration'
}

export type OtelExportDestinationResult = OtelExportDestination | { error: OtelExportDestinationError }

export type OtelExportDestinationScope = {
  tenantId: string
  organizationId: string | null
}

export type ResolveOtelExportDestinationOptions = {
  env?: EnvLike
  lookup?: LookupFn
}

type IntegrationCredentialsServiceLike = {
  resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
}

type IntegrationStateServiceLike = {
  isEnabled(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<boolean>
}

function tryResolve<T>(container: OtelExportContainer, name: string): T | null {
  try {
    return container.resolve(name) as T
  } catch {
    return null
  }
}

export function isOtelExportDestinationError(
  result: OtelExportDestinationResult,
): result is { error: OtelExportDestinationError } {
  return 'error' in result
}

/**
 * Vets validated integration credentials into a pinned tenant destination.
 * Fails closed: tenant endpoints must be allowed by the deployment
 * (`OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS=allow`) and the endpoint must pass
 * the SSRF gate.
 */
export async function resolveOtelExportIntegrationDestination(
  credentials: OtelExportIntegrationCredentialsParsed,
  deployment: Pick<OtelExportDeploymentConfig, 'switchOn' | 'tenantEndpointsAllowed'>,
  options: ResolveOtelExportDestinationOptions = {},
): Promise<OtelExportDestinationResult> {
  if (!deployment.switchOn || !deployment.tenantEndpointsAllowed) {
    return { error: OTEL_EXPORT_DESTINATION_ERRORS.tenantEndpointsDenied }
  }
  const vetted = await vetTenantOtlpEndpoint(
    credentials.endpoint,
    options.env ?? process.env,
    options.lookup ? { lookup: options.lookup } : {},
  )
  if (!vetted.ok) return { error: OTEL_EXPORT_DESTINATION_ERRORS.endpointBlocked }
  return {
    endpoint: vetted.url,
    headers: credentials.headers,
    protocol: credentials.protocol,
    pinnedAddresses: vetted.addresses,
    source: 'integration',
  }
}

async function resolveIntegrationScopeDestination(
  container: OtelExportContainer,
  deployment: OtelExportDeploymentConfig,
  scope: OtelExportDestinationScope,
  options: ResolveOtelExportDestinationOptions,
): Promise<OtelExportDestinationResult> {
  if (!deployment.switchOn || !deployment.tenantEndpointsAllowed) {
    return { error: OTEL_EXPORT_DESTINATION_ERRORS.tenantEndpointsDenied }
  }
  if (!scope.organizationId) return { error: OTEL_EXPORT_DESTINATION_ERRORS.integrationUnconfigured }
  const integrationScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const credentialsService = tryResolve<IntegrationCredentialsServiceLike>(container, 'integrationCredentialsService')
  if (!credentialsService) return { error: OTEL_EXPORT_DESTINATION_ERRORS.integrationUnconfigured }
  const raw = await credentialsService.resolve(OTEL_EXPORT_INTEGRATION_ID, integrationScope)
  if (!raw) return { error: OTEL_EXPORT_DESTINATION_ERRORS.integrationUnconfigured }
  const parsed = parseOtelExportIntegrationCredentials(raw)
  if (!parsed.ok) return { error: OTEL_EXPORT_DESTINATION_ERRORS.integrationUnconfigured }
  const stateService = tryResolve<IntegrationStateServiceLike>(container, 'integrationStateService')
  if (!stateService || !(await stateService.isEnabled(OTEL_EXPORT_INTEGRATION_ID, integrationScope))) {
    return { error: OTEL_EXPORT_DESTINATION_ERRORS.integrationDisabled }
  }
  return resolveOtelExportIntegrationDestination(parsed.credentials, deployment, options)
}

export type OtelExportIntegrationStatus = {
  configured: boolean
  enabled: boolean
}

/**
 * Whether the organization's `agent_orchestrator_otel_export` integration has
 * valid credentials and is enabled. Only the two booleans leave this function:
 * never the endpoint or header values.
 */
export async function readOtelExportIntegrationStatus(
  container: OtelExportContainer,
  scope: OtelExportDestinationScope,
): Promise<OtelExportIntegrationStatus> {
  if (!scope.organizationId) return { configured: false, enabled: false }
  const integrationScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const credentialsService = tryResolve<IntegrationCredentialsServiceLike>(container, 'integrationCredentialsService')
  const raw = credentialsService ? await credentialsService.resolve(OTEL_EXPORT_INTEGRATION_ID, integrationScope) : null
  const configured = raw !== null && parseOtelExportIntegrationCredentials(raw).ok
  const stateService = tryResolve<IntegrationStateServiceLike>(container, 'integrationStateService')
  const enabled = stateService ? await stateService.isEnabled(OTEL_EXPORT_INTEGRATION_ID, integrationScope) : false
  return { configured, enabled }
}

/**
 * The destination of one export for a tenant + organization (a run's own
 * organization, or the caller's for a test span). `deployment` uses the
 * deployment endpoint and headers. `integration` uses the organization's
 * `agent_orchestrator_otel_export` credentials, only while the integration is
 * enabled and the deployment allows tenant endpoints, vetted and pinned. Fails
 * closed with an error code and never falls back to the deployment endpoint.
 * Neither the endpoint nor the header values are logged.
 */
export async function resolveOtelExportDestination(
  container: OtelExportContainer,
  deployment: OtelExportDeploymentConfig,
  settings: Pick<OtelExportSettings, 'destination'>,
  scope: OtelExportDestinationScope,
  options: ResolveOtelExportDestinationOptions = {},
): Promise<OtelExportDestinationResult> {
  if (settings.destination === 'integration') {
    return resolveIntegrationScopeDestination(container, deployment, scope, options)
  }
  if (!deployment.switchOn || !isOtelExportDeploymentEndpointUsable(deployment) || deployment.endpoint === null) {
    return { error: OTEL_EXPORT_DESTINATION_ERRORS.deploymentUnconfigured }
  }
  return {
    endpoint: deployment.endpoint,
    headers: deployment.headers,
    protocol: resolveOtelExportWireProtocol(deployment.protocol),
    source: 'deployment',
  }
}

/**
 * Health-check resolver for the `agent_orchestrator_otel_export` integration:
 * the same tenant-endpoint gate and SSRF vetting as live exports, applied to
 * the credentials under test.
 */
export function createOtelExportHealthDestinationResolver(
  options: ResolveOtelExportDestinationOptions = {},
): OtelExportHealthDestinationResolver {
  return async ({ credentials }) => {
    const env = options.env ?? process.env
    const deployment = resolveOtelExportDeployment(env)
    const destination = await resolveOtelExportIntegrationDestination(credentials, deployment, { ...options, env })
    if (isOtelExportDestinationError(destination)) return destination
    return {
      endpoint: destination.endpoint,
      headers: destination.headers,
      protocol: destination.protocol,
      pinnedAddresses: destination.pinnedAddresses,
      serviceName: deployment.serviceName,
    }
  }
}
